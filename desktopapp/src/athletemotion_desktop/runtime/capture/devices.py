"""Enumeração de câmaras, nomes legíveis e deteção de *hot-plug*.

**Porquê PowerShell e não `pygrabber`/DirectShow via COM.** Os nomes amigáveis das câmaras
no Windows vivem no *device tree* (`Get-PnpDevice`), não no OpenCV: `cv2.VideoCapture`
conhece apenas índices. Enumerar por COM exigiria uma dependência nova (`pygrabber`) e
inicialização COM por thread; o PowerShell já é usado pela sonda de hardware (D02) e não
acrescenta nada à instalação.

**O que este módulo não finge:** a associação entre um nome do Windows e um índice do
OpenCV é **heurística** (a ordem de enumeração do DirectShow costuma seguir a ordem dos
dispositivos no registo, mas não é contratual). Quando o número de nomes e o número de
índices utilizáveis coincidem, faz-se a associação por posição e marca-se
`name_is_inferred=True`; quando não coincidem, ficam nomes genéricos. Nunca se apresenta
uma associação inventada como certa.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import threading
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace
from typing import Any, Final

import cv2

from athletemotion_desktop.runtime.capture.device import (
    CameraBackend,
    CaptureDevice,
    open_camera,
)
from athletemotion_desktop.runtime.process import run_external_command

logger = logging.getLogger(__name__)

#: Consulta das câmaras presentes e funcionais (`OK` = ligada e sem problemas).
#: `-Class Camera` inclui webcams integradas, USB e virtual (OBS, por exemplo).
PNP_CAMERA_QUERY: Final[str] = (
    "Get-PnpDevice -Class Camera -Status OK | "
    "Select-Object -Property FriendlyName,InstanceId | ConvertTo-Json -Compress"
)

#: Índices testados à procura de câmaras utilizáveis (0…N-1). O Windows raramente passa
#: de 4; 8 dá margem sem custar tempo percetível (cada tentativa é local).
DEFAULT_MAX_PROBE_INDEX: Final[int] = 8

#: Intervalo do *polling* de *hot-plug*: ligar/desligar uma câmara é um ato humano, um
#: segundo e meio de atraso na deteção é irrelevante e mantém o custo em zero.
HOTPLUG_INTERVAL_S: Final[float] = 2.0


@dataclass(frozen=True, slots=True)
class CameraDevice:
    """Uma câmara visível pelo sistema.

    Attributes:
        device_id: identificação estável (o `InstanceId` do Windows quando conhecido;
            caso contrário `cv2:{índice}`, que é estável apenas dentro da sessão).
        name: nome legível.
        index: índice utilizável no OpenCV, ou `None` quando nenhum índice responde.
        backend: backend com que o índice respondeu.
        instance_id: identificação do *device tree* do Windows, quando conhecida.
        resolution: resolução nativa reportada, quando o índice responde.
        name_is_inferred: `True` quando o nome veio de uma associação por posição com a
            lista do Windows (heurística documentada no cabeçalho do módulo).
    """

    device_id: str
    name: str
    index: int | None
    backend: str | None
    instance_id: str | None = None
    resolution: str | None = None
    name_is_inferred: bool = False

    @property
    def is_usable(self) -> bool:
        """Indica se existe um índice do OpenCV que responde."""
        return self.index is not None


def parse_pnp_cameras(raw_output: str | None) -> tuple[tuple[str, str], ...]:
    """Interpreta a saída JSON do `Get-PnpDevice -Class Camera`.

    O `ConvertTo-Json` devolve um objeto (e não uma lista) quando só há um dispositivo —
    um erro clássico que faria desaparecer a única câmara do utilizador.

    Args:
        raw_output: `stdout` do PowerShell, ou `None`.

    Returns:
        Pares `(nome, instance_id)`; tupla vazia quando a saída é ausente ou inválida.
    """
    if not raw_output or not raw_output.strip():
        return ()
    try:
        payload: Any = json.loads(raw_output)
    except json.JSONDecodeError as exc:
        logger.warning("Resposta inválida do PowerShell na enumeração de câmaras: %s", exc)
        return ()

    entries = payload if isinstance(payload, list) else [payload]
    cameras: list[tuple[str, str]] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        name = entry.get("FriendlyName")
        instance_id = entry.get("InstanceId")
        if isinstance(name, str) and name.strip():
            cameras.append((name.strip(), str(instance_id or "")))
    return tuple(cameras)


def _default_device_factory(index: int, backend: CameraBackend) -> CaptureDevice:
    """Abre uma câmara para sondar um índice (fábrica de produção)."""
    return open_camera(index, backend)


def probe_indices(
    *,
    max_index: int = DEFAULT_MAX_PROBE_INDEX,
    backend: CameraBackend = CameraBackend.DSHOW,
    device_factory: Callable[[int, CameraBackend], CaptureDevice] | None = None,
) -> tuple[tuple[int, str], ...]:
    """Descobre que índices do OpenCV têm câmara e a que resolução respondem.

    Args:
        max_index: número de índices a testar (0…`max_index`-1).
        backend: backend com que se faz a sondagem.
        device_factory: fábrica do dispositivo (testes).

    Returns:
        Pares `(índice, resolução)` dos índices que abriram, por ordem crescente. Cada
        dispositivo sondado é fechado de imediato — deixar uma câmara aberta impede que
        outra aplicação a use.
    """
    factory = device_factory or _default_device_factory
    found: list[tuple[int, str]] = []
    for index in range(max(0, max_index)):
        device: CaptureDevice | None = None
        try:
            device = factory(index, backend)
            if not device.isOpened():
                continue
            width = round(device.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = round(device.get(cv2.CAP_PROP_FRAME_HEIGHT))
            found.append(
                (index, f"{width}x{height}" if width and height else "resolução desconhecida")
            )
        except Exception as exc:  # noqa: BLE001 - um índice que rebenta não invalida os outros
            logger.debug("Índice %d não respondeu à sondagem: %s", index, exc)
        finally:
            if device is not None:
                try:
                    device.release()
                except Exception as exc:  # noqa: BLE001 - libertar nunca propaga
                    logger.debug("Falha ao libertar o índice %d: %s", index, exc)
    return tuple(found)


def list_cameras(
    *,
    max_index: int = DEFAULT_MAX_PROBE_INDEX,
    backend: CameraBackend = CameraBackend.DSHOW,
    device_factory: Callable[[int, CameraBackend], CaptureDevice] | None = None,
    command_runner: Callable[[Sequence[str]], str | None] | None = None,
) -> tuple[CameraDevice, ...]:
    """Lista as câmaras do sistema, com índices utilizáveis e nomes legíveis.

    Args:
        max_index: número de índices testados no OpenCV.
        backend: backend da sondagem.
        device_factory: fábrica do dispositivo (testes).
        command_runner: executor de comandos externos (testes).

    Returns:
        As câmaras encontradas. Quando nenhuma responde ao OpenCV mas o Windows reporta
        câmaras, devolve-as com `index=None` — é informação útil («a câmara existe mas
        alguma aplicação a está a usar»), não um erro.
    """
    runner = command_runner or (lambda command: run_external_command(command))
    raw = runner(["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", PNP_CAMERA_QUERY])
    named = parse_pnp_cameras(raw)
    probed = probe_indices(max_index=max_index, backend=backend, device_factory=device_factory)

    if not named and not probed:
        return ()

    if named and not probed:
        logger.warning(
            "O Windows reporta %d câmara(s) mas nenhum índice do OpenCV respondeu "
            "(0…%d): verifique se estão em uso por outra aplicação.",
            len(named),
            max_index - 1,
        )
        return tuple(
            CameraDevice(
                device_id=instance_id or f"pnp:{position}",
                name=name,
                index=None,
                backend=None,
                instance_id=instance_id or None,
            )
            for position, (name, instance_id) in enumerate(named)
        )

    if not named:
        return tuple(
            CameraDevice(
                device_id=f"cv2:{index}",
                name=f"Câmara {index}",
                index=index,
                backend=backend.value,
                resolution=resolution,
            )
            for index, resolution in probed
        )

    if len(named) != len(probed):
        logger.warning(
            "O Windows reporta %d câmara(s) mas o OpenCV responde em %d índice(s): "
            "os nomes não podem ser associados com fiabilidade.",
            len(named),
            len(probed),
        )
        return tuple(
            CameraDevice(
                device_id=f"cv2:{index}",
                name=f"Câmara {index}",
                index=index,
                backend=backend.value,
                resolution=resolution,
            )
            for index, resolution in probed
        )

    return tuple(
        CameraDevice(
            device_id=instance_id or f"pnp:{position}",
            name=name,
            index=index,
            backend=backend.value,
            instance_id=instance_id or None,
            resolution=resolution,
            name_is_inferred=True,
        )
        for position, ((name, instance_id), (index, resolution)) in enumerate(
            zip(named, probed, strict=True)
        )
    )


def diff_devices(
    before: Sequence[CameraDevice], after: Sequence[CameraDevice]
) -> tuple[tuple[CameraDevice, ...], tuple[CameraDevice, ...]]:
    """Compara duas enumerações por `device_id`.

    Args:
        before: enumeração anterior.
        after: enumeração nova.

    Returns:
        `(ligadas, desligadas)`. Um dispositivo cujo índice passou a responder conta como
        ligado mesmo que já constasse da lista — é a informação que interessa a quem tem
        uma sessão em curso.
    """
    before_by_id = {device.device_id: device for device in before}
    after_by_id = {device.device_id: device for device in after}

    added = tuple(
        device
        for device_id, device in after_by_id.items()
        if device_id not in before_by_id
        or (device.is_usable and not before_by_id[device_id].is_usable)
    )
    removed = tuple(
        device
        for device_id, device in before_by_id.items()
        if device_id not in after_by_id
        or (device.is_usable and not after_by_id[device_id].is_usable)
    )
    return added, removed


class CameraHotplugMonitor:
    """Vigia a lista de câmaras numa thread e avisa quando algo muda.

    Args:
        on_change: chamada com `(ligadas, desligadas)` a cada alteração detetada.
        interval_s: intervalo entre enumerações.
        lister: função de enumeração (testes injetam uma lista controlada).
    """

    def __init__(
        self,
        on_change: Callable[[tuple[CameraDevice, ...], tuple[CameraDevice, ...]], None],
        *,
        interval_s: float = HOTPLUG_INTERVAL_S,
        lister: Callable[[], tuple[CameraDevice, ...]] | None = None,
    ) -> None:
        self._on_change = on_change
        self._interval_s = max(0.05, interval_s)
        self._lister = lister or list_cameras
        self._known: tuple[CameraDevice, ...] = ()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    @property
    def known_devices(self) -> tuple[CameraDevice, ...]:
        """Última enumeração conhecida."""
        return self._known

    def prime(self) -> tuple[CameraDevice, ...]:
        """Faz a enumeração inicial (a partir da qual as mudanças são calculadas)."""
        self._known = self._lister()
        return self._known

    def poll_once(self) -> tuple[tuple[CameraDevice, ...], tuple[CameraDevice, ...]]:
        """Faz uma enumeração e devolve `(ligadas, desligadas)` face à anterior."""
        current = self._lister()
        added, removed = diff_devices(self._known, current)
        self._known = current
        if added or removed:
            logger.info(
                "Câmaras: %d ligada(s), %d desligada(s).",
                len(added),
                len(removed),
            )
            self._on_change(added, removed)
        return added, removed

    def start(self) -> None:
        """Arranca o vigia em thread própria (idempotente)."""
        if self._thread is not None:
            return
        self._stop.clear()
        self.prime()
        self._thread = threading.Thread(target=self._loop, name="camera-hotplug", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        """Para o vigia e espera que a thread termine (idempotente)."""
        self._stop.set()
        thread = self._thread
        self._thread = None
        if thread is not None and thread.is_alive():
            thread.join(timeout=2.0)

    def _loop(self) -> None:
        """Laço de *polling* lento; `Event.wait` permite encerrar sem `time.sleep`."""
        while not self._stop.wait(self._interval_s):
            try:
                self.poll_once()
            except Exception as exc:  # noqa: BLE001 - uma enumeração falhada não mata o vigia
                logger.warning("Enumeração de câmaras falhou: %s", exc)


def format_devices(devices: Sequence[CameraDevice]) -> str:
    """Formata a lista de câmaras para leitura humana.

    Args:
        devices: câmaras a mostrar.

    Returns:
        Texto com uma câmara por linha, ou uma mensagem explícita quando não há nenhuma.
    """
    if not devices:
        return "Nenhuma câmara detetada no sistema."
    lines = []
    for device in devices:
        if device.is_usable:
            index = f"índice {device.index} ({device.backend})"
        else:
            index = "sem índice OpenCV (em uso por outra aplicação?)"
        name = device.name + (" (nome inferido)" if device.name_is_inferred else "")
        resolution = f", {device.resolution}" if device.resolution else ""
        lines.append(f"- {name}: {index}{resolution}")
    return "\n".join(lines)


def print_devices() -> int:
    """Imprime a lista de câmaras (usada por `--list` dos CLIs de captura).

    Returns:
        0 quando há pelo menos uma câmara utilizável, 1 quando não há nenhuma.
    """
    devices = list_cameras()
    print(format_devices(devices))
    return 0 if any(device.is_usable for device in devices) else 1


def build_argument_parser() -> argparse.ArgumentParser:
    """Constrói o analisador de argumentos do enumerador de câmaras."""
    parser = argparse.ArgumentParser(
        prog="python -m athletemotion_desktop.runtime.capture.devices",
        description="Lista as câmaras do sistema com os índices utilizáveis pelo OpenCV.",
    )
    output_group = parser.add_mutually_exclusive_group()
    output_group.add_argument("--json", action="store_true", help="imprimir em JSON")
    output_group.add_argument(
        "--list",
        action="store_true",
        help=(
            "listar as câmaras (equivalente ao comportamento por omissão; existe para "
            "simetria com `capture.camera --list`)"
        ),
    )
    parser.add_argument(
        "--max-index", type=int, default=DEFAULT_MAX_PROBE_INDEX, help="índices testados (0…N-1)"
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Ponto de entrada do enumerador de câmaras.

    Args:
        argv: argumentos (por omissão os da linha de comandos).

    Returns:
        Código de saída: 0 quando há câmaras utilizáveis, 1 quando não há.
    """
    arguments = build_argument_parser().parse_args(argv)
    devices = list_cameras(max_index=arguments.max_index)

    if arguments.json:
        payload = [
            {
                "device_id": device.device_id,
                "name": device.name,
                "index": device.index,
                "backend": device.backend,
                "instance_id": device.instance_id,
                "resolution": device.resolution,
                "name_is_inferred": device.name_is_inferred,
            }
            for device in devices
        ]
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(format_devices(devices))

    return 0 if any(device.is_usable for device in devices) else 1


def with_index(device: CameraDevice, index: int | None) -> CameraDevice:
    """Devolve uma cópia do dispositivo com outro índice (auxiliar para testes/UI)."""
    return replace(device, index=index)


if __name__ == "__main__":  # pragma: no cover - entrada de CLI
    sys.exit(main())
