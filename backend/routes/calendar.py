"""
Календарь: строим список событий из виджетов документов пользователя.
"""

import re
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from auth import get_current_user_id
from models import Document, WidgetData, Trip, get_db

router = APIRouter(prefix="/api/calendar", tags=["calendar"])


# ──────────────────────────────────────────────
# Нормализация дат
# ──────────────────────────────────────────────

def normalize_date(raw: Optional[str]) -> Optional[str]:
    """
    Пытается привести произвольную дату к формату YYYY-MM-DD.
    При ошибке возвращает исходную строку.
    """
    if not raw:
        return None
    raw = raw.strip()

    # Уже ISO?
    if re.match(r"^\d{4}-\d{2}-\d{2}", raw):
        return raw[:10]

    # DD.MM.YYYY или DD/MM/YYYY
    m = re.match(r"^(\d{1,2})[./](\d{1,2})[./](\d{4})", raw)
    if m:
        d, mo, y = m.group(1), m.group(2), m.group(3)
        return f"{y}-{mo.zfill(2)}-{d.zfill(2)}"

    # D Month YYYY
    months = {
        "jan": "01", "feb": "02", "mar": "03", "apr": "04",
        "may": "05", "jun": "06", "jul": "07", "aug": "08",
        "sep": "09", "oct": "10", "nov": "11", "dec": "12",
    }
    m = re.match(r"^(\d{1,2})\s+([A-Za-z]{3})\w*\.?\s+(\d{4})", raw)
    if m:
        d, mon_str, y = m.group(1), m.group(2).lower()[:3], m.group(3)
        mo = months.get(mon_str)
        if mo:
            return f"{y}-{mo}-{d.zfill(2)}"

    return raw   # оставляем как есть


# ──────────────────────────────────────────────
# Сборка событий
# ──────────────────────────────────────────────

def docs_to_events(docs: List[Document], trips: List[Trip]) -> List[dict]:
    events = []

    # Поездки → события-периоды
    for trip in trips:
        if trip.start_date or trip.end_date:
            events.append({
                "id":         f"trip-{trip.id}",
                "kind":       "trip",
                "title":      trip.title,
                "date":       normalize_date(trip.start_date),
                "end_date":   normalize_date(trip.end_date),
                "trip_id":    trip.id,
                "doc_id":     None,
                "doc_type":   None,
            })

    # Документы → события из widget_data
    for doc in docs:
        wd = doc.widget_data
        if not wd:
            continue
        data = wd.data or {}

        date = None
        end_date = None
        subtitle = None

        dt = doc.doc_type

        if dt == "HOTEL_BOOKING":
            date     = normalize_date(data.get("check_in"))
            end_date = normalize_date(data.get("check_out"))
            subtitle = data.get("hotel_name", "")

        elif dt == "FLIGHT_TICKET":
            date     = normalize_date(data.get("departure_date"))
            end_date = normalize_date(data.get("arrival_date"))
            subtitle = data.get("flight_number", "")

        elif dt in ("TRAIN_TICKET", "BUS_TICKET"):
            date     = normalize_date(data.get("departure_date"))
            end_date = normalize_date(data.get("arrival_date"))
            subtitle = f"{data.get('departure_place', '')} → {data.get('arrival_place', '')}"

        elif dt == "CAR_RENTAL":
            date     = normalize_date(data.get("pickup_date"))
            end_date = normalize_date(data.get("dropoff_date"))
            subtitle = data.get("car_model", "")

        elif dt == "MEDICAL_INSURANCE":
            date     = normalize_date(data.get("start_date"))
            end_date = normalize_date(data.get("end_date"))
            subtitle = data.get("coverage_amount", "")

        if date:
            events.append({
                "id":       f"doc-{doc.id}",
                "kind":     "document",
                "title":    doc.title,
                "subtitle": subtitle,
                "date":     date,
                "end_date": end_date,
                "trip_id":  doc.trip_id,
                "doc_id":   doc.id,
                "doc_type": dt,
            })

    return sorted(events, key=lambda e: (e.get("date") or ""))


# ──────────────────────────────────────────────
# Эндпоинт
# ──────────────────────────────────────────────

@router.get("")
def get_calendar(
    month: Optional[str] = Query(None, description="YYYY-MM"),
    user_id: int     = Depends(get_current_user_id),
    db:      Session = Depends(get_db),
):
    """
    Возвращает события за указанный месяц (или за всё время).
    Каждое событие: { id, kind, title, subtitle, date, end_date, doc_type, doc_id, trip_id }
    """
    docs  = db.query(Document).filter(Document.user_id == user_id).all()
    trips = db.query(Trip).filter(Trip.user_id == user_id).all()

    events = docs_to_events(docs, trips)

    # Фильтр по месяцу: включаем события, которые НАЧАЛИСЬ в этом месяце
    # ИЛИ продолжаются в этот месяц (start <= month <= end)
    if month:
        def overlaps_month(e):
            s  = (e.get("date")     or "")[:7]
            en = (e.get("end_date") or e.get("date") or "")[:7]
            return s <= month <= en
        events = [e for e in events if overlaps_month(e)]

    return {"month": month, "events": events}
