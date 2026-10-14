"""Validação e decodificação defensiva de imagens com proteção contra descompressão abusiva (Pixel Flood / Decompression Bombs)."""

from __future__ import annotations

import io
import logging

import cv2
import numpy as np
from PIL import Image

from athletemotion.config.settings import settings

logger = logging.getLogger("athlete_motion.api.validation.images")


class ImageValidationError(Exception):
    """Exceção base para falhas de validação de imagem."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class UnsupportedImageTypeError(ImageValidationError):
    """Lançada quando a assinatura mágica do ficheiro não corresponde a JPEG, PNG ou WebP."""

    def __init__(
        self, message: str = "Formato de imagem não suportado. Formatos aceites: JPEG, PNG, WebP."
    ):
        super().__init__(message=message, status_code=415)


class ImageTooLargeError(ImageValidationError):
    """Lançada quando a imagem excede o tamanho em bytes ou o número máximo de píxeis."""

    def __init__(
        self, message: str = "A imagem excede as dimensões ou o tamanho máximo permitido."
    ):
        super().__init__(message=message, status_code=413)


class InvalidImagePayloadError(ImageValidationError):
    """Lançada quando a imagem está corrompida ou impossível de decodificar."""

    def __init__(self, message: str = "Ficheiro de imagem corrompido ou payload inválido."):
        super().__init__(message=message, status_code=422)


def check_image_magic_bytes(data: bytes) -> str:
    """Valida os magic bytes iniciais do fluxo binário e devolve o formato detectado.

    Raises:
        UnsupportedImageTypeError: Se o cabeçalho não corresponder a JPEG, PNG ou WebP.
    """
    if len(data) < 12:
        raise UnsupportedImageTypeError(
            "Dados insuficientes para validação de assinatura de imagem."
        )

    # JPEG: FFD8FF
    if data[:3] == b"\xff\xd8\xff":
        return "jpeg"

    # PNG: \x89PNG\r\n\x1a\n
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"

    # WebP: RIFF....WEBP
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"

    raise UnsupportedImageTypeError(
        "Formato de imagem não suportado ou assinatura inválida. Apenas ficheiros JPEG, PNG e WebP genuínos são permitidos."
    )


def validate_and_decode_image(
    data: bytes,
    max_bytes: int | None = None,
    max_pixels: int | None = None,
    max_side: int | None = None,
) -> np.ndarray:
    """Valida defensivamente os bytes de imagem antes da decodificação em memória.

    Fluxo de segurança:
    1. Verifica o limite total de bytes em memória.
    2. Valida magic bytes (JPEG, PNG, WebP).
    3. Inspeciona o cabeçalho via Pillow com MAX_IMAGE_PIXELS ativo para obter (w, h)
       sem descompactar o mapa de bits completo.
    4. Rejeita imagens com dimensões ou contagem de píxeis fora dos limites permitidos.
    5. Decodifica em formato OpenCV BGR uint8 e confirma integridade do array.

    Args:
        data: Fluxo binário bruto da imagem.
        max_bytes: Limite máximo em bytes (por defeito: settings.max_upload_bytes).
        max_pixels: Limite máximo de píxeis (por defeito: settings.max_image_pixels).
        max_side: Limite máximo para qualquer lado (por defeito: settings.max_image_side).

    Returns:
        np.ndarray: Imagem decodificada em BGR uint8.

    Raises:
        ImageTooLargeError: Se exceder bytes, pixels ou comprimento de lado.
        UnsupportedImageTypeError: Se o formato não for suportado.
        InvalidImagePayloadError: Se o payload estiver truncado ou corrompido.
    """
    limit_bytes = max_bytes if max_bytes is not None else settings.max_upload_bytes
    limit_pixels = max_pixels if max_pixels is not None else settings.max_image_pixels
    limit_side = max_side if max_side is not None else settings.max_image_side

    # 1. Verificação de tamanho bruto em bytes
    if len(data) > limit_bytes:
        raise ImageTooLargeError(
            f"O ficheiro enviado ({len(data)} bytes) excede o limite máximo permitido de {limit_bytes} bytes."
        )

    # 2. Verificação de magic bytes
    check_image_magic_bytes(data)

    # 3. Inspeção de cabeçalho com Pillow
    Image.MAX_IMAGE_PIXELS = limit_pixels
    try:
        with Image.open(io.BytesIO(data)) as pil_img:
            width, height = pil_img.size
            if width <= 0 or height <= 0:
                raise InvalidImagePayloadError(
                    "Dimensões inválidas (zero ou negativas) no cabeçalho da imagem."
                )

            if width > limit_side or height > limit_side:
                raise ImageTooLargeError(
                    f"Dimensões da imagem ({width}x{height}) excedem os limites de segurança (máximo {limit_side}px)."
                )

            if (width * height) > limit_pixels:
                raise ImageTooLargeError(
                    f"Total de píxeis ({width * height}) excede o limiar de segurança ({limit_pixels} píxeis)."
                )
    except ImageValidationError:
        raise
    except Exception as err:
        logger.warning("Falha ao analisar cabeçalho da imagem com Pillow: %s", err)
        raise InvalidImagePayloadError(
            "Não foi possível ler o cabeçalho do ficheiro de imagem."
        ) from err

    # 4. Decodificação raster com OpenCV
    nparr = np.frombuffer(data, np.uint8)
    frame_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if (
        frame_bgr is None
        or frame_bgr.size == 0
        or frame_bgr.shape[0] == 0
        or frame_bgr.shape[1] == 0
    ):
        raise InvalidImagePayloadError(
            "Falha na descompressão do raster de imagem. Ficheiro potencialmente corrompido."
        )

    return frame_bgr
