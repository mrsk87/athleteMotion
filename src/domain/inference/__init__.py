"""Módulo de inferência postural multi-engine com Strategy Pattern."""
from .types import Landmark2D, SegmentValidation, BiomechanicalAngles, InferenceOutput
from .base import BasePoseEngine, PoseEngineRegistry
from .mediapipe_engine import MediaPipePoseEngine
from .yolo_engine import YOLO11PoseEngine
from .rtmpose_engine import RTMPoseEngine
from .filters import LowPassFilter, OneEuroFilter1D, LandmarkFilterPipeline
from .opencv_tracker import OpenCVClassicalTracker
from .person_tracker import PersonTracker, box_to_pixels, expand_box, iou

__all__ = [
    "Landmark2D",
    "SegmentValidation",
    "BiomechanicalAngles",
    "InferenceOutput",
    "BasePoseEngine",
    "PoseEngineRegistry",
    "MediaPipePoseEngine",
    "YOLO11PoseEngine",
    "RTMPoseEngine",
    "LowPassFilter",
    "OneEuroFilter1D",
    "LandmarkFilterPipeline",
    "OpenCVClassicalTracker",
    "PersonTracker",
    "box_to_pixels",
    "expand_box",
    "iou",
]
