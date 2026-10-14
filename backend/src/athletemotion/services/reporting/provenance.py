"""Módulo de proveniência, rastreabilidade e integridade para relatórios e exportações (R17).

Garante que cada número, métrica ou parecer emitido pelo Athlete Motion possui
origem verificável, incluindo versões de software, hash criptográfico de pesos de modelos,
backend e fornecedor de execução de hardware, metadados de calibração espacial e contagem de ciclos.
"""

from __future__ import annotations

import contextlib
import hashlib
import os
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal


def resolve_git_sha(fallback: str = "unknown") -> str:
    """Obtém o hash SHA curto do commit Git atual de forma defensiva sem subprocessos."""
    env_sha = os.environ.get("GIT_SHA") or os.environ.get("COMMIT_REF")
    if env_sha:
        return env_sha[:7]

    with contextlib.suppress(Exception):
        backend_dir = Path(__file__).resolve().parents[3]
        repo_dir = backend_dir.parent
        git_dir = repo_dir / ".git"
        if git_dir.is_dir():
            head_file = git_dir / "HEAD"
            if head_file.is_file():
                head_content = head_file.read_text(encoding="utf-8").strip()
                if head_content.startswith("ref:"):
                    ref_rel = head_content[4:].strip()
                    ref_file = git_dir / ref_rel
                    if ref_file.is_file():
                        return ref_file.read_text(encoding="utf-8").strip()[:7]
                    # Verificar packed-refs se o branch foi compactado
                    packed_refs = git_dir / "packed-refs"
                    if packed_refs.is_file():
                        for line in packed_refs.read_text(encoding="utf-8").splitlines():
                            if line.endswith(ref_rel):
                                return line.split()[0][:7]
                elif len(head_content) >= 7:
                    return head_content[:7]

    return fallback


def resolve_app_version(fallback: str = "0.3.1") -> str:
    """Lê a versão semântica oficial da aplicação a partir do ficheiro VERSION."""
    with contextlib.suppress(Exception):
        backend_dir = Path(__file__).resolve().parents[3]
        version_file = backend_dir / "VERSION"
        if version_file.is_file():
            ver = version_file.read_text(encoding="utf-8").strip()
            if ver:
                return ver
    return fallback


def compute_file_sha256(file_path: Path | str | None) -> str | None:
    """Calcula o hash criptográfico SHA-256 do ficheiro de pesos do modelo ONNX."""
    if file_path is None:
        return None
    p = Path(file_path)
    if not p.is_file():
        return None

    sha = hashlib.sha256()
    with open(p, "rb") as f:
        while chunk := f.read(65536):
            sha.update(chunk)
    return sha.hexdigest()


@dataclass(frozen=True)
class Provenance:
    """Metadados de proveniência e rastreabilidade para auditoria científica e clínica."""

    app_version: str
    git_sha: str
    model_id: str
    model_sha256: str | None
    backend: str
    provider: str
    calibration: dict[str, Any] | None
    camera_profile: str | None
    cycles_used: int
    source: Literal["cycles", "manual"]
    created_at: str

    def to_dict(self) -> dict[str, Any]:
        """Serializa os metadados de proveniência para dicionário Python puro."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Provenance:
        """Desserializa dicionário estruturado para instância de Provenance."""
        source_val = data.get("source", "manual")
        if source_val not in ("cycles", "manual"):
            source_val = "manual"

        return cls(
            app_version=str(data.get("app_version", "0.3.1")),
            git_sha=str(data.get("git_sha", "unknown")),
            model_id=str(data.get("model_id", "yolo11n-pose-320")),
            model_sha256=data.get("model_sha256"),
            backend=str(data.get("backend", "directml")),
            provider=str(data.get("provider", "DmlExecutionProvider")),
            calibration=data.get("calibration"),
            camera_profile=data.get("camera_profile"),
            cycles_used=int(data.get("cycles_used", 0)),
            source=source_val,
            created_at=str(data.get("created_at") or datetime.now(UTC).isoformat()),
        )

    def footer_summary(self, language: str = "pt") -> str:
        """Gera linha compacta e inequívoca para rodapé de relatórios PDF e exportações."""
        calib_str = "Não Calibrado" if language == "pt" else "Uncalibrated"
        if self.calibration and self.calibration.get("scale_px_per_mm"):
            scale = self.calibration["scale_px_per_mm"]
            calib_str = f"Escala: {scale:.3f} px/mm" if language == "pt" else f"Scale: {scale:.3f} px/mm"

        source_label = "ciclos" if (self.source == "cycles" and language == "pt") else (
            "cycles" if self.source == "cycles" else "manual"
        )

        sha_short = self.model_sha256[:8] if self.model_sha256 else "n/a"

        return (
            f"Athlete Motion v{self.app_version} ({self.git_sha}) | "
            f"Motor: {self.model_id} [{sha_short}] via {self.backend.upper()} ({self.provider}) | "
            f"{calib_str} | Amostras: {self.cycles_used} ({source_label}) | {self.created_at}"
        )


def create_session_provenance(
    model_id: str = "yolo11n-pose-320",
    model_sha256: str | None = None,
    backend: str = "directml",
    provider: str = "DmlExecutionProvider",
    calibration: dict[str, Any] | None = None,
    camera_profile: str | None = None,
    cycles_used: int = 0,
    source: Literal["cycles", "manual"] = "cycles",
    created_at: str | None = None,
) -> Provenance:
    """Fábrica para instanciação com resolução automática de versão e git sha."""
    return Provenance(
        app_version=resolve_app_version(),
        git_sha=resolve_git_sha(),
        model_id=model_id,
        model_sha256=model_sha256,
        backend=backend,
        provider=provider,
        calibration=calibration,
        camera_profile=camera_profile,
        cycles_used=cycles_used,
        source=source,
        created_at=created_at or datetime.now(UTC).isoformat(),
    )
