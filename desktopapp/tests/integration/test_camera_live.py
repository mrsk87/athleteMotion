"""Medição com câmara real — o teste que a D03 não pôde correr (nem o CI pode).

Porque é opt-in e não apenas `skipif`: um teste que abre a câmara do utilizador sem avisar
é uma surpresa desagradável (e, se houver uma sessão de vídeo a decorrer, um erro). Marcar
`needs_camera` exclui-o do CI e de qualquer execução por omissão; a variável
`ATHLETEMOTION_TEST_CAMERA=1` é o consentimento explícito de quem está no PC alvo.

Uso (PC alvo, com a câmara ligada e livre):

```powershell
$env:ATHLETEMOTION_TEST_CAMERA = "1"
$env:QT_QPA_PLATFORM = "offscreen"
pytest tests/integration/test_camera_live.py -q -s -m needs_camera
```

O que ele mede e porque interessa: o FPS efetivo e a latência de `read()` são os dois
números que a D03 deixou pendentes, porque dependem do driver, do cabo e do modo negociado
— nada disso se pode simular com honestidade. As metas são do `README_PLAN` §4.2
(captura ≤ 3 ms por frame) e do requisito de 30 FPS em 720p.
"""

from __future__ import annotations

import os
import time
from collections.abc import Iterator
from typing import Final

import numpy as np
import pytest

from athletemotion_desktop.runtime.capture.camera import CameraConfig, CameraSource, measure_camera
from athletemotion_desktop.runtime.capture.devices import CameraDevice, list_cameras

pytestmark = [pytest.mark.integration, pytest.mark.needs_camera]

#: Consentimento explícito para tocar no hardware: sem esta variável o teste não corre.
CAMERA_OPT_IN_ENV: Final[str] = "ATHLETEMOTION_TEST_CAMERA"

#: Duração da medição de FPS (segundos).
CAMERA_SECONDS_ENV: Final[str] = "ATHLETEMOTION_TEST_CAMERA_SECONDS"
DEFAULT_CAMERA_SECONDS: Final[float] = 5.0

#: Orçamento do plano para a captura (descodificação MJPG incluída), por frame.
BUDGET_READ_MS: Final[float] = 3.0

#: FPS mínimo aceitável para a configuração pedida (a meta do projeto é 30 FPS em 720p).
MIN_EFFECTIVE_FPS: Final[float] = 25.0

#: Amostras de latência de `read()` a recolher.
LATENCY_SAMPLES: Final[int] = 200


def _opt_in() -> bool:
    """Indica se o utilizador autorizou o acesso à câmara nesta execução."""
    return os.environ.get(CAMERA_OPT_IN_ENV, "").strip() in {"1", "true", "yes", "sim"}


@pytest.fixture(scope="module")
def camera() -> Iterator[CameraDevice]:
    """Primeira câmara utilizável, ou `skip` com o motivo (consentimento/hardware)."""
    if not _opt_in():
        pytest.skip(f"teste com câmara real: defina {CAMERA_OPT_IN_ENV}=1 no PC alvo para o correr")
    devices = [device for device in list_cameras() if device.is_usable]
    if not devices:
        pytest.skip(
            "nenhuma câmara respondeu ao OpenCV (0…4). Verifique se está ligada e livre "
            "(outra aplicação pode tê-la aberta)."
        )
    yield devices[0]


def _measure_seconds() -> float:
    """Duração da medição, configurável por ambiente."""
    raw = os.environ.get(CAMERA_SECONDS_ENV)
    return DEFAULT_CAMERA_SECONDS if raw is None else max(1.0, float(raw))


def test_real_camera_delivers_the_requested_stream(camera: CameraDevice) -> None:
    """O FPS efetivo e os valores reais da câmara são medidos e reportados (D03 §9.4)."""
    assert camera.index is not None
    config = CameraConfig(index=camera.index)
    seconds = _measure_seconds()

    info, effective_fps, captured, delivered, dropped = measure_camera(config, seconds)

    print(
        f"\n[câmara real] '{camera.name}' (índice {camera.index})\n"
        f"  pedido: {config.resolution} @ {config.fps} FPS {config.fourcc}\n"
        f"  obtido: {info.resolution} @ {info.fps:.1f} FPS · formato {info.fourcc} · "
        f"backend {info.backend}\n"
        f"  entregues {delivered}/{captured} frames em {seconds:.1f} s · descartados {dropped}\n"
        f"  FPS efetivo: {effective_fps:.2f} (mínimo {MIN_EFFECTIVE_FPS:.0f})\n"
        f"  avisos: {'; '.join(info.warnings) if info.warnings else 'nenhum'}"
    )

    assert captured > 0, "a câmara não entregou um único frame"
    assert delivered > 0, "a captura leu frames mas nenhum chegou ao consumidor"
    assert effective_fps >= MIN_EFFECTIVE_FPS, (
        f"FPS efetivo de {effective_fps:.2f} abaixo do mínimo de {MIN_EFFECTIVE_FPS:.0f} "
        f"(pedido {config.fps} FPS em {config.resolution})"
    )


def test_real_camera_read_latency_stays_within_budget(camera: CameraDevice) -> None:
    """`read()` de um frame já disponível fica dentro dos 3 ms do orçamento de captura."""
    assert camera.index is not None
    config = CameraConfig(index=camera.index, fps=30)
    source = CameraSource(config)
    samples_ms: list[float] = []
    try:
        source.open()
        deadline = time.perf_counter() + _measure_seconds()
        while len(samples_ms) < LATENCY_SAMPLES and time.perf_counter() < deadline:
            if not source.has_frame:
                # A espera pela câmara fica fora da medição: o que se mede é o custo de
                # consumir um frame que já está disponível (o caso em que o consumidor é
                # mais lento do que a câmara).
                time.sleep(0)
                continue
            started = time.perf_counter_ns()
            frame = source.read(timeout_ms=500)
            samples_ms.append((time.perf_counter_ns() - started) / 1e6)
            assert frame is not None
    finally:
        source.close()

    assert samples_ms, "não foi possível recolher amostras de latência"
    p50_ms = float(np.percentile(samples_ms, 50))
    p95_ms = float(np.percentile(samples_ms, 95))
    print(
        f"\n[câmara real] read() com frame pronto: p50={p50_ms:.4f} ms p95={p95_ms:.4f} ms "
        f"n={len(samples_ms)} (orçamento {BUDGET_READ_MS} ms)"
    )

    assert p95_ms < BUDGET_READ_MS, (
        f"p95 de {p95_ms:.4f} ms excede o orçamento de captura de {BUDGET_READ_MS} ms "
        "(README_PLAN §4.2)"
    )
