"""
Авторизация через Telegram Web App initData.
Валидация HMAC + выдача JWT.
"""

import hashlib
import hmac
import json
import os
import time
from urllib.parse import parse_qsl

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-change-in-production")
BOT_TOKEN  = os.getenv("BOT_TOKEN",  "")
ENV        = os.getenv("ENV", "dev")

bearer_scheme = HTTPBearer(auto_error=False)


# ──────────────────────────────────────────────
# Telegram initData validation (HMAC-SHA256)
# ──────────────────────────────────────────────

def validate_telegram_init_data(init_data: str) -> dict:
    """
    Проверяет подпись initData от Telegram WebApp.
    Возвращает dict с полями пользователя (id, first_name, …).
    Бросает ValueError при невалидной подписи.
    """
    params = dict(parse_qsl(init_data, keep_blank_values=True))

    received_hash = params.pop("hash", None)
    if not received_hash:
        raise ValueError("В initData отсутствует hash")

    # Формируем data-check-string: ключи отсортированы, разделены \n
    data_check_string = "\n".join(
        f"{k}={v}" for k, v in sorted(params.items())
    )

    # Секрет = HMAC-SHA256("WebAppData", bot_token)
    secret = hmac.new(
        b"WebAppData",
        BOT_TOKEN.encode("utf-8"),
        hashlib.sha256,
    ).digest()

    computed_hash = hmac.new(
        secret,
        data_check_string.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    if not hmac.compare_digest(computed_hash, received_hash):
        raise ValueError("Неверная подпись initData")

    # Проверяем актуальность (не старше 24 ч)
    auth_date = int(params.get("auth_date", 0))
    if time.time() - auth_date > 86400:
        raise ValueError("initData устарела (> 24 ч)")

    user_json = params.get("user", "{}")
    return json.loads(user_json)


def validate_init_data_dev(init_data: str) -> dict:
    """
    Dev-режим: принимаем любой JSON в поле user=… без проверки hash.
    Используется только при ENV=dev.
    """
    params = dict(parse_qsl(init_data, keep_blank_values=True))
    user_json = params.get("user", "{}")
    if not user_json:
        # Fallback: сам init_data — это JSON пользователя
        try:
            return json.loads(init_data)
        except Exception:
            pass
    return json.loads(user_json) if user_json else {
        "id": 1,
        "first_name": "Dev",
        "last_name": "User",
        "username": "devuser",
    }


# ──────────────────────────────────────────────
# JWT
# ──────────────────────────────────────────────

def create_token(user_id: int) -> str:
    from datetime import datetime, timedelta

    payload = {
        "sub": str(user_id),
        "exp": datetime.utcnow() + timedelta(days=7),
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm="HS256")


def decode_token(token: str) -> int:
    """Декодирует JWT и возвращает telegram_id пользователя."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
        return int(payload["sub"])
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Токен истёк. Перезапустите приложение.",
        )
    except jwt.InvalidTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Невалидный токен: {e}",
        )


# ──────────────────────────────────────────────
# FastAPI dependency
# ──────────────────────────────────────────────

def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
) -> int:
    """FastAPI dependency — возвращает ID пользователя из Bearer токена.
    В dev-режиме всегда возвращает ID=1 без проверки токена.
    """
    if ENV == "dev":
        return 1  # Dev mode: фиксированный пользователь
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Отсутствует Authorization заголовок",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return decode_token(credentials.credentials)
