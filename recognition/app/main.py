"""Servicio de reconocimiento. Contrato con el backend Node:

  POST   /enroll      {student_id, image_base64, replace}      -> 200 {ok, faces} | 422 {detail}
  DELETE /students/{student_id}                                 -> 200 | 404
  POST   /recognize   {image_base64, candidate_ids}             -> 200 {faces, match, similarity, reason, box}
                      (box = [x1, y1, x2, y2] normalizada 0..1 del rostro único, o null; con candidate_ids = []
                       sirve solo para detectar el rostro y su posición)
  GET    /health

Modo demo (variable DEMO_TRACE=1): /enroll y /recognize añaden "trace" con los datos reales de cada etapa
(detección, recorte, bloques de la red, embedding, similitudes, decisión) para el visor "Laboratorio IA".
Apagado por defecto: sin DEMO_TRACE no se calcula ni se envía nada extra. El body admite "trace": false
para omitirlo en una llamada concreta (p. ej. la comprobación del recuadro guía); nunca puede activarlo.
"""
from __future__ import annotations

import base64
import binascii
import io
import os
import re
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.applications import Starlette
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from .engine import Engine, FaceResult
from .matching import identify
from .store import GalleryStore
from .trace import thumbnail_b64

ID_RE = re.compile(r"^[A-Za-z0-9]{4,20}$")
MAX_SIDE = 1280  # las fotos de tablet son enormes; MTCNN no necesita más para ver un rostro


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    weights_path: Path | None
    tau: float = 0.55         # más estricto que el 0.42 calibrado en pares 1:1 de LFW (ver README)
    min_margin: float = 0.05
    max_image_mb: int = 15
    demo_trace: bool = False  # DEMO_TRACE=1: añade el trace de cada etapa a las respuestas

    @staticmethod
    def from_env() -> "Settings":
        weights = os.getenv("WEIGHTS_PATH", "weights/facenet_vggface2.pt")
        return Settings(
            data_dir=Path(os.getenv("DATA_DIR", "data")),
            weights_path=Path(weights) if weights else None,
            tau=float(os.getenv("TAU", "0.55")),
            min_margin=float(os.getenv("MIN_MARGIN", "0.05")),
            max_image_mb=int(os.getenv("MAX_IMAGE_MB", "15")),
            demo_trace=os.getenv("DEMO_TRACE", "0").strip().lower() in ("1", "true", "yes", "on"),
        )


class BadImage(Exception):
    pass


def decode_image(b64: object, max_mb: int) -> Image.Image:
    if not isinstance(b64, str) or not b64:
        raise BadImage("Falta la imagen")
    b64 = re.sub(r"^data:image/[a-z+]+;base64,", "", b64, flags=re.I)
    if len(b64) > max_mb * 1024 * 1024 * 4 // 3:
        raise BadImage("La imagen es demasiado grande")
    try:
        raw = base64.b64decode(b64, validate=False)
        img = Image.open(io.BytesIO(raw))
        img.load()
    except (binascii.Error, UnidentifiedImageError, OSError, Image.DecompressionBombError):
        raise BadImage("La imagen no es válida")
    img = ImageOps.exif_transpose(img)  # las fotos de celular/tablet traen la rotación en EXIF
    img = img.convert("RGB")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    return img


def _json(status: int, body: dict) -> JSONResponse:
    return JSONResponse(body, status_code=status)


def create_app(engine_factory: Callable[[Settings], Engine], settings: Settings) -> Starlette:
    state: dict = {}

    @asynccontextmanager
    async def lifespan(_app: Starlette):
        state["engine"] = await run_in_threadpool(engine_factory, settings)  # el modelo carga una sola vez, al arrancar
        state["store"] = GalleryStore(settings.data_dir / "gallery.json")
        yield

    async def read_json(request: Request) -> dict:
        try:
            body = await request.json()
        except ValueError:
            raise BadImage("JSON inválido")
        if not isinstance(body, dict):
            raise BadImage("JSON inválido")
        return body

    def wants_trace(body: dict) -> bool:
        # El cliente solo puede APAGARLO; encenderlo depende del servidor (DEMO_TRACE) y de que el motor lo soporte.
        return (settings.demo_trace and getattr(state["engine"], "supports_trace", False)
                and body.get("trace", True) is not False)

    async def analyze(img: Image.Image, trace: bool) -> FaceResult:
        engine = state["engine"]
        fn = (lambda: engine.analyze(img, trace=True)) if trace else (lambda: engine.analyze(img))
        return await run_in_threadpool(fn)

    def start_trace(result: FaceResult, kind: str, img: Image.Image, decode_ms: float) -> dict:
        """Completa el trace del motor con lo que solo conoce el servicio: foto de entrada, parámetros y tiempos."""
        tr = result.trace or {}
        tr.update(kind=kind, ts=time.time(), engine=state["engine"].name,
                  params={"tau": settings.tau, "min_margin": settings.min_margin},
                  input={"image": thumbnail_b64(img)})
        tr.setdefault("timings_ms", {})["decode"] = decode_ms
        return tr

    async def health(_request: Request):
        engine, store = state["engine"], state["store"]
        return _json(200, {"ok": True, "engine": engine.name, "students": len(store),
                           "tau": settings.tau, "min_margin": settings.min_margin,
                           "demo_trace": settings.demo_trace and getattr(engine, "supports_trace", False)})

    async def enroll(request: Request):
        try:
            body = await read_json(request)
            sid = body.get("student_id")
            if not isinstance(sid, str) or not ID_RE.match(sid):
                raise BadImage("student_id inválido")
            t = time.perf_counter()
            img = decode_image(body.get("image_base64"), settings.max_image_mb)
            decode_ms = round((time.perf_counter() - t) * 1000, 1)
        except BadImage as e:
            return _json(422, {"detail": str(e)})
        trace_on = wants_trace(body)

        store: GalleryStore = state["store"]
        if sid in store.snapshot() and not body.get("replace", False):
            return _json(409, {"detail": "El estudiante ya está inscrito"})

        result: FaceResult = await analyze(img, trace_on)
        tr = start_trace(result, "enroll", img, decode_ms) if trace_on else None
        extra = {"trace": tr} if tr else {}
        if result.faces == 0:
            if tr: tr["outcome"] = "no_face"
            return _json(422, {"detail": "No se detectó ningún rostro. Use una foto de frente, con buena luz.", **extra})
        if result.faces > 1 or result.embedding is None:
            if tr: tr["outcome"] = "multiple_faces"
            return _json(422, {"detail": "Aparece más de una persona. La foto debe tener un solo rostro.", **extra})
        replaced = sid in store.snapshot()
        await run_in_threadpool(store.put, sid, result.embedding)
        if tr:
            tr["outcome"] = "stored"
            tr["storage"] = {"student_id": sid, "replaced": replaced, "gallery_size": len(store)}
        return _json(200, {"ok": True, "faces": 1, **extra})

    async def remove(request: Request):
        sid = request.path_params["student_id"]
        removed = await run_in_threadpool(state["store"].remove, sid)
        return _json(200 if removed else 404, {"ok": removed})

    async def recognize(request: Request):
        try:
            body = await read_json(request)
            t = time.perf_counter()
            img = decode_image(body.get("image_base64"), settings.max_image_mb)
            decode_ms = round((time.perf_counter() - t) * 1000, 1)
            candidates = body.get("candidate_ids")
            if not isinstance(candidates, list) or not all(isinstance(c, str) for c in candidates):
                raise BadImage("candidate_ids debe ser una lista de textos")
        except BadImage as e:
            return _json(422, {"detail": str(e)})
        trace_on = wants_trace(body)

        result: FaceResult = await analyze(img, trace_on)
        tr = start_trace(result, "recognize", img, decode_ms) if trace_on else None
        extra = {"trace": tr} if tr else {}
        if result.faces != 1 or result.embedding is None:
            if tr:
                tr["outcome"] = "no_face" if result.faces == 0 else "multiple_faces"
            return _json(200, {"faces": result.faces, "match": None, "similarity": 0.0, "reason": "faces", **extra})

        gallery = state["store"].snapshot()
        t = time.perf_counter()
        m = identify(result.embedding, gallery, candidates, settings.tau, settings.min_margin)
        box = [round(v, 4) for v in result.box] if result.box else None
        if tr:
            scores = [{"student_id": sid, "similarity": round(sim, 4)} for sid, sim in m.scores]
            tr["comparison"] = {
                "tau": settings.tau, "min_margin": settings.min_margin,
                "candidates": len(candidates), "enrolled": sum(1 for c in candidates if c in gallery),
                "scores": scores,
                "margin": round(scores[0]["similarity"] - scores[1]["similarity"], 4) if len(scores) > 1 else None,
                "match": m.student_id, "reason": m.reason,
            }
            tr["outcome"] = m.reason
            tr["timings_ms"]["compare"] = round((time.perf_counter() - t) * 1000, 2)
        return _json(200, {"faces": 1, "match": m.student_id, "similarity": round(m.similarity, 4),
                           "reason": m.reason, "box": box, **extra})

    return Starlette(
        routes=[
            Route("/health", health),
            Route("/enroll", enroll, methods=["POST"]),
            Route("/recognize", recognize, methods=["POST"]),
            Route("/students/{student_id}", remove, methods=["DELETE"]),
        ],
        lifespan=lifespan,
    )


def default_engine_factory(settings: Settings) -> Engine:
    from .engine import FacenetEngine
    return FacenetEngine(settings.weights_path)


def build_default_app() -> Starlette:
    return create_app(default_engine_factory, Settings.from_env())
