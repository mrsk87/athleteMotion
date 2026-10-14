"""Testes de isolamento de motores e concorrência entre ligações WebSocket.

Garante que:
1. Ligações WebSocket simultâneas possuem instâncias isoladas de motores (EngineLease).
2. O comando `set_engine` ou `set_side` numa ligação NÃO afeta outra ligação simultânea.
3. Timestamps independentes não colidem nem contaminam o estado entre clientes.
4. A inferência é estritamente serializada por motor (max_concurrent_calls <= 1).
5. Whitelist de motores rejeita nomes arbitrários com erro claro.
6. Limite de motores ativos é respeitado.
"""

from __future__ import annotations

import asyncio
import struct
import time

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient

from athletemotion.api.app import app
from athletemotion.api.security.auth import get_or_create_api_token
from athletemotion.domain.inference.base import BasePoseEngine, PoseEngineRegistry
from athletemotion.domain.inference.types import (
    BiomechanicalAngles,
    InferenceOutput,
    SegmentValidation,
)
from athletemotion.services.engine_manager import (
    EngineLimitExceededError,
    EngineManager,
)


class SpyPoseEngine(BasePoseEngine):
    """Motor de teste determinístico para verificar isolamento e concorrência."""

    def __init__(self, name: str = "spy_engine", side: str = "right", delay: float = 0.01):
        super().__init__(name=name)
        self.side = side
        self.delay = delay
        self.call_count = 0
        self.active_calls = 0
        self.max_concurrent_calls = 0
        self.timestamps_seen: list[int] = []

    def set_side(self, side: str) -> None:
        self.side = side

    def process_frame(self, frame_bgr: np.ndarray, timestamp_ms: int) -> InferenceOutput:
        self.active_calls += 1
        self.max_concurrent_calls = max(self.max_concurrent_calls, self.active_calls)
        try:
            if self.delay > 0:
                time.sleep(self.delay)
            self.call_count += 1
            self.timestamps_seen.append(timestamp_ms)
            return InferenceOutput(
                engine_name=self.name,
                side=self.side,
                timestamp_ms=timestamp_ms,
                landmarks={},
                angles=BiomechanicalAngles(),
                validation=SegmentValidation(),
            )
        finally:
            self.active_calls -= 1

    def reset(self) -> None:
        self.timestamps_seen.clear()


@pytest.fixture(autouse=True)
def register_spy_engines():
    """Regista motores de teste controlados."""
    PoseEngineRegistry.register(
        "spy_engine_a", lambda **kw: SpyPoseEngine(name="spy_engine_a", **kw)
    )
    PoseEngineRegistry.register(
        "spy_engine_b", lambda **kw: SpyPoseEngine(name="spy_engine_b", **kw)
    )
    yield


@pytest.fixture
def auth_headers() -> dict[str, str]:
    token = get_or_create_api_token()
    return {"Authorization": f"Bearer {token}"}


def _make_dummy_frame(timestamp_ms: int) -> bytes:
    img = np.zeros((100, 100, 3), dtype=np.uint8)
    _, encoded = cv2.imencode(".jpg", img)
    header = struct.pack(">I", timestamp_ms)
    return header + encoded.tobytes()


def test_ws_connections_have_isolated_engines(auth_headers: dict[str, str]):
    """Duas conexões WS com motores diferentes não devem partilhar ou sobrepor estado."""
    client = TestClient(app)

    with client.websocket_connect("/ws/live-inference", headers=auth_headers) as ws1:
        ws1.send_text('{"type": "set_engine", "engine": "spy_engine_a", "side": "left"}')
        resp1 = ws1.receive_json()
        assert resp1["status"] == "ok"
        assert resp1["engine"] == "spy_engine_a"

        with client.websocket_connect("/ws/live-inference", headers=auth_headers) as ws2:
            ws2.send_text('{"type": "set_engine", "engine": "spy_engine_b", "side": "right"}')
            resp2 = ws2.receive_json()
            assert resp2["status"] == "ok"
            assert resp2["engine"] == "spy_engine_b"

            # Enviar frame no cliente 1
            frame1 = _make_dummy_frame(100)
            ws1.send_bytes(frame1)
            telemetry1 = ws1.receive_json()
            assert telemetry1["engine_name"] == "spy_engine_a"
            assert telemetry1["side"] == "left"

            # Enviar frame no cliente 2
            frame2 = _make_dummy_frame(200)
            ws2.send_bytes(frame2)
            telemetry2 = ws2.receive_json()
            assert telemetry2["engine_name"] == "spy_engine_b"
            assert telemetry2["side"] == "right"

            # Garantir que novo frame no cliente 1 AINDA é spy_engine_a e left
            ws1.send_bytes(_make_dummy_frame(300))
            telemetry1_again = ws1.receive_json()
            assert telemetry1_again["engine_name"] == "spy_engine_a"
            assert telemetry1_again["side"] == "left"


def test_ws_set_side_isolation(auth_headers: dict[str, str]):
    """Alterar o perfil lateral no cliente 1 não deve alterar o perfil no cliente 2."""
    client = TestClient(app)

    with (
        client.websocket_connect("/ws/live-inference", headers=auth_headers) as ws1,
        client.websocket_connect("/ws/live-inference", headers=auth_headers) as ws2,
    ):
        ws1.send_text('{"type": "set_engine", "engine": "spy_engine_a", "side": "left"}')
        ws1.receive_json()

        ws2.send_text('{"type": "set_engine", "engine": "spy_engine_a", "side": "right"}')
        ws2.receive_json()

        # Cliente 1 muda o lado para 'right'
        ws1.send_text('{"type": "set_side", "side": "right"}')
        ws1.receive_json()

        # Cliente 2 muda o lado para 'left'
        ws2.send_text('{"type": "set_side", "side": "left"}')
        ws2.receive_json()

        # Testar frame cliente 1 -> deve ser 'right'
        ws1.send_bytes(_make_dummy_frame(10))
        t1 = ws1.receive_json()
        assert t1["side"] == "right"

        # Testar frame cliente 2 -> deve ser 'left'
        ws2.send_bytes(_make_dummy_frame(20))
        t2 = ws2.receive_json()
        assert t2["side"] == "left"


def test_ws_whitelist_engine_rejection(auth_headers: dict[str, str]):
    """Nomes de motores fora da whitelist registada devem ser rejeitados com erro."""
    client = TestClient(app)

    with client.websocket_connect("/ws/live-inference", headers=auth_headers) as ws:
        ws.send_text('{"type": "set_engine", "engine": "non_existent_engine_xxx"}')
        resp = ws.receive_json()
        assert resp["status"] == "error"
        assert resp["code"] == "engine_switch_failed"
        assert "não registado" in resp["message"] or "desconhecido" in resp["message"]


@pytest.mark.asyncio
async def test_inference_strictly_serialized_in_lease():
    """Garante que chamadas concorrentes a um mesmo EngineLease são estritamente serializadas."""
    manager = EngineManager(max_active_engines=2)
    lease = await manager.acquire("lease_test_concurrency", "spy_engine_a", side="right")
    spy_engine: SpyPoseEngine = lease.engine  # type: ignore

    frame = np.zeros((100, 100, 3), dtype=np.uint8)

    # Disparar 5 execuções simultâneas
    tasks = [lease.process_frame(frame, ts) for ts in [100, 200, 300, 400, 500]]
    results = await asyncio.gather(*tasks)

    assert len(results) == 5
    assert spy_engine.call_count == 5
    # Ponto fulcral: o contador de concorrência máxima nunca pode exceder 1
    assert spy_engine.max_concurrent_calls == 1

    await manager.release("lease_test_concurrency")


@pytest.mark.asyncio
async def test_engine_manager_limits():
    """EngineManager deve respeitar max_active_engines e lançar EngineLimitExceededError."""
    manager = EngineManager(max_active_engines=2)

    _ = await manager.acquire("conn_1", "spy_engine_a")
    _ = await manager.acquire("conn_2", "spy_engine_b")
    assert manager.active_count == 2

    # Terceira ligação deve falhar por exceder o limite
    with pytest.raises(EngineLimitExceededError):
        await manager.acquire("conn_3", "spy_engine_a")

    # Libertar conn_1 deve permitir adquirir conn_3
    await manager.release("conn_1")
    assert manager.active_count == 1

    await manager.shutdown()
    assert manager.active_count == 0


def test_rest_engines_endpoint(auth_headers: dict[str, str]):
    """GET /api/v1/inference/engines deve responder com schema válido."""
    client = TestClient(app)
    response = client.get("/api/v1/inference/engines", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert "active_engine" in data
    assert "active_side" in data
    assert "available_engines" in data
    assert "directml_available" in data
    assert isinstance(data["available_engines"], list)
    assert len(data["available_engines"]) > 0


def test_import_no_heavy_engine_created(monkeypatch):
    """Garante que a importação de app e routers não instancia motores de inferência."""
    created_engines: list[str] = []
    original_create = PoseEngineRegistry.create

    def spy_create(name: str, **kwargs):
        created_engines.append(name)
        return original_create(name, **kwargs)

    monkeypatch.setattr(PoseEngineRegistry, "create", spy_create)

    # Reimportar app
    import importlib

    import athletemotion.api.app

    importlib.reload(athletemotion.api.app)

    # Não deve ter sido criado nenhum motor durante o reload/import
    assert len(created_engines) == 0
