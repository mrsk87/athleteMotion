"""Testes unitários para o Model Zoo e verificação de integridade de modelos."""

from __future__ import annotations

from athletemotion.domain.inference.model_zoo import (
    load_manifest,
    verify_file_integrity,
    verify_model,
)


def test_manifest_loading():
    """Valida que o manifesto contém os modelos obrigatórios do ecossistema."""
    manifest = load_manifest()
    assert len(manifest) >= 5

    assert "yolo11n-pose-320" in manifest
    assert "yolo11n-pose" in manifest
    assert "mediapipe-pose-heavy" in manifest
    assert "rtmpose-m-halpe26" in manifest

    rtm_meta = manifest["rtmpose-m-halpe26"]
    assert rtm_meta.keypoint_layout == "halpe26"
    assert rtm_meta.license == "Apache-2.0"
    assert rtm_meta.license_risk is False
    assert rtm_meta.is_permissive_license is True
    assert rtm_meta.sha256 == "26f3a19e61304a600dfb82d1001d41d24343b89fc70a33ffc84657e0b0bf2ecf"


def test_models_sha256_verification_against_disk():
    """Valida que os ficheiros em disco batem certo com o SHA-256 do manifesto."""
    models_to_check = [
        "yolo11n-pose-320",
        "yolo11n-pose",
        "mediapipe-pose-lite",
        "mediapipe-pose-full",
        "mediapipe-pose-heavy",
        "rtmpose-m-halpe26",
    ]
    for model_id in models_to_check:
        is_valid, reason = verify_model(model_id)
        assert is_valid is True, f"Verificação falhou para {model_id}: {reason}"


def test_tampered_model_hash_detection(tmp_path):
    """Valida que ficheiros adulterados são rejeitados na verificação."""
    fake_file = tmp_path / "fake_model.onnx"
    fake_file.write_bytes(b"corrupted_bytes_12345")

    expected_hash = "0000000000000000000000000000000000000000000000000000000000000000"
    is_valid, actual_hash, size = verify_file_integrity(fake_file, expected_hash)

    assert is_valid is False
    assert actual_hash != expected_hash
    assert size == len(b"corrupted_bytes_12345")
