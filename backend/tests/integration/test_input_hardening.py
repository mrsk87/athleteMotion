"""Testes de segurança e abuso para endpoints de upload, WebSockets, GIF e relatórios.

Cobre a matriz de validação e hardening definida em R05:
1. Rejeição com HTTP 413 em uploads superiores ao limite global (5MB).
2. Validação estrita de Magic Bytes de imagem (rejeição de payloads arbitrários).
3. Rejeição de imagens com dimensões/resoluções anómalas (pixel flood / bombs).
4. Limite de ligações WebSocket ativas simultâneas (rejeição com código 1013).
5. Limite de tamanho de mensagens individuais no WebSocket (fecho com código 1009).
6. Deteção de anomalias repetidas no stream WebSocket (fecho com código 1003).
7. Limite de frames e tamanho total na exportação de GIF (422 e 413).
8. Validação estrita de limites numéricos nos parâmetros de consulta (HTTP 422).
9. Higienização contra injeção de markup XML e bytes nulos na geração de relatórios PDF.
"""

from __future__ import annotations

import base64
from unittest.mock import patch

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from PIL import Image
from starlette.websockets import WebSocketDisconnect

import athletemotion.api.v1.inference_ws as ws_mod
from athletemotion.api.app import app
from athletemotion.api.security.auth import get_or_create_api_token
from athletemotion.domain.inference.base import BasePoseEngine, PoseEngineRegistry
from athletemotion.domain.inference.types import BiomechanicalAngles, InferenceOutput
from athletemotion.services.report_generator import generate_bikefit_pdf, sanitize_pdf_text


class DummyHardeningEngine(BasePoseEngine):
    """Motor simples para testes de stream no WebSocket."""

    def __init__(self, name: str = "dummy_hardening") -> None:
        super().__init__(name=name)

    def process_frame(self, frame_bgr: np.ndarray, timestamp_ms: int) -> InferenceOutput:
        return InferenceOutput(
            angles=BiomechanicalAngles(knee=150.0, back=45.0, arm=90.0, ankle=110.0),
            frame_with_overlay=frame_bgr,
            engine_name=self.name,
        )


@pytest.fixture(autouse=True)
def setup_hardening_env():
    """Garante registo do motor de teste e reposição de contadores WS."""
    ws_mod._active_ws_connections.clear()
    PoseEngineRegistry.register("dummy_hardening", lambda **kw: DummyHardeningEngine(**kw))
    yield
    ws_mod._active_ws_connections.clear()


@pytest.fixture
def auth_headers() -> dict[str, str]:
    token = get_or_create_api_token()
    return {"Authorization": f"Bearer {token}"}


# -----------------------------------------------------------------------------
# 1. Upload e Imagens em /process_frame
# -----------------------------------------------------------------------------


def test_process_frame_payload_too_large(client: TestClient):
    """Upload acima de 5MB deve ser abortado imediatamente com HTTP 413."""
    oversized_data = b"X" * (5 * 1024 * 1024 + 1024)  # 5MB + 1KB
    response = client.post(
        "/process_frame",
        files={"file": ("large_image.jpg", oversized_data, "image/jpeg")},
    )
    assert response.status_code == 413
    body = response.json()
    assert body["status"] == 413
    assert "excede o limite máximo" in body["detail"]


def test_process_frame_invalid_magic_bytes(client: TestClient):
    """Upload com cabeçalho desconhecido ou corrompido deve ser rejeitado."""
    corrupted_data = b"RANDOM_CORRUPT_BYTES_NOT_AN_IMAGE_HEADER_12345678"
    response = client.post(
        "/process_frame",
        files={"file": ("corrupted.jpg", corrupted_data, "image/jpeg")},
    )
    assert response.status_code in (415, 422)
    body = response.json()
    assert (
        "formato de imagem" in body["detail"].lower() or "não suportado" in body["detail"].lower()
    )


def test_process_frame_pixel_dimension_limit(client: TestClient):
    """Imagens que excedem 4096px ou limite de pixels devem ser rejeitadas."""
    # Simula decodificação que reporta dimensões gigantescas através de imagem mock
    with patch("athletemotion.api.validation.images.Image.open") as mock_open:
        mock_img = Image.new("RGB", (5000, 100))
        mock_open.return_value.__enter__.return_value = mock_img

        # Cria JPEG válido mínimo
        img_arr = np.zeros((10, 10, 3), dtype=np.uint8)
        _, enc = cv2.imencode(".jpg", img_arr)
        valid_jpeg = enc.tobytes()

        response = client.post(
            "/process_frame",
            files={"file": ("huge.jpg", valid_jpeg, "image/jpeg")},
        )
        assert response.status_code == 413
        assert "excedem os limites de segurança" in response.json()["detail"]


# -----------------------------------------------------------------------------
# 2. WebSocket Hardening
# -----------------------------------------------------------------------------


def test_ws_connection_limit_enforced(auth_headers: dict[str, str]):
    """Quando o número de ligações simultâneas atinge o limite (2), a 3ª deve ser rejeitada."""
    test_client = TestClient(app)

    with (
        test_client.websocket_connect("/ws/live-inference", headers=auth_headers),
        test_client.websocket_connect("/ws/live-inference", headers=auth_headers),
    ):
        # A 3ª ligação deve falhar e fechar com código 1013 (Try again later)
        with pytest.raises(WebSocketDisconnect) as exc_info:  # noqa: SIM117
            with test_client.websocket_connect("/ws/live-inference", headers=auth_headers) as ws:
                ws.receive_text()
        assert exc_info.value.code == 1013


def test_ws_message_too_large(auth_headers: dict[str, str]):
    """Mensagens enviadas com mais de 1MB devem encerrar o socket com 1009."""
    test_client = TestClient(app)
    huge_message = b"\xff\xd8" + (b"A" * (1024 * 1024 + 100))  # > 1MB

    with pytest.raises(WebSocketDisconnect) as exc_info:  # noqa: SIM117
        with test_client.websocket_connect("/ws/live-inference", headers=auth_headers) as ws:
            ws.send_bytes(huge_message)
            ws.receive_json()

    assert exc_info.value.code == 1009


def test_ws_consecutive_invalid_frames_disconnect(auth_headers: dict[str, str]):
    """O envio de 5 frames corrompidos consecutivos sem header JPEG encerra a ligação com 1003."""
    test_client = TestClient(app)

    with pytest.raises(WebSocketDisconnect) as exc_info:  # noqa: SIM117
        with test_client.websocket_connect("/ws/live-inference", headers=auth_headers) as ws:
            # Enviar 5 frames inválidos (sem prefixo JPEG e sem tamanho adequado)
            for _ in range(5):
                ws.send_bytes(b"INVALID_NON_JPEG_FRAME_BYTES")
            ws.receive_text()

    assert exc_info.value.code == 1003


# -----------------------------------------------------------------------------
# 3. Exportação de GIF
# -----------------------------------------------------------------------------


def test_gif_export_frame_limit_exceeded(client: TestClient):
    """Exportação com mais de 120 frames deve ser rejeitada com HTTP 422."""
    dummy_frame = "data:image/jpeg;base64," + base64.b64encode(b"\xff\xd8\xff\xd9").decode("ascii")
    oversized_payload = {
        "frames": [dummy_frame] * 121,
        "delay_ms": 100,
    }
    response = client.post("/api/v1/video/export-gif", json=oversized_payload)
    assert response.status_code == 422
    body = response.json()
    assert "validation_errors" in body or "120" in str(body)


def test_gif_export_payload_size_exceeded(client: TestClient):
    """Exportação cujo volume acumulado de imagens base64 exceda 40MB deve falhar com 413."""
    # Um frame com ~55MB base64 (> 40MB)
    large_frame = "data:image/jpeg;base64," + ("A" * (55 * 1024 * 1024))
    payload = {
        "frames": [large_frame],
        "delay_ms": 100,
    }
    response = client.post("/api/v1/video/export-gif", json=payload)
    assert response.status_code == 413
    assert "excede o limite" in response.json()["detail"].lower()


# -----------------------------------------------------------------------------
# 4. Parâmetros de Consulta em Sessões e AI Coach
# -----------------------------------------------------------------------------


def test_session_pdf_parameter_validation(client: TestClient):
    """Parâmetros fora dos limites definidos para /api/v1/sessions/{id}/pdf devem retornar 422."""
    # Cadência fora do limite [20, 200]
    r1 = client.get("/api/v1/sessions/any-session-id/pdf?cadence_rpm=300")
    assert r1.status_code == 422

    # KOPS fora do limite [-100, 100]
    r2 = client.get("/api/v1/sessions/any-session-id/pdf?kops_offset=150.0")
    assert r2.status_code == 422

    # Saddle Drop fora do limite [-20, 20]
    r3 = client.get("/api/v1/sessions/any-session-id/pdf?saddle_drop=50.0")
    assert r3.status_code == 422

    # Idioma inválido (não pt nem en)
    r4 = client.get("/api/v1/sessions/any-session-id/pdf?lang=es")
    assert r4.status_code == 422


def test_session_ai_coach_parameter_validation(client: TestClient):
    """Parâmetros fora dos limites definidos para /api/v1/sessions/{id}/ai-coach devem retornar 422."""
    # Potência negativa
    r1 = client.get("/api/v1/sessions/any-session-id/ai-coach?power_watts=-50")
    assert r1.status_code == 422

    # Idioma inválido
    r2 = client.get("/api/v1/sessions/any-session-id/ai-coach?lang=de")
    assert r2.status_code == 422


# -----------------------------------------------------------------------------
# 5. Higienização e Geração Segura de PDF
# -----------------------------------------------------------------------------


def test_sanitize_pdf_text_escaping():
    """sanitize_pdf_text deve escapar entidades XML e remover bytes nulos."""
    raw = "Atleta <script>alert(1)</script> & Sons \x00"
    cleaned = sanitize_pdf_text(raw)
    assert "<" not in cleaned
    assert ">" not in cleaned
    assert "&amp;" in cleaned
    assert "\x00" not in cleaned
    assert "&lt;script&gt;" in cleaned


def test_pdf_generation_with_malicious_inputs():
    """Geração de PDF não deve crashar quando os dados contêm markup ou caracteres perigosos."""
    malicious_athlete = {
        "name": "<font color='red'><b>Hacked</b></font> & 'Unclosed <tag>",
        "height_cm": 180,
        "inseam_cm": 85,
        "flexibility": "high",
    }
    angles_summary = [
        {
            "name": "<Joelho>",
            "angle": 148.5,
            "range": "145° - 155°",
            "compliant": True,
            "recommendation": "Alinhado <b>perfeito</b> & sem risco",
        }
    ]
    kops_data = {
        "offset_mm": 5.0,
        "is_aligned": True,
        "recommendation": "Recuo adequado <br/> com tolerância",
    }

    pdf_bytes = generate_bikefit_pdf(
        athlete_data=malicious_athlete,
        bike_data=None,
        session_data={},
        angles_summary=angles_summary,
        kops_data=kops_data,
        language="pt",
    )

    assert isinstance(pdf_bytes, bytes)
    assert len(pdf_bytes) > 1000
    assert pdf_bytes.startswith(b"%PDF-")
