"""Servicio de reconocimiento. Contrato con el backend Node:

  POST   /enroll      {student_id, image_base64, replace}      -> 200 {ok, faces} | 422 {detail}
  DELETE /students/{student_id}                                 -> 200 | 404
  POST   /recognize   {image_base64, candidate_ids}             -> 200 {faces, match, similarity, reason, box}
                      (box = [x1, y1, x2, y2] normalizada 0..1 del rostro único, o null; con candidate_ids = []
                       sirve solo para detectar el rostro y su posición)
  GET    /health
"""
from __future__ import annotations

import base64
import binascii
import io
import os
import re
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

ID_RE = re.compile(r"^[A-Za-z0-9]{4,20}$")
MAX_SIDE = 1280  # las fotos de tablet son enormes; MTCNN no necesita más para ver un rostro


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    weights_path: Path | None
    tau: float = 0.55         # más estricto que el 0.42 calibrado en pares 1:1 de LFW (ver README)
    min_margin: float = 0.05
    max_image_mb: int = 15

    @staticmethod
    def from_env() -> "Settings":
        weights = os.getenv("WEIGHTS_PATH", "weights/facenet_vggface2.pt")
        return Settings(
            data_dir=Path(os.getenv("DATA_DIR", "data")),
            weights_path=Path(weights) if weights else None,
            tau=float(os.getenv("TAU", "0.55")),
            min_margin=float(os.getenv("MIN_MARGIN", "0.05")),
            max_image_mb=int(os.getenv("MAX_IMAGE_MB", "15")),
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

    async def health(_request: Request):
        engine, store = state["engine"], state["store"]
        return _json(200, {"ok": True, "engine": engine.name, "students": len(store),
                           "tau": settings.tau, "min_margin": settings.min_margin})

    async def enroll(request: Request):
        try:
            body = await read_json(request)
            sid = body.get("student_id")
            if not isinstance(sid, str) or not ID_RE.match(sid):
                raise BadImage("student_id inválido")
            img = decode_image(body.get("image_base64"), settings.max_image_mb)
        except BadImage as e:
            return _json(422, {"detail": str(e)})

        store: GalleryStore = state["store"]
        if sid in store.snapshot() and not body.get("replace", False):
            return _json(409, {"detail": "El estudiante ya está inscrito"})

        result: FaceResult = await run_in_threadpool(state["engine"].analyze, img)
        if result.faces == 0:
            return _json(422, {"detail": "No se detectó ningún rostro. Use una foto de frente, con buena luz."})
        if result.faces > 1 or result.embedding is None:
            return _json(422, {"detail": "Aparece más de una persona. La foto debe tener un solo rostro."})
        await run_in_threadpool(store.put, sid, result.embedding)
        return _json(200, {"ok": True, "faces": 1})

    async def remove(request: Request):
        sid = request.path_params["student_id"]
        removed = await run_in_threadpool(state["store"].remove, sid)
        return _json(200 if removed else 404, {"ok": removed})

    async def recognize(request: Request):
        try:
            body = await read_json(request)
            img = decode_image(body.get("image_base64"), settings.max_image_mb)
            candidates = body.get("candidate_ids")
            if not isinstance(candidates, list) or not all(isinstance(c, str) for c in candidates):
                raise BadImage("candidate_ids debe ser una lista de textos")
        except BadImage as e:
            return _json(422, {"detail": str(e)})

        result: FaceResult = await run_in_threadpool(state["engine"].analyze, img)
        if result.faces != 1 or result.embedding is None:
            return _json(200, {"faces": result.faces, "match": None, "similarity": 0.0, "reason": "faces"})

        m = identify(result.embedding, state["store"].snapshot(), candidates, settings.tau, settings.min_margin)
        box = [round(v, 4) for v in result.box] if result.box else None
        return _json(200, {"faces": 1, "match": m.student_id, "similarity": round(m.similarity, 4),
                           "reason": m.reason, "box": box})

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
