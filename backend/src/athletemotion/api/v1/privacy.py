"""Endpoints REST para conformidade com o RGPD (Direitos do Titular dos Dados).

Disponibiliza:
- Atualização e revogação de consentimento informado (Art. 7).
- Exportação integral portável em JSON (Art. 15 e 20).
- Apagamento lógico (soft) e apagamento definitivo (hard com purga física) (Art. 17).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query, status

from athletemotion.schemas.fit import AthleteResponse, ConsentUpdate
from athletemotion.services.privacy_service import (
    AthleteNotFoundError,
    ConsentValidationError,
    PrivacyService,
)

router = APIRouter(prefix="/athletes", tags=["privacy", "athletes"])
_privacy_service = PrivacyService()


@router.patch("/{athlete_id}/consent", response_model=AthleteResponse)
def update_athlete_consent(athlete_id: str, payload: ConsentUpdate) -> AthleteResponse:
    """Atualiza a versão e o âmbito do consentimento do ciclista.

    A revogação da autorização 'store_landmarks' remove imediatamente todos os dados
    biométricos brutos (keypoints) persistidos nas sessões passadas do ciclista.
    """
    try:
        return _privacy_service.update_consent(athlete_id, payload)
    except AthleteNotFoundError as err:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(err)) from err
    except ConsentValidationError as err:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(err)
        ) from err


@router.get("/{athlete_id}/export")
def export_athlete_data(athlete_id: str) -> dict[str, Any]:
    """Exporta todos os dados pessoais, biométricos e de sessões do titular (Art. 15 e 20 do RGPD).

    Gera uma resposta estruturada JSON com schema_version normalizado.
    """
    try:
        return _privacy_service.export_athlete_data(athlete_id)
    except AthleteNotFoundError as err:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(err)) from err


@router.delete("/{athlete_id}", status_code=status.HTTP_200_OK)
def delete_athlete(
    athlete_id: str,
    hard: bool = Query(
        default=False,
        description="Se True, executa hard-delete imediato com purga física no SQLite; se False (padrão), efetua soft-delete",
    ),
) -> dict[str, Any]:
    """Elimina os registos do ciclista em conformidade com o Direito ao Apagamento (Art. 17 do RGPD)."""
    try:
        return _privacy_service.delete_athlete(athlete_id, hard=hard)
    except AthleteNotFoundError as err:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(err)) from err
