import io


def test_system_endpoints(client):
    res_health = client.get("/health")
    assert res_health.status_code == 200
    assert res_health.json()["status"] == "ok"

    res_version = client.get("/api/version")
    assert res_version.status_code == 200
    assert "version" in res_version.json()


def test_biomechanics_estimate_endpoint(client):
    payload = {
        "height_cm": 178.0,
        "inseam_cm": 83.0,
        "shoulder_width_cm": 42.0,
        "riding_style": "road",
    }
    res = client.post("/api/v1/biomechanics/estimate", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["lemond_saddle_height_cm"] == 73.3
    assert data["target_knee_angle_range"] == [145.0, 155.0]


def test_full_acid_lifecycle(client):
    # 1. Criar Atleta
    athlete_data = {
        "name": "Ciclista de Teste",
        "email": "ciclista@teste.pt",
        "height_cm": 180.0,
        "inseam_cm": 84.0,
        "flexibility": "medium",
        "riding_style": "road",
        "consent_version": "v1.0",
        "consent_scope": ["processing", "store_landmarks"],
    }
    res_athlete = client.post("/api/v1/athletes", json=athlete_data)
    assert res_athlete.status_code == 201
    athlete = res_athlete.json()
    athlete_id = athlete["id"]

    # 2. Criar Bicicleta
    bike_data = {
        "athlete_id": athlete_id,
        "bike_type": "road",
        "brand_model": "Specialized Tarmac",
        "frame_size_cm": 56.0,
        "current_saddle_height_cm": 72.0,
    }
    res_bike = client.post("/api/v1/bikes", json=bike_data)
    assert res_bike.status_code == 201
    bike = res_bike.json()
    bike_id = bike["id"]

    # 3. Iniciar Sessão de Fit (ACID)
    session_data = {
        "athlete_id": athlete_id,
        "bike_id": bike_id,
    }
    res_session = client.post("/api/v1/sessions", json=session_data)
    assert res_session.status_code == 201
    session = res_session.json()
    session_id = session["id"]
    assert session["status"] == "IN_PROGRESS"

    # 4. Gravar Snapshots
    for i in range(5):
        snap_data = {
            "frame_index": i,
            "knee_angle": 138.0 + i,  # 138, 139, 140, 141, 142 -> média = 140.0
            "back_angle": 46.0,
            "arm_angle": 156.0,
            "ankle_angle": 95.0,
        }
        res_snap = client.post(f"/api/v1/sessions/{session_id}/snapshot", json=snap_data)
        assert res_snap.status_code == 201

    # 5. Concluir Sessão Atómica (ACID Commit)
    res_complete = client.post(f"/api/v1/sessions/{session_id}/complete")
    assert res_complete.status_code == 200
    report = res_complete.json()
    assert report["status"] == "COMPLETED"
    assert report["measured_avg_knee_angle"] == 140.0
    assert report["measured_avg_back_angle"] == 46.0
    assert len(report["diagnostics"]) > 0

    # 6. Consultar Relatório
    res_report = client.get(f"/api/v1/sessions/{session_id}/report")
    assert res_report.status_code == 200
    assert res_report.json()["session_id"] == session_id

    # 7. Consultar Histórico por Atleta (FEAT-16 Comparador)
    res_history = client.get(f"/api/v1/sessions/by-athlete/{athlete_id}")
    assert res_history.status_code == 200
    history = res_history.json()
    assert len(history) >= 1
    assert history[0]["id"] == session_id

    # 8. Descarregar Relatório PDF Oficial (FEAT-09)
    res_pdf = client.get(
        f"/api/v1/sessions/{session_id}/pdf?lang=pt&kops_offset=12.0&saddle_drop=6.5"
    )
    assert res_pdf.status_code == 200
    assert res_pdf.headers["content-type"] == "application/pdf"
    assert res_pdf.content.startswith(b"%PDF")

    # 9. Consultar Parecer do Treinador Biomecânico (FEAT-21 / R09)
    res_coach = client.get(f"/api/v1/sessions/{session_id}/ai-coach?lang=pt&kops_offset=12.0")
    assert res_coach.status_code == 200
    coach_data = res_coach.json()
    assert "executive_summary" in coach_data
    assert "adaptation_plan" in coach_data
    assert len(coach_data["adaptation_plan"]) == 3
    assert coach_data["generator"] == "rules-v1"
    assert "disclaimer" in coach_data
    assert "data_quality" in coach_data
    assert isinstance(coach_data["data_quality"]["missing_joints"], list)


def test_process_frame_upload_security(client):
    # Ficheiro vazio -> 400
    empty_file = io.BytesIO(b"")
    res_empty = client.post(
        "/process_frame", files={"file": ("test.jpg", empty_file, "image/jpeg")}
    )
    assert res_empty.status_code == 400

    # Ficheiro sem assinatura mágica -> 415
    invalid_bytes = io.BytesIO(b"Texto normal nao imagem")
    res_invalid = client.post(
        "/process_frame", files={"file": ("test.jpg", invalid_bytes, "image/jpeg")}
    )
    assert res_invalid.status_code == 415


def test_export_gif_endpoint(client):
    import base64

    from PIL import Image

    # Gerar 2 fotogramas de teste com Pillow
    frames_b64 = []
    for color in [(255, 0, 0), (0, 255, 0)]:
        img = Image.new("RGB", (100, 100), color=color)
        buf = io.BytesIO()
        img.save(buf, format="JPEG")
        b64 = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("utf-8")
        frames_b64.append(b64)

    payload = {
        "frames": frames_b64,
        "delay_ms": 100,
        "loop": 0,
    }
    res = client.post("/api/v1/video/export-gif", json=payload)
    assert res.status_code == 200
    assert res.headers["content-type"] == "image/gif"
    assert res.content.startswith(b"GIF89a")
