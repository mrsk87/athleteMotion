"""Subpacote de relatórios, gráficos, exportações e proveniência (R17)."""

from __future__ import annotations

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
    resolve_app_version,
    resolve_git_sha,
)

__all__ = [
    "Provenance",
    "compute_file_sha256",
    "create_session_provenance",
    "export_session_csv",
    "export_session_json",
    "generate_bdc_distribution_histogram",
    "generate_bikefit_pdf",
    "generate_cycle_curve_chart",
    "generate_fatigue_trend_chart",
    "resolve_app_version",
    "resolve_git_sha",
    "sanitize_pdf_text",
    "stream_session_csv",
]
