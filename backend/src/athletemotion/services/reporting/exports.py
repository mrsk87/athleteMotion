"""Módulo de exportação de dados de sessões de BikeFit (R17).

Suporta exportação aberta e interoperável de séries temporais e estatísticas agregadas
em formatos CSV e JSON com versionamento de esquema (schema_version='1.0.0'),
proteção de privacidade (minimização de PII) e suporte a streaming para sessões longas.
"""

from __future__ import annotations

import contextlib
import csv
import io
import json
from collections.abc import Generator, Sequence
from datetime import UTC, datetime
from typing import Any, Literal

from athletemotion.services.reporting.provenance import Provenance, create_session_provenance


def export_session_csv(
    session: Any,
    snapshots: Sequence[Any],
    cycles: Sequence[dict[str, Any]] | None = None,
    mode: Literal["frames", "cycles", "full"] = "full",
) -> str:
    """Gera string CSV formatada contendo séries temporais e resumos de ciclo.

    Args:
        session: Instância de FitSessionModel ou objeto equivalente.
        snapshots: Lista de instâncias de PostureSnapshotModel.
        cycles: Resumos de ciclos detetados (opcional).
        mode: 'frames' para amostras quadro a quadro, 'cycles' para resumos de ciclo,
              ou 'full' para ficheiro unificado com secções estruturadas.

    Returns:
        Conteúdo CSV codificado em string UTF-8.
    """
    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\n")

    if mode in ("frames", "full"):
        if mode == "full":
            writer.writerow(["# SECTION: METADATA"])
            writer.writerow(["session_id", getattr(session, "id", "")])
            writer.writerow(["started_at", str(getattr(session, "started_at", ""))])
            writer.writerow(["completed_at", str(getattr(session, "completed_at", ""))])
            writer.writerow(["status", str(getattr(session, "status", ""))])
            writer.writerow([])
            writer.writerow(["# SECTION: FRAME_TIME_SERIES"])

        # Cabeçalho da série temporal quadro a quadro
        writer.writerow(
            [
                "frame_index",
                "timestamp_utc",
                "knee_angle_deg",
                "back_angle_deg",
                "arm_angle_deg",
                "ankle_angle_deg",
                "is_compliant",
            ]
        )

        for s in snapshots:
            ts = getattr(s, "timestamp", "")
            ts_str = ts.isoformat() if isinstance(ts, datetime) else str(ts)
            writer.writerow(
                [
                    getattr(s, "frame_index", 0),
                    ts_str,
                    f"{s.knee_angle:.2f}" if getattr(s, "knee_angle", None) is not None else "",
                    f"{s.back_angle:.2f}" if getattr(s, "back_angle", None) is not None else "",
                    f"{s.arm_angle:.2f}" if getattr(s, "arm_angle", None) is not None else "",
                    f"{s.ankle_angle:.2f}" if getattr(s, "ankle_angle", None) is not None else "",
                    1 if getattr(s, "is_compliant", False) else 0,
                ]
            )

    if mode in ("cycles", "full") and cycles:
        if mode == "full":
            writer.writerow([])
            writer.writerow(["# SECTION: CYCLE_SUMMARY"])

        writer.writerow(
            [
                "cycle_index",
                "start_frame",
                "end_frame",
                "duration_ms",
                "knee_bdc_angle_deg",
                "knee_tdc_angle_deg",
                "knee_rom_deg",
                "cadence_rpm",
            ]
        )

        for c in cycles:
            writer.writerow(
                [
                    c.get("cycle_index", 0),
                    c.get("start_frame", 0),
                    c.get("end_frame", 0),
                    f"{c.get('duration_ms', 0.0):.1f}",
                    f"{c.get('knee_bdc_angle', 0.0):.2f}" if c.get("knee_bdc_angle") is not None else "",
                    f"{c.get('knee_tdc_angle', 0.0):.2f}" if c.get("knee_tdc_angle") is not None else "",
                    f"{c.get('knee_rom', 0.0):.2f}" if c.get("knee_rom") is not None else "",
                    f"{c.get('cadence_rpm', 0.0):.1f}" if c.get("cadence_rpm") is not None else "",
                ]
            )

    return output.getvalue()


def stream_session_csv(
    session: Any,
    snapshots: Sequence[Any],
    cycles: Sequence[dict[str, Any]] | None = None,
    chunk_size: int = 100,
) -> Generator[str, None, None]:
    """Gerador em streaming de blocos de CSV para sessões de elevada duração sem sobrecarga de memória."""
    # Bloco de cabeçalho
    header_buf = io.StringIO()
    writer = csv.writer(header_buf, lineterminator="\n")
    writer.writerow(["# ATHLETE MOTION CSV EXPORT — SCHEMA 1.0"])
    writer.writerow(["session_id", getattr(session, "id", "")])
    writer.writerow(
        [
            "frame_index",
            "timestamp_utc",
            "knee_angle_deg",
            "back_angle_deg",
            "arm_angle_deg",
            "ankle_angle_deg",
            "is_compliant",
        ]
    )
    yield header_buf.getvalue()

    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    count = 0

    for s in snapshots:
        ts = getattr(s, "timestamp", "")
        ts_str = ts.isoformat() if isinstance(ts, datetime) else str(ts)
        writer.writerow(
            [
                getattr(s, "frame_index", 0),
                ts_str,
                f"{s.knee_angle:.2f}" if getattr(s, "knee_angle", None) is not None else "",
                f"{s.back_angle:.2f}" if getattr(s, "back_angle", None) is not None else "",
                f"{s.arm_angle:.2f}" if getattr(s, "arm_angle", None) is not None else "",
                f"{s.ankle_angle:.2f}" if getattr(s, "ankle_angle", None) is not None else "",
                1 if getattr(s, "is_compliant", False) else 0,
            ]
        )
        count += 1
        if count >= chunk_size:
            yield buf.getvalue()
            buf = io.StringIO()
            writer = csv.writer(buf, lineterminator="\n")
            count = 0

    if buf.getvalue():
        yield buf.getvalue()


def export_session_json(
    session: Any,
    snapshots: Sequence[Any],
    provenance: Provenance | dict[str, Any] | None = None,
    cycles_data: list[dict[str, Any]] | None = None,
    include_landmarks: bool = False,
) -> dict[str, Any]:
    """Exporta a sessão em formato estruturado versionado JSON (schema_version='1.0.0')."""
    if isinstance(provenance, Provenance):
        prov_dict = provenance.to_dict()
    elif isinstance(provenance, dict):
        prov_dict = provenance
    else:
        prov_dict = create_session_provenance(
            cycles_used=len(cycles_data or []),
            source="cycles" if cycles_data else "manual",
        ).to_dict()

    athlete = getattr(session, "athlete", None)
    bike = getattr(session, "bike", None)

    started_at = getattr(session, "started_at", None)
    completed_at = getattr(session, "completed_at", None)

    # Amostras de séries temporais
    snapshot_items: list[dict[str, Any]] = []
    for s in snapshots:
        ts = getattr(s, "timestamp", "")
        ts_str = ts.isoformat() if isinstance(ts, datetime) else str(ts)
        item: dict[str, Any] = {
            "frame_index": getattr(s, "frame_index", 0),
            "timestamp": ts_str,
            "angles": {
                "knee": getattr(s, "knee_angle", None),
                "back": getattr(s, "back_angle", None),
                "arm": getattr(s, "arm_angle", None),
                "ankle": getattr(s, "ankle_angle", None),
            },
            "is_compliant": getattr(s, "is_compliant", False),
        }
        if include_landmarks and getattr(s, "raw_landmarks_json", None):
            with contextlib.suppress(Exception):
                item["raw_landmarks"] = json.loads(s.raw_landmarks_json)
        snapshot_items.append(item)

    payload: dict[str, Any] = {
        "schema_version": "1.0.0",
        "exported_at": datetime.now(UTC).isoformat(),
        "session": {
            "id": getattr(session, "id", ""),
            "status": getattr(session, "status", "UNKNOWN"),
            "started_at": started_at.isoformat() if isinstance(started_at, datetime) else str(started_at),
            "completed_at": completed_at.isoformat() if isinstance(completed_at, datetime) else None,
            "targets": {
                "knee_min": getattr(session, "target_knee_min", 145.0),
                "knee_max": getattr(session, "target_knee_max", 155.0),
                "back_min": getattr(session, "target_back_min", 40.0),
                "back_max": getattr(session, "target_back_max", 50.0),
            },
            "averages": {
                "knee_deg": getattr(session, "measured_avg_knee_angle", None),
                "back_deg": getattr(session, "measured_avg_back_angle", None),
                "arm_deg": getattr(session, "measured_avg_arm_angle", None),
                "ankle_deg": getattr(session, "measured_avg_ankle_angle", None),
            },
        },
        "rider": {
            "id": getattr(athlete, "id", None),
            "name": getattr(athlete, "name", "Ciclista"),
            "height_cm": getattr(athlete, "height_cm", None),
            "inseam_cm": getattr(athlete, "inseam_cm", None),
            "flexibility": getattr(athlete, "flexibility", "medium"),
        },
        "bike": {
            "id": getattr(bike, "id", None),
            "type": getattr(bike, "bike_type", "road"),
            "current_saddle_height_cm": getattr(bike, "current_saddle_height_cm", None),
            "crank_length_mm": getattr(bike, "crank_length_mm", None),
        } if bike else None,
        "provenance": prov_dict,
        "cycles": cycles_data or [],
        "snapshots_count": len(snapshot_items),
        "snapshots": snapshot_items,
    }
    return payload
