"""Rotas e serviços de processamento e exportação de vídeo e GIF."""
from __future__ import annotations

import base64
import io
from typing import List, Optional
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from PIL import Image

router = APIRouter(prefix="/video", tags=["Video Analysis & GIF Export"])


class GifExportRequest(BaseModel):
    """Payload para geração de GIF animado a partir de fotogramas analisados."""
    frames: List[str] = Field(..., min_length=1, max_length=120, description="Lista de fotogramas em base64 (data:image/...)")
    delay_ms: int = Field(100, ge=20, le=1000, description="Duração de cada fotograma em milissegundos")
    loop: int = Field(0, ge=0, description="Número de repetições (0 = loop contínuo)")


@router.post("/export-gif", summary="Gerar GIF animado com sobreposição biomecânica")
async def export_gif(payload: GifExportRequest):
    """Compila uma sequência de fotogramas analisados num GIF animado de alta qualidade."""
    if not payload.frames:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nenhum fotograma fornecido para criação do GIF."
        )

    pil_images: List[Image.Image] = []

    for idx, frame_str in enumerate(payload.frames):
        try:
            if "," in frame_str:
                _, b64_data = frame_str.split(",", 1)
            else:
                b64_data = frame_str

            image_bytes = base64.b64decode(b64_data)
            img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
            
            # Otimização de dimensão máxima para manter o GIF leve
            if img.width > 720:
                scale = 720 / img.width
                new_size = (720, int(img.height * scale))
                img = img.resize(new_size, Image.Resampling.LANCZOS)
                
            pil_images.append(img)
        except Exception as e:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Fotograma {idx} inválido: {str(e)}"
            )

    if not pil_images:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Falha ao processar fotogramas de vídeo."
        )

    out_buffer = io.BytesIO()
    first_frame = pil_images[0]
    
    # Salvar como GIF animado com paleta quantizada e loop contínuo
    first_frame.save(
        out_buffer,
        format="GIF",
        save_all=True,
        append_images=pil_images[1:],
        duration=payload.delay_ms,
        loop=payload.loop,
        optimize=True,
    )
    
    gif_bytes = out_buffer.getvalue()

    return Response(
        content=gif_bytes,
        media_type="image/gif",
        headers={
            "Content-Disposition": "attachment; filename=analise_bikefit.gif",
            "Content-Length": str(len(gif_bytes)),
        },
    )
