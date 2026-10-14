"""Definições e configurações operacionais e de segurança da API."""

from __future__ import annotations

import os

from pydantic import BaseModel, Field, model_validator


def _parse_origins(raw: str | None) -> list[str]:
    """Converte string separada por vírgulas numa lista limpa de origens."""
    if not raw or not raw.strip():
        return [
            "http://localhost:8080",
            "http://127.0.0.1:8080",
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ]
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


class ApiSettings(BaseModel):
    """Configurações operacionais para FastAPI, Uvicorn e segurança."""

    env: str = Field(
        default_factory=lambda: os.getenv("ATHLETE_ENV", "dev").lower(),
        description="Ambiente de execução ('dev' ou 'prod')",
    )
    host: str = Field(
        default_factory=lambda: os.getenv("ATHLETE_HOST", "127.0.0.1"),
        description="Endereço de bind da API (127.0.0.1 por defeito para segurança local)",
    )
    port: int = Field(
        default_factory=lambda: int(os.getenv("ATHLETE_PORT", "8000")),
        description="Porto TCP de escuta",
    )
    reload: bool = Field(
        default_factory=lambda: os.getenv("ATHLETE_RELOAD", "false").lower() in ("true", "1"),
        description="Modo de recarregamento automático (apenas para desenvolvimento)",
    )
    allowed_origins: list[str] = Field(
        default_factory=lambda: _parse_origins(os.getenv("ALLOWED_ORIGINS")),
        description="Lista explícita de origens permitidas pelo CORS (sem wildcard)",
    )
    api_token: str | None = Field(
        default_factory=lambda: os.getenv("API_TOKEN") or os.getenv("ATHLETE_API_TOKEN"),
        description="Token secreto de autenticação Bearer para a API",
    )
    lan_mode: bool = Field(
        default_factory=lambda: os.getenv("LAN_MODE", "false").lower() in ("true", "1"),
        description="Modo de rede local (LAN). Exige obrigatoriamente API_TOKEN configurado",
    )
    enable_docs: bool = Field(
        default_factory=lambda: (
            os.getenv(
                "ENABLE_DOCS",
                "true" if os.getenv("ATHLETE_ENV", "dev").lower() != "prod" else "false",
            ).lower()
            in ("true", "1")
        ),
        description="Se verdadeiro, expõe endpoints OpenAPI /docs e /redoc",
    )
    rate_limit_per_minute: int = Field(
        default_factory=lambda: int(os.getenv("RATE_LIMIT_PER_MINUTE", "120")),
        description="Limite global de requisições por minuto por IP/cliente",
    )
    rate_limit_strict_per_minute: int = Field(
        default_factory=lambda: int(os.getenv("RATE_LIMIT_STRICT_PER_MINUTE", "10")),
        description="Limite estrito por minuto para rotas pesadas (PDF, GIF, troca de motor)",
    )
    max_active_engines: int = Field(
        default_factory=lambda: int(os.getenv("MAX_ACTIVE_ENGINES", "2")),
        description="Número máximo de motores de inferência em execução concorrente",
    )
    warmup_on_start: bool = Field(
        default_factory=lambda: os.getenv("WARMUP_ON_START", "false").lower() in ("true", "1"),
        description="Se verdadeiro, executa aquecimento assíncrono do motor padrão no lifespan",
    )
    max_upload_bytes: int = Field(
        default_factory=lambda: int(os.getenv("MAX_UPLOAD_BYTES", str(5 * 1024 * 1024))),
        description="Limite máximo em bytes para upload de ficheiros de imagem (5 MB por defeito)",
    )
    max_image_pixels: int = Field(
        default_factory=lambda: int(os.getenv("MAX_IMAGE_PIXELS", "16000000")),
        description="Limite máximo de megapixels decodificados (16 MP por defeito)",
    )
    max_image_side: int = Field(
        default_factory=lambda: int(os.getenv("MAX_IMAGE_SIDE", "4096")),
        description="Dimensão máxima permitida para largura ou altura de imagem em pixels",
    )
    ws_max_message_bytes: int = Field(
        default_factory=lambda: int(os.getenv("WS_MAX_MESSAGE_BYTES", str(1 * 1024 * 1024))),
        description="Tamanho máximo em bytes para mensagens binárias recebidas via WebSocket",
    )
    ws_max_connections: int = Field(
        default_factory=lambda: int(os.getenv("WS_MAX_CONNECTIONS", "2")),
        description="Número máximo de ligações WebSocket simultâneas aceites pelo backend",
    )
    gif_max_frames: int = Field(
        default_factory=lambda: int(os.getenv("GIF_MAX_FRAMES", "120")),
        description="Número máximo de fotogramas aceites para geração de animação GIF",
    )
    gif_max_total_bytes: int = Field(
        default_factory=lambda: int(os.getenv("GIF_MAX_TOTAL_BYTES", str(40 * 1024 * 1024))),
        description="Limite máximo de carga útil agregada de base64 para geração de GIF (40 MB)",
    )
    gif_max_side: int = Field(
        default_factory=lambda: int(os.getenv("GIF_MAX_SIDE", "720")),
        description="Dimensão máxima em pixels para largura de cada frame do GIF",
    )
    max_raw_landmarks_bytes: int = Field(
        default_factory=lambda: int(os.getenv("MAX_RAW_LANDMARKS_BYTES", str(64 * 1024))),
        description="Tamanho máximo em bytes para string de keypoints brutos (64 KB)",
    )
    pipeline_mode: str = Field(
        default_factory=lambda: os.getenv("PIPELINE_MODE", "sequential").lower(),
        description="Modo de execução do pipeline: 'sequential' ou 'staged'",
    )

    @model_validator(mode="after")
    def validate_lan_security(self) -> ApiSettings:
        """Garante que a exposição em rede local não ocorra sem chave de segurança."""
        if self.lan_mode and not self.api_token:
            raise ValueError(
                "Modo LAN ativado ('LAN_MODE=true') exige definição explícita de 'API_TOKEN'. "
                "Defina a variável API_TOKEN no ambiente para permitir ligações externas seguras."
            )
        return self


settings = ApiSettings()
