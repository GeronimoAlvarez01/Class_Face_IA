"""Galería de embeddings persistente: sobrevive a reinicios y nunca queda a medio escribir."""
from __future__ import annotations

import json
import os
import tempfile
import threading
from pathlib import Path

import numpy as np

EMBEDDING_DIM = 512


class GalleryStore:
    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = threading.Lock()
        self._data: dict[str, np.ndarray] = {}
        self._load()

    def _load(self) -> None:
        if not self.path.exists():
            return
        raw = json.loads(self.path.read_text(encoding="utf-8"))
        self._data = {sid: np.asarray(vecs, dtype=np.float32) for sid, vecs in raw["students"].items()}

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "version": 1,
            "embedding_dim": EMBEDDING_DIM,
            "students": {sid: mat.tolist() for sid, mat in self._data.items()},
        }
        # Escritura atómica: archivo temporal + reemplazo. Si se corta la luz a mitad, el anterior queda intacto.
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(payload, f)
            os.replace(tmp, self.path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    def put(self, student_id: str, embedding: np.ndarray) -> None:
        """Inscribe (o reemplaza) al estudiante con un único embedding."""
        with self._lock:
            self._data[student_id] = embedding.reshape(1, -1).astype(np.float32)
            self._save()

    def remove(self, student_id: str) -> bool:
        with self._lock:
            if student_id not in self._data:
                return False
            del self._data[student_id]
            self._save()
            return True

    def snapshot(self) -> dict[str, np.ndarray]:
        with self._lock:
            return dict(self._data)

    def __len__(self) -> int:
        return len(self._data)
