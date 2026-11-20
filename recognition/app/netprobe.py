"""Sonda de solo lectura sobre InceptionResnetV1: registra, durante UNA pasada, lo que sale de cada bloque.

Usa forward hooks (observan, no modifican), así que el embedding resultante es idéntico con o sin sonda.
Los datos son reales: estadísticas y mapas de activación de ESA foto, no una animación inventada.
"""
from __future__ import annotations

import numpy as np

from .trace import maps_strip_b64, rounded

# (clave, nombre mostrado, atributo del modelo, ¿se extraen mapas de activación?)
STAGES = (
    ("conv1", "Primera convolución (3→32)", "conv2d_1a", True),
    ("stem", "Stem (6 convoluciones → 256)", "conv2d_4b", True),
    ("block35", "Block35 ×5", "repeat_1", True),
    ("reduction_a", "Reducción A (Mixed_6a → 896)", "mixed_6a", True),
    ("block17", "Block17 ×10", "repeat_2", True),
    ("reduction_b", "Reducción B (Mixed_7a → 1792)", "mixed_7a", True),
    ("block8", "Block8 ×6 (5 + el último sin ReLU)", "block8", True),
    ("avgpool", "Promedio global (→ 1792 valores)", "avgpool_1a", False),
    ("dense", "Capa densa 1792→512 + BatchNorm", "last_bn", False),
)

# Bloques residuales individuales: (grupo, atributo). repeat_* son Sequential; block8 es un único bloque.
RESIDUAL = (("block35", "repeat_1"), ("block17", "repeat_2"), ("block8", "repeat_3"), ("block8", "block8"))


class NetworkProbe:
    def __init__(self, model, torch, maps_per_stage: int = 6, map_px: int = 48):
        self._model, self._torch = model, torch
        self._k, self._px = maps_per_stage, map_px
        self._handles: list = []
        self._stage_out: dict[str, object] = {}
        self._residual: list[tuple[str, int, object]] = []  # (grupo, índice, tensor rel_change)

    # --- ciclo de vida: los hooks se quitan siempre, aunque falle la pasada ---
    def __enter__(self):
        torch = self._torch
        for key, _name, attr, _maps in STAGES:
            mod = getattr(self._model, attr)
            self._handles.append(mod.register_forward_hook(self._capture(key)))
        for group, attr in RESIDUAL:
            mod = getattr(self._model, attr)
            blocks = list(mod) if isinstance(mod, torch.nn.Sequential) else [mod]
            for i, block in enumerate(blocks):
                self._handles.append(block.register_forward_hook(self._residual_hook(group, i)))
        return self

    def __exit__(self, *_exc):
        for h in self._handles:
            h.remove()
        self._handles.clear()
        return False

    def _capture(self, key):
        def hook(_mod, _inp, out):
            self._stage_out[key] = out.detach()
        return hook

    def _residual_hook(self, group, index):
        def hook(_mod, inp, out):
            x = inp[0].detach()
            # cuánto cambia el bloque la representación: ||salida - entrada|| / ||entrada||
            rel = (out.detach() - x).flatten().norm() / x.flatten().norm().clamp_min(1e-12)
            self._residual.append((group, index, rel))
        return hook

    # --- informe (se llama dentro del `with`, antes de salir del lock del motor) ---
    def report(self) -> dict:
        torch = self._torch
        stages, stat_tensors = [], []
        for key, name, _attr, with_maps in STAGES:
            x = self._stage_out.get(key)
            if x is None:
                continue
            flat = x.flatten().float()
            stat_tensors.append(torch.stack([flat.abs().mean(), flat.std(), (flat > 0).float().mean()]))
            stages.append((key, name, x, with_maps))
        stats = torch.stack(stat_tensors).cpu().tolist() if stat_tensors else []

        out_stages = []
        for (key, name, x, with_maps), (mean_abs, std, active) in zip(stages, stats):
            shape = list(x.shape[1:])  # sin el lote
            item = {"key": key, "name": name, "shape": shape, "units": int(x[0].numel()),
                    "mean_abs": round(mean_abs, 4), "std": round(std, 4), "active_fraction": round(active, 4)}
            if with_maps and x.dim() == 4 and x.shape[2] > 1:
                item.update(self._maps(x[0]))
            out_stages.append(item)

        residual = []
        if self._residual:
            rels = torch.stack([r for _g, _i, r in self._residual]).cpu().tolist()
            residual = [{"group": g, "index": i, "rel_change": round(rel, 4)}
                        for (g, i, _t), rel in zip(self._residual, rels)]

        avg = self._stage_out.get("avgpool")
        dense_out = self._stage_out.get("dense")
        return {
            "stages": out_stages,
            "residual": residual,
            "dense_in": rounded(avg.flatten().float().cpu().numpy(), 3) if avg is not None else [],
            "dense_out_norm": round(float(dense_out.flatten().float().norm().item()), 4) if dense_out is not None else None,
        }

    def _maps(self, chw) -> dict:
        """Los k canales más 'activos' (mayor desviación espacial) como miniaturas en una sola tira PNG."""
        torch = self._torch
        c = chw.shape[0]
        k = min(self._k, c)
        spread = chw.flatten(1).float().std(dim=1)
        idx = torch.topk(spread, k).indices
        maps = chw[idx].float()
        mn = maps.flatten(1).min(dim=1).values.view(k, 1, 1)
        mx = maps.flatten(1).max(dim=1).values.view(k, 1, 1)
        maps = (maps - mn) / (mx - mn + 1e-6)
        maps = torch.nn.functional.interpolate(maps.unsqueeze(1), size=(self._px, self._px), mode="bilinear",
                                               align_corners=False).squeeze(1)
        u8 = (maps * 255).clamp(0, 255).byte().cpu().numpy()
        return {"maps": maps_strip_b64(u8), "map_px": self._px, "map_channels": [int(i) for i in idx.cpu()],
                "channels": int(c)}
