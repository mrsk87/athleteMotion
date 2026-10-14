"""Filtro de Kalman cinemático 2D com restrição de comprimento de segmentos anatómicos.

Aplica um modelo de velocidade constante por articulação com matriz de ruído de
medição dinamicamente escalada pela visibilidade do marco.
Implementa projeção geométrica para garantir que os comprimentos do fémur
(anca-joelho) e da tíbia (joelho-tornozelo) não desviam mais de ±8% da sua
referência anatómica sob ruído e oclusões temporárias.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np
import numpy.typing as npt


@dataclass
class JointKalmanState:
    """Estado interno do filtro de Kalman para uma articulação 2D."""

    x: npt.NDArray[np.float64]  # [px, py, vx, vy]^T
    P: npt.NDArray[np.float64]  # Matriz de covariância 4x4
    initialized: bool = False


class SkeletonKalmanFilter:
    """Filtro de Kalman para rastreio do esqueleto com restrição de segmentos."""

    def __init__(
        self,
        enabled: bool = True,
        segment_constraint_enabled: bool = True,
        tolerance_pct: float = 0.08,  # ±8%
        process_noise_std: float = 500.0,
        measurement_noise_std: float = 5.0,
    ) -> None:
        self.enabled = enabled
        self.segment_constraint_enabled = segment_constraint_enabled
        self.tolerance_pct = tolerance_pct
        self.q_std = process_noise_std
        self.r_std = measurement_noise_std

        self._states: dict[str, JointKalmanState] = {}
        self._femur_ref_length: float | None = None
        self._tibia_ref_length: float | None = None
        self._ref_sample_count: int = 0
        self._fixed_references: bool = False

    def reset(self) -> None:
        """Reinicia o estado interno dos filtros e referências antropométricas."""
        self._states.clear()
        self._femur_ref_length = None
        self._tibia_ref_length = None
        self._ref_sample_count = 0
        self._fixed_references = False

    def set_reference_lengths(self, femur_px: float, tibia_px: float) -> None:
        """Define explicitamente os comprimentos de referência do fémur e da tíbia."""
        self._femur_ref_length = max(1.0, float(femur_px))
        self._tibia_ref_length = max(1.0, float(tibia_px))
        self._fixed_references = True

    def _init_joint(self, joint_name: str, x: float, y: float) -> None:
        state = np.array([x, y, 0.0, 0.0], dtype=np.float64)
        P = np.diag([self.r_std**2, self.r_std**2, 100.0, 100.0]).astype(np.float64)
        self._states[joint_name] = JointKalmanState(x=state, P=P, initialized=True)

    def _predict(self, joint_state: JointKalmanState, dt: float) -> None:
        """Passo de predição temporal (modelo de velocidade constante)."""
        F = np.array(
            [
                [1.0, 0.0, dt, 0.0],
                [0.0, 1.0, 0.0, dt],
                [0.0, 0.0, 1.0, 0.0],
                [0.0, 0.0, 0.0, 1.0],
            ],
            dtype=np.float64,
        )

        dt2 = dt * dt
        dt3 = dt2 * dt
        q = (self.q_std**2)
        Q = q * np.array(
            [
                [dt3 / 3.0, 0.0, dt2 / 2.0, 0.0],
                [0.0, dt3 / 3.0, 0.0, dt2 / 2.0],
                [dt2 / 2.0, 0.0, dt, 0.0],
                [0.0, dt2 / 2.0, 0.0, dt],
            ],
            dtype=np.float64,
        )

        joint_state.x = F @ joint_state.x
        joint_state.P = F @ joint_state.P @ F.T + Q

    def _update(self, joint_state: JointKalmanState, z_x: float, z_y: float, visibility: float) -> None:
        """Passo de atualização com ganho de Kalman ponderado pela visibilidade."""
        vis = max(0.01, min(1.0, float(visibility)))

        # Ruído de medição inversamente proporcional ao quadrado da visibilidade
        r_var = (self.r_std / vis) ** 2
        R = np.diag([r_var, r_var]).astype(np.float64)

        H = np.array([[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0]], dtype=np.float64)

        z = np.array([z_x, z_y], dtype=np.float64)
        y = z - (H @ joint_state.x)

        S = H @ joint_state.P @ H.T + R
        K = joint_state.P @ H.T @ np.linalg.inv(S)

        joint_state.x = joint_state.x + (K @ y)
        eye4 = np.eye(4, dtype=np.float64)
        joint_state.P = (eye4 - K @ H) @ joint_state.P

    def step(
        self,
        landmarks: dict[str, Any],
        dt: float = 1.0 / 60.0,
    ) -> dict[str, tuple[float, float, float]]:
        """Aplica o filtro de Kalman e as restrições anatómicas a um fotograma.

        Args:
            landmarks: Dicionário mapeando nome do marco a (x, y, visibilidade) ou Landmark2D.
            dt: Intervalo temporal entre frames em segundos.

        Returns:
            Dicionário de marcos filtrados com coordenadas corrigidas e visibilidade atualizada.
        """
        if not self.enabled:
            # Pass-through inalterado
            out: dict[str, tuple[float, float, float]] = {}
            for k, val in landmarks.items():
                if hasattr(val, "x") and hasattr(val, "y"):
                    out[k] = (float(val.x), float(val.y), float(getattr(val, "visibility", 1.0)))
                else:
                    out[k] = (float(val[0]), float(val[1]), float(val[2]) if len(val) > 2 else 1.0)
            return out

        dt_safe = max(1e-4, min(0.5, float(dt)))

        filtered: dict[str, tuple[float, float, float]] = {}

        # 1. Kalman prediction e update por articulação
        for name, val in landmarks.items():
            if hasattr(val, "x") and hasattr(val, "y"):
                zx, zy = float(val.x), float(val.y)
                vis = float(getattr(val, "visibility", 1.0))
            else:
                zx, zy = float(val[0]), float(val[1])
                vis = float(val[2]) if len(val) > 2 else 1.0

            if name not in self._states:
                self._init_joint(name, zx, zy)
            else:
                st = self._states[name]
                self._predict(st, dt_safe)
                self._update(st, zx, zy, vis)

            px, py = float(self._states[name].x[0]), float(self._states[name].x[1])
            filtered[name] = (px, py, vis)

        # 2. Restrição cinemática de comprimento de segmentos (fémur e tíbia)
        if self.segment_constraint_enabled:
            filtered = self._apply_segment_constraints(filtered)

        return filtered

    def _apply_segment_constraints(
        self,
        coords: dict[str, tuple[float, float, float]],
    ) -> dict[str, tuple[float, float, float]]:
        """Aplica a projeção de restrição para fémur e tíbia de ambos os lados."""
        for side in ("right", "left"):
            hip_k = f"{side}_hip"
            knee_k = f"{side}_knee"
            ankle_k = f"{side}_ankle"

            if hip_k not in coords or knee_k not in coords:
                continue

            hx, hy, hvis = coords[hip_k]
            kx, ky, kvis = coords[knee_k]

            femur_vec = np.array([kx - hx, ky - hy], dtype=np.float64)
            femur_len = float(np.hypot(femur_vec[0], femur_vec[1]))

            # Calibração adaptativa do comprimento de referência se ainda não fixado
            if not self._fixed_references and femur_len > 10.0 and hvis > 0.6 and kvis > 0.6:
                if self._femur_ref_length is None:
                    self._femur_ref_length = femur_len
                elif self._ref_sample_count < 30:
                    self._femur_ref_length = 0.95 * self._femur_ref_length + 0.05 * femur_len

            # Restrição no Fémur (Anca -> Joelho)
            if self._femur_ref_length is not None and femur_len > 1e-4:
                ref = self._femur_ref_length
                min_len = (1.0 - self.tolerance_pct) * ref
                max_len = (1.0 + self.tolerance_pct) * ref

                if femur_len < min_len or femur_len > max_len:
                    clamped_len = max(min_len, min(max_len, femur_len))
                    unit_v = femur_vec / femur_len
                    # Move o joelho ao longo da direção do fémur
                    new_kx = hx + unit_v[0] * clamped_len
                    new_ky = hy + unit_v[1] * clamped_len
                    coords[knee_k] = (new_kx, new_ky, kvis)
                    # Atualiza o estado interno do Kalman do joelho
                    if knee_k in self._states:
                        self._states[knee_k].x[0] = new_kx
                        self._states[knee_k].x[1] = new_ky
                    kx, ky = new_kx, new_ky

            # Restrição na Tíbia (Joelho -> Tornozelo)
            if ankle_k in coords:
                ax, ay, avis = coords[ankle_k]
                tibia_vec = np.array([ax - kx, ay - ky], dtype=np.float64)
                tibia_len = float(np.hypot(tibia_vec[0], tibia_vec[1]))

                if not self._fixed_references and tibia_len > 10.0 and kvis > 0.6 and avis > 0.6:
                    if self._tibia_ref_length is None:
                        self._tibia_ref_length = tibia_len
                    elif self._ref_sample_count < 30:
                        self._tibia_ref_length = 0.95 * self._tibia_ref_length + 0.05 * tibia_len

                if self._tibia_ref_length is not None and tibia_len > 1e-4:
                    ref_t = self._tibia_ref_length
                    min_t = (1.0 - self.tolerance_pct) * ref_t
                    max_t = (1.0 + self.tolerance_pct) * ref_t

                    if tibia_len < min_t or tibia_len > max_t:
                        clamped_t = max(min_t, min(max_t, tibia_len))
                        unit_t = tibia_vec / tibia_len
                        new_ax = kx + unit_t[0] * clamped_t
                        new_ay = ky + unit_t[1] * clamped_t
                        coords[ankle_k] = (new_ax, new_ay, avis)
                        if ankle_k in self._states:
                            self._states[ankle_k].x[0] = new_ax
                            self._states[ankle_k].x[1] = new_ay

        self._ref_sample_count += 1
        return coords
