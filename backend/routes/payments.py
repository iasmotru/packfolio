"""
Telegram Stars payments: создание инвойса и обработка webhook от Telegram.
"""

import os
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import BOT_TOKEN, get_current_user_id
from models import User, get_db

router = APIRouter(prefix="/api/payments", tags=["payments"])

PLANS = {
    "month": {"amount": 250,  "days": 30,  "label": "Packfolio Pro — 1 месяц"},
    "year":  {"amount": 2100, "days": 365, "label": "Packfolio Pro — 1 год"},
}


class InvoiceRequest(BaseModel):
    plan: str  # "month" | "year"


@router.post("/invoice")
def create_invoice(
    body:    InvoiceRequest,
    user_id: int     = Depends(get_current_user_id),
    db:      Session = Depends(get_db),
):
    plan = PLANS.get(body.plan)
    if not plan:
        raise HTTPException(status_code=400, detail="Неизвестный тариф")
    if not BOT_TOKEN:
        raise HTTPException(status_code=503, detail="BOT_TOKEN не настроен")

    payload = f"{user_id}:{body.plan}"

    # sendInvoice отправляет платёжную карточку прямо в чат пользователя с ботом.
    # openInvoice / openTelegramLink из Mini App контекста блокируются Telegram.
    resp = httpx.post(
        f"https://api.telegram.org/bot{BOT_TOKEN}/sendInvoice",
        json={
            "chat_id":        user_id,
            "title":          "Packfolio Pro",
            "description":    plan["label"],
            "payload":        payload,
            "currency":       "XTR",
            "prices":         [{"label": "Подписка", "amount": plan["amount"]}],
            "provider_token": "",
        },
        timeout=10,
    )
    data = resp.json()
    if not data.get("ok"):
        raise HTTPException(status_code=502, detail=data.get("description", "Ошибка Telegram"))

    return {"sent": True}


@router.post("/webhook")
async def telegram_webhook(request: Request, db: Session = Depends(get_db)):
    """
    Telegram присылает сюда все апдейты бота.
    Нас интересуют pre_checkout_query и successful_payment.
    """
    update = await request.json()

    # 1. pre_checkout_query — обязательно подтвердить в течение 10 секунд
    pcq = update.get("pre_checkout_query")
    if pcq and BOT_TOKEN:
        httpx.post(
            f"https://api.telegram.org/bot{BOT_TOKEN}/answerPreCheckoutQuery",
            json={"pre_checkout_query_id": pcq["id"], "ok": True},
            timeout=8,
        )
        return {"ok": True}

    # 2. successful_payment
    msg = update.get("message", {})
    payment = msg.get("successful_payment")
    if payment:
        payload = payment.get("invoice_payload", "")
        try:
            user_id_str, plan_key = payload.split(":", 1)
            user_id = int(user_id_str)
        except ValueError:
            return {"ok": True}

        plan = PLANS.get(plan_key)
        if not plan:
            return {"ok": True}

        user = db.query(User).filter(User.id == user_id).first()
        if user:
            now = datetime.utcnow()
            # Продлеваем от текущей даты окончания, если подписка ещё активна
            base = user.pro_until if (user.pro_until and user.pro_until > now) else now
            user.is_pro    = True
            user.pro_until = base + timedelta(days=plan["days"])
            db.commit()

    return {"ok": True}
