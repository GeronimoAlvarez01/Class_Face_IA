"""Sonda de la red y trace del motor real. Necesitan PyTorch + facenet-pytorch (si no están, se omiten).

No descargan pesos ni usan fotos de personas: la red va con pesos aleatorios y MTCNN se reemplaza por un doble;
lo que se verifica es que la sonda sea de SOLO LECTURA y que describa correctamente la estructura de la red.
"""
import base64
import io

import numpy as np
import pytest
from PIL import Image

torch = pytest.importorskip("torch")
pytest.importorskip("facenet_pytorch")
from facenet_pytorch import InceptionResnetV1  # noqa: E402

from app.engine import FacenetEngine  # noqa: E402
from app.netprobe import NetworkProbe  # noqa: E402


@pytest.fixture(scope="module")
def model():
    torch.manual_seed(0)
    return InceptionResnetV1(pretrained=None, num_classes=8631).eval()


def face_batch(seed=1):
    g = torch.Generator().manual_seed(seed)
    return torch.randn(1, 3, 160, 160, generator=g)


def test_la_sonda_no_cambia_el_embedding_y_quita_sus_hooks(model):
    x = face_batch()
    with torch.no_grad():
        plain = model(x)
        with NetworkProbe(model, torch) as probe:
            probed = model(x)
            probe.report()
        again = model(x)
    assert torch.equal(plain, probed) and torch.equal(plain, again)          # idéntico bit a bit
    assert all(len(m._forward_hooks) == 0 for m in model.modules())          # no deja hooks colgados


def test_la_sonda_quita_los_hooks_aunque_falle_la_pasada(model):
    with pytest.raises(RuntimeError):
        with NetworkProbe(model, torch):
            model(torch.randn(1, 3, 160, 160)[:, :2])                       # canales equivocados -> error dentro del with
    assert all(len(m._forward_hooks) == 0 for m in model.modules())


def test_la_sonda_describe_la_estructura_real_de_la_red(model):
    with torch.no_grad(), NetworkProbe(model, torch) as probe:
        model(face_batch())
        rep = probe.report()
    shapes = {s["key"]: s["shape"] for s in rep["stages"]}
    assert shapes == {"conv1": [32, 79, 79], "stem": [256, 17, 17], "block35": [256, 17, 17],
                      "reduction_a": [896, 8, 8], "block17": [896, 8, 8], "reduction_b": [1792, 3, 3],
                      "block8": [1792, 3, 3], "avgpool": [1792, 1, 1], "dense": [512]}
    counts = {}
    for r in rep["residual"]:
        counts[r["group"]] = counts.get(r["group"], 0) + 1
    assert counts == {"block35": 5, "block17": 10, "block8": 6} and len(rep["residual"]) == 21
    assert all(r["rel_change"] >= 0 for r in rep["residual"])
    assert len(rep["dense_in"]) == 1792 and rep["dense_out_norm"] > 0
    with_maps = [s for s in rep["stages"] if "maps" in s]
    assert [s["key"] for s in with_maps] == ["conv1", "stem", "block35", "reduction_a", "block17", "reduction_b", "block8"]
    strip = Image.open(io.BytesIO(base64.b64decode(with_maps[0]["maps"].split(",", 1)[1])))
    assert strip.size == (48 * 6, 48) and len(with_maps[0]["map_channels"]) == 6


# ---------- motor completo con MTCNN reemplazado por un doble ----------

class StubMTCNN:
    def __init__(self, boxes, probs, face):
        self.boxes, self.probs, self.face = boxes, probs, face

    def detect(self, image):
        return (None, None) if self.boxes is None else (np.asarray(self.boxes, dtype=float), list(self.probs))

    def extract(self, image, boxes, save_path):
        return self.face


@pytest.fixture()
def engine(tmp_path, model):
    weights = tmp_path / "w.pt"
    torch.save(model.state_dict(), weights)                                  # mismo formato que guarda el notebook
    return FacenetEngine(weights, device="cpu")


IMG = Image.new("RGB", (400, 300), (120, 130, 140))


def with_stub(engine, boxes, probs):
    engine._mtcnn = StubMTCNN(boxes, probs, face_batch(3)[0].clone())
    return engine


def test_analyze_con_trace_da_el_mismo_resultado_que_sin_trace(engine):
    with_stub(engine, [[100, 60, 220, 220]], [0.999])
    plain = engine.analyze(IMG)
    traced = engine.analyze(IMG, trace=True)
    assert plain.trace is None and traced.trace is not None
    assert plain.faces == traced.faces == 1 and plain.box == traced.box
    assert np.array_equal(plain.embedding, traced.embedding)                 # la decisión no puede depender del trace
    tr = traced.trace
    assert tr["image"] == {"width": 400, "height": 300}
    face = tr["detection"]["faces"][0]
    assert face["selected"] and face["confident"] and face["significant"] and face["prob"] == 0.999
    assert tr["crop"]["size"] == 160 and tr["crop"]["image"].startswith("data:image/jpeg;base64,")
    assert tr["embedding"]["dim"] == 512 and len(tr["embedding"]["values"]) == 512
    assert abs(sum(v * v for v in tr["embedding"]["values"]) - 1) < 1e-2     # vector L2-normalizado
    assert {"detect", "crop", "network", "engine"} <= set(tr["timings_ms"])
    assert len(tr["network"]["stages"]) == 9 and len(tr["network"]["residual"]) == 21


def test_trace_cuando_no_hay_rostro_o_hay_varios(engine):
    r = with_stub(engine, None, None).analyze(IMG, trace=True)
    assert r.faces == 0 and r.trace["detection"]["faces"] == [] and "network" not in r.trace

    r = with_stub(engine, [[10, 10, 60, 70]], [0.40]).analyze(IMG, trace=True)       # detectado pero con poca confianza
    assert r.faces == 0 and r.trace["detection"]["faces"][0]["confident"] is False

    r = with_stub(engine, [[10, 10, 130, 170], [200, 20, 320, 180]], [0.99, 0.98]).analyze(IMG, trace=True)
    assert r.faces == 2 and r.embedding is None and r.trace["detection"]["faces_counted"] == 2
    assert not any(f["selected"] for f in r.trace["detection"]["faces"])

    # Un rostro pequeño al fondo no cuenta como otra persona (background_ratio) pero queda marcado en el trace
    r = with_stub(engine, [[10, 10, 130, 170], [300, 20, 320, 40]], [0.99, 0.99]).analyze(IMG, trace=True)
    small = r.trace["detection"]["faces"][1]
    assert r.faces == 1 and small["confident"] and not small["significant"] and r.trace["detection"]["faces"][0]["selected"]
