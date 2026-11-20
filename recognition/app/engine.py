"""Motor de rostros: detecta con MTCNN y genera el embedding con FaceNet (misma lógica del notebook de Colab)."""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np
from PIL import Image


@dataclass(frozen=True)
class FaceResult:
    faces: int                       # rostros significativos en la imagen
    embedding: np.ndarray | None     # solo si hay exactamente uno (vector L2-normalizado de 512)
    # Caja del rostro único, normalizada 0..1 respecto a la imagen: (x1, y1, x2, y2). Permite al backend
    # comprobar que el rostro está dentro del recuadro guía que ve el usuario.
    box: tuple[float, float, float, float] | None = None
    # Solo con analyze(..., trace=True) (modo demo): datos de cada etapa para el visor. Nunca afecta la decisión.
    trace: dict | None = None


class Engine(Protocol):
    name: str

    def analyze(self, image: Image.Image) -> FaceResult: ...


class FacenetEngine:
    name = "facenet-vggface2"
    supports_trace = True   # analyze() acepta trace=True

    def __init__(self, weights_path: Path | None, device: str | None = None,
                 min_conf: float = 0.95, background_ratio: float = 0.35):
        import torch  # import tardío: las pruebas con motor falso no necesitan PyTorch
        from facenet_pytorch import MTCNN, InceptionResnetV1

        self._torch = torch
        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        self.min_conf = min_conf
        # Caras mucho más pequeñas que la principal (un afiche, alguien lejos al fondo) no cuentan como "otra persona"
        self.background_ratio = background_ratio
        self._lock = threading.Lock()
        self._mtcnn = MTCNN(image_size=160, margin=20, post_process=True, device=self.device)

        if weights_path and Path(weights_path).exists():
            # Los pesos que guardó el notebook en Drive (state_dict; 8631 = clases originales de VGGFace2)
            model = InceptionResnetV1(pretrained=None, num_classes=8631)
            state = torch.load(weights_path, map_location="cpu")
            # El checkpoint incluye la capa de clasificación (logits); el modelo sin classify no la tiene
            # y para generar embeddings no se usa, así que se descarta.
            state = {k: v for k, v in state.items() if not k.startswith("logits.")}
            model.load_state_dict(state)
        else:
            model = InceptionResnetV1(pretrained="vggface2")  # descarga los pesos la primera vez
        self._model = model.eval().to(self.device)

    def _sync(self) -> float:
        """Reloj para medir tiempos; en GPU espera a que termine el trabajo pendiente para no medir de menos."""
        if self.device.type == "cuda":
            self._torch.cuda.synchronize()
        return time.perf_counter()

    def analyze(self, image: Image.Image, trace: bool = False) -> FaceResult:
        torch = self._torch
        with self._lock, torch.no_grad():
            t0 = self._sync() if trace else 0.0
            boxes, probs = self._mtcnn.detect(image)
            t_detect = self._sync() if trace else 0.0
            if boxes is None:
                return FaceResult(0, None, trace=self._trace(image, None, None, [], [], None, (t0, t_detect)) if trace else None)
            conf = [i for i, p in enumerate(probs) if p is not None and p >= self.min_conf]
            if not conf:
                return FaceResult(0, None, trace=self._trace(image, boxes, probs, [], [], None, (t0, t_detect)) if trace else None)
            areas = {i: float((boxes[i][2] - boxes[i][0]) * (boxes[i][3] - boxes[i][1])) for i in conf}
            biggest = max(areas.values())
            significant = [i for i in conf if areas[i] >= self.background_ratio * biggest]
            if len(significant) != 1:
                return FaceResult(len(significant), None,
                                  trace=self._trace(image, boxes, probs, conf, significant, None, (t0, t_detect)) if trace else None)

            sel = significant[0]
            box = boxes[sel]
            out = self._mtcnn.extract(image, np.asarray([box]), None)
            face = out[0] if isinstance(out, (list, tuple)) else out
            t_crop = self._sync() if trace else 0.0

            batch = face.unsqueeze(0).to(self.device)
            net = None
            if trace:
                from .netprobe import NetworkProbe
                with NetworkProbe(self._model, torch) as probe:   # hooks de solo lectura; se quitan al salir
                    emb = self._model(batch)
                    net = probe.report()
            else:
                emb = self._model(batch)
            emb = torch.nn.functional.normalize(emb, dim=1)[0].cpu().numpy().astype(np.float32)
            t_net = self._sync() if trace else 0.0

            w, h = image.size
            x1, y1, x2, y2 = (float(v) for v in box)
            norm = (max(0.0, x1 / w), max(0.0, y1 / h), min(1.0, x2 / w), min(1.0, y2 / h))
            tr = None
            if trace:
                tr = self._trace(image, boxes, probs, conf, significant, sel, (t0, t_detect))
                tr["crop"] = {"size": 160, "normalization": "(x - 127.5) / 128", "image": self._crop_b64(face)}
                tr["network"] = net
                tr["embedding"] = {"dim": int(emb.shape[0]), "values": [round(float(v), 4) for v in emb],
                                   "norm_before_l2": net["dense_out_norm"]}
                tr["timings_ms"].update(crop=round((t_crop - t_detect) * 1000, 1),
                                        network=round((t_net - t_crop) * 1000, 1),
                                        engine=round((t_net - t0) * 1000, 1))
            return FaceResult(1, emb, norm, tr)

    # --- partes del trace ---
    def _trace(self, image, boxes, probs, conf, significant, selected, times) -> dict:
        """Cabecera común: imagen y detección (se usa también cuando no hay rostro o hay varios)."""
        w, h = image.size
        biggest = max(((boxes[i][2] - boxes[i][0]) * (boxes[i][3] - boxes[i][1]) for i in conf), default=0.0)
        faces = []
        for i in range(0 if boxes is None else len(boxes)):
            x1, y1, x2, y2 = (float(v) for v in boxes[i])
            area = (x2 - x1) * (y2 - y1)
            faces.append({
                "box": [round(max(0.0, x1 / w), 4), round(max(0.0, y1 / h), 4),
                         round(min(1.0, x2 / w), 4), round(min(1.0, y2 / h), 4)],
                "prob": None if probs[i] is None else round(float(probs[i]), 4),
                "confident": i in conf, "significant": i in significant, "selected": i == selected,
                "area_ratio": round(area / biggest, 3) if biggest and i in conf else None,
            })
        return {
            "image": {"width": w, "height": h},
            "detection": {"min_conf": self.min_conf, "background_ratio": self.background_ratio,
                          "faces": faces, "faces_counted": len(significant)},
            "device": str(self.device),
            "timings_ms": {"detect": round((times[1] - times[0]) * 1000, 1)},
        }

    def _crop_b64(self, face) -> str:
        from .trace import jpeg_b64
        arr = (face.detach().cpu() * 128.0 + 127.5).clamp(0, 255).byte().permute(1, 2, 0).numpy()  # deshace la estandarización
        return jpeg_b64(Image.fromarray(arr), 85)
