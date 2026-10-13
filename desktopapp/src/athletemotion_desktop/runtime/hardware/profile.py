"""Leitura e validação de `hardware_profile.json` (resultado do autotune).

O perfil é produzido pelo autotune (tarefa R14, no pacote `athletemotion`) e diz
qual o *backend*, modelo e resolução recomendados para **este** computador. Este
módulo limita-se a ler, validar e decidir se o perfil ainda é válido.

**Estado do projeto:** a R14 ainda não expõe `athletemotion.infrastructure.autotune`,
pelo que a execução do autotune falha explicitamente com
`AutotuneUnavailableError` — nunca se inventa um perfil "por omissão" nem se
mostra progresso falso.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Final, Literal

from pydantic import BaseModel, Field, ValidationError

logger = logging.getLogger(__name__)

PROFILE_FILE_NAME: Final[str] = "hardware_profile.json"
PROFILE_SCHEMA_VERSION: Final[int] = 1

#: Módulo do backend que executa o autotune (R14). Enquanto não existir, a
#: funcionalidade fica indisponível de forma explícita.
AUTOTUNE_MODULE: Final[str] = "athletemotion.infrastructure.autotune"

BackendChoice = Literal["directml", "openvino", "cpu"]
OperatingMode = Literal["real_time", "precision", "batch"]


class ProfileState(str, Enum):
    """Estado do perfil de hardware relativamente ao computador atual."""

    MISSING = "missing"
    READY = "ready"
    NEEDS_AUTOTUNE = "needs_autotune"
    INVALID = "invalid"


class AutotuneUnavailableError(RuntimeError):
    """O autotune não pode ser executado neste ambiente.

    Args:
        reason: explicação em PT-PT, pronta a mostrar ao utilizador.
    """

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class MeasurementModel(BaseModel):
    """Medição de desempenho de uma combinação (modelo × backend × resolução)."""

    backend: BackendChoice
    pose_model: str
    input_resolution: int = Field(ge=160, le=1280)
    latency_p50_ms: float = Field(ge=0)
    latency_p95_ms: float = Field(ge=0)
    fps: float = Field(ge=0)


class RecommendationModel(BaseModel):
    """Perfil escolhido pelo autotune para este hardware."""

    backend: BackendChoice
    pose_model: str
    detector_model: str
    input_resolution: int = Field(ge=160, le=1280)
    redetect_interval: int = Field(default=10, ge=1, le=120)
    mode: OperatingMode = "real_time"


class HardwareProfileModel(BaseModel):
    """Esquema versionado de `hardware_profile.json`.

    O esquema é **provisório** até a R14 fixar o formato partilhado com o backend;
    por isso a versão é validada explicitamente e um perfil de versão desconhecida
    é tratado como inválido (em vez de interpretado à sorte).
    """

    schema_version: int
    generated_at: str
    hardware_signature: str
    ort_version: str | None = None
    recommendation: RecommendationModel
    measurements: tuple[MeasurementModel, ...] = ()


@dataclass(frozen=True)
class ProfileStatus:
    """Resultado da avaliação do perfil de hardware.

    Attributes:
        state: estado do perfil.
        profile: perfil carregado, quando o estado é `READY`.
        reason: explicação em PT-PT do estado (mostrada na interface).
    """

    state: ProfileState
    profile: HardwareProfileModel | None
    reason: str

    @property
    def is_usable(self) -> bool:
        """Indica se existe um perfil válido e atual para este hardware."""
        return self.state is ProfileState.READY


def load_profile(profile_file: Path, hardware_signature: str) -> ProfileStatus:
    """Carrega e avalia o perfil de hardware de um computador.

    Args:
        profile_file: caminho de `hardware_profile.json`.
        hardware_signature: assinatura do hardware atual (`probe.build_hardware_signature`).

    Returns:
        `ProfileStatus` com o estado e a razão em PT-PT. Nunca levanta exceção por
        ficheiro ausente, corrompido ou de versão desconhecida.
    """
    if not profile_file.is_file():
        return ProfileStatus(
            state=ProfileState.MISSING,
            profile=None,
            reason=(
                "Ainda não existe perfil de hardware neste computador: "
                "execute o autotune para medir o desempenho real."
            ),
        )

    try:
        raw_content = profile_file.read_text(encoding="utf-8")
    except OSError as exc:
        logger.warning("Não foi possível ler o perfil de hardware %s: %s", profile_file, exc)
        return ProfileStatus(
            state=ProfileState.INVALID,
            profile=None,
            reason=f"O perfil de hardware não pôde ser lido ({exc}).",
        )

    try:
        payload = json.loads(raw_content)
    except json.JSONDecodeError as exc:
        logger.error("Perfil de hardware com JSON inválido em %s: %s", profile_file, exc)
        return ProfileStatus(
            state=ProfileState.INVALID,
            profile=None,
            reason=f"O perfil de hardware tem JSON inválido (linha {exc.lineno}).",
        )

    try:
        profile = HardwareProfileModel.model_validate(payload)
    except ValidationError as exc:
        errors = exc.errors()
        if errors:
            location = ".".join(str(part) for part in errors[0]["loc"]) or "?"
            message = errors[0]["msg"]
        else:
            location, message = "?", "erro desconhecido"
        logger.error("Perfil de hardware inválido em %s: %s", profile_file, exc)
        return ProfileStatus(
            state=ProfileState.INVALID,
            profile=None,
            reason=(
                f"O perfil de hardware não cumpre o esquema v{PROFILE_SCHEMA_VERSION} "
                f"(campo '{location}': {message})."
            ),
        )

    if profile.schema_version != PROFILE_SCHEMA_VERSION:
        return ProfileStatus(
            state=ProfileState.INVALID,
            profile=None,
            reason=(
                f"O perfil de hardware usa o esquema v{profile.schema_version}, "
                f"mas esta versão da aplicação espera v{PROFILE_SCHEMA_VERSION}. "
                "Execute novamente o autotune."
            ),
        )

    if profile.hardware_signature != hardware_signature:
        return ProfileStatus(
            state=ProfileState.NEEDS_AUTOTUNE,
            profile=profile,
            reason=(
                "O hardware ou o driver mudaram desde o último autotune: "
                "o perfil existente deixou de ser fiável."
            ),
        )

    return ProfileStatus(
        state=ProfileState.READY,
        profile=profile,
        reason="Perfil de hardware válido para este computador.",
    )
