"""
CRUD для поездок (Trip).
"""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user_id
from models import Trip, get_db

router = APIRouter(prefix="/api/trips", tags=["trips"])


# ──────────────────────────────────────────────
# Pydantic схемы
# ──────────────────────────────────────────────

class TripCreate(BaseModel):
    title:      str
    locations:  Optional[str] = None
    start_date: Optional[str] = None
    end_date:   Optional[str] = None
    note:       Optional[str] = None


class TripUpdate(BaseModel):
    title:      Optional[str] = None
    locations:  Optional[str] = None
    start_date: Optional[str] = None
    end_date:   Optional[str] = None
    note:       Optional[str] = None


class TripOut(BaseModel):
    id:         int
    user_id:    int
    title:      str
    locations:  Optional[str]
    start_date: Optional[str]
    end_date:   Optional[str]
    note:       Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


# ──────────────────────────────────────────────
# Эндпоинты
# ──────────────────────────────────────────────

@router.get("", response_model=List[TripOut])
def list_trips(
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    return db.query(Trip).filter(Trip.user_id == user_id).order_by(Trip.created_at.desc()).all()


@router.post("", response_model=TripOut, status_code=status.HTTP_201_CREATED)
def create_trip(
    body: TripCreate,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    trip = Trip(user_id=user_id, **body.model_dump())
    db.add(trip)
    db.commit()
    db.refresh(trip)
    return trip


@router.put("/{trip_id}", response_model=TripOut)
def update_trip(
    trip_id: int,
    body: TripUpdate,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    trip = db.query(Trip).filter(Trip.id == trip_id, Trip.user_id == user_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Поездка не найдена")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(trip, field, value)

    db.commit()
    db.refresh(trip)
    return trip


@router.delete("/{trip_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_trip(
    trip_id: int,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    trip = db.query(Trip).filter(Trip.id == trip_id, Trip.user_id == user_id).first()
    if not trip:
        raise HTTPException(status_code=404, detail="Поездка не найдена")
    db.delete(trip)
    db.commit()
