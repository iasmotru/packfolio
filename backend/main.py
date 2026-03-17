"""
Packfolio — Telegram Mini App для хранения трэвел-документов.
FastAPI + SQLite + Uvicorn.

Запуск:
    uvicorn main:app --reload --port 8000
"""

import json
import os
from datetime import datetime
from typing import Optional

from dotenv import load_dotenv
load_dotenv()

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import (
    ENV, BOT_TOKEN,
    create_token, get_current_user_id,
    validate_telegram_init_data, validate_init_data_dev,
)
from models import (
    Document, DocumentTag, Tag, Trip, User, WidgetData,
    create_tables, get_db,
)
from routes import calendar, documents, tags, trips, wallet_routes

# ──────────────────────────────────────────────
# Инициализация приложения
# ──────────────────────────────────────────────

app = FastAPI(
    title="Packfolio API",
    description="Travel document storage Telegram Mini App",
    version="1.0.0",
)

# CORS — разрешаем локальный фронтенд и Telegram WebApp
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # В проде замените на конкретные домены
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Регистрируем роутеры
app.include_router(trips.router)
app.include_router(tags.router)
app.include_router(documents.router)
app.include_router(calendar.router)
app.include_router(wallet_routes.router)

# Статические файлы (фронтенд)
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.isdir(FRONTEND_DIR):
    app.mount("/app", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

# Создаём директорию для загрузок
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


# ──────────────────────────────────────────────
# Создание таблиц при старте
# ──────────────────────────────────────────────

@app.on_event("startup")
def on_startup():
    create_tables()
    print("✓ Таблицы созданы / обновлены")

    # Авто-сид в dev-режиме
    if ENV == "dev":
        from sqlalchemy.orm import Session
        from models import SessionLocal
        db = SessionLocal()
        try:
            _seed_dev(db)
        finally:
            db.close()


# ──────────────────────────────────────────────
# Auth endpoint
# ──────────────────────────────────────────────

class AuthRequest(BaseModel):
    init_data: str


@app.post("/api/auth/telegram")
def auth_telegram(body: AuthRequest, db: Session = Depends(get_db)):
    """
    Валидирует Telegram WebApp initData, создаёт/обновляет пользователя,
    возвращает Bearer JWT токен.
    """
    if not body.init_data:
        raise HTTPException(status_code=400, detail="initData не передан")

    # В dev-режиме без BOT_TOKEN — пропускаем проверку HMAC
    if ENV == "dev" and not BOT_TOKEN:
        try:
            user_data = validate_init_data_dev(body.init_data)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Ошибка парсинга initData: {e}")
    else:
        try:
            user_data = validate_telegram_init_data(body.init_data)
        except ValueError as e:
            raise HTTPException(status_code=401, detail=str(e))

    telegram_id = user_data.get("id")
    if not telegram_id:
        raise HTTPException(status_code=400, detail="В initData нет поля user.id")

    # Создаём или обновляем пользователя
    user = db.query(User).filter(User.id == telegram_id).first()
    if not user:
        user = User(
            id=telegram_id,
            first_name=user_data.get("first_name", ""),
            last_name=user_data.get("last_name"),
            username=user_data.get("username"),
        )
        db.add(user)
        db.commit()
    else:
        user.first_name = user_data.get("first_name", user.first_name)
        user.last_name  = user_data.get("last_name",  user.last_name)
        user.username   = user_data.get("username",   user.username)
        db.commit()

    token = create_token(telegram_id)
    return {
        "token": token,
        "user": {
            "id":         user.id,
            "first_name": user.first_name,
            "last_name":  user.last_name,
            "username":   user.username,
        },
    }


# ──────────────────────────────────────────────
# Dev seed
# ──────────────────────────────────────────────

def _seed_dev(db: Session):
    """
    Создаёт тестовые данные для разработки.
    Вызывается только при ENV=dev.
    """
    DEV_USER_ID = 1

    # Пользователь
    user = db.query(User).filter(User.id == DEV_USER_ID).first()
    if not user:
        user = User(
            id=DEV_USER_ID,
            first_name="Dev",
            last_name="User",
            username="devuser",
        )
        db.add(user)
        db.flush()

    # Поездка
    if not db.query(Trip).filter(Trip.user_id == DEV_USER_ID).first():
        trip = Trip(
            user_id=DEV_USER_ID,
            title="Берлин — осень 2024",
            locations="Берлин, Германия",
            start_date="2024-10-05",
            end_date="2024-10-12",
            note="Конференция + отдых",
        )
        db.add(trip)
        db.flush()

        # Теги
        tag1 = Tag(user_id=DEV_USER_ID, name="Командировка", kind="tripType")
        tag2 = Tag(user_id=DEV_USER_ID, name="Важное",       kind="custom")
        db.add_all([tag1, tag2])
        db.flush()

        # Документ 1 — авиабилет (заглушка без файла)
        doc1 = Document(
            user_id=DEV_USER_ID,
            trip_id=trip.id,
            doc_type="FLIGHT_TICKET",
            title="Билет SU 2576 MOW→TXL",
            file_path=None,
            file_mime=None,
        )
        db.add(doc1)
        db.flush()

        wd1 = WidgetData(
            document_id=doc1.id,
            data={
                "flight_number":   "SU 2576",
                "pnr":             "ABCDEF",
                "departure_place": "SVO",
                "arrival_place":   "TXL",
                "departure_date":  "2024-10-05",
                "departure_time":  "07:30",
                "arrival_date":    "2024-10-05",
                "arrival_time":    "09:45",
                "seat":            "14A",
                "baggage":         "1 × 23 кг",
                "passengers":      1,
            },
            extracted_data={},
            confidence=0.95,
            last_parsed_at=datetime.utcnow(),
        )
        db.add(wd1)
        db.add(DocumentTag(document_id=doc1.id, tag_id=tag1.id))

        # Документ 2 — отель (заглушка без файла)
        doc2 = Document(
            user_id=DEV_USER_ID,
            trip_id=trip.id,
            doc_type="HOTEL_BOOKING",
            title="Hotel Mitte Berlin",
            file_path=None,
            file_mime=None,
        )
        db.add(doc2)
        db.flush()

        wd2 = WidgetData(
            document_id=doc2.id,
            data={
                "hotel_name": "Hotel Mitte Berlin",
                "address":    "Unter den Linden 10, Berlin",
                "check_in":   "2024-10-05",
                "check_out":  "2024-10-12",
                "nights":     7,
                "room_type":  "Standard Double",
                "guests":     1,
            },
            extracted_data={},
            confidence=0.92,
            last_parsed_at=datetime.utcnow(),
        )
        db.add(wd2)
        db.add(DocumentTag(document_id=doc2.id, tag_id=tag2.id))

        db.commit()
        print("✓ Dev seed: добавлены тестовые данные (1 поездка, 2 тега, 2 документа)")
    else:
        print("✓ Dev seed: данные уже существуют, пропускаем")


@app.post("/api/dev/seed")
def dev_seed(db: Session = Depends(get_db)):
    """Ручной запуск сида (только при ENV=dev)."""
    if ENV != "dev":
        raise HTTPException(status_code=403, detail="Доступно только в dev-режиме")
    _seed_dev(db)
    return {"ok": True, "message": "Сид выполнен"}


# ──────────────────────────────────────────────
# Health check
# ──────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "env": ENV,
        "wallet_configured": bool(os.getenv("PASS_TYPE_ID")),
        "ocr_enabled": os.getenv("ENABLE_OCR", "0") == "1",
    }


@app.get("/api/me")
def get_me(
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    return {
        "id":         user.id,
        "first_name": user.first_name,
        "last_name":  user.last_name,
        "username":   user.username,
    }
