"""
Генерация Apple Wallet (.pkpass) файлов.
Если сертификаты не настроены — возвращаем описательную ошибку.
"""

import base64
import hashlib
import io
import json
import os
import zipfile
from typing import Dict, Any

PASS_TYPE_ID      = os.getenv("PASS_TYPE_ID",      "")
TEAM_ID           = os.getenv("TEAM_ID",           "")
ORGANIZATION_NAME = os.getenv("ORGANIZATION_NAME", "Packfolio")
CERT_P12_BASE64   = os.getenv("CERT_P12_BASE64",   "")
CERT_P12_PASSWORD = os.getenv("CERT_P12_PASSWORD", "")
WWDR_CERT_BASE64  = os.getenv("WWDR_CERT_BASE64",  "")
APP_BASE_URL      = os.getenv("APP_BASE_URL",      "http://localhost:8000")


def is_wallet_configured() -> bool:
    """Проверяет, заданы ли все необходимые переменные окружения."""
    return bool(PASS_TYPE_ID and TEAM_ID and CERT_P12_BASE64 and WWDR_CERT_BASE64)


# ──────────────────────────────────────────────
# Построение pass.json
# ──────────────────────────────────────────────

def _build_pass_json(doc_id: int, doc_type: str, widget_data: Dict[str, Any]) -> dict:
    """Формирует структуру pass.json для passkit."""

    base: dict = {
        "formatVersion": 1,
        "passTypeIdentifier": PASS_TYPE_ID,
        "serialNumber": f"packfolio-{doc_id}",
        "teamIdentifier": TEAM_ID,
        "organizationName": ORGANIZATION_NAME,
        "description": "Packfolio — Travel Document",
        "backgroundColor": "rgb(255, 255, 255)",
        "foregroundColor": "rgb(20, 20, 20)",
        "labelColor": "rgb(110, 110, 110)",
        "barcode": {
            "message": f"{APP_BASE_URL}/#doc/{doc_id}",
            "format": "PKBarcodeFormatQR",
            "messageEncoding": "iso-8859-1",
            "altText": f"packfolio-{doc_id}",
        },
    }

    if doc_type == "HOTEL_BOOKING":
        base["generic"] = {
            "primaryFields": [
                {
                    "key": "hotel",
                    "label": "Отель",
                    "value": widget_data.get("hotel_name") or "—",
                }
            ],
            "secondaryFields": [
                {"key": "checkin",  "label": "Заезд",   "value": widget_data.get("check_in")  or "—"},
                {"key": "checkout", "label": "Выезд",   "value": widget_data.get("check_out") or "—"},
            ],
            "auxiliaryFields": [
                {"key": "nights", "label": "Ночей", "value": str(widget_data.get("nights", "—"))},
                {"key": "room",   "label": "Номер", "value": widget_data.get("room_type") or "—"},
            ],
        }

    elif doc_type == "FLIGHT_TICKET":
        base["boardingPass"] = {
            "transitType": "PKTransitTypeAir",
            "primaryFields": [
                {"key": "from", "label": "Откуда", "value": widget_data.get("departure_place") or "—"},
                {"key": "to",   "label": "Куда",   "value": widget_data.get("arrival_place")   or "—"},
            ],
            "secondaryFields": [
                {"key": "flight", "label": "Рейс",   "value": widget_data.get("flight_number")  or "—"},
                {"key": "date",   "label": "Дата",   "value": widget_data.get("departure_date") or "—"},
                {"key": "seat",   "label": "Место",  "value": widget_data.get("seat")           or "—"},
            ],
        }

    elif doc_type == "TRAIN_TICKET":
        base["boardingPass"] = {
            "transitType": "PKTransitTypeTrain",
            "primaryFields": [
                {"key": "from", "label": "Откуда", "value": widget_data.get("departure_place") or "—"},
                {"key": "to",   "label": "Куда",   "value": widget_data.get("arrival_place")   or "—"},
            ],
            "secondaryFields": [
                {"key": "date", "label": "Дата",  "value": widget_data.get("departure_date") or "—"},
                {"key": "seat", "label": "Место", "value": widget_data.get("seat")           or "—"},
            ],
        }

    elif doc_type == "CAR_RENTAL":
        base["generic"] = {
            "primaryFields": [
                {"key": "car", "label": "Автомобиль", "value": widget_data.get("car_model") or "—"}
            ],
            "secondaryFields": [
                {"key": "pickup",  "label": "Получение", "value": widget_data.get("pickup_date")  or "—"},
                {"key": "dropoff", "label": "Возврат",   "value": widget_data.get("dropoff_date") or "—"},
            ],
        }

    elif doc_type == "MEDICAL_INSURANCE":
        base["generic"] = {
            "primaryFields": [
                {"key": "coverage", "label": "Покрытие", "value": widget_data.get("coverage_amount") or "—"}
            ],
            "secondaryFields": [
                {"key": "start", "label": "С",  "value": widget_data.get("start_date") or "—"},
                {"key": "end",   "label": "По", "value": widget_data.get("end_date")   or "—"},
            ],
        }

    else:
        base["generic"] = {
            "primaryFields": [
                {"key": "type", "label": "Тип", "value": doc_type.replace("_", " ").title()}
            ],
            "secondaryFields": [],
        }

    return base


# ──────────────────────────────────────────────
# Подпись PKCS#7 (CMS Detached)
# ──────────────────────────────────────────────

def _sign_manifest(manifest_bytes: bytes) -> bytes:
    """
    Подписываем manifest.json сертификатом Apple Pass.
    Требует пакет `cryptography`.
    """
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.serialization import pkcs7
    from cryptography.hazmat.primitives.serialization.pkcs12 import (
        load_key_and_certificates,
    )
    from cryptography.x509 import load_der_x509_certificate, load_pem_x509_certificate

    # Загружаем P12 (сертификат разработчика Pass Type)
    p12_data = base64.b64decode(CERT_P12_BASE64)
    password  = CERT_P12_PASSWORD.encode("utf-8") if CERT_P12_PASSWORD else None
    private_key, certificate, _ = load_key_and_certificates(
        p12_data, password, default_backend()
    )

    # Загружаем WWDR (Apple Worldwide Developer Relations Certificate)
    wwdr_raw = base64.b64decode(WWDR_CERT_BASE64)
    try:
        wwdr_cert = load_pem_x509_certificate(wwdr_raw, default_backend())
    except Exception:
        wwdr_cert = load_der_x509_certificate(wwdr_raw, default_backend())

    # CMS Detached подпись
    signature = (
        pkcs7.PKCS7SignatureBuilder()
        .set_data(manifest_bytes)
        .add_signer(certificate, private_key, hashes.SHA256())
        .add_certificate(wwdr_cert)
        .sign(serialization.Encoding.DER, [pkcs7.PKCS7Options.Detached])
    )
    return signature


# ──────────────────────────────────────────────
# Публичный API
# ──────────────────────────────────────────────

def generate_pkpass(doc_id: int, doc_type: str, widget_data: Dict[str, Any]) -> bytes:
    """
    Генерирует .pkpass файл в виде байт-строки (ZIP-архив).
    Бросает ValueError если Wallet не сконфигурирован или подпись не удалась.
    """
    if not is_wallet_configured():
        raise ValueError("Wallet не настроен: задайте PASS_TYPE_ID, TEAM_ID, CERT_P12_BASE64, WWDR_CERT_BASE64")

    pass_json_obj   = _build_pass_json(doc_id, doc_type, widget_data)
    pass_json_bytes = json.dumps(pass_json_obj, ensure_ascii=False, indent=2).encode("utf-8")

    # manifest.json: SHA1 каждого файла в архиве
    manifest = {
        "pass.json": hashlib.sha1(pass_json_bytes).hexdigest(),
    }
    manifest_bytes = json.dumps(manifest).encode("utf-8")

    try:
        signature_bytes = _sign_manifest(manifest_bytes)
    except ImportError:
        raise ValueError(
            "Библиотека cryptography не установлена. "
            "Добавьте cryptography в requirements.txt."
        )
    except Exception as exc:
        raise ValueError(f"Ошибка подписи pkpass: {exc}")

    # Собираем ZIP-архив
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("pass.json",     pass_json_bytes)
        zf.writestr("manifest.json", manifest_bytes)
        zf.writestr("signature",     signature_bytes)

    return buf.getvalue()
