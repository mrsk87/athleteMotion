"""Geradores determinísticos de dados de teste (vídeo, frames, poses e séries).

Porque é que estes dados são gerados e não versionados: um vídeo de teste é pesado, opaco
num `diff` e envelhece mal; uma pose com valores **fixos** transforma-se em *golden file*
que ninguém sabe justificar. O que os testes precisam é de dados *previsíveis* — a mesma
entrada produz exatamente a mesma observação — para poderem falhar por um defeito e não
por azar.

**Proveniência (D14 §4):** nada aqui tem significado clínico nem vem de um atleta. O vídeo
tem um padrão de cinzentos calculado, a pose é uma senoide, e a série de pedalada é uma
onda de cadência artificial. Landmarks reais e anonimizados (`.npz`) têm de ser fornecidos
pelo responsável do projeto e ficam documentados em `tests/data/README.md`; até lá, os
testes que dependem de valores humanos ficam explicitamente marcados como pendentes.

**Pendente da R10:** o gerador de cadência é uma aproximação local. Quando a R10 publicar
`synthetic_pedaling` no domínio partilhado, este módulo deve passar a delegar nele — a
única razão para não o fazer já é o módulo não existir.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Final

import cv2
import numpy as np
import numpy.typing as npt

from athletemotion_desktop.runtime.capture.device import fourcc_to_code

UInt8Image = npt.NDArray[np.uint8]
FloatArray = npt.NDArray[np.float32]

#: Valor de cinzento do frame `index` do vídeo sintético (múltiplos de 5: 10, 15, 20…).
#: A separação entre frames vizinhos é o que permite verificar *por conteúdo* qual o frame
#: devolvido por `seek`/`step` — um `seek` que caia no *keyframe* anterior é detetado.
GRAY_STEP: Final[int] = 5
GRAY_BASE: Final[int] = 10

#: Tolerância de comparação de cinzentos: a compressão MJPG não é sem perdas.
GRAY_TOLERANCE: Final[int] = 4


def gray_value(index: int) -> int:
    """Valor de cinzento escrito no frame `index` do vídeo sintético.

    Args:
        index: índice do frame (0 é o primeiro).

    Returns:
        O valor entre 0 e 255; a função é saturada pelo `np.full` para índices grandes.
    """
    return GRAY_BASE + index * GRAY_STEP


def mean_gray(image: UInt8Image) -> float:
    """Média dos píxeis de uma imagem (identifica o frame no vídeo sintético).

    Args:
        image: imagem BGR.

    Returns:
        A média dos píxeis, em níveis de cinzento.
    """
    return float(np.asarray(image).mean())


def write_synthetic_video(
    path: Path,
    *,
    frame_count: int = 20,
    width: int = 64,
    height: int = 48,
    fps: float = 25.0,
    fourcc: str = "MJPG",
) -> Path:
    """Gera um vídeo de frames sólidos e identificáveis.

    Args:
        path: ficheiro de destino (a extensão deve corresponder ao `fourcc`).
        frame_count: número de frames a escrever.
        width: largura em píxeis.
        height: altura em píxeis.
        fps: cadência gravada no ficheiro.
        fourcc: código do *codec* (`MJPG` por omissão).

    Returns:
        O caminho do ficheiro escrito.

    Raises:
        RuntimeError: se o `cv2.VideoWriter` não abrir (o *codec* não está disponível
            neste OpenCV), com a mensagem que permite agir em vez de um teste opaco.
    """
    writer = cv2.VideoWriter(str(path), fourcc_to_code(fourcc), fps, (width, height))
    if not writer.isOpened():  # pragma: no cover - depende do build do OpenCV
        raise RuntimeError(
            f"O escritor de vídeo não abriu ({fourcc} {width}x{height} @ {fps} FPS). "
            "Sem codec não há dados de teste: instale/verifique o OpenCV em vez de "
            "ignorar o teste em silêncio."
        )
    try:
        for index in range(frame_count):
            frame = np.full((height, width, 3), gray_value(index) % 256, dtype=np.uint8)
            writer.write(frame)
    finally:
        writer.release()
    return path


def synthetic_frame(width: int, height: int, *, seed: int = 11) -> UInt8Image:
    """Frame de textura determinística (não é ruído puro: o ruído puro esconde cópias).

    Args:
        width: largura em píxeis.
        height: altura em píxeis.
        seed: semente do gerador (a mesma semente dá sempre a mesma imagem).

    Returns:
        A imagem BGR.
    """
    generator = np.random.default_rng(seed)
    return generator.integers(0, 256, size=(height, width, 3), dtype=np.uint8)


def synthetic_landmark_sequence(
    frame_count: int,
    *,
    landmark_count: int = 26,
    width: int = 1280,
    height: int = 720,
    cadence_rpm: float = 80.0,
    fps: float = 30.0,
    seed: int = 3,
    noise_px: float = 1.5,
) -> FloatArray:
    """Sequência de landmarks `[frames, N, 3]` de um ciclista sintético.

    O joelho (índice 13, Halpe26) descreve um arco de pedalada à cadência pedida; os
    restantes pontos ficam num corpo plausível. O objetivo é ter uma série com a **forma**
    real (periódica, com ruído) para exercitar filtros, deteção de ciclos e medições —
    nunca para validar valores clínicos.

    Args:
        frame_count: número de frames a gerar.
        landmark_count: número de pontos por frame.
        width: largura do quadro em píxeis.
        height: altura do quadro em píxeis.
        cadence_rpm: cadência da pedalada simulada.
        fps: cadência de aquisição simulada.
        seed: semente do ruído.
        noise_px: desvio-padrão do ruído adicionado, em píxeis.

    Returns:
        Array `float32` com `(x, y, confiança)` por landmark, em píxeis de quadro.
    """
    if frame_count < 1:
        raise ValueError(f"Uma sequência precisa de pelo menos um frame (recebido {frame_count}).")
    if landmark_count < 1:
        raise ValueError(f"Uma pose precisa de pelo menos um landmark (recebido {landmark_count}).")
    if cadence_rpm <= 0 or fps <= 0:
        raise ValueError(
            f"Cadência ({cadence_rpm} rpm) e cadência de aquisição ({fps} FPS) têm de ser positivas."
        )

    generator = np.random.default_rng(seed)
    times = np.arange(frame_count, dtype=np.float64) / fps
    revolutions = times * cadence_rpm / 60.0

    landmarks = np.zeros((frame_count, landmark_count, 3), dtype=np.float32)
    centre_x = width * 0.5
    centre_y = height * 0.55
    for index in range(landmark_count):
        # Cada ponto fica numa posição estável, distribuída em anel: o que interessa é
        # que os pontos sejam distintos e rastreáveis, não que uma pose seja \"realista\".
        angle = 2.0 * math.pi * index / landmark_count
        base_x = centre_x + 0.25 * width * math.cos(angle)
        base_y = centre_y + 0.25 * height * math.sin(angle)
        landmarks[:, index, 0] = base_x
        landmarks[:, index, 1] = base_y
        landmarks[:, index, 2] = 0.9

    # Pedalada: o joelho (13) e o tornozelo (14) sobem e descem com a revolução.
    if landmark_count > 14:
        landmarks[:, 13, 0] = centre_x + 0.05 * width
        landmarks[:, 13, 1] = centre_y + 0.12 * height * np.sin(2.0 * math.pi * revolutions)
        landmarks[:, 14, 0] = centre_x + 0.10 * width
        landmarks[:, 14, 1] = centre_y + 0.18 * height * np.sin(
            2.0 * math.pi * revolutions - math.pi / 4.0
        )

    if noise_px > 0:
        noise = generator.normal(0.0, noise_px, size=(frame_count, landmark_count, 2))
        landmarks[:, :, 0] += noise[:, :, 0].astype(np.float32)
        landmarks[:, :, 1] += noise[:, :, 1].astype(np.float32)
    return landmarks


def synthetic_pedaling_series(
    frame_count: int,
    *,
    cadence_rpm: float = 80.0,
    fps: float = 30.0,
    amplitude: float = 1.0,
    seed: int = 5,
) -> FloatArray:
    """Série temporal de ângulo (graus) de uma pedalada sintética.

    **Provisório:** substitui-se por `synthetic_pedaling` do domínio quando a R10 o
    publicar (ver nota no cabeçalho do módulo).

    Args:
        frame_count: número de amostras.
        cadence_rpm: cadência simulada.
        fps: frequência de amostragem.
        amplitude: amplitude em graus.
        seed: semente do ruído.

    Returns:
        Array `float32` com o ângulo em cada instante.
    """
    landmarks = synthetic_landmark_sequence(
        frame_count, cadence_rpm=cadence_rpm, fps=fps, seed=seed
    )
    knee = landmarks[:, 13, 1]
    if knee.size == 0:  # pragma: no cover - defensivo: frame_count >= 1 é garantido acima
        return np.zeros(0, dtype=np.float32)
    normalised = (knee - knee.mean()) / max(float(knee.std()), 1e-6)
    # `np.asarray` com `dtype` declarado (em vez de `astype`) mantém o tipo verificável
    # pelo mypy em modo estrito: `astype` devolve `Any` nas stubs do numpy.
    series: FloatArray = np.asarray(amplitude * normalised, dtype=np.float32)
    return series


__all__ = [
    "GRAY_BASE",
    "GRAY_STEP",
    "GRAY_TOLERANCE",
    "gray_value",
    "mean_gray",
    "synthetic_frame",
    "synthetic_landmark_sequence",
    "synthetic_pedaling_series",
    "write_synthetic_video",
]
