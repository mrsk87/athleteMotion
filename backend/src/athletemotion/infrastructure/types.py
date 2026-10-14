"""Tipos customizados de base de dados para garantir integridade e consistência."""

from __future__ import annotations

import datetime

from sqlalchemy import DateTime, TypeDecorator


class UTCDateTime(TypeDecorator):
    """Garante que instâncias de datetime sejam sempre persistidas e recuperadas em UTC com timezone ativo (tz-aware).

    Resolve o problema clássico do SQLite onde objetos datetime com timezone são convertidos
    para strings ou perdem o fuso horário ao serem lidos.
    """

    impl = DateTime
    cache_ok = True

    def process_bind_param(
        self, value: datetime.datetime | None, dialect
    ) -> datetime.datetime | None:
        if value is None:
            return None
        if not isinstance(value, datetime.datetime):
            raise TypeError(f"Esperado datetime.datetime, recebido {type(value).__name__}")
        if value.tzinfo is None:
            # Se for naive, assume UTC
            return value.replace(tzinfo=datetime.UTC)
        return value.astimezone(datetime.UTC)

    def process_result_value(
        self, value: datetime.datetime | None, dialect
    ) -> datetime.datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=datetime.UTC)
        return value.astimezone(datetime.UTC)
