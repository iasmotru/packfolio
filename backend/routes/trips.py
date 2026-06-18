"""
CRUD для поездок (Trip).
"""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user_id
from models import Trip, TripShare, User, get_db

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
    is_shared:  bool = False


class TripUpdate(BaseModel):
    title:      Optional[str] = None
    locations:  Optional[str] = None
    start_date: Optional[str] = None
    end_date:   Optional[str] = None
    note:       Optional[str] = None
    is_shared:  Optional[bool] = None


class TripOut(BaseModel):
    id:          int
    user_id:     int
    title:       str
    locations:   Optional[str]
    start_date:  Optional[str]
    end_date:    Optional[str]
    note:        Optional[str]
    is_shared:   bool = False
    created_at:  datetime
    access_role: str = "owner"   # "owner" | "editor" | "reader"

    class Config:
        from_attributes = True


# ──────────────────────────────────────────────
# Эндпоинты
# ──────────────────────────────────────────────

@router.get("")
def list_trips(
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    # Собственные поездки
    owned = db.query(Trip).filter(Trip.user_id == user_id).order_by(Trip.created_at.desc()).all()

    # Принятые расшаренные поездки
    shares = db.query(TripShare).filter(
        TripShare.member_id == user_id,
        TripShare.accepted == True,
    ).all()
    owned_ids = {t.id for t in owned}
    shares_obj_map = {s.trip_id: s for s in shares}
    shared_ids = set(shares_obj_map.keys()) - owned_ids

    shared = db.query(Trip).filter(Trip.id.in_(shared_ids)).all() if shared_ids else []

    # Ожидающие запросы на редакторский доступ для поездок владельца
    owned_trip_ids = list(owned_ids)
    pending_reqs = db.query(TripShare).filter(
        TripShare.trip_id.in_(owned_trip_ids),
        TripShare.accepted == True,
        TripShare.edit_request_status == 'pending',
    ).all() if owned_trip_ids else []
    pending_map: dict = {}
    for req in pending_reqs:
        member = db.query(User).filter(User.id == req.member_id).first()
        pending_map.setdefault(req.trip_id, []).append({
            "share_id":        req.id,
            "member_id":       req.member_id,
            "member_name":     f"{member.first_name} {member.last_name or ''}".strip() if member else "Пользователь",
            "member_username": member.username if member else None,
        })

    def _trip_dict(trip: Trip, role: str, share: TripShare = None) -> dict:
        d = {
            "id":          trip.id,
            "user_id":     trip.user_id,
            "title":       trip.title,
            "locations":   trip.locations,
            "start_date":  trip.start_date,
            "end_date":    trip.end_date,
            "note":        trip.note,
            "is_shared":   trip.is_shared,
            "created_at":  trip.created_at.isoformat() if trip.created_at else None,
            "access_role": role,
        }
        if share:
            d["share_id"]            = share.id
            d["edit_request_status"] = share.edit_request_status
        else:
            d["pending_editor_requests"] = pending_map.get(trip.id, [])
        return d

    result = [_trip_dict(t, "owner") for t in owned]
    result += [_trip_dict(t, shares_obj_map[t.id].role, shares_obj_map[t.id]) for t in shared]
    result.sort(key=lambda x: x["created_at"] or "", reverse=True)
    return result


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
