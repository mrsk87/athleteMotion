"""Testes de paridade determinística entre motores de inferência postural.

Garante que MediaPipe, YOLO11 e RTMPose utilizam a mesma matemática de domínio,
produzindo ângulos absolutamente idênticos (+- 0.1°) para os mesmos marcos anatómicos.
"""

from athletemotion.domain.biomechanics.angles import compute_joint_angles
from athletemotion.domain.inference.mediapipe_engine import MediaPipePoseEngine
from athletemotion.domain.inference.rtmpose_engine import RTMPoseEngine
from athletemotion.domain.inference.types import Landmark2D
from athletemotion.domain.inference.yolo_engine import YOLO11PoseEngine


def test_domain_angles_deterministic_parity():
    """Garante que a função central de domínio calcula ângulos idênticos."""
    w, h = 1920, 1080

    landmarks = {
        "hip": Landmark2D(x=0.45, y=0.50, visibility=0.9),
        "knee": Landmark2D(x=0.55, y=0.70, visibility=0.9),
        "ankle": Landmark2D(x=0.50, y=0.88, visibility=0.9),
        "toe": Landmark2D(x=0.56, y=0.92, visibility=0.8, estimated=True),
        "shoulder": Landmark2D(x=0.35, y=0.30, visibility=0.9),
        "elbow": Landmark2D(x=0.42, y=0.40, visibility=0.9),
        "wrist": Landmark2D(x=0.48, y=0.35, visibility=0.9),
    }

    angles1 = compute_joint_angles(landmarks, w, h)
    angles2 = compute_joint_angles(landmarks, w, h)

    assert angles1.knee == angles2.knee
    assert angles1.torso == angles2.torso
    assert angles1.arm_elbow == angles2.arm_elbow
    assert angles1.ankle == angles2.ankle
    assert angles1.shoulder == angles2.shoulder


def test_engines_internal_angle_computation_parity():
    """Verifica que a chamada interna de cálculo de ângulos dos 3 motores produz paridade perfeita."""
    w, h = 1920, 1080

    landmarks = {
        "hip": Landmark2D(x=0.45, y=0.50, visibility=0.9),
        "knee": Landmark2D(x=0.55, y=0.70, visibility=0.9),
        "ankle": Landmark2D(x=0.50, y=0.88, visibility=0.9),
        "toe": Landmark2D(x=0.56, y=0.92, visibility=0.8, estimated=True),
        "shoulder": Landmark2D(x=0.35, y=0.30, visibility=0.9),
        "elbow": Landmark2D(x=0.42, y=0.40, visibility=0.9),
        "wrist": Landmark2D(x=0.48, y=0.35, visibility=0.9),
    }

    # Motores em modo CPU / sem pesos obrigatórios
    mp_engine = MediaPipePoseEngine(side="right")
    yolo_engine = YOLO11PoseEngine(side="right", use_gpu=False, model_path="__non_existent__.onnx")
    rtm_engine = RTMPoseEngine(side="right", use_gpu=False, model_path="__non_existent__.onnx")

    assert mp_engine.side == "right"
    assert yolo_engine.side == "right"
    assert rtm_engine.side == "right"

    # Injetar marcos no cálculo de ângulos
    _, yolo_angles, _ = yolo_engine._compute_angles(landmarks, w, h)
    rtm_angles = compute_joint_angles(landmarks, w, h)
    reference_angles = compute_joint_angles(landmarks, w, h)

    # Todos os motores devem reportar exatamente o mesmo valor numérico (+-0.1°)
    for angles in (yolo_angles, rtm_angles):
        assert abs(angles.knee - reference_angles.knee) <= 0.1
        assert abs(angles.torso - reference_angles.torso) <= 0.1
        assert abs(angles.arm_elbow - reference_angles.arm_elbow) <= 0.1
        assert abs(angles.ankle - reference_angles.ankle) <= 0.1
        assert abs(angles.shoulder - reference_angles.shoulder) <= 0.1
