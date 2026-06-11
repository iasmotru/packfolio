"""
Хелпер проверки прав доступа к поездкам и документам.
"""
from typing import Optional
from sqlalchemy.orm import Session
from models import Trip, TripShare


def get_trip_role(trip_id: int, user_id: int, db: Session) -> Optional[str]:
    """
    Возвращает роль пользователя в поездке:
      'owner'  — создатель поездки
      'editor' — принятый редактор
      'reader' — принятый читатель
      None     — нет доступа
    """
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        return None
    if trip.user_id == user_id:
        return "owner"
    share = db.query(TripShare).filter(
        TripShare.trip_id == trip_id,
        TripShare.member_id == user_id,
        TripShare.accepted == True,
    ).first()
    return share.role if share else None
