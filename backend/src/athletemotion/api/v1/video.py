"""Rotas e serviços de processamento e exportação de vídeo e GIF."""

from __future__ import annotations

import base64
import io

import anyio
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import Response
from PIL import Image
from pydantic import BaseModel, Field

from athletemotion.config.settings import settings

router = APIRouter(prefix="/video", tags=["Video Analysis & GIF Export"])


class GifExportRequest(BaseModel):
    """Payload para geração de GIF animado a partir de fotogramas analisados."""

    frames: list[str] = Field(
        ...,
        min_length=1,
        max_length=120,
        description="Lista de fotogramas em base64 (data:image/...)",
    )
    delay_ms: int = Field(
        100, ge=20, le=1000, description="Duração de cada fotograma em milissegundos"
    )
    loop: int = Field(0, ge=0, description="Número de repetições (0 = loop contínuo)")


def _compile_gif_sync(frames_payload: list[str], delay_ms: int, loop: int) -> bytes:
    """Função síncrona executada em threadpool para descarregar o processamento CPU intenso."""
    Image.MAX_IMAGE_PIXELS = settings.max_image_pixels
    max_total_bytes = settings.gif_max_total_bytes
    max_side = settings.gif_max_side

    total_bytes = 0
    pil_images: list[Image.Image] = []

    for idx, frame_str in enumerate(frames_payload):
        if "," in frame_str:
            _, b64_data = frame_str.split(",", 1)
        else:
            b64_data = frame_str

        # Estimar tamanho base64 antes da descodificação
        approx_bytes = len(b64_data) * 3 // 4
        total_bytes += approx_bytes
        if total_bytes > max_total_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Carga útil agregada dos fotogramas excede o limite máximo permitido de {max_total_bytes} bytes.",
            )

        try:
            image_bytes = base64.b64decode(b64_data)
        except Exception as err:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Fotograma {idx} contém codificação base64 inválida.",
            ) from err

        try:
            with Image.open(io.BytesIO(image_bytes)) as raw_img:
                img = raw_img.convert("RGB")

            # Redimensionamento defensivo mantendo proporção
            if img.width > max_side:
                scale = max_side / img.width
                new_size = (max_side, int(img.height * scale))
                img = img.resize(new_size, Image.Resampling.LANCZOS)

            pil_images.append(img)
        except Exception as err:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Fotograma {idx} inválido ou impossível de decodificar.",
            ) from err

    if not pil_images:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nenhum fotograma válido para criação do GIF.",
        )

    out_buffer = io.BytesIO()
    first_frame = pil_images[0]

    first_frame.save(
        out_buffer,
        format="GIF",
        save_all=True,
        append_images=pil_images[1:],
        duration=delay_ms,
        loop=loop,
        optimize=True,
    )

    return out_buffer.getvalue()


@router.post("/export-gif", summary="Gerar GIF animado com sobreposição biomecânica")
async def export_gif(payload: GifExportRequest):
    """Compila uma sequência de fotogramas analisados num GIF animado de alta qualidade.

    A compilação corre num thread dedicado (anyio.to_thread) para nunca bloquear o event loop.
    """
    if len(payload.frames) > settings.gif_max_frames:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Número de fotogramas ({len(payload.frames)}) excede o limite máximo permitido de {settings.gif_max_frames}.",
        )

    gif_bytes = await anyio.to_thread.run_sync(
        _compile_gif_sync, payload.frames, payload.delay_ms, payload.loop
    )

    return Response(
        content=gif_bytes,
        media_type="image/gif",
        headers={
            "Content-Disposition": "attachment; filename=analise_bikefit.gif",
            "Content-Length": str(len(gif_bytes)),
        },
    )
