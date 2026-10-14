"""Constantes e modelos de limites operacionais para validação de esquemas.

Centraliza limites de carga útil, resolução e transporte com base nas configurações da aplicação.
"""

from __future__ import annotations

from typing import Final

from athletemotion.config.settings import settings

# Limites centrais de upload e processamento de imagem
MAX_UPLOAD_BYTES: Final[int] = settings.max_upload_bytes
MAX_IMAGE_PIXELS: Final[int] = settings.max_image_pixels
MAX_IMAGE_SIDE: Final[int] = settings.max_image_side

# Limites de WebSocket e transporte
WS_MAX_MESSAGE_BYTES: Final[int] = settings.ws_max_message_bytes
WS_MAX_CONNECTIONS: Final[int] = settings.ws_max_connections

# Limites de animação GIF
GIF_MAX_FRAMES: Final[int] = settings.gif_max_frames
GIF_MAX_TOTAL_BYTES: Final[int] = settings.gif_max_total_bytes
GIF_MAX_SIDE: Final[int] = settings.gif_max_side

# Limites de dados biométricos e telemetria
MAX_RAW_LANDMARKS_BYTES: Final[int] = settings.max_raw_landmarks_bytes
