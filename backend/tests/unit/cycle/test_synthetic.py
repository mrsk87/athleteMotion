"""Testes unitários para o gerador de pedalada sintética."""

from __future__ import annotations

import numpy as np

from tests.fixtures.synthetic_pedaling import synthetic_pedaling


def test_synthetic_pedaling_generation():
    """Gera conjunto sintético a 80 RPM durante 6 segundos e verifica integridade."""
    data = synthetic_pedaling(rpm=80.0, fps=60.0, duration_s=6.0, noise_std=0.0)

    # Duração e fotogramas
    assert len(data.timestamps_ms) == 360
    assert data.fps == 60.0

    # 80 RPM em 6 segundos = 8 rotações completas
    assert len(data.ground_truth_bdc_indices) >= 7
    assert len(data.ground_truth_tdc_indices) >= 7

    # Verificar alternância BDC e TDC
    assert data.ground_truth_bdc_indices[0] != data.ground_truth_tdc_indices[0]

    # Verificar amplitude angular do joelho
    assert np.max(data.knee_angles) > 135.0
    assert np.min(data.knee_angles) < 90.0


def test_synthetic_pedaling_with_noise_and_dropouts():
    """Gera dados com ruído e dropouts e verifica que dimensões se mantêm intactas."""
    data = synthetic_pedaling(
        rpm=90.0,
        fps=30.0,
        duration_s=5.0,
        noise_std=2.0,
        dropout_prob=0.05,
    )
    assert len(data.timestamps_ms) == 150
    assert np.any(data.visibilities == 0.0)
