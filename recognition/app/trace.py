"""Ayudas del modo trace (demo): convierten lo que pasa dentro del modelo en JSON pequeño para el visor.

Todo aquí es de SOLO LECTURA: no cambia los pesos, ni el embedding, ni la decisión de identidad.
"""
from __future__ import annotations

import base64
import io

import numpy as np
from PIL import Image


def _b64(img: Image.Image, fmt: str, **kw) -> str:
    buf = io.BytesIO()
    img.save(buf, fmt, **kw)
    mime = "jpeg" if fmt == "JPEG" else "png"
    return f"data:image/{mime};base64," + base64.b64encode(buf.getvalue()).decode()


def jpeg_b64(img: Image.Image, quality: int = 72) -> str:
    return _b64(img.convert("RGB"), "JPEG", quality=quality)


def thumbnail_b64(img: Image.Image, max_side: int = 360, quality: int = 70) -> str:
    """Miniatura de la foto recibida (para que el visor muestre qué entró al sistema)."""
    small = img.copy()
    small.thumbnail((max_side, max_side))
    return jpeg_b64(small, quality)


def maps_strip_b64(maps_u8: np.ndarray) -> str:
    """(k, h, w) uint8 -> una sola tira PNG en escala de grises con los k mapas uno al lado del otro."""
    k, h, w = maps_u8.shape
    strip = np.concatenate([maps_u8[i] for i in range(k)], axis=1) if k else np.zeros((h, w), np.uint8)
    return _b64(Image.fromarray(strip, mode="L"), "PNG", optimize=True)


def rounded(values, nd: int = 4) -> list[float]:
    return [round(float(v), nd) for v in values]
