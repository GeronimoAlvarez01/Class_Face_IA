import base64
import io
import json
import socket
import threading
import time
import urllib.error
import urllib.request

import numpy as np
import pytest
import uvicorn
from PIL import Image

from app.engine import FaceResult
from app.main import Settings, create_app
from app.matching import identify
from app.store import GalleryStore


# ---------- motor falso: la identidad sale del color del píxel (0,0) ----------

def unit(v):
    return (v / np.linalg.norm(v)).astype(np.float32)


class FakeEngine:
    name = "fake"

    def analyze(self, image: Image.Image) -> FaceResult:
        if image.getpixel((0, 0)) == (255, 255, 255):
            return FaceResult(0, None)           # imagen en blanco: nadie
        if image.width >= 32:
            return FaceResult(2, None)           # imagen ancha: dos personas
        r, g, b = image.getpixel((0, 0))
        base = np.random.default_rng(r * 65536 + g * 256 + b).normal(size=512)
        noise = np.random.default_rng(image.getpixel((1, 1))[0] + 1).normal(size=512)
        return FaceResult(1, unit(base + 0.15 * noise))   # "otra foto de la misma persona" = mismo base, ruido distinto


def png_b64(color, noise=0, width=8) -> str:
    img = Image.new("RGB", (width, 8), color)
    img.putpixel((1, 1), (noise, 0, 0))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


SAMUEL, CAMILO, DESCONOCIDO = (10, 20, 30), (40, 50, 60), (200, 100, 50)


# ---------- lógica de decisión ----------

def emb(seed):
    return unit(np.random.default_rng(seed).normal(size=512))


def test_identify_acepta_al_mejor_candidato_y_rechaza_por_debajo_del_umbral():
    gallery = {"a": emb(1).reshape(1, -1), "b": emb(2).reshape(1, -1)}
    assert identify(emb(1), gallery, ["a", "b"], tau=0.55).student_id == "a"
    m = identify(emb(3), gallery, ["a", "b"], tau=0.55)
    assert m.student_id is None and m.reason == "below_threshold"


def test_identify_solo_compara_contra_los_candidatos_del_grupo():
    gallery = {"a": emb(1).reshape(1, -1), "b": emb(2).reshape(1, -1)}
    m = identify(emb(1), gallery, ["b"], tau=0.55)      # "a" existe pero no está en este grupo
    assert m.student_id is None
    assert identify(emb(1), gallery, [], tau=0.55).reason == "no_candidates"
    assert identify(emb(1), gallery, ["zzz"], tau=0.55).reason == "no_candidates"


def test_identify_margen_evita_empates():
    a = emb(1)
    twin = unit(a + 0.02 * emb(9))                       # casi idéntico a "a"
    gallery = {"a": a.reshape(1, -1), "twin": twin.reshape(1, -1)}
    assert identify(a, gallery, ["a", "twin"], tau=0.55, min_margin=0.05).reason == "ambiguous"
    assert identify(a, gallery, ["a", "twin"], tau=0.55, min_margin=0.0).student_id == "a"


# ---------- galería persistente ----------

def test_galeria_persiste_entre_reinicios_y_reemplaza(tmp_path):
    path = tmp_path / "gallery.json"
    store = GalleryStore(path)
    store.put("1007074776", emb(1))
    store.put("1007074776", emb(2))                      # reemplaza, no acumula
    assert GalleryStore(path).snapshot()["1007074776"].shape == (1, 512)
    assert np.allclose(GalleryStore(path).snapshot()["1007074776"][0], emb(2), atol=1e-6)
    assert GalleryStore(path).remove("1007074776") is True
    assert GalleryStore(path).remove("1007074776") is False
    assert not list(tmp_path.glob("*.tmp"))              # sin archivos temporales huérfanos


# ---------- servicio real (uvicorn) con motor falso ----------

@pytest.fixture()
def service(tmp_path):
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    settings = Settings(data_dir=tmp_path, weights_path=None, tau=0.55, min_margin=0.05)
    server = uvicorn.Server(uvicorn.Config(create_app(lambda _s: FakeEngine(), settings),
                                           host="127.0.0.1", port=port, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)

    def call(method, path, body=None):
        req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", method=method,
                                     data=json.dumps(body).encode() if body is not None else None,
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    yield call, tmp_path
    server.should_exit = True
    thread.join(timeout=5)


def test_flujo_completo_inscribir_reconocer_y_borrar(service):
    call, data_dir = service
    assert call("GET", "/health")[1]["students"] == 0

    # Inscripción con UNA foto por estudiante
    assert call("POST", "/enroll", {"student_id": "1007074776", "image_base64": png_b64(SAMUEL, 0), "replace": True})[0] == 200
    assert call("POST", "/enroll", {"student_id": "1152712132", "image_base64": png_b64(CAMILO, 0), "replace": True})[0] == 200

    both = ["1007074776", "1152712132"]
    # Otra foto de Samuel (ruido distinto) lo reconoce
    st, r = call("POST", "/recognize", {"image_base64": png_b64(SAMUEL, 77), "candidate_ids": both})
    assert (st, r["match"], r["reason"]) == (200, "1007074776", "ok") and r["similarity"] > 0.9
    # Alguien no inscrito es rechazado
    r = call("POST", "/recognize", {"image_base64": png_b64(DESCONOCIDO, 5), "candidate_ids": both})[1]
    assert r["match"] is None and r["reason"] == "below_threshold"
    # Sin rostro / varios rostros: no se intenta reconocer
    assert call("POST", "/recognize", {"image_base64": png_b64((255, 255, 255)), "candidate_ids": both})[1]["faces"] == 0
    r = call("POST", "/recognize", {"image_base64": png_b64(SAMUEL, 0, width=32), "candidate_ids": both})[1]
    assert r["faces"] == 2 and r["match"] is None
    # Solo candidatos del grupo: Samuel existe pero no es candidato aquí
    r = call("POST", "/recognize", {"image_base64": png_b64(SAMUEL, 77), "candidate_ids": ["1152712132"]})[1]
    assert r["match"] is None

    # La galería sobrevive: está en disco
    assert "1007074776" in json.loads((data_dir / "gallery.json").read_text())["students"]

    assert call("DELETE", "/students/1007074776")[0] == 200
    assert call("DELETE", "/students/1007074776")[0] == 404
    r = call("POST", "/recognize", {"image_base64": png_b64(SAMUEL, 77), "candidate_ids": both})[1]
    assert r["match"] is None


def test_validaciones_de_inscripcion(service):
    call, _ = service
    st, r = call("POST", "/enroll", {"student_id": "1007074776", "image_base64": png_b64((255, 255, 255)), "replace": True})
    assert st == 422 and "rostro" in r["detail"]
    st, r = call("POST", "/enroll", {"student_id": "1007074776", "image_base64": png_b64(SAMUEL, 0, width=32), "replace": True})
    assert st == 422 and "más de una persona" in r["detail"]
    assert call("POST", "/enroll", {"student_id": "../x", "image_base64": png_b64(SAMUEL)})[0] == 422
    assert call("POST", "/enroll", {"student_id": "1007074776", "image_base64": "no-es-imagen"})[0] == 422
    # Sin replace, no pisa una inscripción existente
    call("POST", "/enroll", {"student_id": "1007074776", "image_base64": png_b64(SAMUEL, 0), "replace": True})
    assert call("POST", "/enroll", {"student_id": "1007074776", "image_base64": png_b64(SAMUEL, 0)})[0] == 409
    assert call("POST", "/recognize", {"image_base64": png_b64(SAMUEL), "candidate_ids": "no-lista"})[0] == 422
