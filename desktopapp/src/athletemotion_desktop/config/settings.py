"""Definições da aplicação com validação Pydantic e persistência atómica."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

from athletemotion_desktop.config.paths import get_app_paths

logger = logging.getLogger(__name__)

#: Códigos de idioma suportados pela interface. Fonte única de verdade partilhada
#: pelo modelo de definições (validação) e pelo serviço de traduções (UI).
LanguageCode = Literal["pt_PT", "en_US"]


class InferenceSettings(BaseModel):
    """Configurações do subsistema de inferência e aceleração por hardware.

    O utilizador pode sobrepor-se ao perfil recomendado pelo autotune: nesse caso
    `manual_override` fica `True` e a recomendação deixa de ser aplicada
    automaticamente (requisito de aceitação da D02).
    """

    preferred_backend: Literal["auto", "directml", "openvino", "cpu"] = Field(
        default="auto",
        description="Backend preferencial para execução de modelos",
    )
    pose_model: str = Field(
        default="pose_yolo11n_320",
        description="Identificador do modelo de pose (ver model zoo do plano §5)",
    )
    detector_model: str = Field(
        default="det_yolo11n",
        description="Identificador do detetor de pessoa usado na redeteção periódica",
    )
    input_resolution: int = Field(
        default=320,
        ge=160,
        le=1280,
        description="Lado maior da entrada do modelo de pose, em píxeis",
    )
    redetect_interval: int = Field(
        default=10,
        ge=1,
        le=120,
        description="Número de frames entre redeteções completas da pessoa",
    )
    confidence_threshold: float = Field(
        default=0.45,
        ge=0.0,
        le=1.0,
        description="Limiar mínimo de confiança para aceitação de keypoints",
    )
    mode: Literal["real_time", "precision", "batch"] = Field(
        default="real_time",
        description="Perfil de desempenho pretendido (tempo real, precisão ou batch)",
    )
    manual_override: bool = Field(
        default=False,
        description="Indica que o utilizador substituiu manualmente a recomendação do autotune",
    )


class CameraSettings(BaseModel):
    """Configurações da captura de câmara."""

    device_index: int = Field(default=0, ge=0, description="Índice da câmara no sistema")
    target_fps: int = Field(default=60, ge=15, le=120, description="Taxa de quadros pretendida")
    frame_width: int = Field(default=1280, ge=640, description="Largura pretendida em píxeis")
    frame_height: int = Field(default=720, ge=480, description="Altura pretendida em píxeis")


class AppSettings(BaseModel):
    """Configurações globais persistidas da aplicação desktop.

    Os campos acrescentados nas tarefas seguintes têm valores por omissão, pelo que
    um ficheiro gravado por uma versão anterior continua a carregar sem migração.
    """

    schema_version: int = Field(default=1, description="Versão do esquema para migrações")
    language: LanguageCode = Field(default="pt_PT", description="Idioma da interface")
    theme: Literal["dark", "light"] = Field(default="dark", description="Tema visual")
    record_sessions: bool = Field(
        default=False,
        description=(
            "Gravar vídeo das sessões (decisão E4 do plano: desligado por omissão, "
            "exige consentimento explícito)"
        ),
    )
    inference: InferenceSettings = Field(default_factory=InferenceSettings)
    camera: CameraSettings = Field(default_factory=CameraSettings)

    def reset_to_defaults(self) -> AppSettings:
        """Devolve um novo conjunto de definições nos valores padrão.

        O idioma e o tema são preservados: são preferências de acessibilidade do
        utilizador e não parte do desempenho que se está a repor.

        Returns:
            Nova instância de `AppSettings` com o desempenho, a câmara e a política
            de gravação nos valores de fábrica.
        """
        defaults = AppSettings()
        return self.model_copy(
            update={
                "record_sessions": defaults.record_sessions,
                "inference": defaults.inference,
                "camera": defaults.camera,
            }
        )


def load_settings(custom_path: Path | None = None) -> AppSettings:
    """Carrega as definições do disco ou devolve os valores padrão se não existirem.

    Args:
        custom_path: Caminho opcional para teste; por omissão usa `paths.settings_file`.

    Returns:
        AppSettings validado.
    """
    settings_file = custom_path or get_app_paths().settings_file
    if not settings_file.exists():
        return AppSettings()

    try:
        content = settings_file.read_text(encoding="utf-8")
        data = json.loads(content)
        return AppSettings.model_validate(data)
    except (OSError, ValueError) as exc:
        # JSON inválido (ValueError) ou ficheiro ilegível (OSError): o utilizador
        # fica com os valores padrão e o problema é registado em vez de silenciado.
        logger.warning(
            "Falha ao carregar ficheiro de definições em %s (%s). A usar padrões.",
            settings_file,
            exc,
        )
        return AppSettings()


def save_settings(settings: AppSettings, custom_path: Path | None = None) -> None:
    """Grava as definições no disco com garantia ACID (gravação atómica via ficheiro temporário).

    Args:
        settings: Instância de definições a persistir.
        custom_path: Caminho opcional para teste.
    """
    settings_file = custom_path or get_app_paths().settings_file
    temp_file = settings_file.with_suffix(".json.tmp")

    payload = settings.model_dump_json(indent=2)
    temp_file.write_text(payload, encoding="utf-8")

    # Substituição atómica do ficheiro
    os.replace(temp_file, settings_file)
    logger.info("Definições gravadas com sucesso em %s", settings_file)
