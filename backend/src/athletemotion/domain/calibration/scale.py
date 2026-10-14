"""Transformador unificado de coordenadas espaciais com correção ótica, nivelamento e escala métrica."""

from __future__ import annotations

import math
from collections.abc import Sequence

from athletemotion.domain.calibration.lens import undistort_points
from athletemotion.domain.calibration.roll import correct_roll_points
from athletemotion.domain.calibration.types import (
    LensProfile,
    ScaleCalibration,
)


class CoordinateTransformer:
    """Aplica o pipeline completo de transformação geométrica em pontos articulares:

    1. Desdistorção ótica radial e tangencial (LensProfile).
    2. Correção de rotação horizontal (Roll).
    3. Conversão de pixels para milímetros com incerteza propagada (ScaleCalibration).
    """

    def __init__(
        self,
        scale: ScaleCalibration | None = None,
        lens_profile: LensProfile | None = None,
        roll_deg: float = 0.0,
        image_center: tuple[float, float] = (0.0, 0.0),
    ) -> None:
        self.scale = scale
        self.lens_profile = lens_profile
        # Se a escala já trouxer plane_roll_deg medido por ArUco, combina com o roll explícito
        self.roll_deg = roll_deg or (scale.plane_roll_deg if scale else 0.0)
        self.image_center = image_center

    def transform_points(
        self,
        points: Sequence[tuple[float, float]],
    ) -> list[tuple[float, float]]:
        """Aplica desdistorção de lente e correção de roll à lista de pontos."""
        if not points:
            return []

        pts = list(points)
        if self.lens_profile is not None:
            pts = undistort_points(pts, self.lens_profile)

        if abs(self.roll_deg) > 1e-4:
            pts = correct_roll_points(pts, self.roll_deg, origin=self.image_center)

        return pts

    def measure_distance_mm(
        self,
        point_a: tuple[float, float],
        point_b: tuple[float, float],
    ) -> tuple[float | None, float | None]:
        """Calcula a distância euclidiana corrigida em milímetros e a respetiva incerteza.

        Se não existir calibração métrica ativa, devolve (None, None) em conformidade com o RGPD
        e os princípios biomecânicos de não inventar números clínicos sem suporte físico.
        """
        if self.scale is None:
            return None, None

        transformed = self.transform_points([point_a, point_b])
        pa, pb = transformed[0], transformed[1]
        dist_px = math.hypot(pb[0] - pa[0], pb[1] - pa[1])
        return self.scale.to_mm(dist_px)

    def measure_horizontal_offset_mm(
        self,
        x_reference: float,
        x_target: float,
    ) -> tuple[float | None, float | None]:
        """Calcula o desfasamento horizontal (ex: alinhamento KOPS patela-pedal) em mm com sinal e incerteza."""
        if self.scale is None:
            return None, None

        # Projeta os valores no espaço corrigido
        dummy_y = self.image_center[1]
        transformed = self.transform_points([(x_reference, dummy_y), (x_target, dummy_y)])
        dx_px = transformed[1][0] - transformed[0][0]

        abs_dist, unc = self.scale.to_mm(abs(dx_px))
        sign = 1.0 if dx_px >= 0 else -1.0
        return abs_dist * sign, unc
