"""Testes dos geradores de dados de teste e da política de dados (D14 §4).

Gerar dados em vez de os versionar só é seguro se os dados forem **reproduzíveis** e a
política de proveniência for verificável. É isso que se testa aqui: a mesma semente dá a
mesma observação, os ficheiros pesados não entram no repositório, e os limites dos
geradores são validados em vez de produzirem dados silenciosamente errados.
"""

from __future__ import annotations

import itertools
from pathlib import Path

import cv2
import numpy as np
import pytest

from tests.fakes.synthetic import (
    GRAY_TOLERANCE,
    gray_value,
    mean_gray,
    synthetic_frame,
    synthetic_landmark_sequence,
    synthetic_pedaling_series,
    write_synthetic_video,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "tests" / "data"

#: Artefactos **gerados**: nunca entram no repositório, geram-se em tempo de execução.
GENERATED_SUFFIXES = {".mp4", ".avi", ".mkv", ".mov", ".npy", ".onnx"}

#: Teto de tamanho para dados guardados (landmarks anonimizados): acima disto, o ficheiro
#: deixa de ser um caso de teste e passa a ser um conjunto de dados a gerir fora do repo.
MAX_ARCHIVED_BYTES = 1024 * 1024


def test_synthetic_video_is_playable_and_identifiable(tmp_path: Path) -> None:
    """O vídeo gerado abre, tem os frames pedidos e cada frame é identificável."""
    video = write_synthetic_video(tmp_path / "clip.avi", frame_count=12, fps=25.0)

    capture = cv2.VideoCapture(str(video))
    try:
        assert capture.isOpened()
        assert capture.get(cv2.CAP_PROP_FRAME_COUNT) == pytest.approx(12, abs=1)
        assert capture.get(cv2.CAP_PROP_FPS) == pytest.approx(25.0, abs=0.5)

        for index in range(12):
            ok, frame = capture.read()
            assert ok, f"o frame {index} não foi lido"
            # A compressão MJPG não é sem perdas: compara-se com tolerância, e é a
            # separação de 5 níveis entre frames que torna a posição verificável.
            assert mean_gray(np.asarray(frame)) == pytest.approx(
                gray_value(index), abs=GRAY_TOLERANCE
            )
    finally:
        capture.release()


def test_gray_values_are_well_separated() -> None:
    """Frames vizinhos diferem mais do que a tolerância: caso contrário seriam confundíveis.

    A verificação de `seek`/`step` compara o cinzento medido com o esperado com uma
    tolerância de ±4 níveis (a compressão MJPG não é sem perdas). Se o passo entre frames
    não excedesse a tolerância, os intervalos de dois frames vizinhos sobrepor-se-iam e o
    teste deixaria de conseguir dizer qual deles foi devolvido.
    """
    values = [gray_value(index) for index in range(40)]

    assert values == sorted(values)
    step = min(second - first for first, second in itertools.pairwise(values))
    assert step > GRAY_TOLERANCE, (
        f"passo de {step} níveis não excede a tolerância de {GRAY_TOLERANCE}"
    )


def test_generated_frames_are_deterministic() -> None:
    """A mesma semente dá a mesma imagem; sementes diferentes dão imagens diferentes."""
    first = synthetic_frame(64, 48, seed=7)
    second = synthetic_frame(64, 48, seed=7)
    other = synthetic_frame(64, 48, seed=8)

    assert first.shape == (48, 64, 3)
    assert first.dtype == np.uint8
    assert np.array_equal(first, second)
    assert not np.array_equal(first, other)


def test_landmark_sequence_is_periodic_and_stable() -> None:
    """A pose sintética é determinística, tem a forma contratada e o joelho pedala."""
    first = synthetic_landmark_sequence(30, cadence_rpm=90.0, fps=30.0, seed=4)
    second = synthetic_landmark_sequence(30, cadence_rpm=90.0, fps=30.0, seed=4)

    assert first.shape == (30, 26, 3)
    assert first.dtype == np.float32
    assert np.array_equal(first, second)
    knee_y = first[:, 13, 1]
    assert float(knee_y.max() - knee_y.min()) > 20.0, "o joelho não se moveu o suficiente"
    assert np.all(first[:, :, 2] > 0.5), "as confianças deviam ser plausíveis (> 0,5)"


def test_landmark_sequence_validates_its_arguments() -> None:
    """Parâmetros impossíveis falham com contexto em vez de gerar dados vazios."""
    with pytest.raises(ValueError, match="pelo menos um frame"):
        synthetic_landmark_sequence(0)
    with pytest.raises(ValueError, match="pelo menos um landmark"):
        synthetic_landmark_sequence(5, landmark_count=0)
    with pytest.raises(ValueError, match="têm de ser positivas"):
        synthetic_landmark_sequence(5, cadence_rpm=0.0)
    with pytest.raises(ValueError, match="têm de ser positivas"):
        synthetic_landmark_sequence(5, fps=0.0)


def test_pedaling_series_is_deterministic_and_centred() -> None:
    """A série de ângulos é reproduzível e centrada (o que a deteção de ciclos espera)."""
    first = synthetic_pedaling_series(120, cadence_rpm=80.0, fps=30.0)
    second = synthetic_pedaling_series(120, cadence_rpm=80.0, fps=30.0)

    assert first.shape == (120,)
    assert np.array_equal(first, second)
    assert abs(float(first.mean())) < 0.2


def test_no_generated_artifacts_are_versioned() -> None:
    """A política é verificável: vídeos e artefactos gerados não vivem no repositório."""
    offenders = [
        path
        for path in DATA_DIR.rglob("*")
        if path.is_file() and path.suffix.lower() in GENERATED_SUFFIXES
    ]

    assert offenders == [], (
        "Artefactos de teste gerados não podem ser versionados: "
        f"{[str(path.relative_to(REPO_ROOT)) for path in offenders]} — gere-os em tempo de "
        "execução (tests/fakes/synthetic.py), ver tests/data/README.md."
    )


def test_archived_landmarks_are_small_and_documented() -> None:
    """Dados guardados (landmarks anonimizados) têm de ser pequenos e estar documentados."""
    policy = (DATA_DIR / "README.md").read_text(encoding="utf-8")
    archived = sorted(path for path in DATA_DIR.rglob("*.npz") if path.is_file())
    for path in archived:
        assert path.stat().st_size <= MAX_ARCHIVED_BYTES, (
            f"{path.name} tem {path.stat().st_size} bytes; acima de {MAX_ARCHIVED_BYTES} deixa "
            "de ser um caso de teste (ver tests/data/README.md)"
        )
        assert path.name in policy, (
            f"{path.name} está guardado em tests/data/ mas não está descrito em "
            "tests/data/README.md: sem proveniência não se sabe o que o ficheiro contém."
        )


def test_data_policy_document_exists_and_is_explicit() -> None:
    """A proveniência dos dados tem de estar escrita, não subentendida."""
    policy = (DATA_DIR / "README.md").read_text(encoding="utf-8")

    assert "proveniência" in policy.lower()
    assert "anonimiz" in policy.lower()
    assert "ground-truth" in policy.lower()
