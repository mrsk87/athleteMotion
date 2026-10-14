"""Testes unitários e de integração para relatórios PDF, proveniência e validação científica (R17)."""

from __future__ import annotations

import io
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from unittest.mock import MagicMock

import numpy as np
import pypdf
import pytest

from athletemotion.services.reporting.charts import (
    generate_bdc_distribution_histogram,
    generate_cycle_curve_chart,
    generate_fatigue_trend_chart,
)
from athletemotion.services.reporting.exports import (
    export_session_csv,
    export_session_json,
    stream_session_csv,
)
from athletemotion.services.reporting.pdf import (
    generate_bikefit_pdf,
    sanitize_pdf_text,
)
from athletemotion.services.reporting.provenance import (
    Provenance,
    compute_file_sha256,
    create_session_provenance,
)
from athletemotion.validation.bland_altman import (
    compute_bland_altman_stats,
    generate_bland_altman_plot,
)
from athletemotion.validation.metrics import (
    compute_validation_metrics,
)
from athletemotion.validation.runner import (
    create_synthetic_validation_dataset,
    run_validation_suite,
)


class TestProvenance:
    """Testes de proveniência e rastreabilidade."""

    def test_provenance_creation_and_serialization(self, tmp_path):
        test_file = tmp_path / "model.onnx"
        test_file.write_bytes(b"dummy onnx weights content for sha test")

        sha = compute_file_sha256(test_file)
        assert sha is not None
        assert len(sha) == 64

        prov = create_session_provenance(
            model_id="yolo11n-pose-320",
            model_sha256=sha,
            backend="directml",
            provider="DmlExecutionProvider",
            calibration={"scale_px_per_mm": 1.25, "roll_deg": 0.4},
            camera_profile="logitech_c920",
            cycles_used=45,
            source="cycles",
        )

        d = prov.to_dict()
        assert d["model_id"] == "yolo11n-pose-320"
        assert d["model_sha256"] == sha
        assert d["backend"] == "directml"
        assert d["cycles_used"] == 45
        assert d["source"] == "cycles"

        # Deserialização
        reconstructed = Provenance.from_dict(d)
        assert reconstructed == prov

        # Rodapé formatado em PT e EN
        footer_pt = prov.footer_summary(language="pt")
        assert "Athlete Motion" in footer_pt
        assert "yolo11n-pose-320" in footer_pt
        assert "1.250 px/mm" in footer_pt
        assert "45 (ciclos)" in footer_pt

        footer_en = prov.footer_summary(language="en")
        assert "Scale: 1.250 px/mm" in footer_en
        assert "45 (cycles)" in footer_en


class TestChartsGeneration:
    """Testes para geração de gráficos biomecânicos thread-safe."""

    def test_cycle_curve_chart_valid_png(self):
        t = np.linspace(0, 2 * np.pi, 100)
        mean_y = 130.0 + 20.0 * np.sin(t)
        std_y = np.full(100, 2.0)

        png_bytes = generate_cycle_curve_chart(
            mean_trajectory=mean_y,
            std_trajectory=std_y,
            joint_name="Joelho",
            target_min=145.0,
            target_max=155.0,
            language="pt",
        )
        assert len(png_bytes) > 1000
        assert png_bytes.startswith(b"\x89PNG\r\n\x1a\n")

    def test_bdc_distribution_histogram_valid_png(self):
        bdc_angles = [148.2, 149.1, 150.0, 147.9, 151.2, 148.8, 149.5]
        png_bytes = generate_bdc_distribution_histogram(bdc_angles, language="en")
        assert len(png_bytes) > 1000
        assert png_bytes.startswith(b"\x89PNG\r\n\x1a\n")

    def test_fatigue_trend_chart_valid_png(self):
        cycles = list(range(1, 21))
        angles = [148.0 + 0.1 * c for c in cycles]
        png_bytes = generate_fatigue_trend_chart(cycles, angles, language="pt")
        assert len(png_bytes) > 1000
        assert png_bytes.startswith(b"\x89PNG\r\n\x1a\n")

    def test_thread_safe_concurrent_chart_generation(self):
        def worker(idx: int) -> int:
            t = np.linspace(0, 2 * np.pi, 50)
            data = 140.0 + idx + 10.0 * np.cos(t)
            res = generate_cycle_curve_chart(data)
            return len(res)

        with ThreadPoolExecutor(max_workers=4) as executor:
            lengths = list(executor.map(worker, range(8)))

        assert all(length > 1000 for length in lengths)


class TestPdfReportGeneration:
    """Testes de geração de relatórios PDF, sanitização e conformidade."""

    def test_sanitize_pdf_text(self):
        raw = "<script>alert('xss');</script> & \"test\"\x00"
        sanitized = sanitize_pdf_text(raw)
        assert "<" not in sanitized
        assert ">" not in sanitized
        assert "\x00" not in sanitized
        assert "&lt;script&gt;" in sanitized
        assert "&amp;" in sanitized

    def test_generate_bikefit_pdf_smoke_and_pypdf_parsing(self):
        athlete_data = {
            "name": "João Silva",
            "height_cm": 178.5,
            "inseam_cm": 84.0,
            "flexibility": "medium",
        }
        bike_data = {
            "modality": "road",
            "current_saddle_height_cm": 74.2,
            "crank_length_mm": 172.5,
        }
        session_data = {
            "cadence_rpm": 90,
            "power_watts": 220,
            "overall_confidence": 0.94,
            "bdc_knee_angles": [148.5, 149.0, 150.1, 148.2, 149.8],
        }
        angles_summary = [
            {
                "name": "Joelho",
                "angle": 149.5,
                "uncertainty": 1.2,
                "confidence": 0.95,
                "range": "145° - 155°",
                "compliant": True,
                "recommendation": "Dentro da faixa recomendada.",
            },
            {
                "name": "Tronco",
                "angle": 44.0,
                "uncertainty": 1.8,
                "confidence": 0.91,
                "range": "40° - 50°",
                "compliant": True,
                "recommendation": "Postura de tronco estável.",
            },
        ]
        kops_data = {
            "offset_mm": 1.5,
            "uncertainty_mm": 1.0,
            "is_aligned": True,
            "recommendation": "Alinhamento neutro satisfatório.",
        }
        withheld_measures = [
            {
                "name": "Queda Pélvica Lateral",
                "reason": "Exige câmara posterior calibrada para análise frontal.",
            }
        ]

        prov = create_session_provenance(
            model_id="yolo11n-pose-320",
            model_sha256="abc1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab",
            backend="directml",
            calibration={"scale_px_per_mm": 1.42},
            cycles_used=25,
            source="cycles",
        )

        pdf_bytes = generate_bikefit_pdf(
            athlete_data=athlete_data,
            bike_data=bike_data,
            session_data=session_data,
            angles_summary=angles_summary,
            kops_data=kops_data,
            withheld_measures=withheld_measures,
            provenance=prov,
            language="pt",
        )

        assert len(pdf_bytes) > 5000
        assert pdf_bytes.startswith(b"%PDF")

        # Leitura e inspeção estrutural com pypdf
        reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
        assert len(reader.pages) >= 1

        extracted_text = " ".join([page.extract_text() or "" for page in reader.pages])
        assert "João Silva" in extracted_text
        assert "ROAD" in extracted_text
        assert "149.5°" in extracted_text
        assert "Queda Pélvica Lateral" in extracted_text
        assert "Athlete Motion" in extracted_text

    def test_pdf_generation_performance_300_cycles(self):
        """Critério de aceitação: gerar PDF com 300+ ciclos em menos de 3.0 segundos."""
        athlete_data = {"name": "Test Rider", "height_cm": 180.0, "inseam_cm": 85.0}
        session_data = {
            "cadence_rpm": 92,
            "power_watts": 250,
            "bdc_knee_angles": list(np.random.normal(148.5, 1.5, 350)),
        }
        angles_summary = [
            {"name": "Joelho", "angle": 148.5, "range": "145° - 155°", "compliant": True}
        ]

        t0 = time.perf_counter()
        pdf_bytes = generate_bikefit_pdf(
            athlete_data=athlete_data,
            bike_data=None,
            session_data=session_data,
            angles_summary=angles_summary,
            language="pt",
        )
        elapsed = time.perf_counter() - t0

        assert len(pdf_bytes) > 5000
        assert elapsed < 3.0, f"Tempo de geração do PDF excedeu o limiar: {elapsed:.3f} s >= 3.0 s"


class TestExports:
    """Testes para exportações de séries temporais em CSV e JSON."""

    def test_export_session_csv_and_streaming(self):
        session_mock = MagicMock()
        session_mock.id = "sess-12345"
        session_mock.started_at = datetime(2026, 10, 14, 10, 0, 0, tzinfo=UTC)
        session_mock.completed_at = datetime(2026, 10, 14, 10, 15, 0, tzinfo=UTC)
        session_mock.status = "COMPLETED"

        snapshots = []
        for i in range(10):
            s = MagicMock()
            s.frame_index = i
            s.timestamp = datetime(2026, 10, 14, 10, 0, i, tzinfo=UTC)
            s.knee_angle = 148.0 + (i * 0.5)
            s.back_angle = 45.0
            s.arm_angle = 155.0
            s.ankle_angle = 75.0
            s.is_compliant = True
            snapshots.append(s)

        cycles = [
            {
                "cycle_index": 1,
                "start_frame": 0,
                "end_frame": 5,
                "duration_ms": 666.6,
                "knee_bdc_angle": 149.2,
                "knee_tdc_angle": 72.1,
                "knee_rom": 77.1,
                "cadence_rpm": 90.0,
            }
        ]

        csv_str = export_session_csv(session_mock, snapshots, cycles=cycles, mode="full")
        assert "frame_index,timestamp_utc,knee_angle_deg" in csv_str
        assert "sess-12345" in csv_str
        assert "148.00" in csv_str
        assert "knee_bdc_angle_deg" in csv_str
        assert "149.20" in csv_str

        # Streaming
        stream_chunks = list(stream_session_csv(session_mock, snapshots, chunk_size=5))
        assert len(stream_chunks) >= 2
        joined_stream = "".join(stream_chunks)
        assert "frame_index,timestamp_utc" in joined_stream
        assert "148.00" in joined_stream

    def test_export_session_json_schema_version(self):
        session_mock = MagicMock()
        session_mock.id = "sess-abc"
        session_mock.status = "COMPLETED"
        session_mock.started_at = datetime(2026, 10, 14, 11, 0, 0, tzinfo=UTC)
        session_mock.completed_at = datetime(2026, 10, 14, 11, 10, 0, tzinfo=UTC)
        session_mock.target_knee_min = 145.0
        session_mock.target_knee_max = 155.0
        session_mock.measured_avg_knee_angle = 149.2
        session_mock.athlete = None
        session_mock.bike = None

        s = MagicMock()
        s.frame_index = 0
        s.timestamp = datetime(2026, 10, 14, 11, 0, 0, tzinfo=UTC)
        s.knee_angle = 149.2
        s.back_angle = 46.0
        s.arm_angle = None
        s.ankle_angle = None
        s.is_compliant = True
        s.raw_landmarks_json = None

        json_data = export_session_json(session_mock, [s])
        assert json_data["schema_version"] == "1.0.0"
        assert json_data["session"]["id"] == "sess-abc"
        assert json_data["session"]["averages"]["knee_deg"] == 149.2
        assert json_data["snapshots_count"] == 1
        assert "provenance" in json_data


class TestValidationMetricsAndBlandAltman:
    """Testes do motor de validação científica, Bland-Altman e runner."""

    def test_metrics_injected_error_recovery(self):
        """Verifica recuperação com exatidão <= 0.1° de erro injetado."""
        y_true = np.array([100.0, 110.0, 120.0, 130.0, 140.0, 150.0])
        # Injetar viés constante de +1.5°
        y_pred = y_true + 1.5

        m = compute_validation_metrics(y_true, y_pred)
        assert pytest.approx(m.mae, abs=0.01) == 1.5
        assert pytest.approx(m.rmse, abs=0.01) == 1.5
        assert pytest.approx(m.bias, abs=0.01) == 1.5
        assert pytest.approx(m.std_diff, abs=0.01) == 0.0
        assert pytest.approx(m.pearson_r, abs=0.001) == 1.0
        assert m.pct_within_3deg == 100.0
        assert m.is_acceptable()

    def test_metrics_invalid_inputs(self):
        with pytest.raises(ValueError):
            compute_validation_metrics([1.0, 2.0], [1.0])
        with pytest.raises(ValueError):
            compute_validation_metrics([], [])

    def test_bland_altman_stats_and_plot(self):
        y_true = [120.0, 130.0, 140.0, 150.0]
        y_pred = [121.0, 129.5, 140.8, 151.2]

        stats = compute_bland_altman_stats(y_true, y_pred)
        assert stats["n"] == 4.0
        assert "bias" in stats
        assert "loa_upper" in stats

        plot_png = generate_bland_altman_plot(y_true, y_pred, joint_name="Joelho")
        assert len(plot_png) > 1000
        assert plot_png.startswith(b"\x89PNG\r\n\x1a\n")

    def test_synthetic_dataset_and_runner(self, tmp_path):
        ds_dir = tmp_path / "synthetic_ds"
        create_synthetic_validation_dataset(
            ds_dir, n_samples=100, knee_bias=0.8, knee_noise_std=1.0
        )

        res = run_validation_suite(ds_dir)
        assert "knee_validation" in res["trials"]
        assert "hip_validation" in res["trials"]

        knee_metrics = res["trials"]["knee_validation"]["metrics"]
        # Injetámos 0.8 de viés -> deve recuperar ~0.8 ± 0.2
        assert pytest.approx(knee_metrics["bias"], abs=0.25) == 0.8
        assert knee_metrics["mae"] < 2.5
        assert res["all_passed"] is True
