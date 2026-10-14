"""Verificação da migração aditiva da tabela `bikes` (reach/drop do guiador e tubo superior).

Porquê este teste:
`Base.metadata.create_all` cria tabelas em falta mas NUNCA altera uma tabela existente. Quem já
tinha o ficheiro SQLite (o caso real de desenvolvimento) ficaria com uma base sem as colunas
`handlebar_reach_mm` / `handlebar_drop_mm` / `top_tube_mm` — e a gravação da bicicleta falharia.
O teste simula exatamente esse cenário: uma base ANTIGA, criada com o esquema anterior, e depois
`init_db()`.
"""

import sqlite3

from sqlalchemy import create_engine

import athletemotion.infrastructure.database as db_module
from athletemotion.schemas.fit import BikeCreate, BikeResponse


def _old_bikes_schema(path: str) -> None:
    """Cria a tabela `bikes` como ela era antes desta alteração (sem reach/drop)."""
    connection = sqlite3.connect(path)
    connection.executescript(
        """
        CREATE TABLE bikes (
            id VARCHAR(36) NOT NULL PRIMARY KEY,
            athlete_id VARCHAR(36) NOT NULL,
            bike_type VARCHAR(20) NOT NULL,
            brand_model VARCHAR(100) NOT NULL,
            frame_size_cm FLOAT,
            handlebar_width_mm FLOAT,
            stem_length_mm FLOAT,
            crank_length_mm FLOAT,
            current_saddle_height_cm FLOAT,
            created_at DATETIME NOT NULL
        );
        """
    )
    connection.commit()
    connection.close()


def _columns(path: str) -> set[str]:
    connection = sqlite3.connect(path)
    rows = connection.execute("PRAGMA table_info(bikes)").fetchall()
    connection.close()
    return {row[1] for row in rows}


def test_init_db_adds_handlebar_columns_to_existing_table(tmp_path, test_db_isolation):
    """Numa base já existente, `init_db()` acrescenta as colunas novas (idempotente)."""
    db_file = tmp_path / "antiga.db"
    _old_bikes_schema(str(db_file))
    assert "handlebar_reach_mm" not in _columns(str(db_file))
    assert "top_tube_mm" not in _columns(str(db_file))
    assert "cleat_position" not in _columns(str(db_file))

    original_engine = db_module.engine
    db_module.engine = create_engine(f"sqlite:///{db_file}")
    try:
        db_module.init_db()
        # Ser idempotente é obrigatório: `init_db()` corre a cada arranque.
        db_module.init_db()
    finally:
        db_module.engine = original_engine

    columns = _columns(str(db_file))
    assert {"handlebar_reach_mm", "handlebar_drop_mm", "top_tube_mm", "cleat_position"} <= columns


def test_bike_payload_accepts_and_returns_bar_shape(client):
    """A API aceita reach/drop do guiador e devolve-os na resposta."""
    athlete = client.post(
        "/api/v1/athletes",
        json={
            "name": "Ana",
            "height_cm": 178.0,
            "inseam_cm": 84.0,
            "shoulder_width_cm": 40.0,
            "consent_version": "v1.0",
            "consent_scope": ["processing", "store_landmarks"],
        },
    ).json()

    payload = BikeCreate(
        athlete_id=athlete["id"],
        bike_type="road",
        brand_model="Teste",
        frame_size_cm=54.0,
        top_tube_mm=545.0,
        handlebar_width_mm=420.0,
        handlebar_reach_mm=85.0,
        handlebar_drop_mm=150.0,
        stem_length_mm=100.0,
        crank_length_mm=172.5,
        current_saddle_height_cm=73.5,
        cleat_position="rearward",
    )
    response = client.post("/api/v1/bikes", json=payload.model_dump())
    assert response.status_code == 201

    bike = BikeResponse.model_validate(response.json())
    assert bike.handlebar_reach_mm == 85.0
    assert bike.handlebar_drop_mm == 150.0
    assert bike.handlebar_width_mm == 420.0
    # O tubo superior (ETT) é uma medida PRÓPRIA: não se confunde com o tamanho do quadro.
    assert bike.top_tube_mm == 545.0
    assert bike.frame_size_cm == 54.0
    assert bike.cleat_position == "rearward"

    # E o valor chega de volta pela leitura por atleta (é o que a análise consome).
    listed = client.get(f"/api/v1/bikes/by-athlete/{athlete['id']}").json()
    assert listed[0]["handlebar_reach_mm"] == 85.0
    assert listed[0]["handlebar_drop_mm"] == 150.0
    assert listed[0]["top_tube_mm"] == 545.0
    assert listed[0]["cleat_position"] == "rearward"
