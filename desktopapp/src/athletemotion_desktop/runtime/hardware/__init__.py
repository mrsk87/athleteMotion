"""Sondagem de hardware, perfil de autotune e execução do benchmark (sem Qt).

Este pacote é seguro para correr fora da interface gráfica e por CLI:
`python -m athletemotion_desktop.runtime.hardware.probe --json`.
"""

from athletemotion_desktop.runtime.hardware.autotune import (
    AutotuneProcess,
    AutotuneProgress,
    autotune_module_available,
    parse_progress_line,
)
from athletemotion_desktop.runtime.hardware.probe import (
    CpuInfo,
    GpuInfo,
    HardwareInfo,
    build_hardware_signature,
    collect_hardware_info,
)
from athletemotion_desktop.runtime.hardware.profile import (
    PROFILE_FILE_NAME,
    AutotuneUnavailableError,
    BackendChoice,
    HardwareProfileModel,
    OperatingMode,
    ProfileState,
    ProfileStatus,
    load_profile,
)

__all__ = [
    "PROFILE_FILE_NAME",
    "AutotuneProcess",
    "AutotuneProgress",
    "AutotuneUnavailableError",
    "BackendChoice",
    "CpuInfo",
    "GpuInfo",
    "HardwareInfo",
    "HardwareProfileModel",
    "OperatingMode",
    "ProfileState",
    "ProfileStatus",
    "autotune_module_available",
    "build_hardware_signature",
    "collect_hardware_info",
    "load_profile",
    "parse_progress_line",
]
