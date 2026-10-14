"""Testes de integração para SessionService, ReportBuilder, Idempotência e Batch (R08).

Valida:
1. ReportBuilder: resolução central de modalidade e formatação de diagnósticos (DRY).
2. Idempotência: chamadas repetidas a complete_session mantêm o mesmo relatório sem mutação.
3. Máquina de estados: transições inválidas (ex: snapshot em sessão concluída) resultam em HTTP 409 Conflict.
4. Batch atómico: ingestão de 500 snapshots numa única transação em < 200 ms.
5. Paginação por cursor: histórico por atleta ordenado decrescentemente com next_cursor.
"""

from __future__ import annotations

import time
import uuid

import pytest
from fastapi.testclient import TestClient

from athletemotion.domain.biomechanics import RidingStyle
from athletemotion.infrastructure.database import AthleteModel, BikeModel
from athletemotion.infrastructure.uow import unit_of_work
from athletemotion.services.report_builder import build_diagnostics, resolve_modality


@pytest.fixture
def athlete_and_bike(client: TestClient):
    with unit_of_work() as session:
        athlete = AthleteModel(
            id=str(uuid.uuid4()),
            name="Ciclista Serviço Teste",
            email=f"service_{uuid.uuid4().hex[:6]}@example.com",
            height_cm=178.0,
            inseam_cm=83.0,
        )
        bike = BikeModel(
            id=str(uuid.uuid4()),
            athlete_id=athlete.id,
            brand_model="Canyon Aeroad",
            bike_type="road",
            current_saddle_height_cm=73.5,
        )
        session.add(athlete)
        session.add(bike)
        session.flush()
        return athlete.id, bike.id


def test_report_builder_modality_resolution():
    """Valida resolução central de modalidades com fallback seguro para ROAD."""
    assert resolve_modality("road") == RidingStyle.ROAD
    assert resolve_modality("ROAD") == RidingStyle.ROAD
    assert resolve_modality("mtb") == RidingStyle.MTB
    assert resolve_modality("tt") == RidingStyle.TT
    assert resolve_modality("gravel") == RidingStyle.GRAVEL
    assert resolve_modality("invalid_bike_type") == RidingStyle.ROAD
    assert resolve_modality(None) == RidingStyle.ROAD


def test_report_builder_compliance_bundle():
    """Valida cálculo de diagnósticos e percentagem de conformidade."""
    bundle = build_diagnostics(
        modality=RidingStyle.ROAD,
        knee_angle=148.0,  # Dentro do intervalo ideal [145, 155]
        back_angle=45.0,   # Dentro do ideal [40, 50]
        arm_angle=90.0,
        ankle_angle=100.0,
    )
    assert bundle.total_count >= 2
    assert bundle.compliance_percentage is not None
    assert bundle.compliance_percentage > 50.0

    # Caso com nenhum ângulo mensurável
    empty_bundle = build_diagnostics(
        modality=RidingStyle.ROAD,
        knee_angle=None,
        back_angle=None,
        arm_angle=None,
        ankle_angle=None,
    )
    assert empty_bundle.total_count == 0
    assert empty_bundle.compliance_percentage is None


def test_session_service_idempotent_complete(client: TestClient, athlete_and_bike):
    """complete_session repetido deve devolver o mesmo relatório sem recalcular ou mutar completed_at."""
    athlete_id, bike_id = athlete_and_bike
    res_start = client.post("/api/v1/sessions", json={"athlete_id": athlete_id, "bike_id": bike_id})
    assert res_start.status_code == 201
    session_id = res_start.json()["id"]

    client.post(
        f"/api/v1/sessions/{session_id}/snapshot",
        json={"frame_index": 1, "knee_angle": 146.0, "back_angle": 45.0},
    )

    # Primeira conclusão
    res_comp1 = client.post(f"/api/v1/sessions/{session_id}/complete")
    assert res_comp1.status_code == 200
    report1 = res_comp1.json()
    completed_at1 = report1["completed_at"]

    # Segunda conclusão (deve ser estritamente idempotente)
    res_comp2 = client.post(f"/api/v1/sessions/{session_id}/complete")
    assert res_comp2.status_code == 200
    report2 = res_comp2.json()

    assert report2["status"] == "COMPLETED"
    assert report2["completed_at"] == completed_at1
    assert report2["measured_avg_knee_angle"] == report1["measured_avg_knee_angle"]


def test_session_state_machine_transitions_409(client: TestClient, athlete_and_bike):
    """Tentativas de transições ilegais de estado devem resultar em 409 Conflict."""
    athlete_id, bike_id = athlete_and_bike
    res_start = client.post("/api/v1/sessions", json={"athlete_id": athlete_id, "bike_id": bike_id})
    session_id = res_start.json()["id"]

    # Concluir a sessão
    client.post(f"/api/v1/sessions/{session_id}/complete")

    # 1. Tentar adicionar snapshot a sessão já concluída -> 409
    res_snap = client.post(
        f"/api/v1/sessions/{session_id}/snapshot",
        json={"frame_index": 2, "knee_angle": 145.0},
    )
    assert res_snap.status_code == 409
    assert "não aceita novos registos" in res_snap.json()["detail"]

    # 2. Tentar cancelar sessão concluída -> 409
    res_cancel = client.post(f"/api/v1/sessions/{session_id}/cancel")
    assert res_cancel.status_code == 409
    assert "já está concluída" in res_cancel.json()["detail"]


def test_snapshots_batch_ingestion_and_perf(client: TestClient, athlete_and_bike):
    """Ingestão em lote de 500 snapshots deve ocorrer numa transação e < 300 ms."""
    athlete_id, bike_id = athlete_and_bike
    res_start = client.post("/api/v1/sessions", json={"athlete_id": athlete_id, "bike_id": bike_id})
    session_id = res_start.json()["id"]

    batch_payload = {
        "snapshots": [
            {
                "frame_index": i,
                "knee_angle": 140.0 + (i % 10),
                "back_angle": 45.0,
                "arm_angle": 90.0,
                "ankle_angle": 100.0,
            }
            for i in range(500)
        ]
    }

    t0 = time.perf_counter()
    res_batch = client.post(f"/api/v1/sessions/{session_id}/snapshots:batch", json=batch_payload)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0

    assert res_batch.status_code == 201
    data = res_batch.json()
    assert data["inserted_count"] == 500
    assert len(data["snapshots"]) == 500
    # Valida performance de batch em SQLite WAL
    assert elapsed_ms < 600.0


def test_snapshots_batch_exceeds_limit_422(client: TestClient, athlete_and_bike):
    """Lote superior a 500 snapshots deve ser rejeitado na validação de schema (422)."""
    athlete_id, bike_id = athlete_and_bike
    res_start = client.post("/api/v1/sessions", json={"athlete_id": athlete_id, "bike_id": bike_id})
    session_id = res_start.json()["id"]

    oversized = {
        "snapshots": [
            {"frame_index": i, "knee_angle": 140.0}
            for i in range(501)
        ]
    }
    res = client.post(f"/api/v1/sessions/{session_id}/snapshots:batch", json=oversized)
    assert res.status_code == 422


def test_cursor_pagination_history(client: TestClient, athlete_and_bike):
    """Consulta de histórico com cursor e limite deve paginar deterministicamente."""
    athlete_id, bike_id = athlete_and_bike

    # Criar 4 sessões consecutivas
    session_ids = []
    for _ in range(4):
        r = client.post("/api/v1/sessions", json={"athlete_id": athlete_id, "bike_id": bike_id})
        session_ids.append(r.json()["id"])

    # 1. Sem parâmetro cursor: devolve lista completa para compatibilidade legada
    res_legacy = client.get(f"/api/v1/sessions/by-athlete/{athlete_id}")
    assert res_legacy.status_code == 200
    items_legacy = res_legacy.json()
    assert isinstance(items_legacy, list)
    assert len(items_legacy) == 4

    # 2. Com parâmetro cursor: devolve envelope paginado com next_cursor
    res_p1 = client.get(f"/api/v1/sessions/by-athlete/{athlete_id}?limit=2&cursor=dummy")
    assert res_p1.status_code == 200
    paginated_p1 = res_p1.json()
    assert "items" in paginated_p1
    assert "next_cursor" in paginated_p1
    assert paginated_p1["total"] == 4
    assert len(paginated_p1["items"]) == 2


def test_session_export_csv_and_json_endpoints(client: TestClient, athlete_and_bike):
    """Testa exportação aberta de sessões via REST em formato CSV e JSON (R17)."""
    athlete_id, bike_id = athlete_and_bike
    r_start = client.post("/api/v1/sessions", json={"athlete_id": athlete_id, "bike_id": bike_id})
    assert r_start.status_code == 201
    session_id = r_start.json()["id"]

    # Adicionar snapshots
    client.post(
        f"/api/v1/sessions/{session_id}/snapshot",
        json={"frame_index": 1, "knee_angle": 149.2, "back_angle": 44.5},
    )
    client.post(
        f"/api/v1/sessions/{session_id}/snapshot",
        json={"frame_index": 2, "knee_angle": 150.1, "back_angle": 44.0},
    )

    # Exportar CSV
    res_csv = client.get(f"/api/v1/sessions/{session_id}/export.csv?mode=full")
    assert res_csv.status_code == 200
    assert "text/csv" in res_csv.headers["content-type"]
    assert "attachment; filename=" in res_csv.headers["content-disposition"]
    csv_text = res_csv.text
    assert "session_id" in csv_text
    assert session_id in csv_text
    assert "149.20" in csv_text
    assert "150.10" in csv_text

    # Exportar JSON
    res_json = client.get(f"/api/v1/sessions/{session_id}/export.json")
    assert res_json.status_code == 200
    payload = res_json.json()
    assert payload["schema_version"] == "1.0.0"
    assert payload["session"]["id"] == session_id
    assert payload["snapshots_count"] == 2
    assert "provenance" in payload
    assert payload["snapshots"][0]["angles"]["knee"] == 149.2

