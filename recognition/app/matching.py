"""Decisión de identidad: lógica pura (sin modelo ni red), por eso es fácil de probar."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Match:
    student_id: str | None  # None = desconocido
    similarity: float       # mejor similitud coseno entre los candidatos inscritos
    reason: str             # ok | below_threshold | ambiguous | no_candidates


def identify(
    query: np.ndarray,
    gallery: dict[str, np.ndarray],
    candidate_ids: list[str],
    tau: float,
    min_margin: float = 0.0,
) -> Match:
    """
    Compara `query` (vector L2-normalizado) solo contra los candidatos (los estudiantes del grupo).

    - `tau`: similitud mínima. En 1:N el riesgo de falsa aceptación crece con el número de candidatos,
      por eso el umbral de producción es más estricto que el calibrado en pares 1:1.
    - `min_margin`: el mejor candidato debe superar al segundo por este margen; si dos estudiantes
      quedan casi empatados preferimos no marcar a nadie antes que marcar al equivocado.
    """
    scores: list[tuple[float, str]] = []
    for sid in candidate_ids:
        mat = gallery.get(sid)
        if mat is None or len(mat) == 0:
            continue
        scores.append((float(np.max(mat @ query)), sid))  # mejor foto inscrita de ese estudiante

    if not scores:
        return Match(None, 0.0, "no_candidates")

    scores.sort(reverse=True)
    best_sim, best_id = scores[0]
    if best_sim < tau:
        return Match(None, best_sim, "below_threshold")
    if min_margin > 0 and len(scores) > 1 and (best_sim - scores[1][0]) < min_margin:
        return Match(None, best_sim, "ambiguous")
    return Match(best_id, best_sim, "ok")
