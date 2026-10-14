"""Módulo de validação científica, ensaios de concordância e métricas de fidelidade (R17)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from athletemotion.validation.bland_altman import (
    compute_bland_altman_stats,
    generate_bland_altman_plot,
)
from athletemotion.validation.metrics import (
    ValidationMetrics,
    compute_validation_metrics,
)

if TYPE_CHECKING:
    from athletemotion.validation.runner import (
        create_synthetic_validation_dataset,
        run_validation_suite,
    )


def __getattr__(name: str) -> Any:
    if name in ("create_synthetic_validation_dataset", "run_validation_suite"):
        from athletemotion.validation import runner

        return getattr(runner, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "ValidationMetrics",
    "compute_bland_altman_stats",
    "compute_validation_metrics",
    "create_synthetic_validation_dataset",
    "generate_bland_altman_plot",
    "run_validation_suite",
]
