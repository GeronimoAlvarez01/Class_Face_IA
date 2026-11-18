"""Motor de rostros: detecta con MTCNN y genera el embedding con FaceNet (misma lógica del notebook de Colab)."""
from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np
from PIL import Image


@dataclass(frozen=True)
class FaceResult:
    faces: int                       # rostros significativos en la imagen
    embedding: np.ndarray | None     # solo si hay exactamente uno (vector L2-normalizado de 512)


class Engine(Protocol):
    name: str

    def analyze(self, image: Image.Image) -> FaceResult: ...


class FacenetEngine:
    name = "facenet-vggface2"

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
            model.load_state_dict(torch.load(weights_path, map_location="cpu"))
        else:
            model = InceptionResnetV1(pretrained="vggface2")  # descarga los pesos la primera vez
        self._model = model.eval().to(self.device)

    def analyze(self, image: Image.Image) -> FaceResult:
        torch = self._torch
        with self._lock, torch.no_grad():
            boxes, probs = self._mtcnn.detect(image)
            if boxes is None:
                return FaceResult(0, None)
            confident = [(b, p) for b, p in zip(boxes, probs) if p is not None and p >= self.min_conf]
            if not confident:
                return FaceResult(0, None)
            areas = [(b[2] - b[0]) * (b[3] - b[1]) for b, _ in confident]
            biggest = max(areas)
            significant = [i for i, a in enumerate(areas) if a >= self.background_ratio * biggest]
            if len(significant) != 1:
                return FaceResult(len(significant), None)

            box = confident[significant[0]][0]
            out = self._mtcnn.extract(image, np.asarray([box]), None)
            face = out[0] if isinstance(out, (list, tuple)) else out
            emb = self._model(face.unsqueeze(0).to(self.device))
            emb = torch.nn.functional.normalize(emb, dim=1)[0].cpu().numpy().astype(np.float32)
            return FaceResult(1, emb)
