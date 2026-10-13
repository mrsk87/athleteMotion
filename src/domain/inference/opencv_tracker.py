"""Motor de visão clássica para deteção ótica determinística de marcadores físicos."""
from __future__ import annotations

from typing import Dict, Tuple
import cv2
import numpy as np

from src.domain.calculator import calculate_safe_angle, Point2D
from .base import BasePoseEngine, PoseEngineRegistry
from .types import InferenceOutput, Landmark2D, BiomechanicalAngles, SegmentValidation


class OpenCVClassicalTracker(BasePoseEngine):
    def __init__(self, side: str = "right", mode: str = "hsv"):
        super().__init__(name="opencv_markers")
        self.side = side.lower()
        self.mode = mode  # "hsv" ou "luma" (retrorefletor)

        # Intervalos HSV para marcadores coloridos comuns em bike fit:
        # Verde fluorescente: Joelho | Ciano: Tornozelo | Magenta/Laranja: Anca
        self.color_ranges = {
            "knee": (np.array([35, 80, 80]), np.array([85, 255, 255])),
            "ankle": (np.array([85, 80, 80]), np.array([125, 255, 255])),
            "hip": (np.array([140, 80, 80]), np.array([170, 255, 255])),
        }

    def set_side(self, side: str) -> None:
        self.side = side.lower()

    def reset(self) -> None:
        pass

    def _find_centroid(self, mask: np.ndarray, min_area: int = 15, max_area: int = 2500) -> Tuple[float, float, bool]:
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        best_c = None
        best_area = 0

        for c in contours:
            area = cv2.contourArea(c)
            if min_area <= area <= max_area and area > best_area:
                best_area = area
                best_c = c

        if best_c is not None:
            M = cv2.moments(best_c)
            if M["m00"] > 0:
                cx = float(M["m10"] / M["m00"])
                cy = float(M["m01"] / M["m00"])
                return cx, cy, True
        return 0.0, 0.0, False

    def process_frame(self, frame_bgr: np.ndarray, timestamp_ms: int) -> InferenceOutput:
        h, w = frame_bgr.shape[:2]
        landmarks: Dict[str, Landmark2D] = {}

        if self.mode == "hsv":
            hsv = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)
            for joint, (lower, upper) in self.color_ranges.items():
                mask = cv2.inRange(hsv, lower, upper)
                # Operação morfológica para limpar ruído
                kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
                mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
                cx, cy, found = self._find_centroid(mask)
                if found and w > 0 and h > 0:
                    landmarks[joint] = Landmark2D(x=float(cx / w), y=float(cy / h), visibility=1.0)

        elif self.mode == "luma":
            # Retrorefletores: picos de intensidade luminosa em escala de cinzas
            gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
            _, thresh = cv2.threshold(gray, 220, 255, cv2.THRESH_BINARY)
            # Ordenar centróides verticalmente: Anca (mais alto), Joelho (médio), Tornozelo (mais baixo)
            contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            pts = []
            for c in contours:
                if 20 <= cv2.contourArea(c) <= 3000:
                    M = cv2.moments(c)
                    if M["m00"] > 0:
                        pts.append((float(M["m10"] / M["m00"]), float(M["m01"] / M["m00"])))

            pts.sort(key=lambda p: p[1])  # Ordenar por Y
            if len(pts) >= 3 and w > 0 and h > 0:
                landmarks["hip"] = Landmark2D(x=float(pts[0][0] / w), y=float(pts[0][1] / h), visibility=1.0)
                landmarks["knee"] = Landmark2D(x=float(pts[1][0] / w), y=float(pts[1][1] / h), visibility=1.0)
                landmarks["ankle"] = Landmark2D(x=float(pts[2][0] / w), y=float(pts[2][1] / h), visibility=1.0)

        # Calcular ângulo do joelho caso os 3 pontos existam
        angles = BiomechanicalAngles()
        if "hip" in landmarks and "knee" in landmarks and "ankle" in landmarks:
            angles.knee = round(calculate_safe_angle(
                Point2D(landmarks["hip"].x, landmarks["hip"].y),
                Point2D(landmarks["knee"].x, landmarks["knee"].y),
                Point2D(landmarks["ankle"].x, landmarks["ankle"].y),
            ), 1)

        val = SegmentValidation(femur_length=0.25, tibia_length=0.22, femur_valid=True, tibia_valid=True)

        return InferenceOutput(
            engine_name=self.name,
            side=self.side,
            timestamp_ms=timestamp_ms,
            landmarks=landmarks,
            angles=angles,
            validation=val,
        )


PoseEngineRegistry.register("opencv_markers", OpenCVClassicalTracker)
