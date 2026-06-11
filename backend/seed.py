"""
Сидовые данные для режима разработки (ENV=dev).
Запускается автоматически при старте, если БД пустая.
Создаёт: 1 пользователь, 1 поездка, 2 тега, 2 документа-заглушки.
"""
import json
from datetime import datetime

from sqlmodel import Session, select

from models import User, Trip, Tag, Document, WidgetData


def run_seed(session: Session) -> None:
    """Заполнить БД тестовыми данными, если она пуста."""
    # Проверяем: есть ли хоть один пользователь
    existing = session.exec(select(User)).first()
    if existing:
        return  # уже засидировано

    print("[seed] Создаём демо-данные...")

    # ── Пользователь ──────────────────────────────────────────────────────
    user = User(
        telegram_id=1,
        first_name="Dev",
        last_name="User",
        username="devuser",
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    # ── Поездка ───────────────────────────────────────────────────────────
    trip = Trip(
        user_id=user.id,
        title="Берлин / Мюнхен 2025",
        locations="Берлин, Мюнхен",
        start_date="2025-06-01",
        end_date="2025-06-10",
        note="Командировка + выходные",
    )
    session.add(trip)
    session.commit()
    session.refresh(trip)

    # ── Теги ──────────────────────────────────────────────────────────────
    tag_biz = Tag(user_id=user.id, name="Командировка", kind="tripType")
    tag_eur = Tag(user_id=user.id, name="Европа",       kind="custom")
    session.add_all([tag_biz, tag_eur])
    session.commit()

    # ── Документ 1: бронь отеля ───────────────────────────────────────────
    doc1 = Document(
        user_id=user.id,
        trip_id=trip.id,
        doc_type="HOTEL_BOOKING",
        title="Отель Novotel Berlin",
        file_path="",   # заглушка, файла нет
        file_mime="application/pdf",
    )
    session.add(doc1)
    session.commit()
    session.refresh(doc1)

    widget1 = WidgetData(
        document_id=doc1.id,
        confidence=0.92,
        extracted_data=json.dumps({
            "hotel_name":  "Novotel Berlin Mitte",
            "address":     "Fischerinsel 12, 10179 Berlin",
            "check_in":    "2025-06-01",
            "check_out":   "2025-06-05",
            "nights":      4,
            "room_type":   "Superior Double",
            "booking_ref": "NBM-4829301",
        }, ensure_ascii=False),
        data="{}",
        last_parsed_at=datetime.utcnow(),
    )
    session.add(widget1)

    # ── Документ 2: авиабилет ─────────────────────────────────────────────
    doc2 = Document(
        user_id=user.id,
        trip_id=trip.id,
        doc_type="FLIGHT_TICKET",
        title="Билет Москва → Берлин",
        file_path="",
        file_mime="application/pdf",
    )
    session.add(doc2)
    session.commit()
    session.refresh(doc2)

    widget2 = WidgetData(
        document_id=doc2.id,
        confidence=0.88,
        extracted_data=json.dumps({
            "passenger_name":  "Dev User",
            "flight_number":   "SU 2432",
            "pnr":             "ABCDE1",
            "departure_place": "SVO (Шереметьево)",
            "departure_date":  "2025-06-01",
            "departure_time":  "07:45",
            "arrival_place":   "BER (Берлин Бранденбург)",
            "arrival_date":    "2025-06-01",
            "arrival_time":    "09:20",
            "seat":            "14A",
            "baggage":         "23 кг",
            "tariff":          "Economy Flex",
        }, ensure_ascii=False),
        data="{}",
        last_parsed_at=datetime.utcnow(),
    )
    session.add(widget2)
    session.commit()

    print("[seed] Демо-данные созданы: 1 поездка, 2 документа, 2 тега.")
