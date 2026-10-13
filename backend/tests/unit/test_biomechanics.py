"""Testes unitários para regras de negócio biomecânicas de ciclismo."""
from athletemotion.domain.biomechanics import (
    RidingStyle,
    calculate_lemond_saddle_height,
    calculate_109_saddle_height,
    estimate_frame_size,
    recommend_crank_length,
    recommend_handlebar_width,
    evaluate_posture_angles,
)


def test_lemond_saddle_height():
    # Cavalo de 84 cm -> 84 * 0.883 = 74.172 -> 74.2 cm
    saddle_h = calculate_lemond_saddle_height(84.0)
    assert saddle_h == 74.2


def test_109_saddle_height():
    # Cavalo de 84 cm -> 84 * 1.09 = 91.56 -> 91.6 cm
    saddle_109 = calculate_109_saddle_height(84.0)
    assert saddle_109 == 91.6


def test_frame_size_and_crank_recommendations():
    frame_road = estimate_frame_size(178.0, 84.0, RidingStyle.ROAD)
    assert frame_road > 50.0 and frame_road < 60.0

    crank_len = recommend_crank_length(84.0)
    assert crank_len == 172.5

    bar_width = recommend_handlebar_width(42.0, 178.0, RidingStyle.ROAD)
    assert bar_width == 420.0


def test_posture_angle_diagnostics():
    # Joelho fletido demais (135° quando o ideal de estrada é 145°-155°)
    diagnostics = evaluate_posture_angles(
        modality=RidingStyle.ROAD,
        knee_angle=135.0,
        back_angle=45.0,
        arm_angle=155.0,
        ankle_angle=95.0,
    )

    knee_diag = next(d for d in diagnostics if d.joint_name == "joelho")
    assert not knee_diag.is_compliant
    assert knee_diag.adjustment_delta is not None and knee_diag.adjustment_delta > 0
    assert "Subir o selim" in knee_diag.recommendation_pt

    back_diag = next(d for d in diagnostics if d.joint_name == "costas")
    assert back_diag.is_compliant


def test_kops_alignment_diagnostics():
    from athletemotion.domain.biomechanics import evaluate_kops_alignment

    # Alinhado (< 5mm)
    neutral = evaluate_kops_alignment(2.3)
    assert neutral.is_aligned
    assert "Neutro" in neutral.status_label_pt

    # Joelho adiantado (+15mm) -> Recuar selim
    ahead = evaluate_kops_alignment(15.0)
    assert not ahead.is_aligned
    assert "Recuar o selim" in ahead.recommendation_pt
    assert "Slide saddle backward" in ahead.recommendation_en

    # Joelho atrasado (-12mm) -> Avançar selim
    behind = evaluate_kops_alignment(-12.0)
    assert not behind.is_aligned
    assert "Avançar o selim" in behind.recommendation_pt


def test_symmetry_index_calculation():
    from athletemotion.domain.biomechanics import calculate_symmetry_index

    # Simétrico (148 vs 149)
    report_good = calculate_symmetry_index(148.0, 149.0, "joelho")
    assert report_good.symmetry_index <= 2.0
    assert report_good.classification == "excelente"

    # Assimetria significativa (150 vs 140) -> SI = 10 / 145 * 100 = 6.9%
    report_asym = calculate_symmetry_index(150.0, 140.0, "joelho")
    assert report_asym.symmetry_index > 4.0
    assert report_asym.classification == "significativa"
    assert "calços de compensação" in report_asym.recommendation_pt


def test_saddle_drop_diagnostics():
    from athletemotion.domain.biomechanics import evaluate_saddle_drop, FlexibilityLevel

    # Drop normal estrada (6.5 cm com flexibilidade média)
    diag_ok = evaluate_saddle_drop(6.5, RidingStyle.ROAD, FlexibilityLevel.MEDIUM)
    assert diag_ok.is_compliant

    # Drop excessivo para flexibilidade baixa (9.5 cm)
    diag_excessive = evaluate_saddle_drop(9.5, RidingStyle.ROAD, FlexibilityLevel.LOW)
    assert not diag_excessive.is_compliant
    assert "Adicionar" in diag_excessive.recommendation_pt


def test_frontal_knee_tracking():
    from athletemotion.domain.biomechanics import evaluate_frontal_knee_tracking

    # Neutro (<= 10mm)
    neutral = evaluate_frontal_knee_tracking(4.5, "right")
    assert neutral.is_compliant
    assert neutral.condition == "neutral"
    assert "Perfeito" in neutral.label_pt

    # Valgo Dinâmico na perna direita (desvio negativo > 10mm, joelho colapsa medialmente)
    valgus_right = evaluate_frontal_knee_tracking(-14.2, "right")
    assert not valgus_right.is_compliant
    assert valgus_right.condition == "valgus"
    assert "Valgo Dinâmico" in valgus_right.label_pt
    assert "Fator Q" in valgus_right.recommendation_pt

    # Varo Dinâmico na perna direita (desvio positivo > 10mm, joelho abre para fora)
    varus_right = evaluate_frontal_knee_tracking(15.0, "right")
    assert not varus_right.is_compliant
    assert varus_right.condition == "varus"
    assert "Varo Dinâmico" in varus_right.label_pt



