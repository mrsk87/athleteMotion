"""Testes unitários para o estabilizador funcional de segmentos rígidos."""

import copy

from athletemotion.domain.inference.stabilizer import (
    StabilizerParams,
    StabilizerState,
    stabilize,
)
from athletemotion.domain.inference.types import Landmark2D


def test_stabilizer_first_frame_and_history_building():
    """Primeiro frame deve ser considerado válido e construir histórico progressivamente."""
    w, h = 1920, 1080
    state = StabilizerState()
    params = StabilizerParams(min_samples_for_validation=5)

    # Frame com femur = 300px, tibia = 300px
    hip = Landmark2D(x=0.5, y=0.3, visibility=0.9)
    knee = Landmark2D(x=0.5, y=0.3 + 300.0 / h, visibility=0.9)
    ankle = Landmark2D(x=0.5, y=0.3 + 600.0 / h, visibility=0.9)
    lms = {"hip": hip, "knee": knee, "ankle": ankle}

    # 1. Primeiro frame
    _out_lms, new_state, val = stabilize(lms, state, w, h, params)
    assert val.femur_valid is True
    assert val.tibia_valid is True
    assert len(new_state.femur_history) == 1
    assert len(new_state.tibia_history) == 1
    assert new_state.last_valid_landmarks is not None

    # 2. Alimentar mais 4 frames para atingir min_samples=5
    for _ in range(4):
        _, new_state, val = stabilize(lms, new_state, w, h, params)
        assert val.femur_valid is True

    assert len(new_state.femur_history) == 5
    assert len(new_state.tibia_history) == 5


def test_stabilizer_detects_anomalous_jump_and_interpolates():
    """Salto anómalo > 12% deve ser marcado inválido e interpolado suavemente."""
    w, h = 1920, 1080
    params = StabilizerParams(
        rigid_tolerance_pct=12.0, min_samples_for_validation=5, smoothing_alpha=0.3
    )

    hip = Landmark2D(x=0.5, y=0.2, visibility=0.9)
    knee = Landmark2D(x=0.5, y=0.5, visibility=0.9)  # 0.3 * 1080 = 324px
    ankle = Landmark2D(x=0.5, y=0.8, visibility=0.9)  # 0.3 * 1080 = 324px
    lms_stable = {"hip": hip, "knee": knee, "ankle": ankle}

    state = StabilizerState()
    for _ in range(5):
        _, state, val = stabilize(lms_stable, state, w, h, params)
        assert val.femur_valid is True

    # Introduzir anomalia: salto súbito no joelho que encurta o fémur em 30%
    anomalous_knee = Landmark2D(x=0.5, y=0.35, visibility=0.9)  # encurtado para 0.15 * 1080 = 162px
    lms_anomalous = {"hip": hip, "knee": anomalous_knee, "ankle": ankle}

    out_lms, next_state, val = stabilize(lms_anomalous, state, w, h, params)

    # Validação deve falhar
    assert val.femur_valid is False
    assert val.segment_error_pct > 12.0

    # Histórico NÃO deve ser contaminado pelo salto espúrio
    assert len(next_state.femur_history) == 5

    # Marco deve ter sido corrigido com interpolação e marcado com estimated=True
    assert out_lms["knee"].estimated is True
    # Posição interpolada deve estar entre 0.35 e 0.50 (0.35 * 0.3 + 0.50 * 0.7 = 0.455)
    assert abs(out_lms["knee"].y - 0.455) < 0.01


def test_stabilizer_no_mutation_of_inputs():
    """Garante imutabilidade estrita: nenhum objeto Landmark2D de entrada é alterado."""
    w, h = 1920, 1080
    hip = Landmark2D(x=0.5, y=0.2, visibility=0.9)
    knee = Landmark2D(x=0.5, y=0.5, visibility=0.9)
    ankle = Landmark2D(x=0.5, y=0.8, visibility=0.9)
    lms = {"hip": hip, "knee": knee, "ankle": ankle}

    # Cópia profunda para verificação de igualdade estrita
    orig_lms = copy.deepcopy(lms)
    state = StabilizerState()

    out_lms, _new_state, _ = stabilize(lms, state, w, h)

    # Entradas mantêm-se exatamente idênticas
    assert lms == orig_lms
    assert lms["hip"] is hip
    # Saída não deve ser a mesma referência em caso de interpolação ou manipulação
    assert out_lms is not lms


def test_stabilizer_handles_occlusion_and_missing_points():
    """Se faltar qualquer ponto (ex.: oclusão), deve retornar de forma segura sem crash."""
    w, h = 1920, 1080
    state = StabilizerState()
    # Apenas o joelho presente
    lms = {"knee": Landmark2D(x=0.5, y=0.5, visibility=0.9)}

    _out_lms, new_state, val = stabilize(lms, state, w, h)

    assert val.femur_valid is False
    assert val.tibia_valid is False
    assert val.femur_length == 0.0
    assert len(new_state.femur_history) == 0
