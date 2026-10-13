"""Endpoints REST para gestão de ciclistas e medidas antropométricas."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ...infrastructure.database import AthleteModel, get_db
from ...infrastructure.uow import unit_of_work
from ...schemas.fit import AthleteCreate, AthleteResponse

router = APIRouter(prefix="/athletes", tags=["athletes"])


@router.post("", response_model=AthleteResponse, status_code=status.HTTP_201_CREATED)
def create_athlete(payload: AthleteCreate):
    """Cria o perfil do ciclista com as suas medidas antropométricas iniciais."""
    if payload.inseam_cm >= payload.height_cm:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="A altura do cavalo (entre-perna) não pode ser superior à altura total.",
        )

    with unit_of_work() as session:
        athlete = AthleteModel(
            name=payload.name,
            email=payload.email,
            height_cm=payload.height_cm,
            inseam_cm=payload.inseam_cm,
            shoulder_width_cm=payload.shoulder_width_cm,
            torso_length_cm=payload.torso_length_cm,
            arm_length_cm=payload.arm_length_cm,
            flexibility=payload.flexibility,
            riding_style=payload.riding_style,
        )
        session.add(athlete)
        session.flush()
        # Construir resposta dentro da sessão ativa antes de fechar
        return AthleteResponse.model_validate(athlete)


@router.get("", response_model=list[AthleteResponse])
def list_athletes(db: Session = Depends(get_db)):
    """Lista todos os ciclistas registados."""
    athletes = db.query(AthleteModel).order_by(AthleteModel.created_at.desc()).all()
    return [AthleteResponse.model_validate(a) for a in athletes]


@router.get("/{athlete_id}", response_model=AthleteResponse)
def get_athlete(athlete_id: str, db: Session = Depends(get_db)):
    """Obtém detalhes e medidas corporais de um ciclista."""
    athlete = db.query(AthleteModel).filter_by(id=athlete_id).first()
    if not athlete:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ciclista não encontrado.")
    return AthleteResponse.model_validate(athlete)


