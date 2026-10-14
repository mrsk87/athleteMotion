"""Módulo de backends de inferência de deep learning."""

from athletemotion.infrastructure.backends.base import BackendInfo, InferenceBackend
from athletemotion.infrastructure.backends.openvino_cpu import OpenVinoCPUBackend
from athletemotion.infrastructure.backends.ort_cpu import OrtCPUBackend
from athletemotion.infrastructure.backends.ort_directml import OrtDirectMLBackend
from athletemotion.infrastructure.backends.registry import BackendRegistry

__all__ = [
    "BackendInfo",
    "BackendRegistry",
    "InferenceBackend",
    "OpenVinoCPUBackend",
    "OrtCPUBackend",
    "OrtDirectMLBackend",
]
