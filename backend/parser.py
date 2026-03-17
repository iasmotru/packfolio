"""
Парсинг документов: извлечение текста из PDF/изображений,
определение типа документа, извлечение структурированных данных.
"""

import os
import re
from datetime import datetime
from typing import Any, Dict, Optional, Tuple

ENABLE_OCR = os.getenv("ENABLE_OCR", "0") == "1"


# ──────────────────────────────────────────────
# Извлечение текста
# ──────────────────────────────────────────────

def extract_text_from_pdf(file_path: str) -> str:
    """Извлекаем текст из PDF с помощью pypdf."""
    try:
        import pypdf  # type: ignore

        reader = pypdf.PdfReader(file_path)
        parts = []
        for page in reader.pages:
            text = page.extract_text()
            if text:
                parts.append(text)
        return "\n".join(parts)
    except ImportError:
        return ""
    except Exception as e:
        print(f"[parser] PDF extract error: {e}")
        return ""


def extract_text_from_image(file_path: str) -> str:
    """OCR изображения через pytesseract (требует ENABLE_OCR=1)."""
    if not ENABLE_OCR:
        return ""
    try:
        import pytesseract  # type: ignore
        from PIL import Image  # type: ignore

        img = Image.open(file_path)
        return pytesseract.image_to_string(img, lang="eng+rus")
    except ImportError:
        return ""
    except Exception as e:
        print(f"[parser] OCR error: {e}")
        return ""


def extract_text(file_path: str, mime_type: str) -> str:
    """Определяем тип файла и извлекаем текст."""
    if not file_path or not os.path.exists(file_path):
        return ""

    if "pdf" in mime_type:
        return extract_text_from_pdf(file_path)
    elif mime_type.startswith("image/"):
        return extract_text_from_image(file_path)
    return ""


# ──────────────────────────────────────────────
# Определение типа документа
# ──────────────────────────────────────────────

# Паттерны для каждого типа (regex, case-insensitive).
# Чем больше совпадений — тем выше confidence.
DOC_PATTERNS: Dict[str, list] = {
    "PASSPORT": [
        r"\bpassport\b",
        r"\bnationality\b",
        r"\bdate of (birth|expiry)\b",
        r"\bgiven names?\b",
        r"\bsurname\b",
        r"\bplace of birth\b",
        r"[P<][A-Z]{3}",  # MRZ строка
    ],
    "FLIGHT_TICKET": [
        r"\bflight\b",
        r"\bairline\b",
        r"\bboarding pass\b",
        r"\bpnr\b",
        r"\bcheck.?in\b",
        r"\bgate\b",
        r"\b[A-Z]{2}\s*\d{3,4}\b",  # номер рейса
        r"\bairport\b",
        r"\bbaggage\b",
    ],
    "TRAIN_TICKET": [
        r"\btrain\b",
        r"\brailway\b",
        r"\bstation\b",
        r"\bplatform\b",
        r"\bdeutsche bahn\b",
        r"\b(db|sncf|eurostar|thalys|italo|trenitalia)\b",
        r"\bwagon\b",
        r"\bcoach\b.*\bseat\b",
    ],
    "BUS_TICKET": [
        r"\bbus\b",
        r"\bcoach\b",
        r"\bflixbus\b",
        r"\beurolines\b",
        r"\bbus.?station\b",
        r"\bbusterminal\b",
    ],
    "HOTEL_BOOKING": [
        r"\bhotel\b",
        r"\bcheck.?in\b",
        r"\bcheck.?out\b",
        r"\broom\b",
        r"\breservation\b",
        r"\bbooking(\.com)?\b",
        r"\bnight[s]?\b",
        r"\bguest[s]?\b",
        r"\baccommodation\b",
    ],
    "CAR_RENTAL": [
        r"\bcar.?rental\b",
        r"\brental.?car\b",
        r"\bpickup\b",
        r"\bdrop.?off\b",
        r"\brental.?agreement\b",
        r"\b(hertz|avis|europcar|sixt|budget|enterprise)\b",
        r"\bvehicle\b",
    ],
    "MEDICAL_INSURANCE": [
        r"\binsurance\b",
        r"\bpolicy\b",
        r"\bcoverage\b",
        r"\bmedical\b",
        r"\btravel.?insurance\b",
        r"\bpremium\b",
        r"\binsured\b",
        r"\bdeductible\b",
        r"\bbeneficiary\b",
    ],
}


def determine_doc_type(text: str) -> Tuple[str, float]:
    """
    Определяет тип документа по тексту.
    Возвращает (doc_type, confidence 0..1).
    """
    text_lower = text.lower()
    scores: Dict[str, float] = {}

    for doc_type, patterns in DOC_PATTERNS.items():
        matches = sum(
            1 for p in patterns if re.search(p, text_lower)
        )
        scores[doc_type] = matches / len(patterns)

    if not scores:
        return "UNKNOWN", 0.0

    best_type = max(scores, key=lambda k: scores[k])
    raw_score = scores[best_type]

    # Масштабируем: 3+ совпадений из 9 = уже что-то разумное
    confidence = min(raw_score * 2.5, 1.0)

    if confidence < 0.15:
        return "UNKNOWN", confidence

    return best_type, confidence


# ──────────────────────────────────────────────
# Утилиты для извлечения полей
# ──────────────────────────────────────────────

# Словарь месяцев: все варианты → номер (1–12)
MONTH_MAP = {
    # Английский
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4,
    "jun": 6, "jul": 7, "aug": 8,
    "sep": 9, "oct": 10, "nov": 11, "dec": 12,
    # Русский (именительный + родительный)
    "январь": 1, "февраль": 2, "март": 3, "апрель": 4,
    "май": 5, "июнь": 6, "июль": 7, "август": 8,
    "сентябрь": 9, "октябрь": 10, "ноябрь": 11, "декабрь": 12,
    "января": 1, "февраля": 2, "марта": 3, "апреля": 4,
    "мая": 5, "июня": 6, "июля": 7, "августа": 8,
    "сентября": 9, "октября": 10, "ноября": 11, "декабря": 12,
    "янв": 1, "фев": 2, "мар": 3, "апр": 4,
    "июн": 6, "июл": 7, "авг": 8,
    "сен": 9, "окт": 10, "ноя": 11, "дек": 12,
    # Немецкий
    "januar": 1, "februar": 2, "märz": 3, "mai": 5, "juni": 6,
    "juli": 7, "oktober": 10, "dezember": 12,
    "mär": 3, "okt": 10, "dez": 12,
    # Испанский
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5,
    "junio": 6, "julio": 7, "agosto": 8, "septiembre": 9,
    "octubre": 10, "noviembre": 11, "diciembre": 12,
    # Французский
    "janvier": 1, "février": 2, "mars": 3, "avril": 4,
    "juin": 6, "juillet": 7, "août": 8, "septembre": 9,
    "octobre": 10, "novembre": 11, "décembre": 12,
}

# Паттерны дат с поддержкой названий месяцев
_WORD = r"[A-Za-zА-Яа-яёЁüäöÄÖÜéàèùâêîôûç]+"
DATE_PATTERNS = [
    r"\d{4}[./\-]\d{1,2}[./\-]\d{1,2}",              # ISO: 2024-10-05
    r"\d{1,2}[./\-]\d{1,2}[./\-]\d{4}",              # dd/mm/yyyy
    r"\d{1,2}[./\-]\d{1,2}[./\-]\d{2}",              # dd/mm/yy
    rf"\d{{1,2}}\s+{_WORD}\.?\s+\d{{4}}",             # "5 August 2024", "5 августа 2024"
    rf"{_WORD}\.?\s+\d{{1,2}},?\s+\d{{4}}",           # "August 5, 2024"
]

TIME_PATTERN = r"\b(\d{1,2}:\d{2}(?::\d{2})?)\b"

# Ключевые слова для check-in/check-out (многоязычные)
_CHECKIN_KW  = r"check[\s\-]?in|arrival|заезд|прибытие|въезд|дата\s+заезда|дата\s+прибытия|ankunft|arriv[eé]e|llegada|arrivo"
_CHECKOUT_KW = r"check[\s\-]?out|departure|выезд|отъезд|дата\s+выезда|дата\s+отъезда|abfahrt|d[eé]part|salida|partenza"

# Дата-паттерн для контекстного поиска (без word boundaries)
_DATE_CTX = (
    r"(\d{4}[./\-]\d{1,2}[./\-]\d{1,2}"
    r"|\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4}"
    rf"|\d{{1,2}}\s+{_WORD}+\.?\s+\d{{4}}"
    rf"|{_WORD}+\.?\s+\d{{1,2}},?\s+\d{{4}})"
)


def normalize_date_str(s: str) -> Optional[str]:
    """Приводит любую строку с датой к формату YYYY-MM-DD."""
    if not s:
        return None
    s = s.strip()

    # Уже ISO
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})$", s)
    if m:
        return f"{m.group(1)}-{m.group(2).zfill(2)}-{m.group(3).zfill(2)}"

    # dd.mm.yyyy или dd/mm/yyyy или dd-mm-yyyy
    m = re.match(r"^(\d{1,2})[./\-](\d{1,2})[./\-](\d{4})$", s)
    if m:
        return f"{m.group(3)}-{m.group(2).zfill(2)}-{m.group(1).zfill(2)}"

    # dd.mm.yy (двузначный год)
    m = re.match(r"^(\d{1,2})[./\-](\d{1,2})[./\-](\d{2})$", s)
    if m:
        y = ("20" if int(m.group(3)) < 50 else "19") + m.group(3)
        return f"{y}-{m.group(2).zfill(2)}-{m.group(1).zfill(2)}"

    # yyyy/mm/dd (нестандарт)
    m = re.match(r"^(\d{4})[./\-](\d{1,2})[./\-](\d{1,2})$", s)
    if m:
        return f"{m.group(1)}-{m.group(2).zfill(2)}-{m.group(3).zfill(2)}"

    # "5 August 2024", "5 августа 2024", "5 août 2024"
    m = re.match(rf"^(\d{{1,2}})\s+({_WORD})\.?\s+(\d{{4}})$", s, re.IGNORECASE)
    if m:
        mon = MONTH_MAP.get(m.group(2).lower())
        if mon:
            return f"{m.group(3)}-{str(mon).zfill(2)}-{m.group(1).zfill(2)}"

    # "August 5, 2024", "août 5 2024"
    m = re.match(rf"^({_WORD})\.?\s+(\d{{1,2}}),?\s+(\d{{4}})$", s, re.IGNORECASE)
    if m:
        mon = MONTH_MAP.get(m.group(1).lower())
        if mon:
            return f"{m.group(3)}-{str(mon).zfill(2)}-{m.group(2).zfill(2)}"

    return s  # вернём как есть, если не распознали


def calc_nights(check_in: Optional[str], check_out: Optional[str]) -> Optional[int]:
    """Вычисляет количество ночей между датами заезда и выезда."""
    if not check_in or not check_out:
        return None
    try:
        from datetime import date as _date
        d1 = _date.fromisoformat(check_in)
        d2 = _date.fromisoformat(check_out)
        n = (d2 - d1).days
        return n if n > 0 else None
    except Exception:
        return None


def find_dates(text: str) -> list:
    """Ищет все даты в тексте и нормализует их к YYYY-MM-DD."""
    results = []
    for p in DATE_PATTERNS:
        results.extend(re.findall(p, text, re.IGNORECASE))
    seen: set = set()
    unique = []
    for d in results:
        norm = normalize_date_str(d)
        if norm and norm not in seen:
            seen.add(norm)
            unique.append(norm)
    return unique


def find_date_after_keyword(text: str, keyword_re: str) -> Optional[str]:
    """Ищет дату сразу после ключевого слова (в пределах 60 символов)."""
    m = re.search(
        rf"(?:{keyword_re})[^\d\n]{{0,60}}{_DATE_CTX}",
        text, re.IGNORECASE,
    )
    if m:
        return normalize_date_str(m.group(m.lastindex))
    return None


def find_times(text: str) -> list:
    return re.findall(TIME_PATTERN, text)


def first_or_none(lst: list, idx: int = 0) -> Optional[str]:
    return lst[idx] if len(lst) > idx else None


# ──────────────────────────────────────────────
# Извлечение данных по типу
# ──────────────────────────────────────────────

def extract_hotel_data(text: str) -> Dict[str, Any]:
    data: Dict[str, Any] = {}

    # Название отеля
    hotel_match = re.search(
        r"(?:hotel|resort|inn|hostel|apart(?:ment)?hotel)\s+([A-Z][^\n]{2,50})",
        text, re.IGNORECASE,
    )
    if hotel_match:
        data["hotel_name"] = hotel_match.group(1).strip()

    # Адрес
    addr_match = re.search(r"(?:address|addr|адрес)[:\s]+([^\n]{5,100})", text, re.IGNORECASE)
    if addr_match:
        data["address"] = addr_match.group(1).strip()

    # Тип номера
    room_match = re.search(r"(?:room type|room category|room|номер|тип номера)[:\s]+([^\n]{2,60})", text, re.IGNORECASE)
    if room_match:
        data["room_type"] = room_match.group(1).strip()

    # Гости
    guests_match = re.search(r"(\d+)\s+(?:guest|adult|person|гост|чел)", text, re.IGNORECASE)
    if guests_match:
        data["guests"] = int(guests_match.group(1))

    # Ключевой поиск дат заезда/выезда
    check_in  = find_date_after_keyword(text, _CHECKIN_KW)
    check_out = find_date_after_keyword(text, _CHECKOUT_KW)

    # Fallback: первые две даты в тексте
    if not check_in or not check_out:
        dates = find_dates(text)
        if not check_in:
            check_in = first_or_none(dates, 0)
        if not check_out:
            check_out = first_or_none(dates, 1)

    if check_in:
        data["check_in"] = check_in
    if check_out:
        data["check_out"] = check_out

    # Количество ночей: сначала явно из текста, иначе вычисляем
    nights_match = re.search(r"(\d+)\s+(?:night|ноч)", text, re.IGNORECASE)
    if nights_match:
        data["nights"] = int(nights_match.group(1))
    elif check_in and check_out:
        n = calc_nights(check_in, check_out)
        if n is not None:
            data["nights"] = n

    return data


def extract_ticket_data(text: str, doc_type: str) -> Dict[str, Any]:
    data: Dict[str, Any] = {}
    times = find_times(text)

    # PNR / booking ref
    pnr_match = re.search(r"\b([A-Z0-9]{6})\b", text)
    if pnr_match:
        data["pnr"] = pnr_match.group(1)

    # Места/сиденья
    seat_match = re.search(r"(?:seat|место)[:\s]+([A-Z]?\d+[A-Z]?)", text, re.IGNORECASE)
    if seat_match:
        data["seat"] = seat_match.group(1)

    # Пассажиры
    pax_match = re.search(r"(\d+)\s+(?:passenger|adult|traveller|пассажир)", text, re.IGNORECASE)
    if pax_match:
        data["passengers"] = int(pax_match.group(1))

    # Багаж
    bag_match = re.search(r"(?:baggage|luggage|багаж)[:\s]+([^\n]{2,60})", text, re.IGNORECASE)
    if bag_match:
        data["baggage"] = bag_match.group(1).strip()

    # Дата отправления с ключевыми словами
    dep_kw = r"departure|departs?|отправление|отправл|вылет|from date"
    arr_kw = r"arrival|arrives?|прибытие|прибыт|прилёт|to date"
    dep_date = find_date_after_keyword(text, dep_kw)
    arr_date = find_date_after_keyword(text, arr_kw)

    # Fallback к первым двум датам
    if not dep_date or not arr_date:
        dates = find_dates(text)
        if not dep_date:
            dep_date = first_or_none(dates, 0)
        if not arr_date:
            arr_date = first_or_none(dates, 1)

    if dep_date:
        data["departure_date"] = dep_date
    if arr_date:
        data["arrival_date"] = arr_date

    if times:
        data["departure_time"] = first_or_none(times, 0)
        data["arrival_time"]   = first_or_none(times, 1)

    if doc_type == "FLIGHT_TICKET":
        flight_match = re.search(r"\b([A-Z]{2}\s*\d{3,4})\b", text)
        if flight_match:
            data["flight_number"] = flight_match.group(1).replace(" ", "")
        dep_airport = re.search(r"(?:from|departure|отправление)[:\s]+([A-Z]{3})", text, re.IGNORECASE)
        arr_airport = re.search(r"(?:to|arrival|прибытие)[:\s]+([A-Z]{3})", text, re.IGNORECASE)
        if dep_airport:
            data["departure_place"] = dep_airport.group(1)
        if arr_airport:
            data["arrival_place"] = arr_airport.group(1)

    elif doc_type in ("TRAIN_TICKET", "BUS_TICKET"):
        dep_match = re.search(r"(?:from|departure|abfahrt|откуда|отправление)[:\s]+([^\n]{2,50})", text, re.IGNORECASE)
        arr_match = re.search(r"(?:to|arrival|ankunft|куда|прибытие)[:\s]+([^\n]{2,50})", text, re.IGNORECASE)
        if dep_match:
            data["departure_place"] = dep_match.group(1).strip()
        if arr_match:
            data["arrival_place"] = arr_match.group(1).strip()

    return data


def extract_car_rental_data(text: str) -> Dict[str, Any]:
    data: Dict[str, Any] = {}
    times = find_times(text)

    # Гос. номер
    plate_match = re.search(r"\b([A-ZÄÖÜ]{1,3}[-\s]\w{2,4}[-\s]?\w{0,4})\b", text)
    if plate_match:
        data["plate"] = plate_match.group(1).strip()

    # Марка/модель
    car_match = re.search(r"(?:vehicle|car|model|марка|автомобиль)[:\s]+([^\n]{2,50})", text, re.IGNORECASE)
    if car_match:
        data["car_model"] = car_match.group(1).strip()

    pickup_kw  = r"pick[\s\-]?up|rental start|забрать|выдача"
    dropoff_kw = r"drop[\s\-]?off|return|rental end|вернуть|возврат"
    pickup_date  = find_date_after_keyword(text, pickup_kw)
    dropoff_date = find_date_after_keyword(text, dropoff_kw)

    if not pickup_date or not dropoff_date:
        dates = find_dates(text)
        if not pickup_date:
            pickup_date = first_or_none(dates, 0)
        if not dropoff_date:
            dropoff_date = first_or_none(dates, 1)

    if pickup_date:
        data["pickup_date"] = pickup_date
    if dropoff_date:
        data["dropoff_date"] = dropoff_date
    if times:
        data["pickup_time"]  = first_or_none(times, 0)
        data["dropoff_time"] = first_or_none(times, 1)

    return data


def extract_insurance_data(text: str) -> Dict[str, Any]:
    data: Dict[str, Any] = {}

    # Сумма покрытия
    amount_match = re.search(
        r"(?:coverage|sum insured|sum|amount|покрытие|страховая сумма)[:\s]+([€$£]\s*[\d,. ]+|\d[\d,. ]+[€$£])",
        text, re.IGNORECASE,
    )
    if amount_match:
        data["coverage_amount"] = amount_match.group(1).strip()

    # Дней
    days_match = re.search(r"(\d+)\s+(?:day|дн)", text, re.IGNORECASE)
    if days_match:
        data["days"] = int(days_match.group(1))

    start_kw = r"valid from|start date|начало|начало действия|period from"
    end_kw   = r"valid (?:until|to)|end date|конец|конец действия|period to|expiry"
    start = find_date_after_keyword(text, start_kw)
    end   = find_date_after_keyword(text, end_kw)

    if not start or not end:
        dates = find_dates(text)
        if not start:
            start = first_or_none(dates, 0)
        if not end:
            end = first_or_none(dates, 1)

    if start:
        data["start_date"] = start
    if end:
        data["end_date"] = end

    # Вычислить дни, если не нашли явно
    if not data.get("days") and start and end:
        n = calc_nights(start, end)
        if n is not None:
            data["days"] = n + 1  # страховка включает оба дня

    return data


def extract_passport_data(text: str) -> Dict[str, Any]:
    data: Dict[str, Any] = {}

    # Имя / фамилия из MRZ или явных полей
    name_match = re.search(r"(?:surname|last name)[:\s]+([A-Z ]+)", text, re.IGNORECASE)
    if name_match:
        data["surname"] = name_match.group(1).strip()

    given_match = re.search(r"given names?[:\s]+([A-Z ]+)", text, re.IGNORECASE)
    if given_match:
        data["given_names"] = given_match.group(1).strip()

    nationality_match = re.search(r"nationality[:\s]+([A-Za-z ]+)", text, re.IGNORECASE)
    if nationality_match:
        data["nationality"] = nationality_match.group(1).strip()

    dates = find_dates(text)
    if dates:
        data["date_of_birth"] = first_or_none(dates, 0)
        data["expiry_date"]   = first_or_none(dates, 1)

    return data


# ──────────────────────────────────────────────
# Публичный API
# ──────────────────────────────────────────────

def extract_widget_data(text: str, doc_type: str) -> Dict[str, Any]:
    """Извлекает структурированные поля в зависимости от типа документа."""
    if doc_type == "HOTEL_BOOKING":
        return extract_hotel_data(text)
    elif doc_type in ("FLIGHT_TICKET", "TRAIN_TICKET", "BUS_TICKET"):
        return extract_ticket_data(text, doc_type)
    elif doc_type == "CAR_RENTAL":
        return extract_car_rental_data(text)
    elif doc_type == "MEDICAL_INSURANCE":
        return extract_insurance_data(text)
    elif doc_type == "PASSPORT":
        return extract_passport_data(text)
    return {}


def parse_document(file_path: str, mime_type: str) -> Tuple[str, float, Dict[str, Any]]:
    """
    Основной метод: парсит файл, определяет тип, извлекает данные.
    Возвращает (doc_type, confidence, extracted_data).
    """
    text = extract_text(file_path, mime_type)

    if not text.strip():
        return "UNKNOWN", 0.0, {}

    doc_type, confidence = determine_doc_type(text)
    extracted = extract_widget_data(text, doc_type)

    return doc_type, confidence, extracted
