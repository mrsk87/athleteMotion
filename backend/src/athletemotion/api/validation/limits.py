"""Constantes e modelos de limites operacionais e de segurança."""

from __future__ import annotations

from athletemotion.config.settings import settings


class SecurityLimits:
    """Acesso centralizado aos limites de validação de carga útil e transporte."""

    @classmethod
    def max_upload_bytes(cls) -> int:
        return settings.max_upload_bytes

    @classmethod
    def max_image_pixels(cls) -> int:
        return settings.max_image_pixels

    @classmethod
    def max_image_side(cls) -> int:
        return settings.max_image_side

    @classmethod
    def ws_max_message_bytes(cls) -> int:
        return settings.ws_max_message_bytes

    @classmethod
    def ws_max_connections(cls) -> int:
        return settings.ws_max_connections

    @classmethod
    def gif_max_frames(cls) -> int:
        return settings.gif_max_frames

    @classmethod
    def gif_max_total_bytes(cls) -> int:
        return settings.gif_max_total_bytes

    @classmethod
    def gif_max_side(cls) -> int:
        return settings.gif_max_side

    @classmethod
    def max_raw_landmarks_bytes(cls) -> int:
        return settings.max_raw_landmarks_bytes
