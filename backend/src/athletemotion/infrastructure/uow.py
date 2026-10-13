"""Padrão Unit of Work para gestão atómica e isolada de transações (ACID).

Garante que múltiplas operações de escrita no banco ocorram em bloco ou
sejam totalmente revertidas (Rollback) em caso de qualquer exceção.
"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Generator
from sqlalchemy.orm import Session

from .database import SessionLocal


@contextmanager
def unit_of_work() -> Generator[Session, None, None]:
    """Gerenciador de contexto transacional (Unit of Work).

    Uso:
        with unit_of_work() as session:
            session.add(athlete)
            session.add(bike)
            # O commit é automático no encerramento limpo do bloco.
            # Se ocorrer qualquer erro, faz rollback imediato.
    """
    session: Session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

