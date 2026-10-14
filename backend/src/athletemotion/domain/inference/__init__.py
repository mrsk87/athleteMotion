"""Módulo de inferência postural multi-engine com Strategy Pattern."""

from .base import BasePoseEngine, PoseEngineRegistry
from .filters import LandmarkFilterPipeline, LowPassFilter, OneEuroFilter1D
from .mediapipe_engine import MediaPipePoseEngine
from .opencv_tracker import OpenCVClassicalTracker
from .person_tracker import PersonTracker, box_to_pixels, expand_box, iou
from .rtmpose_engine import RTMPoseEngine
from .types import BiomechanicalAngles, InferenceOutput, Landmark2D, SegmentValidation
from .yolo_engine import YOLO11PoseEngine

__all__ = [
    "BasePoseEngine",
    "BiomechanicalAngles",
    "InferenceOutput",
    "Landmark2D",
    "LandmarkFilterPipeline",
    "LowPassFilter",
    "MediaPipePoseEngine",
    "OneEuroFilter1D",
    "OpenCVClassicalTracker",
    "PersonTracker",
    "PoseEngineRegistry",
    "RTMPoseEngine",
    "SegmentValidation",
    "YOLO11PoseEngine",
    "box_to_pixels",
    "expand_box",
    "iou",
]
