"""Módulo de compatibilidade retroativa para geração de relatórios PDF (R17).

Atua como shim para o novo pipeline auditável e estruturado em:
`athletemotion.services.reporting.pdf`
"""

from __future__ import annotations

from typing import Any

from athletemotion.services.reporting.pdf import (
    generate_bikefit_pdf as _generate_bikefit_pdf_v2,
)
from athletemotion.services.reporting.pdf import (
    sanitize_pdf_text,
)


def generate_bikefit_pdf(
    athlete_data: dict[str, Any],
    bike_data: dict[str, Any] | None,
    session_data: dict[str, Any],
    angles_summary: list[dict[str, Any]],
    kops_data: dict[str, Any] | None = None,
    symmetry_data: list[dict[str, Any]] | None = None,
    saddle_drop_data: dict[str, Any] | None = None,
    language: str = "pt",
    **kwargs: Any,
) -> bytes:
    """Gera um buffer de bytes contendo o PDF do relatório de BikeFit (retrocompatível)."""
    return _generate_bikefit_pdf_v2(
        athlete_data=athlete_data,
        bike_data=bike_data,
        session_data=session_data,
        angles_summary=angles_summary,
        kops_data=kops_data,
        symmetry_data=symmetry_data,
        saddle_drop_data=saddle_drop_data,
        language=language,
        **kwargs,
    )


__all__ = ["generate_bikefit_pdf", "sanitize_pdf_text"]
