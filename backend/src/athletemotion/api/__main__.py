"""Entry point executável para o backend Athlete Motion API.

Uso:
    python -m athletemotion.api
"""

from __future__ import annotations

import uvicorn

from athletemotion.config.settings import settings


def main() -> None:
    """Inicia o servidor Uvicorn com a aplicação FastAPI configurada."""
    uvicorn.run(
        "athletemotion.api.app:app",
        host=settings.host,
        port=settings.port,
        reload=settings.reload,
    )


if __name__ == "__main__":
    main()
