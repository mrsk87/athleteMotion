"""Controlos de câmara: exposição, ganho, balanço de brancos, foco — e os seus limites.

O problema central deste módulo é que **os drivers mentem**. `cap.set(...)` devolve `True`
para propriedades que o dispositivo não suporta, e `cap.get(...)` devolve `0.0` tanto para
"não suportado" como para "exposição zero". Inventar capacidades a partir dessas respostas
levaria a UI a oferecer controlos que não fazem nada e, pior, a gravar presets com valores
que nunca foram aceites.

Por isso o suporte é **medido**: escreve-se o valor atual de volta e verifica-se que ele
é legível antes e depois. Quando o resultado é ambíguo, o controlo é reportado como não
suportado com a razão — nunca como suportado "provavelmente".
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from pathlib import Path
from typing import Any, Final

import cv2
from pydantic import BaseModel, Field, ValidationError

from athletemotion_desktop.runtime.capture.device import CaptureDevice

logger = logging.getLogger(__name__)

PRESET_SCHEMA_VERSION: Final[int] = 1

#: Nomes dos ficheiros de presets no diretório de dados da aplicação.
PRESETS_FILE_NAME: Final[str] = "camera_presets.json"


class CameraControl(StrEnum):
    """Controlos expostos pela interface, quando o driver os suportar."""

    EXPOSURE = "exposure"
    AUTO_EXPOSURE = "auto_exposure"
    GAIN = "gain"
    BRIGHTNESS = "brightness"
    CONTRAST = "contrast"
    SATURATION = "saturation"
    WHITE_BALANCE = "white_balance"
    AUTO_WHITE_BALANCE = "auto_white_balance"
    FOCUS = "focus"
    AUTO_FOCUS = "auto_focus"
    BACKLIGHT_COMPENSATION = "backlight_compensation"


#: Tradução `controlo do domínio → atributo do OpenCV`. Os controlos "automáticos"
#: (`CAP_PROP_AUTO_EXPOSURE`, `CAP_PROP_AUTO_WB`, `CAP_PROP_AUTOFOCUS`) fazem parte da
#: mesma tabela: quem trava a exposição precisa de os escrever diretamente, pelo que
#: separá-los numa função diferente só criava um caminho onde se esqueceriam.
_CONTROL_ATTRIBUTES: Final[dict[CameraControl, str]] = {
    CameraControl.EXPOSURE: "CAP_PROP_EXPOSURE",
    CameraControl.AUTO_EXPOSURE: "CAP_PROP_AUTO_EXPOSURE",
    CameraControl.GAIN: "CAP_PROP_GAIN",
    CameraControl.BRIGHTNESS: "CAP_PROP_BRIGHTNESS",
    CameraControl.CONTRAST: "CAP_PROP_CONTRAST",
    CameraControl.SATURATION: "CAP_PROP_SATURATION",
    CameraControl.WHITE_BALANCE: "CAP_PROP_WHITE_BALANCE_BLUE_U",
    CameraControl.AUTO_WHITE_BALANCE: "CAP_PROP_AUTO_WB",
    CameraControl.FOCUS: "CAP_PROP_FOCUS",
    CameraControl.AUTO_FOCUS: "CAP_PROP_AUTOFOCUS",
    CameraControl.BACKLIGHT_COMPENSATION: "CAP_PROP_BACKLIGHT",
}


#: Valores que desligam cada modo automático. Os drivers não são consistentes (`0`, `0.25`
#: e `1` aparecem todos como "manual" segundo o backend), pelo que o valor é escrito e a
#: confirmação fica a cargo da leitura seguinte.
AUTO_OFF_VALUE: Final[float] = 0.0


def _cv_property(control: CameraControl) -> int | None:
    """Traduz um controlo do domínio para a propriedade do OpenCV.

    Args:
        control: controlo pedido.

    Returns:
        O identificador `cv2.CAP_PROP_*`, ou `None` quando a versão do OpenCV instalada
        não expõe essa propriedade (acontece com `CAP_PROP_AUTO_WB` em versões antigas).
    """
    attribute = _CONTROL_ATTRIBUTES.get(control)
    if attribute is None or not hasattr(cv2, attribute):
        return None
    return int(getattr(cv2, attribute))


@dataclass(frozen=True, slots=True)
class ControlCapability:
    """O que se conseguiu verificar sobre um controlo de um dispositivo.

    Attributes:
        control: o controlo em causa.
        supported: `True` só quando a escrita e a leitura foram confirmadas.
        value: valor atual, quando legível.
        minimum: limite inferior, quando o driver o reporta de forma útil.
        maximum: limite superior, quando o driver o reporta de forma útil.
        reason: explicação em PT-PT do resultado (sempre preenchida).
    """

    control: CameraControl
    supported: bool
    value: float | None
    minimum: float | None
    maximum: float | None
    reason: str


def probe_controls(device: CaptureDevice) -> dict[CameraControl, ControlCapability]:
    """Mede quais os controlos que um dispositivo realmente suporta.

    A verificação é uma escrita do **valor atual** seguida de nova leitura: escrever o
    mesmo valor não altera o estado da câmara, mas denuncia os drivers que aceitam
    qualquer escrita e devolvem `0.0` em todas as leituras.

    Args:
        device: dispositivo de captura aberto.

    Returns:
        Mapa controlo → capacidade. Controlos ausentes do mapa são os que nem existem
        nesta versão do OpenCV, e são tratados como não suportados.
    """
    capabilities: dict[CameraControl, ControlCapability] = {}

    for control in CameraControl:
        prop_id = _cv_property(control)
        if prop_id is None:
            capabilities[control] = ControlCapability(
                control=control,
                supported=False,
                value=None,
                minimum=None,
                maximum=None,
                reason="o OpenCV instalado não expõe esta propriedade",
            )
            continue

        try:
            before = float(device.get(prop_id))
        except Exception as exc:  # noqa: BLE001 - drivers lançam erro de tipos variados
            capabilities[control] = ControlCapability(
                control=control,
                supported=False,
                value=None,
                minimum=None,
                maximum=None,
                reason=f"a leitura falhou: {exc}",
            )
            continue

        try:
            accepted = bool(device.set(prop_id, before))
        except Exception as exc:  # noqa: BLE001 - idem
            capabilities[control] = ControlCapability(
                control=control,
                supported=False,
                value=None,
                minimum=None,
                maximum=None,
                reason=f"a escrita falhou: {exc}",
            )
            continue

        try:
            after = float(device.get(prop_id))
        except Exception as exc:  # noqa: BLE001 - idem
            after = before
            logger.debug("Confirmação de '%s' falhou após escrita: %s", control.value, exc)

        # Um driver que devolve sempre 0.0 aceita escritas mas não devolve estado: não é
        # possível distinguir "suportado com valor zero" de "não suportado". Sem
        # verificação não há suporte — a interface pode mostrar a limitação, mas não pode
        # apresentar um controlo que talvez não faça nada.
        confirmed = accepted and after == before and after != 0.0
        capabilities[control] = ControlCapability(
            control=control,
            supported=confirmed,
            value=after,
            minimum=None,
            maximum=None,
            reason=(
                "confirmado por escrita do mesmo valor e nova leitura"
                if confirmed
                else (
                    "o driver devolve sempre 0.0, que é indistinguível de não suportado"
                    if after == before == 0.0
                    else "o driver aceitou a escrita mas não devolveu o valor esperado"
                )
            ),
        )

    logger.info(
        "Controlos suportados: %s",
        ", ".join(c.value for c, cap in capabilities.items() if cap.supported) or "(nenhum)",
    )
    return capabilities


def set_control(
    device: CaptureDevice,
    capabilities: Mapping[CameraControl, ControlCapability],
    control: CameraControl,
    value: float,
) -> bool:
    """Aplica um valor a um controlo, respeitando o que foi verificado.

    Args:
        device: dispositivo de captura aberto.
        capabilities: resultado de :func:`probe_controls`.
        control: controlo a alterar.
        value: valor pretendido.

    Returns:
        `True` quando a escrita foi aceite pelo driver; `False` quando o controlo não é
        suportado ou o valor não foi aceite.
    """
    capability = capabilities.get(control)
    if capability is None or not capability.supported:
        logger.debug("Controlo '%s' ignorado: não suportado pelo dispositivo.", control.value)
        return False
    prop_id = _cv_property(control)
    if prop_id is None:  # pragma: no cover - coerente com `probe_controls`
        return False
    try:
        return bool(device.set(prop_id, float(value)))
    except Exception as exc:  # noqa: BLE001 - drivers lançam erro de tipos variados
        logger.warning("Escrita de '%s=%s' falhou: %s", control.value, value, exc)
        return False


def lock_exposure(
    device: CaptureDevice, capabilities: Mapping[CameraControl, ControlCapability]
) -> float | None:
    """Trava a exposição no valor que a automática escolheu.

    A exposição automática é a maior fonte de variabilidade entre frames: com ela ligada,
    a mesma pose produz tensores diferentes segundo a luz do ginásio. Esta função lê o
    valor atual (o que a automática decidiu), desliga a automática e fixa-o.

    Args:
        device: dispositivo de captura aberto.
        capabilities: resultado de :func:`probe_controls`.

    Returns:
        O valor fixado, ou `None` quando a exposição não é controlável (o que é normal
        em várias webcams — nesse caso o consumidor deve ser avisado, não enganado).
    """
    exposure = capabilities.get(CameraControl.EXPOSURE)
    if exposure is None or not exposure.supported or exposure.value is None:
        logger.warning("Não é possível travar a exposição: o dispositivo não a expõe.")
        return None

    auto = capabilities.get(CameraControl.AUTO_EXPOSURE)
    if auto is not None and auto.supported:
        prop_id = _cv_property(CameraControl.AUTO_EXPOSURE)
        if prop_id is not None:
            # Nos drivers DirectShow/V4L2 o valor 0.25 (ou 1) significa "manual" e 0.75
            # (ou 3) "automático", com convenções diferentes por backend. Desliga-se
            # primeiro com o valor mínimo e confirma-se pela exposição lida.
            device.set(prop_id, AUTO_OFF_VALUE)

    prop_id = _cv_property(CameraControl.EXPOSURE)
    if prop_id is None:  # pragma: no cover - coerente com `probe_controls`
        return None
    if not device.set(prop_id, float(exposure.value)):
        logger.warning("O dispositivo recusou fixar a exposição em %s.", exposure.value)
        return None
    return exposure.value


class CameraPresetModel(BaseModel):
    """Preset de controlos guardado por dispositivo (formato do ficheiro)."""

    name: str = Field(min_length=1, max_length=64)
    device_id: str = Field(min_length=1)
    controls: dict[str, float]
    created_at: str


class PresetsFileModel(BaseModel):
    """Esquema versionado de `camera_presets.json`."""

    schema_version: int
    presets: list[CameraPresetModel] = Field(default_factory=list)


@dataclass(frozen=True, slots=True)
class CameraPreset:
    """Preset aplicável a um dispositivo.

    Attributes:
        name: nome dado pelo utilizador.
        device_id: identificação do dispositivo a que pertence.
        controls: valores por controlo (`CameraControl` → valor).
        created_at: instante ISO-8601 de criação.
    """

    name: str
    device_id: str
    controls: dict[str, float]
    created_at: str


def capture_preset(
    name: str,
    device_id: str,
    capabilities: Mapping[CameraControl, ControlCapability],
) -> CameraPreset:
    """Fotografa os controlos suportados e atuais de um dispositivo.

    Args:
        name: nome do preset.
        device_id: identificação do dispositivo.
        capabilities: resultado de :func:`probe_controls`.

    Returns:
        Um `CameraPreset` com **apenas** os controlos realmente suportados (guardar
        valores não confirmados criaria presets que não se reproduzem).
    """
    values = {
        control.value: float(capability.value)
        for control, capability in capabilities.items()
        if capability.supported and capability.value is not None
    }
    return CameraPreset(
        name=name,
        device_id=device_id,
        controls=values,
        created_at=datetime.now(UTC).isoformat(),
    )


def apply_preset(
    device: CaptureDevice,
    capabilities: Mapping[CameraControl, ControlCapability],
    preset: CameraPreset,
) -> tuple[CameraControl, ...]:
    """Aplica um preset, devolvendo os controlos que ficaram por aplicar.

    Args:
        device: dispositivo de captura aberto.
        capabilities: resultado de :func:`probe_controls` no dispositivo atual.
        preset: preset a aplicar.

    Returns:
        Os controlos que **não** puderam ser aplicados (não suportados ou recusados),
        para que a interface o diga ao utilizador em vez de fingir sucesso.
    """
    rejected: list[CameraControl] = []
    for name, value in preset.controls.items():
        try:
            control = CameraControl(name)
        except ValueError:
            logger.warning("Preset '%s' tem um controlo desconhecido: %s", preset.name, name)
            continue
        if not set_control(device, capabilities, control, value):
            rejected.append(control)
    return tuple(rejected)


def _presets_path(presets_file: Path | None) -> Path:
    """Resolve o caminho do ficheiro de presets (dados do utilizador por omissão)."""
    if presets_file is not None:
        return presets_file
    # Import tardio: `config` toca no sistema de ficheiros do utilizador e não deve ser
    # carregado só por importar este módulo.
    from athletemotion_desktop.config.paths import get_app_paths

    return get_app_paths().camera_presets_file


def load_presets(presets_file: Path | None = None) -> tuple[CameraPreset, ...]:
    """Lê os presets guardados, ignorando um ficheiro inválido com aviso.

    Args:
        presets_file: caminho alternativo (usado nos testes).

    Returns:
        Os presets válidos; tupla vazia quando o ficheiro não existe ou está corrompido
        (nunca uma exceção: um preset ilegível não pode impedir a captura).
    """
    path = _presets_path(presets_file)
    if not path.is_file():
        return ()
    try:
        payload: Any = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Presets de câmara ilegíveis em %s: %s", path, exc)
        return ()

    try:
        parsed = PresetsFileModel.model_validate(payload)
    except ValidationError as exc:
        logger.warning("Presets de câmara com esquema inválido em %s: %s", path, exc)
        return ()

    if parsed.schema_version != PRESET_SCHEMA_VERSION:
        logger.warning(
            "Presets de câmara na versão %d (esperada %d): ignorados.",
            parsed.schema_version,
            PRESET_SCHEMA_VERSION,
        )
        return ()

    return tuple(
        CameraPreset(
            name=item.name,
            device_id=item.device_id,
            controls=dict(item.controls),
            created_at=item.created_at,
        )
        for item in parsed.presets
    )


def save_presets(presets: tuple[CameraPreset, ...], presets_file: Path | None = None) -> Path:
    """Grava os presets de forma atómica (`.tmp` + `os.replace`).

    Args:
        presets: presets a gravar (substituem os anteriores).
        presets_file: caminho alternativo (usado nos testes).

    Returns:
        O caminho gravado.

    Raises:
        OSError: se a gravação falhar; o ficheiro anterior mantém-se intacto.
    """
    path = _presets_path(presets_file)
    path.parent.mkdir(parents=True, exist_ok=True)
    document = PresetsFileModel(
        schema_version=PRESET_SCHEMA_VERSION,
        presets=[
            CameraPresetModel(
                name=preset.name,
                device_id=preset.device_id,
                controls=preset.controls,
                created_at=preset.created_at,
            )
            for preset in presets
        ],
    )
    payload = document.model_dump_json(indent=2)

    # Gravação atómica: nunca se deixa um ficheiro de presets truncado se o processo
    # morrer a meio da escrita (regra de integridade da AGENTS.md §2.1).
    descriptor, temporary_name = tempfile.mkstemp(
        dir=str(path.parent), prefix=f".{path.name}.", suffix=".tmp"
    )
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    except OSError:
        Path(temporary_name).unlink(missing_ok=True)
        raise
    return path
