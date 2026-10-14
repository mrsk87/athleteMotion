"""Rastreador de pessoa (ROI) para inferência de pose em tempo real.

Porquê: a rede tem um tamanho de entrada FIXO (ex.: 640×640 ou 320×320), portanto
processar o fotograma inteiro custa sempre o mesmo, esteja o ciclista a ocupar 20 %
ou 90 % da imagem. Se o recortarmos à volta da pessoa detetada e enviarmos ESSE
recorte, acontecem duas coisas ao mesmo tempo:

1. **A pessoa fica muito maior** dentro da entrada da rede → as articulações são
   localizadas com mais precisão do que no fotograma inteiro.
2. **Podemos descer o tamanho de entrada** (ex.: 320) mantendo a precisão efetiva,
   porque a pessoa já preenche o recorte. Isso corta o custo por fotograma.

A deteção em fotograma inteiro só volta a acontecer de vez em quando (ou quando o
rastreio fica suspeito), o que é o que dá a sensação de "instantâneo" a acompanhar
a perna: a maioria dos fotogramas paga apenas o custo de um recorte pequeno.

Todas as funções de decisão são puras para poderem ser verificadas sem GPU.
"""

from __future__ import annotations

from collections.abc import Sequence

# Caixa normalizada: (x1, y1, x2, y2) em [0, 1].
Box = tuple[float, float, float, float]


def clamp_box(box: Sequence[float]) -> Box:
    """Mantém a caixa dentro da imagem e com área não nula."""
    x1, y1, x2, y2 = (float(v) for v in box)
    x1, x2 = sorted((max(0.0, min(1.0, x1)), max(0.0, min(1.0, x2))))
    y1, y2 = sorted((max(0.0, min(1.0, y1)), max(0.0, min(1.0, y2))))
    return (x1, y1, x2, y2)


def expand_box(box: Sequence[float], margin: float = 0.25) -> Box:
    """Alarga a caixa em `margin` da sua própria largura/altura (contexto da bike).

    O contexto é essencial: sem uma margem generosa a roda e o guiador saem do
    recorte e o modelo perde referências de escala.
    """
    x1, y1, x2, y2 = (float(v) for v in box)
    w = max(1e-6, x2 - x1)
    h = max(1e-6, y2 - y1)
    dx = w * max(0.0, margin)
    dy = h * max(0.0, margin)
    return clamp_box((x1 - dx, y1 - dy, x2 + dx, y2 + dy))


def iou(a: Sequence[float], b: Sequence[float]) -> float:
    """Interseção sobre união de duas caixas normalizadas."""
    ax1, ay1, ax2, ay2 = (float(v) for v in a)
    bx1, by1, bx2, by2 = (float(v) for v in b)
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - inter
    return float(inter / union) if union > 0 else 0.0


def box_to_pixels(box: Sequence[float], width: int, height: int) -> tuple[int, int, int, int]:
    """Converte a caixa normalizada num recorte de píxeis (x, y, w, h) válido."""
    x1, y1, x2, y2 = clamp_box(box)
    px1 = max(0, min(width - 1, round(x1 * width)))
    py1 = max(0, min(height - 1, round(y1 * height)))
    px2 = max(px1 + 1, min(width, round(x2 * width)))
    py2 = max(py1 + 1, min(height, round(y2 * height)))
    return px1, py1, px2 - px1, py2 - py1


class PersonTracker:
    """Mantém a caixa da pessoa e decide quando vale a pena re-detectar.

    A política é deliberadamente conservadora: só se gasta uma deteção em
    fotograma inteiro quando (a) ainda não há caixa, (b) passaram
    `redetect_interval` fotogramas, (c) a caixa encosta à margem do recorte — sinal
    de que o atleta se está a afastar e o recorte o vai cortar — ou (d) o
    rastreio esteve demasiado tempo sem confirmação.
    """

    def __init__(
        self,
        redetect_interval: int = 15,
        smoothing: float = 0.45,
        margin: float = 0.28,
        max_misses: int = 3,
        edge_tolerance: float = 0.02,
    ):
        self.redetect_interval = max(1, int(redetect_interval))
        self.smoothing = max(0.0, min(1.0, float(smoothing)))
        self.margin = max(0.0, float(margin))
        self.max_misses = max(1, int(max_misses))
        self.edge_tolerance = max(0.0, float(edge_tolerance))

        self.box: Box | None = None
        self.score: float = 0.0
        self.misses: int = 0
        self.frames_since_detect: int = 0
        self.detections: int = 0
        self.roi_reuses: int = 0

    def reset(self) -> None:
        self.box = None
        self.score = 0.0
        self.misses = 0
        self.frames_since_detect = 0
        self.detections = 0
        self.roi_reuses = 0

    @property
    def has_box(self) -> bool:
        return self.box is not None

    def needs_full_frame(self) -> bool:
        """`True` quando este fotograma deve correr em fotograma inteiro."""
        if self.box is None:
            return True
        if self.misses >= self.max_misses:
            return True
        if self.frames_since_detect >= self.redetect_interval:
            return True
        return bool(self._box_touches_edge())

    def _box_touches_edge(self) -> bool:
        if self.box is None:
            return True
        x1, y1, x2, y2 = self.box
        t = self.edge_tolerance
        return x1 <= t or y1 <= t or x2 >= 1.0 - t or y2 >= 1.0 - t

    def observe(self, box: Sequence[float], score: float = 1.0) -> Box:
        """Confirma/recebe uma deteção e devolve a caixa suavizada."""
        new_box = clamp_box(box)
        if self.box is None or self.smoothing <= 0.0:
            merged = new_box
        else:
            alpha = self.smoothing
            merged = clamp_box(
                tuple(self.box[i] * (1.0 - alpha) + new_box[i] * alpha for i in range(4))
            )
        self.box = merged
        self.score = float(score)
        self.misses = 0
        self.frames_since_detect = 0
        self.detections += 1
        return merged

    def tick(self, pose_found: bool = True) -> None:
        """Avança um fotograma que NÃO teve deteção nova (recorte reutilizado).

        `pose_found=False` marca ainda uma falha de pose (nem pelo recorte se
        encontrou pessoa), o que obriga à próxima deteção em fotograma inteiro.
        """
        self.frames_since_detect += 1
        if pose_found:
            self.misses = 0
        else:
            self.misses += 1

    def roi_box(self) -> Box | None:
        """Caixa alargada do recorte a enviar ao modelo (ou `None` se não há rastreio)."""
        if self.box is None:
            return None
        return expand_box(self.box, self.margin)

    def note_roi_reuse(self) -> None:
        self.roi_reuses += 1

    def stats(self) -> dict:
        total = self.detections + self.roi_reuses
        return {
            "detections": self.detections,
            "roi_reuses": self.roi_reuses,
            "reuse_ratio": round(self.roi_reuses / total, 3) if total else 0.0,
            "has_box": self.has_box,
        }
