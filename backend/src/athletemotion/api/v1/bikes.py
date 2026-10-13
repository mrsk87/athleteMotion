"""Endpoints REST para gestão de bicicletas e especificações dos componentes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from athletemotion.infrastructure.database import AthleteModel, BikeModel, get_db
from athletemotion.infrastructure.uow import unit_of_work
from athletemotion.schemas.fit import BikeCreate, BikeResponse

router = APIRouter(prefix="/bikes", tags=["bikes"])


@router.post("", response_model=BikeResponse, status_code=status.HTTP_201_CREATED)
def create_bike(payload: BikeCreate):
    """Regista a bicicleta e componentes para o ciclista."""
    with unit_of_work() as session:
        athlete = session.query(AthleteModel).filter_by(id=payload.athlete_id).first()
        if not athlete:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Atleta não encontrado.")

        bike = BikeModel(
            athlete_id=payload.athlete_id,
            bike_type=payload.bike_type,
            brand_model=payload.brand_model,
            frame_size_cm=payload.frame_size_cm,
            top_tube_mm=payload.top_tube_mm,
            handlebar_width_mm=payload.handlebar_width_mm,
            handlebar_reach_mm=payload.handlebar_reach_mm,
            handlebar_drop_mm=payload.handlebar_drop_mm,
            stem_length_mm=payload.stem_length_mm,
            crank_length_mm=payload.crank_length_mm,
            current_saddle_height_cm=payload.current_saddle_height_cm,
            cleat_position=payload.cleat_position,
        )
        session.add(bike)
        session.flush()
        return BikeResponse.model_validate(bike)


@router.get("/by-athlete/{athlete_id}", response_model=list[BikeResponse])
def get_athlete_bikes(athlete_id: str, db: Session = Depends(get_db)):
    """Retorna todas as bicicletas associadas a um atleta."""
    bikes = db.query(BikeModel).filter_by(athlete_id=athlete_id).all()
    return [BikeResponse.model_validate(b) for b in bikes]


