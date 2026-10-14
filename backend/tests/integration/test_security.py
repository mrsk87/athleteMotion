"""Testes de integração para a linha de base de segurança da API (R04).

Valida:
1. Rejeição de requisições sem autenticação (401) e com token inválido.
2. Sucesso de requisições com token Bearer válido.
3. Isenção de rotas públicas essenciais (/health, /api/version, /).
4. Restrição estrita de CORS (sem wildcards).
5. Injeção de cabeçalhos de segurança OWASP e X-Request-ID.
6. Formato de erros RFC 7807 sem fuga de detalhes internos (500).
7. Limitação de taxa (Rate Limiting 429).
8. Validação de segurança em modo LAN.
9. Autenticação no canal WebSocket.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from athletemotion.api.app import app
from athletemotion.api.security.auth import get_or_create_api_token
from athletemotion.api.security.rate_limit import rate_limiter
from athletemotion.config.settings import ApiSettings


@pytest.fixture(autouse=True)
def reset_limiter():
    """Garante rate limiter limpo antes de cada teste."""
    rate_limiter.reset()
    yield
    rate_limiter.reset()


def test_endpoints_require_auth():
    """Rotas sob /api/v1/ devem exigir autenticação Bearer válida."""
    client = TestClient(app)

    # 1. Sem cabeçalho Authorization
    resp1 = client.get("/api/v1/athletes")
    assert resp1.status_code == 401
    assert resp1.headers["content-type"] == "application/problem+json"
    data1 = resp1.json()
    assert data1["status"] == 401
    assert data1["title"] == "Unauthorized"
    assert "Authorization: Bearer" in data1["detail"]
    assert "request_id" in data1

    # 2. Com token incorreto
    resp2 = client.get("/api/v1/athletes", headers={"Authorization": "Bearer invalid_secret_token"})
    assert resp2.status_code == 401
    assert resp2.json()["status"] == 401


def test_endpoints_accept_valid_token():
    """Requisições com token Bearer válido devem ter acesso autorizado."""
    client = TestClient(app)
    token = get_or_create_api_token()

    response = client.get("/api/v1/athletes", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_exempt_endpoints_without_auth():
    """Endpoints de integridade e metadados devem responder sem autenticação."""
    client = TestClient(app)

    r_health = client.get("/health")
    assert r_health.status_code == 200
    assert r_health.json()["status"] == "ok"

    r_ver = client.get("/api/version")
    assert r_ver.status_code == 200
    assert "version" in r_ver.json()

    r_root = client.get("/")
    assert r_root.status_code == 200
    assert "status" in r_root.json()


def test_cors_strict_origins():
    """Origens autorizadas recebem cabeçalho CORS; origens desconhecidas são bloqueadas."""
    client = TestClient(app)

    # Origem autorizada presente em ALLOWED_ORIGINS
    r_allowed = client.options(
        "/api/v1/athletes",
        headers={
            "Origin": "http://localhost:8080",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert r_allowed.headers.get("access-control-allow-origin") == "http://localhost:8080"

    # Origem externa maliciosa não listada
    r_blocked = client.options(
        "/api/v1/athletes",
        headers={
            "Origin": "http://malicious-site.example.com",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert "access-control-allow-origin" not in r_blocked.headers


def test_security_headers_and_request_id():
    """Respostas HTTP devem conter cabeçalhos OWASP e identificador de rastreabilidade."""
    client = TestClient(app)
    response = client.get("/health")

    assert response.headers.get("x-content-type-options") == "nosniff"
    assert response.headers.get("x-frame-options") == "DENY"
    assert response.headers.get("referrer-policy") == "no-referrer"
    assert "camera=(self)" in response.headers.get("permissions-policy", "")
    assert "x-request-id" in response.headers


def test_internal_error_does_not_leak_traceback():
    """Erros 500 devem retornar formato RFC 7807 sem expor detalhes internos ou tracebacks."""

    @app.get("/api/v1/_test_crash", include_in_schema=False)
    def _crash_route():
        raise RuntimeError("CONFIDENTIAL_DATABASE_CREDENTIAL_ERROR_XYZ_123")

    client = TestClient(app, raise_server_exceptions=False)
    token = get_or_create_api_token()

    response = client.get("/api/v1/_test_crash", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 500
    assert response.headers["content-type"] == "application/problem+json"

    data = response.json()
    assert data["status"] == 500
    assert data["title"] == "Internal Server Error"
    assert "CONFIDENTIAL_DATABASE_CREDENTIAL" not in data["detail"]
    assert "CONFIDENTIAL_DATABASE_CREDENTIAL" not in response.text
    assert data["detail"] == "Ocorreu um erro interno no processamento do servidor."


def test_rate_limiting_enforcement():
    """Rajada de requisições deve ativar resposta 429 Too Many Requests com Retry-After."""
    client = TestClient(app)
    token = get_or_create_api_token()
    headers = {"Authorization": f"Bearer {token}"}

    # Executar requisições no endpoint estrito (limite 10/min)
    responses = [
        client.post("/api/v1/video/export-gif", json={"frames": []}, headers=headers)
        for _ in range(15)
    ]

    status_codes = [r.status_code for r in responses]
    assert 429 in status_codes

    resp_429 = next(r for r in responses if r.status_code == 429)
    assert resp_429.headers["content-type"] == "application/problem+json"
    assert "retry-after" in resp_429.headers
    data_429 = resp_429.json()
    assert data_429["status"] == 429
    assert data_429["title"] == "Too Many Requests"


def test_lan_mode_without_token_raises_validation_error():
    """Ativar LAN_MODE=True sem API_TOKEN deve ser rejeitado no modelo de configurações."""
    with pytest.raises(ValueError, match="Modo LAN ativado"):
        ApiSettings(lan_mode=True, api_token=None)


def test_websocket_auth_rejection_and_acceptance():
    """WebSocket /ws/live-inference deve rejeitar ligações sem credenciais e aceitar com token."""
    from starlette.websockets import WebSocketDisconnect

    client = TestClient(app)
    token = get_or_create_api_token()

    # 1. Ligação sem token e sem autenticação -> recebe erro e é fechada com código 1008
    with client.websocket_connect("/ws/live-inference") as ws:
        ws.send_text('{"type": "warmup"}')
        resp = ws.receive_json()
        assert resp["status"] == "error"
        assert resp["code"] == "unauthorized"
        with pytest.raises(WebSocketDisconnect) as exc_info:
            ws.receive_json()
        assert exc_info.value.code == 1008

    # 2. Ligação autenticada via cabeçalho HTTP Bearer
    headers = {"Authorization": f"Bearer {token}"}
    with client.websocket_connect("/ws/live-inference", headers=headers) as ws_auth:
        ws_auth.send_text('{"type": "warmup"}')
        resp = ws_auth.receive_json()
        assert resp["status"] == "ok"

    # 3. Ligação autenticada via primeira mensagem (suporte a navegadores)
    with client.websocket_connect("/ws/live-inference") as ws_msg:
        ws_msg.send_text(f'{{"type": "auth", "token": "{token}"}}')
        resp = ws_msg.receive_json()
        assert resp["status"] == "ok"
        assert "Autenticado" in resp["message"]
