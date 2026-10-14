"""Catálogo, manifesto e verificação de integridade de modelos de visão computacional."""

from __future__ import annotations

import hashlib
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from athletemotion.config.paths import MODELS_DIR

logger = logging.getLogger("athlete_motion.model_zoo")

MANIFEST_PATH = MODELS_DIR / "manifest.json"


@dataclass(frozen=True)
class ModelMetadata:
    """Metadados estruturados de um modelo no catálogo do AthleteMotion."""

    id: str
    name: str
    task: str
    framework: str
    filename: str
    license: str
    license_risk: bool
    sha256: str | None
    size_bytes: int | None
    keypoint_layout: str
    verified: bool
    input_shape: list[int] = field(default_factory=list)
    input_norm: dict[str, Any] = field(default_factory=dict)
    output_format: str = "raw"
    simcc_split_ratio: float = 2.0
    padding: float = 1.25
    min_ort_version: str | None = None
    urls: list[str] = field(default_factory=list)
    archive_type: str | None = None
    archive_member_pattern: str | None = None
    description: str = ""

    @property
    def is_permissive_license(self) -> bool:
        """Verifica se o modelo possui licença permissiva para distribuição comercial."""
        return not self.license_risk and self.license in ("Apache-2.0", "MIT", "BSD-3-Clause")


def load_manifest(manifest_path: Path | None = None) -> dict[str, ModelMetadata]:
    """Carrega o manifesto de modelos a partir de ficheiro JSON."""
    path = manifest_path or MANIFEST_PATH
    if not path.exists():
        logger.warning("Manifesto de modelos não encontrado em %s", path)
        return {}

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        models_data = data.get("models", {})
        result: dict[str, ModelMetadata] = {}
        for m_id, m_dict in models_data.items():
            result[m_id] = ModelMetadata(
                id=m_dict.get("id", m_id),
                name=m_dict.get("name", m_id),
                task=m_dict.get("task", "pose_estimation"),
                framework=m_dict.get("framework", "onnx"),
                filename=m_dict.get("filename", ""),
                license=m_dict.get("license", "Unknown"),
                license_risk=bool(m_dict.get("license_risk", False)),
                sha256=m_dict.get("sha256"),
                size_bytes=m_dict.get("size_bytes"),
                keypoint_layout=m_dict.get("keypoint_layout", "coco17"),
                verified=bool(m_dict.get("verified", False)),
                input_shape=m_dict.get("input_shape", []),
                input_norm=m_dict.get("input_norm", {}),
                output_format=m_dict.get("output_format", "raw"),
                simcc_split_ratio=float(m_dict.get("simcc_split_ratio", 2.0)),
                padding=float(m_dict.get("padding", 1.25)),
                min_ort_version=m_dict.get("min_ort_version"),
                urls=m_dict.get("urls", []),
                archive_type=m_dict.get("archive_type"),
                archive_member_pattern=m_dict.get("archive_member_pattern"),
                description=m_dict.get("description", ""),
            )
        return result
    except Exception as err:
        logger.error("Falha ao ler ou desserializar manifesto %s: %s", path, err)
        return {}


def compute_file_sha256(file_path: Path) -> str:
    """Calcula o hash criptográfico SHA-256 de um ficheiro em streaming."""
    hasher = hashlib.sha256()
    with file_path.open("rb") as f:
        while chunk := f.read(1024 * 1024):
            hasher.update(chunk)
    return hasher.hexdigest()


def verify_file_integrity(
    file_path: Path, expected_sha256: str | None, expected_size: int | None = None
) -> tuple[bool, str, int]:
    """Verifica a integridade de um ficheiro contra tamanho e hash esperados.

    Retorna: (sucesso: bool, actual_sha256: str, actual_size: int)
    """
    if not file_path.exists():
        return False, "", 0

    actual_size = file_path.stat().st_size
    if expected_size is not None and actual_size != expected_size:
        return False, "", actual_size

    actual_hash = compute_file_sha256(file_path)
    if expected_sha256 is None:
        return True, actual_hash, actual_size

    return (actual_hash.lower() == expected_sha256.lower()), actual_hash, actual_size


def get_model_metadata(model_id: str, manifest_path: Path | None = None) -> ModelMetadata | None:
    """Devolve os metadados de um modelo específico do manifesto."""
    models = load_manifest(manifest_path)
    return models.get(model_id)


def list_models(manifest_path: Path | None = None) -> list[ModelMetadata]:
    """Lista todos os modelos descritos no manifesto."""
    return list(load_manifest(manifest_path).values())


def verify_model(
    model_id: str, models_dir: Path | None = None, manifest_path: Path | None = None
) -> tuple[bool, str]:
    """Verifica se o ficheiro do modelo existe e corresponde ao hash do manifesto.

    Retorna: (is_valid: bool, reason: str)
    """
    meta = get_model_metadata(model_id, manifest_path)
    if not meta:
        return False, f"Modelo '{model_id}' não catalogado no manifesto."

    base_dir = models_dir or MODELS_DIR
    target_path = base_dir / meta.filename

    if not target_path.exists():
        return False, f"Ficheiro '{meta.filename}' não encontrado em {base_dir}."

    if meta.sha256 is None:
        logger.warning("Modelo '%s' presente mas sem hash SHA-256 no manifesto.", model_id)
        return True, "Ficheiro presente (sem hash SHA-256 no manifesto)"

    is_valid, actual_hash, _actual_size = verify_file_integrity(
        target_path, meta.sha256, meta.size_bytes
    )
    if not is_valid:
        return (
            False,
            f"Hash SHA-256 inválido para {meta.filename}. Esperado: {meta.sha256}, Obtido: {actual_hash}",
        )

    return True, "Ficheiro verificado com sucesso contra SHA-256 do manifesto."
