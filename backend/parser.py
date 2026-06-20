"""
Парсинг документов: извлечение текста из PDF/изображений,
определение типа документа, извлечение структурированных данных.
"""

import os
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

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


def extract_pdf_pages(file_path: str) -> List[str]:
    """Возвращает список текстов — по одному на страницу PDF."""
    try:
        import pypdf  # type: ignore
        reader = pypdf.PdfReader(file_path)
        pages = []
        for page in reader.pages:
            text = page.extract_text()
            if text and text.strip():
                # Удаляем символы Unicode PUA (U+E000–U+F8FF), которые pypdf
                # вставляет вместо лигатур/кернинга, разрывая токены
                text = re.sub(r'[-]', '', text)
                pages.append(text)
        return pages
    except Exception:
        return []


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
        r"\bboarding.?pass\b",
        r"\bpnr\b",
        r"\bcheck.?in\b",
        r"\bgate\b",
        r"\b[A-Z]{2}\s*\d{3,4}\b",  # номер рейса
        r"\bairport\b",
        r"\bbaggage\b",
        r"\be.?ticket\b",
        r"\bboarding\b",
        r"\b(pegasus|turkish|ryanair|easyjet|wizz|flydubai|aeroflot)\b",
        r"\bdeparture\b",
        r"\barrival\b",
        # Русские паттерны
        r"\bномер\s+брони\b",
        r"\bвылет\b",
        r"\bприлёт\b",
        r"\bрейс\b",
        r"\bполёт\b|\bполет\b",
        r"\bаэропорт\b",
        r"\bбагаж\b",
    ],
    "TRAIN_TICKET": [
        r"\btrain\b",
        r"\brailway\b",
        r"\bstation\b",
        r"\bplatform\b",
        r"\bdeutsche bahn\b",
        r"\b(db|sncf|eurostar|thalys|italo|trenitalia|omio)\b",
        r"\bwagon\b",
        r"\bcoach\b.*\bseat\b",
        # Русские паттерны (РЖД / ФПК)
        r"\bвагон\b",
        r"\bкупе\b",
        r"\bплацкарт\b",
        r"\bфпк\b",
        r"\bпоезд\b",
        r"\bперевозчик\b",
        r"контрольный\s+купон",
        r"\bнумерация\s+вагонов\b",
        r"\bпосадка\s+в\s+поезд\b",
    ],
    "BUS_TICKET": [
        r"\bbus\b",
        r"\bcoach\b",
        r"\bflixbus\b",
        r"\beurolines\b",
        r"\bbus.?station\b",
        r"\bbusterminal\b",
        r"\bbus\s*no\b",
        r"\bseat\s*:\s*\d+",
        r"\bdepart\s*:",
        r"\b(rede.?expressos|national\s+express|ouibus|blablabus)\b",
        r"\bticket\s+no\b",
        r"\bpassenger\s+information\b",
        r"\bestimated\s+time\s+of\s+arrival\b",
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
    r"\d{1,2}[A-Za-z]{3}\d{2,4}",                     # "26AUG26" / "26AUG2026" авиа-формат
]

TIME_PATTERN = r"\b(\d{1,2}:\d{2}(?::\d{2})?)\b"

# Ключевые слова для check-in/check-out (многоязычные)
_CHECKIN_KW  = r"check[\s\-]?in|arrival|заезд|прибытие|въезд|дата\s+заезда|дата\s+прибытия|ankunft|arriv[eé]e|llegada|arrivo"
_CHECKOUT_KW = r"check[\s\-]?out|departure|выезд|отъезд|дата\s+выезда|дата\s+отъезда|abfahrt|d[eé]part|salida|partenza"

# Дата-паттерн для контекстного поиска (без word boundaries)
_DATE_CTX = (
    r"(\d{4}[./\-]\d{1,2}[./\-]\d{1,2}"
    r"|\d{1,2}[./\-]\d{1,2}[./\-]\d{2,4}"
    rf"|\d{{1,2}}\s+{_WORD}\.?\s+\d{{4}}"
    rf"|{_WORD}\.?\s+\d{{1,2}},?\s+\d{{4}}"
    r"|\d{1,2}[A-Za-z]{3}\d{2,4})"
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

    # "26AUG26" / "26AUG2026" авиа-формат
    m = re.match(r"^(\d{1,2})([A-Za-z]{3})(\d{2,4})$", s)
    if m:
        mon = MONTH_MAP.get(m.group(2).lower())
        if mon:
            y = m.group(3)
            year = ("20" + y if len(y) == 2 else y)
            return f"{year}-{str(mon).zfill(2)}-{m.group(1).zfill(2)}"

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


def find_time_after_keyword(text: str, keyword_re: str) -> Optional[str]:
    """Ищет время (HH:MM) сразу после ключевого слова (в пределах 120 символов)."""
    m = re.search(
        rf"(?:{keyword_re})[^\n]{{0,120}}{TIME_PATTERN}",
        text, re.IGNORECASE,
    )
    return m.group(m.lastindex) if m else None


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


def _extract_airline_itinerary(lines: list) -> Optional[Dict]:
    """
    Парсит маршрутную строку вида:
      CITY [(AIRPORT NAME)] FLIGHT_NO CL DATE HHMM STATUS ...
      arrival date and time: DATE HHMM
      ARRIVAL_CITY [(ARRIVAL_AIRPORT)]
    Поддерживает форматы Pobeda/S7 где аэропорты записаны как "MOSCOW (VNUKOVO A)".
    """
    for i, line in enumerate(lines):
        # Расширенный паттерн: CITY с необязательным (AIRPORT NAME) перед кодом рейса
        m = re.search(
            r'^([A-Z][A-Z ]{1,30}?)\s*(?:\(([^)]*)\))?\s*([A-Z]{2})\s*(\d{3,4})\s+[A-Z]\s+'
            r'(\d{1,2}[A-Za-z]{3}\d{2,4})\s+(\d{4})\b',
            line.strip(),
        )
        if not m:
            continue

        dep_city_raw = m.group(1).strip()
        dep_airport_name = m.group(2).strip() if m.group(2) else None
        flight_no = m.group(3) + m.group(4)
        dep_date = normalize_date_str(m.group(5))
        dep_time_raw = m.group(6)
        dep_time = f"{dep_time_raw[:2]}:{dep_time_raw[2:]}"

        # IATA вылета: из названия аэропорта в скобках (на той же строке)
        dep_iata = _airport_name_to_iata(dep_airport_name) if dep_airport_name else None

        result: Dict[str, Any] = {
            'flight_no': flight_no,
            'dep_city': dep_city_raw.title(),
            'dep_date': dep_date,
            'dep_time': dep_time,
            'dep_iata': dep_iata,
            'dep_airport_raw': dep_airport_name,  # сырое название из скобок как фоллбэк
            'arr_date': None,
            'arr_time': None,
            'arr_city': None,
            'arr_iata': None,
            'arr_airport_raw': None,
        }

        arr_city_candidate: Optional[str] = None  # временный кандидат города прилёта
        arr_airport_raw_candidate: Optional[str] = None

        for j in range(i + 1, min(len(lines), i + 10)):
            ln = lines[j].strip()

            # Вариант Pobeda: строка "(AIRPORT_NAME) дата и время прибытия..."
            # "(VNUKOVO A) arrival date and time: 25AUG26 1205" — это аэропорт вылета
            if not result['dep_airport_raw']:
                dep_ap_line = re.match(r'^\(([^)]+)\)\s*(?:дата|arrival|прибытия)', ln, re.IGNORECASE)
                if dep_ap_line:
                    raw = dep_ap_line.group(1).strip()
                    result['dep_airport_raw'] = raw
                    result['dep_iata'] = _airport_name_to_iata(raw)

            # Arrival datetime: "arrival date and time: DATE HHMM" / "прибытия: DATE HHMM"
            if not result['arr_date']:
                am = re.search(
                    r'(?:arrival\s+date\s+and\s+time|прибытия)[:\s/]+(\d{1,2}[A-Za-z]{3}\d{2,4})\s+(\d{4})',
                    ln, re.IGNORECASE,
                )
                if am:
                    result['arr_date'] = normalize_date_str(am.group(1))
                    result['arr_time'] = f"{am.group(2)[:2]}:{am.group(2)[2:]}"

            # Arrival city/airport — три варианта:
            # A: "ISTANBUL (ISTANBUL AIRPORT)" всё на одной строке
            # B: "ISTANBUL\n(ISTANBUL AIRPORT)" — город и аэропорт на разных строках
            # C: просто "ISTANBUL" без аэропорта
            if not result['arr_city']:
                city_ap_m = re.match(r'^([A-Z][A-Z ]{2,30})\s*\(([^)]+)\)\s*$', ln)
                if city_ap_m:
                    # Вариант A
                    raw = city_ap_m.group(2).strip()
                    result['arr_city'] = city_ap_m.group(1).strip().title()
                    result['arr_airport_raw'] = raw
                    result['arr_iata'] = _airport_name_to_iata(raw)
                elif re.match(r'^[A-Z][A-Z ]+$', ln) and 3 < len(ln) < 40:
                    # Потенциальный город — сохраняем как кандидат
                    arr_city_candidate = ln.strip().title()
                elif arr_city_candidate:
                    # Предыдущая строка была городом — проверяем, не "(AIRPORT)" ли это
                    ap_only_m = re.match(r'^\(([^)]+)\)\s*$', ln)
                    if ap_only_m:
                        # Вариант B
                        raw = ap_only_m.group(1).strip()
                        result['arr_city'] = arr_city_candidate
                        result['arr_airport_raw'] = raw
                        result['arr_iata'] = _airport_name_to_iata(raw)
                    else:
                        # Вариант C — город без аэропорта
                        result['arr_city'] = arr_city_candidate

        # Если IATA всё ещё не найдены — пробуем строку расчёта тарифа
        if not result['dep_iata'] or not result['arr_iata']:
            fare_iata = _extract_fare_calc_iata(lines)
            if fare_iata:
                fc_dep, fc_arr = fare_iata
                if not result['dep_iata']:
                    result['dep_iata'] = fc_dep
                if not result['arr_iata']:
                    result['arr_iata'] = fc_arr

        return result

    return None


def _extract_flight_legs(lines: list, pnr: str = None) -> list:
    """
    Splits a multi-segment flight ticket into individual leg dicts.
    Detects segment headers like "Мадрид, Испания - Белград, Сербия".
    Returns a list of dicts (one per leg), or [] if fewer than 2 segments found.
    """
    HEADER_RE = re.compile(
        r'^([А-ЯЁA-Z][^\d\n,]{1,30}),\s*\S+\s*[-—]\s*([А-ЯЁA-Z][^\d\n,]{1,30}),?',
    )
    FLIGHT_RE = re.compile(
        r'(?:номер\s+рейса|flight\s+(?:number|no\.?))[:\s]+([A-Z]{2})[\s\-]*(\d{3,4})',
        re.IGNORECASE,
    )
    DEP_RE = re.compile(r'(?:вылет|departure)[:\s]+(\d{1,2}:\d{2})', re.IGNORECASE)
    ARR_RE = re.compile(r'(?:прилет|прилёт|arrival)[:\s]+(\d{1,2}:\d{2})', re.IGNORECASE)
    IATA_RE = re.compile(r'\(([A-Z]{3})\)')

    # Find all header line indices and their city pairs
    header_indices = []
    for i, line in enumerate(lines):
        m = HEADER_RE.match(line.strip())
        if m:
            dep_city = m.group(1).strip()
            arr_city = m.group(2).strip()
            header_indices.append((i, dep_city, arr_city))

    if len(header_indices) < 2:
        return []

    # Build segments: each segment spans from one header to the next
    result = []
    for seg_idx, (start_i, dep_city, arr_city) in enumerate(header_indices):
        end_i = header_indices[seg_idx + 1][0] if seg_idx + 1 < len(header_indices) else len(lines)
        seg_lines = lines[start_i:end_i]
        seg_text = '\n'.join(seg_lines)

        leg: Dict[str, Any] = {}
        if pnr:
            leg['pnr'] = pnr

        # Flight number
        fm = FLIGHT_RE.search(seg_text)
        if fm:
            leg['flight_number'] = fm.group(1).upper() + fm.group(2)

        # Departure time + date
        for j, ln in enumerate(seg_lines):
            dm = DEP_RE.search(ln)
            if dm:
                leg['departure_time'] = dm.group(1)
                # Date is on the next line
                if j + 1 < len(seg_lines):
                    next_ln = seg_lines[j + 1]
                    for p in DATE_PATTERNS:
                        date_m = re.search(p, next_ln, re.IGNORECASE)
                        if date_m:
                            leg['departure_date'] = normalize_date_str(date_m.group(0))
                            break
                break

        # Arrival time + date
        for j, ln in enumerate(seg_lines):
            am = ARR_RE.search(ln)
            if am:
                leg['arrival_time'] = am.group(1)
                if j + 1 < len(seg_lines):
                    next_ln = seg_lines[j + 1]
                    for p in DATE_PATTERNS:
                        date_m = re.search(p, next_ln, re.IGNORECASE)
                        if date_m:
                            leg['arrival_date'] = normalize_date_str(date_m.group(0))
                            break
                break

        # IATA codes: first = departure, second = arrival
        iata_codes = IATA_RE.findall(seg_text)
        if len(iata_codes) >= 1:
            leg['departure_place'] = f"{dep_city} ({iata_codes[0]})"
        if len(iata_codes) >= 2:
            leg['arrival_place'] = f"{arr_city} ({iata_codes[1]})"

        result.append(leg)

    # Deduplicate by IATA codes — removes English duplicate sections
    # Key: extract IATA codes from place strings like "Мадрид (MAD)" → "MAD"
    def _iata_key(place: str) -> str:
        m = re.search(r'\(([A-Z]{3})\)', place)
        return m.group(1) if m else place

    seen: set = set()
    deduped = []
    for leg in result:
        dep_key = _iata_key(leg.get('departure_place', ''))
        arr_key = _iata_key(leg.get('arrival_place', ''))
        key = (dep_key, arr_key)
        if key not in seen:
            seen.add(key)
            deduped.append(leg)

    return deduped


# ──────────────────────────────────────────────
# Маппинг названий аэропортов → IATA-коды
# (для форматов, где нет явных IATA в скобках, e.g. Pobeda)
# ──────────────────────────────────────────────

AIRPORT_NAME_TO_IATA: Dict[str, str] = {
    # Москва
    "VNUKOVO": "VKO", "VNUKOVO A": "VKO", "VNUKOVO B": "VKO", "VNUKOVO C": "VKO",
    "DOMODEDOVO": "DME",
    "SHEREMETYEVO": "SVO", "SHEREMETYEVO B": "SVO", "SHEREMETYEVO C": "SVO",
    "ZHUKOVSKY": "ZIA", "ZHUKOVSKIY": "ZIA",
    # Санкт-Петербург
    "PULKOVO": "LED",
    # Турция
    "ISTANBUL AIRPORT": "IST", "ISTANBUL NEW AIRPORT": "IST", "ISTANBUL": "IST",
    "SABIHA GOKCEN": "SAW", "SABIHA GOKCHEN": "SAW",
    "ANKARA ESENBOGA": "ESB", "ESENBOGA": "ESB",
    "ANTALYA": "AYT",
    "BODRUM MILAS": "BJV", "MILAS BODRUM": "BJV",
    "IZMIR ADNAN MENDERES": "ADB", "ADNAN MENDERES": "ADB",
    "TRABZON": "TZX",
    "DALAMAN": "DLM",
    # Германия
    "FRANKFURT": "FRA", "FRANKFURT MAIN": "FRA", "FRANKFURT AM MAIN": "FRA",
    "MUNICH": "MUC", "MÜNCHEN": "MUC", "MUNICH INTERNATIONAL": "MUC",
    "BERLIN BRANDENBURG": "BER", "BERLIN": "BER", "BER": "BER",
    "HAMBURG": "HAM",
    "DUSSELDORF": "DUS", "DÜSSELDORF": "DUS",
    "COLOGNE BONN": "CGN",
    # Великобритания
    "HEATHROW": "LHR", "LONDON HEATHROW": "LHR",
    "GATWICK": "LGW", "LONDON GATWICK": "LGW",
    "STANSTED": "STN", "LONDON STANSTED": "STN",
    "LUTON": "LTN", "LONDON LUTON": "LTN",
    "LONDON CITY": "LCY",
    # ОАЭ
    "DUBAI": "DXB", "DUBAI INTERNATIONAL": "DXB",
    "ABU DHABI": "AUH",
    # Европа
    "PARIS CDG": "CDG", "CHARLES DE GAULLE": "CDG", "ROISSY": "CDG",
    "PARIS ORLY": "ORY", "ORLY": "ORY",
    "AMSTERDAM": "AMS", "SCHIPHOL": "AMS", "AMSTERDAM SCHIPHOL": "AMS",
    "ROME FIUMICINO": "FCO", "FIUMICINO": "FCO", "LEONARDO DA VINCI": "FCO",
    "ROME CIAMPINO": "CIA", "CIAMPINO": "CIA",
    "MILAN MALPENSA": "MXP", "MALPENSA": "MXP",
    "MILAN LINATE": "LIN", "LINATE": "LIN",
    "MADRID BARAJAS": "MAD", "BARAJAS": "MAD", "ADOLFO SUAREZ": "MAD",
    "BARCELONA": "BCN", "EL PRAT": "BCN",
    "ATHENS": "ATH", "ELEFTHERIOS VENIZELOS": "ATH",
    "PRAGUE": "PRG", "VACLAV HAVEL": "PRG",
    "VIENNA": "VIE", "SCHWECHAT": "VIE",
    "ZURICH": "ZRH",
    "GENEVA": "GVA",
    "BRUSSELS": "BRU", "ZAVENTEM": "BRU",
    "LISBON": "LIS", "HUMBERTO DELGADO": "LIS",
    "OSLO": "OSL", "OSLO GARDERMOEN": "OSL", "GARDERMOEN": "OSL",
    "STOCKHOLM ARLANDA": "ARN", "ARLANDA": "ARN",
    "HELSINKI": "HEL", "VANTAA": "HEL",
    "COPENHAGEN": "CPH", "KASTRUP": "CPH",
    "WARSAW": "WAW", "CHOPIN": "WAW",
    "BUDAPEST": "BUD", "LISZT FERENC": "BUD",
    "BUCHAREST": "OTP", "BUCHAREST OTOPENI": "OTP", "HENRI COANDA": "OTP",
    "SOFIA": "SOF",
    "BELGRADE": "BEG", "NIKOLA TESLA": "BEG",
    "ZAGREB": "ZAG",
    # СНГ
    "KYIV BORYSPIL": "KBP", "BORYSPIL": "KBP",
    "MINSK": "MSQ", "MINSK NATIONAL": "MSQ",
    "TBILISI": "TBS",
    "YEREVAN ZVARTNOTS": "EVN", "ZVARTNOTS": "EVN",
    "BAKU HEYDAR ALIYEV": "GYD", "HEYDAR ALIYEV": "GYD",
    "ALMATY": "ALA",
    "TASHKENT": "TAS", "TASHKENT INTERNATIONAL": "TAS",
    # Азия / прочие
    "BEIJING CAPITAL": "PEK", "CAPITAL": "PEK",
    "SHANGHAI PUDONG": "PVG", "PUDONG": "PVG",
    "HONG KONG": "HKG",
    "SINGAPORE CHANGI": "SIN", "CHANGI": "SIN",
    "TOKYO NARITA": "NRT", "NARITA": "NRT",
    "TOKYO HANEDA": "HND", "HANEDA": "HND",
    "BANGKOK SUVARNABHUMI": "BKK", "SUVARNABHUMI": "BKK",
    "DELHI": "DEL", "INDIRA GANDHI": "DEL",
    "MUMBAI": "BOM", "CHHATRAPATI SHIVAJI": "BOM",
    "CAIRO": "CAI",
    "TEL AVIV": "TLV", "BEN GURION": "TLV",
    "AMMAN": "AMM", "QUEEN ALIA": "AMM",
    "RIYADH": "RUH", "KING KHALID": "RUH",
    "JEDDAH": "JED", "KING ABDULAZIZ": "JED",
    "CASABLANCA": "CMN", "MOHAMMED V": "CMN",
    "NEW YORK JFK": "JFK",
    "NEW YORK NEWARK": "EWR", "NEWARK": "EWR",
    "LOS ANGELES": "LAX",
    "MIAMI": "MIA",
    "TORONTO PEARSON": "YYZ", "PEARSON": "YYZ",
}


def _airport_name_to_iata(name: str) -> Optional[str]:
    """Ищет IATA-код по названию аэропорта (нечувствительно к регистру)."""
    if not name:
        return None
    key = name.upper().strip()
    # Точное совпадение
    if key in AIRPORT_NAME_TO_IATA:
        return AIRPORT_NAME_TO_IATA[key]
    # Частичное: ищем ключ-подстроку в name или name в ключе
    for k, v in AIRPORT_NAME_TO_IATA.items():
        if k in key or key in k:
            return v
    return None


def _extract_fare_calc_iata(lines: list) -> Optional[Tuple[str, str]]:
    """
    Извлекает IATA-коды вылета/прилёта из строки расчёта тарифа BSP вида:
      MOW DP IST179.36NUC179.36END
    Возвращает (dep_iata, arr_iata) или None.
    """
    # Паттерн: CITY_CODE AIRLINE_CODE CITY_CODEfares...
    FARE_CALC_RE = re.compile(r'\b([A-Z]{3})\s+[A-Z]{2}\s+([A-Z]{3})[\d.]')
    for line in lines:
        m = FARE_CALC_RE.search(line)
        if m:
            return m.group(1), m.group(2)
    return None


def _looks_like_city(s: str) -> bool:
    """Проверяет, похоже ли значение на название города."""
    return bool(s and len(s) < 50 and re.match(r'^[A-Za-zА-Яа-яёЁÄÖÜäöüéàèùâêîôûç\s\-]+$', s.strip()))


def _extract_iata_segments(lines: list) -> list:
    """
    Находит аэропортные сегменты по IATA-кодам вида (XXX).
    Возвращает список dict: {iata, city, date, time} для каждого уникального кода.
    """
    SKIP_TIME = re.compile(
        r'аэропорт|airport|прибыть|arrive|рекоменд|recommend|check.?in|выписки|issued',
        re.IGNORECASE,
    )
    ROUTE_LINE = re.compile(
        r'\([A-Z]{3}\).*\([A-Z]{3}\)',  # несколько IATA на одной строке — строка-маршрут
    )
    seen: set = set()
    segments = []

    for i, line in enumerate(lines):
        # Пропускаем строки-маршруты (содержат несколько IATA-кодов)
        if ROUTE_LINE.search(line):
            continue

        m = re.search(r'\(([A-Z]{3})\)', line)
        if not m:
            continue
        iata = m.group(1)
        if iata in seen:
            continue
        seen.add(iata)

        # Название города: сначала предыдущие строки, потом текст до IATA
        before = line[:m.start()].strip()
        before = re.sub(
            r'^(?:departure|arrival|departs?|arrives?|from|to|откуда|куда|вылет|прилёт)'
            r'[\s:]+', '', before, flags=re.IGNORECASE,
        ).strip()
        city = ''
        # Ищем заголовок сегмента вида "Город, Страна - Город2, Страна2" в ±5 строках
        for k in range(max(0, i - 5), i):
            seg_m = re.match(
                r'^([А-ЯЁA-Z][^\d\n]{2,40}?),\s*[А-ЯЁA-Za-z]+\s*(?:-|—)',
                lines[k], re.IGNORECASE,
            )
            if seg_m:
                city = seg_m.group(1).strip()
                break
        if not city:
            if i > 0 and _looks_like_city(lines[i - 1]):
                city = lines[i - 1]
        if not city and before and _looks_like_city(before):
            city = before
        if not city and before:
            city = before
        if not city and i > 1 and _looks_like_city(lines[i - 2]):
            city = lines[i - 2]

        # Время: сначала та же строка, потом ±3 строки (пропускаем «рекомендуемое» время)
        time_val = None
        check_lines = [line] + [lines[j] for j in range(max(0, i - 3), min(len(lines), i + 4)) if j != i]
        for cline in check_lines:
            if SKIP_TIME.search(cline):
                continue
            tm = re.search(r'\b(\d{1,2}:\d{2})\b', cline)
            if tm:
                time_val = tm.group(1)
                break

        # Дата: ищем в ±3 строках (пропускаем дату выписки билета)
        date_val = None
        for j in range(max(0, i - 3), min(len(lines), i + 4)):
            cline = lines[j]
            if SKIP_TIME.search(cline):
                continue
            for p in DATE_PATTERNS:
                dm = re.search(p, cline, re.IGNORECASE)
                if dm:
                    date_val = normalize_date_str(dm.group(0))
                    if date_val:
                        break
            if date_val:
                break

        segments.append({'iata': iata, 'city': city, 'date': date_val, 'time': time_val})

    return segments


def _extract_rzd_data(text: str) -> Optional[Dict[str, Any]]:
    """
    Парсит билет РЖД (ФПК).
    Ключевой источник данных — машиночитаемая строка в конце билета вида:
      063ВА 07.06.2026 19:15 01К 104 САНКТ-ПЕТЕРБУРГ-ГЛАВН. - МОСКВА ВК ВОСТОЧНЫЙ ПН4523078552 МАРТИНОВИЧ-МД 070702
    """
    # Признак РЖД-билета
    if not re.search(r"(?:фпк|контрольный\s+купон|нумерация\s+вагонов|посадка\s+в\s+поезд)", text, re.IGNORECASE):
        return None

    data: Dict[str, Any] = {}

    # ── Машиночитаемая строка ──────────────────────────────────────────────
    # Формат: ПОЕЗД[БУКВЫ] ДАТА ВРЕМЯ ВАГОН[КЛАСС] МЕСТО ОТКУДА - КУДА ПН/ПАСПОРТ ПАССАЖИР ДАТАРОЖД
    barcode_m = re.search(
        r'(\d{3})[А-ЯЁA-Z]{0,3}\s+'              # номер поезда
        r'(\d{2}\.\d{2}\.\d{4})\s+'              # дата отправления
        r'(\d{2}:\d{2})\s+'                       # время отправления
        r'(\d{2})[А-ЯЁA-Z]?\s+'                  # вагон
        r'(\d{1,3})\s+'                           # место
        r'([А-ЯЁ][А-ЯЁ\.\-]+(?:\s+[А-ЯЁ][А-ЯЁ\.\-]+)*)'  # откуда (без пробелов внутри)
        r'\s+-\s+'                                # разделитель " - "
        r'([А-ЯЁ][А-ЯЁ\.\-\s]+?)'               # куда (может быть с пробелами)
        r'(?=\s+(?:ПН|[А-ЯЁ]{2})\d)',            # lookahead: паспорт
        text,
    )
    if barcode_m:
        data['flight_number'] = barcode_m.group(1)  # номер поезда → flight_number (общее поле)
        data['departure_date'] = normalize_date_str(barcode_m.group(2))
        data['departure_time'] = barcode_m.group(3)
        data['wagon'] = barcode_m.group(4)
        data['seat'] = barcode_m.group(5)
        dep_raw = barcode_m.group(6).strip()
        arr_raw = barcode_m.group(7).strip()
        # Приводим к нормальному регистру: "САНКТ-ПЕТЕРБУРГ-ГЛАВН." → "Санкт-Петербург-Главн."
        data['departure_place'] = re.sub(
            r'([А-ЯЁA-Z])([А-ЯЁA-Za-zа-яё]+)',
            lambda m: m.group(1) + m.group(2).lower(),
            dep_raw,
        )
        data['arrival_place'] = re.sub(
            r'([А-ЯЁA-Z])([А-ЯЁA-Za-zа-яё]+)',
            lambda m: m.group(1) + m.group(2).lower(),
            arr_raw,
        )
    else:
        # Fallback: берём поезд/вагон/место из структурированного блока PDF
        # (дублированные строки: "063\n063\n01\n01\n104\n104")
        pv_block = re.search(
            r'ПОЕЗД\s+ВАГОН\s+МЕСТО\s+'
            r'(\d+)\s+\1\s+(\d+)\s+\2\s+(\d+)',
            text,
        )
        if pv_block:
            data['flight_number'] = pv_block.group(1)
            data['wagon']        = pv_block.group(2)
            data['seat']         = pv_block.group(3)

        # Станции из дублированных строк заголовков (буква + остаток на следующей строке)
        # "С\nСанкт-Петербург-Главн.\nМосковский Вокзал"
        dep_city_m = re.search(
            r'(?:С\s+С|Санкт)(?:анкт)?[\-\s]Петербург[^\n]*\n([^\n]+)',
            text,
        )
        if dep_city_m:
            data['departure_place'] = 'Санкт-Петербург-Главн.'

        arr_city_m = re.search(
            r'(?:М\s+М|М)(?:осква)\s+Вк?\s+Восточный',
            text, re.IGNORECASE,
        )
        if arr_city_m:
            data['arrival_place'] = 'Москва Вк Восточный'

    # ── Время и дата прибытия ─────────────────────────────────────────────
    # В тексте два блока «время\nвремя\nдата\nдень_недели»: первый — отправление, второй — прибытие
    time_blocks = list(re.finditer(
        r'(\d{2}:\d{2})\n\d{2}:\d{2}\n'
        r'(\d{2}\.\d{2}\.\d{4})',
        text,
    ))
    if len(time_blocks) >= 2:
        # Первый блок — отправление (уже взяли из barcode), второй — прибытие
        arr_tb = time_blocks[-1]
        data['arrival_time'] = arr_tb.group(1)
        data['arrival_date'] = normalize_date_str(arr_tb.group(2))
    elif len(time_blocks) == 1 and not data.get('departure_time'):
        # Единственный блок — отправление
        data['departure_time'] = time_blocks[0].group(1)
        data['departure_date'] = normalize_date_str(time_blocks[0].group(2))
    else:
        # Fallback: ищем время прибытия по ключевому слову
        arr_kw = re.search(r'Прибытие[^0-9]{0,80}(\d{2}:\d{2})', text, re.IGNORECASE)
        if arr_kw:
            data['arrival_time'] = arr_kw.group(1)
        arr_date_kw = find_date_after_keyword(text, r'прибытие|arrival')
        if arr_date_kw:
            data['arrival_date'] = arr_date_kw

    # ── Пассажир: "МАРТИНОВИЧ МАРИЯ\nДЕНИСОВНА" ─────────────────────────
    # Ищем строку в формате "ФАМИЛИЯ ИМЯ\nОТЧЕСТВО" после номера паспорта
    pax_m = re.search(
        r'(?:ПАСПОРТ|PASSPORT)\s*(?:РФ\s*)?\d[\d\s]{7,}\n'
        r'\d{2}\.\d{2}\.\d{4}\s+[A-Z]{2,3}\s+[МЖF]\n'
        r'([А-ЯЁ][А-ЯЁ\-]+\s+[А-ЯЁ][А-ЯЁ\-]+)\n'
        r'([А-ЯЁ][А-ЯЁ\-]+)',
        text,
    )
    if pax_m:
        first_line = pax_m.group(1).strip()   # "МАРТИНОВИЧ МАРИЯ"
        patronym   = pax_m.group(2).strip()   # "ДЕНИСОВНА"
        full_name  = f"{first_line} {patronym}"
        # Title case: "МАРТИНОВИЧ МАРИЯ ДЕНИСОВНА" → "Мартинович Мария Денисовна"
        data['passengers'] = ' '.join(
            w[0].upper() + w[1:].lower() for w in full_name.split()
        )
    else:
        # Fallback из машиночитаемой строки: МАРТИНОВИЧ-МД → неполное имя
        short_pax = re.search(r'([А-ЯЁ]{3,})-([А-ЯЁ]{2,3})\s+\d{6}\b', text)
        if short_pax:
            data['passengers'] = short_pax.group(1).capitalize()

    # ── Тип вагона / тариф ────────────────────────────────────────────────
    wagon_type_m = re.search(r'\b(Купе|Плацкарт|СВ|Люкс|Сидячий)\b', text, re.IGNORECASE)
    if wagon_type_m:
        data['tariff'] = wagon_type_m.group(1).capitalize()

    return data if data else None


def extract_ticket_data(text: str, doc_type: str) -> Dict[str, Any]:
    # Нормализуем неразрывные пробелы и мягкие дефисы
    text = text.replace('\xa0', ' ').replace('\xad', '')

    # ── РЖД/ФПК — специализированный парсер (высокий приоритет) ──────────
    if doc_type == "TRAIN_TICKET":
        rzd = _extract_rzd_data(text)
        if rzd:
            return rzd

    data: Dict[str, Any] = {}

    # ── PNR: сначала ищем по ключевому слову, потом fallback ──────────────
    pnr_kw = re.search(
        r"(?:pnr|booking\s*ref(?:erence)?|reservation\s*(?:code|number)|"
        r"confirmation\s*(?:code|number)?|ref(?:erence)?\.?\s*(?:n[o°.]?|number|code)?|"
        r"номер\s+брони(?:\s+\S+){0,3}|бронь\b)"
        r"[:\s#\-]+([A-Z0-9]{5,8})\b",
        text, re.IGNORECASE,
    )
    if pnr_kw:
        data["pnr"] = pnr_kw.group(1).upper()
    else:
        # Fallback 1: табличный формат "LABEL\n...\n : VALUE" — ищем строку ": CODE"
        for m in re.finditer(r'\n\s*:\s*([A-Z0-9]{5,8})\b', text):
            c = m.group(1)
            if re.search(r'[A-Z]', c) and re.search(r'\d', c) and not re.match(r'^[A-Z]{2}\d{3,4}$', c):
                data["pnr"] = c
                break

        # Fallback 2: любой смешанный буквенно-цифровой код в тексте
        if not data.get("pnr"):
            for m in re.finditer(r"\b([A-Z0-9]{5,8})\b", text):
                c = m.group(1)
                if re.search(r'[A-Z]', c) and re.search(r'\d', c) and not re.match(r"^[A-Z]{2}\d{3,4}$", c):
                    data["pnr"] = c
                    break

    # ── Места/сиденья ──────────────────────────────────────────────────────
    seat_match = re.search(r"(?:seat|место)[:\s]+([A-Z]?\d+[A-Z]?)", text, re.IGNORECASE)
    if seat_match:
        data["seat"] = seat_match.group(1)

    # ── Пассажиры ──────────────────────────────────────────────────────────
    pax_match = re.search(r"(\d+)\s+(?:passenger|adult|traveller|пассажир)", text, re.IGNORECASE)
    if pax_match:
        data["passengers"] = int(pax_match.group(1))

    # ── Багаж ──────────────────────────────────────────────────────────────
    # Сначала ищем конкретный формат: "1 x 20 кг", "1PC", "20KG", "23 kg"
    bag_match = re.search(
        r"\b(\d+\s*(?:x\s*\d+\s*)?(?:кг|kg|pc|pieces?|bag)(?:\s*\d+\s*(?:кг|kg))?)\b",
        text, re.IGNORECASE,
    )
    if not bag_match:
        # Fallback: ключевое слово + значение до конца строки (но не слишком длинное)
        bag_match = re.search(
            r"(?:^|\s)(?:багаж|baggage|luggage)\b[:\s]+([^\n]{2,40}?)(?:\s*[,;]|\s*$)",
            text, re.IGNORECASE | re.MULTILINE,
        )
    if bag_match:
        data["baggage"] = bag_match.group(1).strip()

    # ── Специфика FLIGHT_TICKET ────────────────────────────────────────────
    if doc_type == "FLIGHT_TICKET":
        # Номер рейса: "PC1099" / "PC 1099" / "JU-571"
        # Сначала по ключевому слову (точнее)
        flight_kw = re.search(
            r'(?:номер\s+рейса|flight\s+number|flight)[:\s]+([A-Z]{2})[\s\-]*(\d{3,4})\b',
            text, re.IGNORECASE,
        )
        if flight_kw:
            data["flight_number"] = flight_kw.group(1).upper() + flight_kw.group(2)
        else:
            flight_match = re.search(r"\b([A-Z]{2})[\s\-]*(\d{3,4})\b", text)
            if flight_match:
                data["flight_number"] = flight_match.group(1) + flight_match.group(2)

        # Класс / тариф
        tariff_match = re.search(r"(?:class|класс|тариф)[:\s]+([^\n\d]{2,30})", text, re.IGNORECASE)
        if tariff_match:
            val = tariff_match.group(1).strip()
            if val:
                data["tariff"] = val

        lines = [ln.strip() for ln in text.split('\n')]

        # Подход 1: маршрутная строка вида "CITY [(AIRPORT)] FLIGHT CL DATE HHMM"
        itinerary = _extract_airline_itinerary(lines)
        if itinerary:
            if not data.get('flight_number'):
                data['flight_number'] = itinerary['flight_no']
            if itinerary['dep_city']:
                iata = itinerary.get('dep_iata') or ''
                airport_raw = itinerary.get('dep_airport_raw') or ''
                suffix = iata or airport_raw   # IATA приоритетнее, иначе сырое название
                data['departure_place'] = f"{itinerary['dep_city']} ({suffix})" if suffix else itinerary['dep_city']
            if itinerary['dep_date']:
                data['departure_date'] = itinerary['dep_date']
            if itinerary['dep_time']:
                data['departure_time'] = itinerary['dep_time']
            if itinerary['arr_city']:
                iata = itinerary.get('arr_iata') or ''
                airport_raw = itinerary.get('arr_airport_raw') or ''
                suffix = iata or airport_raw
                data['arrival_place'] = f"{itinerary['arr_city']} ({suffix})" if suffix else itinerary['arr_city']
            if itinerary['arr_date']:
                data['arrival_date'] = itinerary['arr_date']
            if itinerary['arr_time']:
                data['arrival_time'] = itinerary['arr_time']

        # Подход 2: IATA-коды вида "(SAW)" / "(MAD)" (Pegasus, Ryanair и т.п.)
        if not data.get('departure_date') or not data.get('arrival_date'):
            segments = _extract_iata_segments(lines)

            if len(segments) >= 1:
                seg = segments[0]
                if seg['city'] and not data.get('departure_place'):
                    data["departure_place"] = f"{seg['city']} ({seg['iata']})"
                if seg['date'] and not data.get('departure_date'):
                    data["departure_date"] = seg['date']
                if seg['time'] and not data.get('departure_time'):
                    data["departure_time"] = seg['time']

            if len(segments) >= 2:
                seg = segments[1]
                if seg['city'] and not data.get('arrival_place'):
                    data["arrival_place"] = f"{seg['city']} ({seg['iata']})"
                if seg['date'] and not data.get('arrival_date'):
                    data["arrival_date"] = seg['date']
                if seg['time'] and not data.get('arrival_time'):
                    data["arrival_time"] = seg['time']

        # Fallback дат/времён через ключевые слова (для EN-билетов без IATA)
        if not data.get("departure_date") or not data.get("arrival_date"):
            dep_kw = r"departure|departs?|отправление|отправл|вылет|from\s*date|\bstd\b"
            arr_kw = r"arrival|arrives?|прибытие|прибыт|прилёт|to\s*date|\bsta\b"
            if not data.get("departure_date"):
                data["departure_date"] = find_date_after_keyword(text, dep_kw)
            if not data.get("arrival_date"):
                data["arrival_date"] = find_date_after_keyword(text, arr_kw)
            if not data.get("departure_date") or not data.get("arrival_date"):
                dates = find_dates(text)
                if not data.get("departure_date"):
                    data["departure_date"] = first_or_none(dates, 0)
                if not data.get("arrival_date"):
                    data["arrival_date"] = first_or_none(dates, 1)
            if not data.get("departure_time") or not data.get("arrival_time"):
                dep_kw = r"departure|departs?|отправление|отправл|вылет|from\s*date|\bstd\b"
                arr_kw = r"arrival|arrives?|прибытие|прибыт|прилёт|to\s*date|\bsta\b"
                if not data.get("departure_time"):
                    data["departure_time"] = find_time_after_keyword(text, dep_kw)
                if not data.get("arrival_time"):
                    data["arrival_time"] = find_time_after_keyword(text, arr_kw)
            if not data.get("departure_time") or not data.get("arrival_time"):
                times = find_times(text)
                if not data.get("departure_time"):
                    data["departure_time"] = first_or_none(times, 0)
                if not data.get("arrival_time"):
                    data["arrival_time"] = first_or_none(times, 1)

        # Fallback аэропортов через ключевые слова
        if not data.get("departure_place"):
            dep_place = _extract_airport(text, r"from|departure|departs?|origin|откуда|вылет из")
            if dep_place:
                data["departure_place"] = dep_place
        if not data.get("arrival_place"):
            arr_place = _extract_airport(text, r"to|arrival|arrives?|destination|куда|прилёт в")
            if arr_place:
                data["arrival_place"] = arr_place

        # ── Wizz Air / посадочный талон ────────────────────────────────────
        if re.search(r"wizzair|wizz\s+air|посадочный\s+талон|boarding\s+pass", text, re.IGNORECASE):
            dep_dest = re.search(r"DEP\s*/\s*DEST\s+([A-Z]{3})\s*[-–]\s*([A-Z]{3})", text)
            dep_iata = dep_dest.group(1) if dep_dest else None
            arr_iata = dep_dest.group(2) if dep_dest else None

            terminal_m = re.search(r"TERMINAL\s+\S+\s*\n([A-Z]{4,})\b", text)
            dep_city = terminal_m.group(1).title() if terminal_m else None

            terminal_pos = text.upper().find("TERMINAL")
            _city_src = text[terminal_pos:] if terminal_pos >= 0 else text
            cities = re.findall(r"\n([A-Z]{4,}(?:[ ][A-Z]{2,})*)(?=\n|$)", _city_src)
            arr_city = None
            if dep_city:
                for c in cities:
                    if c.title() != dep_city:
                        arr_city = c.title()
                        break

            if dep_city and dep_iata:
                data["departure_place"] = f"{dep_city} ({dep_iata})"
            elif dep_city:
                data["departure_place"] = dep_city
            elif dep_iata:
                data["departure_place"] = dep_iata

            if arr_city and arr_iata:
                data["arrival_place"] = f"{arr_city} ({arr_iata})"
            elif arr_city:
                data["arrival_place"] = arr_city
            elif arr_iata:
                data["arrival_place"] = arr_iata

            vylеt_t = re.search(r"(?:Вылет|Departure(?:\s+time)?)\s*\n\s*(\d{2}:\d{2})", text, re.IGNORECASE)
            if vylеt_t:
                data["departure_time"] = vylеt_t.group(1)

            prib_t = re.search(r"(?:Прибытие|Arrival)\s*:?\s*\n\s*(\d{2}:\d{2})", text, re.IGNORECASE)
            if prib_t:
                data["arrival_time"] = prib_t.group(1)

            date_slash = re.search(r"(\d{1,2})\s*/\s*([A-Za-z]{3})\s*/\s*(\d{4})", text)
            if date_slash:
                mon = MONTH_MAP.get(date_slash.group(2).lower()[:3])
                if mon:
                    data["departure_date"] = f"{date_slash.group(3)}-{str(mon).zfill(2)}-{date_slash.group(1).zfill(2)}"
                    data["arrival_date"]   = data["departure_date"]

            if data.get("departure_date"):
                if not data.get("arrival_date"):
                    data["arrival_date"] = data["departure_date"]
                arr_t = data.get("arrival_time", "")
                dep_t = data.get("departure_time", "")
                if arr_t and dep_t and arr_t < dep_t and data["arrival_date"] == data["departure_date"]:
                    try:
                        from datetime import date as _date, timedelta
                        d = _date.fromisoformat(data["departure_date"])
                        data["arrival_date"] = str(d + timedelta(days=1))
                    except Exception:
                        pass

            pax_m = re.search(r"(?:Имя|Name)\s*\n?\s*([A-Z][A-Z]+\s+[A-Z][A-Z]+)(?:\s|$)", text)
            if pax_m and not data.get("passengers"):
                data["passengers"] = pax_m.group(1).strip().title()

            dims_m = re.search(r"(\d+\s*[xхх×]\s*\d+\s*[xхх×]\s*\d+\s*(?:cm|см))", text, re.IGNORECASE)
            kg_m   = re.search(r"(?:Max|<|до)\s*(\d+\s*(?:kg|кг))", text, re.IGNORECASE)
            if dims_m or kg_m:
                parts = []
                if kg_m:   parts.append(kg_m.group(1).strip())
                if dims_m: parts.append(dims_m.group(1).strip())
                data["baggage"] = ", ".join(parts)

        # ── Авиасейлс / Маршрутная квитанция ──────────────────────────────
        if re.search(r"маршрутная\s+квитанция|авиасейлс", text, re.IGNORECASE):
            # Пассажир: "ПАССАЖИР / ДОКУМЕНТ\nFAMILY NAME / doc"
            pax_av = re.search(
                r"ПАССАЖИР\s*/\s*ДОКУМЕНТ\s*\n([A-Z][A-Z]+\s+[A-Z][A-Z]+)",
                text,
            )
            if pax_av and not data.get("passengers"):
                data["passengers"] = pax_av.group(1).strip().title()

            # Рейс: строка вида "W46019" (IATA prefix = буква+буква_или_цифра + 3-5 цифр)
            flight_av = re.search(r"^([A-Z][A-Z0-9]\d{3,5})$", text, re.MULTILINE)
            if flight_av:
                data["flight_number"] = flight_av.group(1)

            # Времена в формате HHMM (4 цифры на отдельной строке)
            # Структура: IATA(CODE)\nHHMM\nDD mon YYYY\nFLIGHT_NO\n...\nHHMM\nDD mon YYYY
            hhmm_dates = re.findall(
                r"^(\d{4})\n\d{2}\s+[а-яёА-ЯЁ]+\s+\d{4}$",
                text, re.MULTILINE,
            )
            if len(hhmm_dates) >= 2:
                dep_t = hhmm_dates[0]
                arr_t = hhmm_dates[-1]
                data["departure_time"] = f"{dep_t[:2]}:{dep_t[2:]}"
                data["arrival_time"]   = f"{arr_t[:2]}:{arr_t[2:]}"

        # ── Biletix формат ─────────────────────────────────────────────────
        if re.search(r"biletix|номер\s+электронного\s+билета|e-ticket\s+number", text, re.IGNORECASE):
            bil_pax = re.search(
                r"([A-Z]{2,}\s+[A-Z]{2,})\s+[A-Z0-9]{6,}\s+(\d{6,12})\s+\S+",
                text,
            )
            if bil_pax:
                data["passengers"] = bil_pax.group(1).strip().title()
                data["pnr"] = bil_pax.group(2)

            bil_route = re.search(
                r"^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*→\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)",
                text, re.MULTILINE,
            )
            if bil_route:
                dep_city = bil_route.group(1).strip()
                arr_city = bil_route.group(2).strip()
                dep_iata_m = re.search(rf"{dep_city}[^\n]*\n[^\n]+\s+([A-Z]{{3}})\b", text)
                arr_iata_m = re.search(rf"{arr_city}[^\n]*\n[^\n]+\s+([A-Z]{{3}})\b", text)
                dep_iata = dep_iata_m.group(1) if dep_iata_m else ""
                arr_iata = arr_iata_m.group(1) if arr_iata_m else ""
                data["departure_place"] = f"{dep_city} ({dep_iata})" if dep_iata else dep_city
                data["arrival_place"]   = f"{arr_city} ({arr_iata})" if arr_iata else arr_city

            bil_dt = re.findall(r"(\d{2}:\d{2})\n(\d{2}\s+[A-Z]{3}\s+\d{4})", text)
            if len(bil_dt) >= 1:
                data["departure_time"] = bil_dt[0][0]
                data["departure_date"] = normalize_date_str(bil_dt[0][1])
            if len(bil_dt) >= 2:
                data["arrival_time"] = bil_dt[1][0]
                data["arrival_date"] = normalize_date_str(bil_dt[1][1])

            bil_cls = re.search(r"Class:\s*(Economy|Business|First(?:\s+Class)?)", text, re.IGNORECASE)
            if bil_cls:
                data["tariff"] = bil_cls.group(1)

            bil_bag = re.search(r"Baggage\s+allowance:\s*([^\n]+)", text, re.IGNORECASE)
            if bil_bag:
                val = bil_bag.group(1).strip()
                if val:
                    data["baggage"] = val

        # ── City.Travel / Ryanair русский формат ───────────────────────────
        if re.search(r"city\.travel|номер\s+авиакомпании\s*/\s*pnr", text, re.IGNORECASE):
            ct_pnr = re.search(
                r"(?:номер\s+авиакомпании|авиакомпании)\s*/\s*PNR\s*\n\s*([A-Z0-9]{5,8})",
                text, re.IGNORECASE,
            )
            if ct_pnr:
                data["pnr"] = ct_pnr.group(1)

            route_m = re.search(r"(?:[A-Z]{2}|[A-Z]\d)[\s\-]\d{3,4}\s+([A-Z]{3})\s+([A-Z]{3})", text)
            if route_m:
                data["departure_place"] = route_m.group(1)
                data["arrival_place"]   = route_m.group(2)

            _COUNTRIES = (
                r"Испания|Италия|Германия|Франция|Португалия|Греция|Турция|"
                r"Великобритания|Нидерланды|Австрия|Швейцария|Польша|Венгрия|Чехия|"
                r"Швеция|Дания|Норвегия|Финляндия|Сербия|Хорватия|Болгария|Румыния|"
                r"Россия|Украина|Беларусь|Грузия|Армения|Казахстан|Азербайджан|"
                r"США|Канада|Япония|Китай|Австралия|ОАЭ|Израиль|Таиланд|Сингапур|"
                r"Индия|Египет|Марокко|Кипр|Мальта|Ирландия|Бельгия|Люксембург"
            )
            city_pairs = re.findall(
                rf"([А-Яа-яёЁ][А-Яа-яёЁ\-]+(?:[ \-][А-Яа-яёЁ\-]+)?),[ \t]*(?:{_COUNTRIES})",
                text,
            )
            if len(city_pairs) >= 1 and data.get("departure_place"):
                data["departure_place"] = f"{city_pairs[0].strip()} ({data['departure_place']})"
            if len(city_pairs) >= 2 and data.get("arrival_place"):
                data["arrival_place"] = f"{city_pairs[1].strip()} ({data['arrival_place']})"

            ru_dt = re.findall(
                r"(\d{2}:\d{2})\s+(\d{1,2})\s+(января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря)\s+(\d{4})",
                text, re.IGNORECASE,
            )
            if len(ru_dt) >= 1:
                t, d, mon_s, y = ru_dt[0]
                mon = MONTH_MAP.get(mon_s.lower())
                if mon:
                    data["departure_time"] = t
                    data["departure_date"] = f"{y}-{str(mon).zfill(2)}-{d.zfill(2)}"
            if len(ru_dt) >= 2:
                t, d, mon_s, y = ru_dt[1]
                mon = MONTH_MAP.get(mon_s.lower())
                if mon:
                    data["arrival_time"] = t
                    data["arrival_date"] = f"{y}-{str(mon).zfill(2)}-{d.zfill(2)}"

            ct_tariff = re.search(r"(Эконом|Бизнес|Первый)\s*/\s*(?:Economy|Business|First)", text, re.IGNORECASE)
            if ct_tariff:
                data["tariff"] = ct_tariff.group(1)

            ct_pax = re.search(r"([A-Z][a-z]+\s+[A-Z][a-z]+)\s+\d{2}\.\d{2}\.\d{4}", text)
            if ct_pax:
                data["passengers"] = ct_pax.group(1).strip()

            ct_bag = re.search(r'(?:Услуга\s+[«"\']?)?Багаж\s+(\d+\s*кг)', text, re.IGNORECASE)
            if ct_bag:
                data["baggage"] = ct_bag.group(1).strip()
            elif re.search(r"Багаж не включен", text, re.IGNORECASE):
                data["baggage"] = "не включён"

        # ── Aviakassa (русский формат) ──────────────────────────────────────
        if re.search(r"aviakassa|данные\s+брони|рейс\s+вылет", text, re.IGNORECASE):
            dan_bron = re.search(
                r"данные\s+брони[^\n]*\n\d{8,}\s+(\d{5,12})\b", text, re.IGNORECASE,
            )
            if dan_bron:
                data["pnr"] = dan_bron.group(1)

            ru_route = re.search(
                r"^([А-Яа-яёЁ][А-Яа-яёЁ\- ]+?)\s*→\s*([А-Яа-яёЁ][А-Яа-яёЁ\- ]+?)\s*$",
                text, re.MULTILINE,
            )
            if ru_route:
                data["departure_place"] = ru_route.group(1).strip()
                data["arrival_place"]   = ru_route.group(2).strip()

            ft = re.search(
                r"[A-Z]{2}[\-\s]*\d{3,4}\s+(\d{2}:\d{2})\s*\n[^\d\n]*\n(\d{1,2}[./]\d{1,2}[./]\d{4})"
                r"\s*\n(\d{2}:\d{2})\s*\n[^\d\n]*\n(\d{1,2}[./]\d{1,2}[./]\d{4})",
                text,
            )
            if ft:
                data["departure_time"] = ft.group(1)
                data["departure_date"] = normalize_date_str(ft.group(2))
                data["arrival_time"]   = ft.group(3)
                data["arrival_date"]   = normalize_date_str(ft.group(4))

            ru_tariff = re.search(r"Класс\s+(Эконом|Бизнес|Первый(?:\s+класс)?)", text, re.IGNORECASE)
            if ru_tariff:
                data["tariff"] = ru_tariff.group(1).strip()

            ru_bag = re.search(
                r"Ручная\s+кладь\s+до\s+(\d+\s*кг)[,\s]*(?:\n\s*)?([^\n,]+(?:[×xх]\d+){2}[^\n]*)?",
                text, re.IGNORECASE,
            )
            if ru_bag:
                parts = ["до " + ru_bag.group(1).strip()]
                if ru_bag.group(2):
                    parts.append(ru_bag.group(2).strip())
                data["baggage"] = ", ".join(parts)

            ru_pax = re.search(
                r"(?:Пассажир[^\n]*\n)([A-ZА-ЯЁ][A-ZА-ЯЁ]+\s+[A-ZА-ЯЁ][A-ZА-ЯЁ]+)\s+[A-Z0-9]{5,}",
                text,
            )
            if ru_pax:
                data["passengers"] = ru_pax.group(1).strip().title()

    # ── Специфика TRAIN_TICKET / BUS_TICKET ───────────────────────────────
    else:
        # ── Omio: кошелёк/скриншот Apple Wallet ────────────────────────
        if _is_omio(text):
            omio = _extract_omio_data(text)
            data.update({k: v for k, v in omio.items() if v is not None})
            return data

        dep_kw = r"departure|departs?|отправление|отправл|вылет|from\s*date|\bstd\b"
        arr_kw = r"arrival|arrives?|прибытие|прибыт|прилёт|to\s*date|\bsta\b"
        dep_date = find_date_after_keyword(text, dep_kw)
        arr_date = find_date_after_keyword(text, arr_kw)
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

        dep_time = find_time_after_keyword(text, dep_kw)
        arr_time = find_time_after_keyword(text, arr_kw)
        if not dep_time or not arr_time:
            times = find_times(text)
            if not dep_time:
                dep_time = first_or_none(times, 0)
            if not arr_time:
                arr_time = first_or_none(times, 1)
        if dep_time:
            data["departure_time"] = dep_time
        if arr_time:
            data["arrival_time"] = arr_time

        if doc_type in ("TRAIN_TICKET", "BUS_TICKET"):
            dep_match = re.search(
                r"(?:from|departure|abfahrt|откуда|отправление)[:\s]+([^\n]{2,50})",
                text, re.IGNORECASE,
            )
            arr_match = re.search(
                r"(?:to|arrival|ankunft|куда|прибытие)[:\s]+([^\n]{2,50})",
                text, re.IGNORECASE,
            )
            if dep_match:
                data["departure_place"] = dep_match.group(1).strip()
            if arr_match:
                data["arrival_place"] = arr_match.group(1).strip()

    return data


def _extract_airport(text: str, keyword_re: str) -> Optional[str]:
    """
    Извлекает аэропорт/город из строки, содержащей ключевое слово.
    Поддерживает форматы:
      - "Istanbul Sabiha Gokcen (SAW)"  → "Istanbul Sabiha Gokcen (SAW)"
      - "SAW Istanbul"                  → "Istanbul (SAW)"
      - keyword: SAW                    → "SAW"
    """
    for line in text.split('\n'):
        if not re.search(keyword_re, line, re.IGNORECASE):
            continue

        # Формат "City... (IATA)" — город начинается с заглавной буквы
        m = re.search(
            r'([A-Z][A-Za-z]+(?:\s+[A-Za-z]+){0,4})\s*\(\s*([A-Z]{3})\s*\)',
            line,
        )
        if m:
            return f"{m.group(1).strip()} ({m.group(2)})"

        # Формат "IATA City"
        m = re.search(r'\b([A-Z]{3})\s+([A-Z][A-Za-z]+(?:\s+[A-Za-z]+){0,3})', line)
        if m:
            return f"{m.group(2).strip()} ({m.group(1)})"

        # Fallback: просто 3-буквенный код на строке
        m = re.search(r'\b([A-Z]{3})\b', line)
        if m:
            return m.group(1)

    return None


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


def _parse_dmy_date(raw: str) -> str:
    """DD-MM-YYYY или DD/MM/YYYY → YYYY-MM-DD"""
    m = re.match(r'(\d{2})[-/](\d{2})[-/](\d{4})', raw.strip())
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return raw


def _is_omio(text: str) -> bool:
    return bool(re.search(r'\bomio\b', text, re.IGNORECASE))


def _extract_omio_data(text: str) -> Dict[str, Any]:
    """
    Парсит билеты Omio (Apple Wallet passes / скриншоты).
    Формат OCR: station names в ALL CAPS, "BOOKING REFERENCE\n<digits>",
    "DATE Sep 23, 2025", "PASSENGER\nFirstname Lastname".
    """
    data: Dict[str, Any] = {}

    # Booking reference (чисто числовой, 7–13 цифр).
    # В Apple Wallet пасс: "PASSENGER BOOKING REFERENCE\nMariia Martinovich 2624346803"
    # — номер брони на той же строке, что и имя, поэтому ищем через [^\n]*?
    pnr_m = re.search(r'booking\s*reference[^\n]*\n[^\n]*?(\d{7,13})', text, re.IGNORECASE)
    if pnr_m:
        data['pnr'] = pnr_m.group(1)

    # Passenger name: "PASSENGER BOOKING REFERENCE\nMariia Martinovich ..."
    # Require a newline so we skip the label line; name must be Title Case (not ALL CAPS)
    pax_m = re.search(
        r'passenger[^\n]*\n\s*([A-Z][a-z][a-zA-Z]*(?:\s+[A-Z][a-z][a-zA-Z]*)+)',
        text, re.IGNORECASE,
    )
    if pax_m:
        data['passengers'] = pax_m.group(1).strip()

    # Date: "DATE Sep 23, 2025" (label on same or next line)
    date_m = re.search(
        r'\bDATE[:\s]*\n?\s*([A-Za-z]{3}\.?\s+\d{1,2},?\s+\d{4})',
        text, re.IGNORECASE,
    )
    if date_m:
        d = normalize_date_str(date_m.group(1).strip())
        if d:
            data['departure_date'] = d
            data['arrival_date'] = d
    if not data.get('departure_date'):
        dates = find_dates(text)
        if dates:
            data['departure_date'] = dates[0]
            data['arrival_date'] = dates[0]

    # Station names: ALL-CAPS sequences (Omio wallet format)
    # E.g. "VARENNA-ESINO", "SANTA MARGHERITA LI..."
    _OMIO_SKIP = {
        'DATE', 'PASSENGER', 'BOOKING', 'REFERENCE', 'LIVE', 'UPDATES',
        'OMIO', 'JOURNEY', 'TRACKER', 'TR', 'IN', 'THE', 'APP',
    }
    station_re = re.compile(r'\b([A-Z][A-Z\-]{2,}(?:[ \t]+[A-Z][A-Z\-]+){0,4})\b')
    candidates = []
    for m in station_re.finditer(text):
        val = m.group(1).strip()
        if any(w in _OMIO_SKIP for w in val.split()):
            continue
        if len(val) >= 4:
            candidates.append(val)

    if candidates and not data.get('departure_place'):
        data['departure_place'] = candidates[0].title()
    if len(candidates) >= 2 and not data.get('arrival_place'):
        data['arrival_place'] = candidates[1].title()

    # Times: first = departure, second = arrival
    times = find_times(text)
    if times and not data.get('departure_time'):
        data['departure_time'] = times[0]
    if len(times) >= 2 and not data.get('arrival_time'):
        data['arrival_time'] = times[1]

    return data


def _extract_generic_bus_legs(pages: List[str]) -> List[Dict[str, Any]]:
    """
    Per-page парсер автобусных билетов в формате Rede Expressos / Omio.
    Каждая страница = один пассажир/место.
    """
    legs = []
    for raw_page in pages:
        page = raw_page.replace('\xa0', ' ')  # non-breaking space → space
        # Booking reference: "Booking: RK8HNZL"
        booking_m = re.search(r'Booking\s*:\s*([A-Z0-9]{5,})', page, re.IGNORECASE)
        if not booking_m:
            continue
        booking = booking_m.group(1).strip()

        # From / To: "From ORIGIN to DESTINATION"
        route_m = re.search(r'From\s+(.+?)\s+to\s+(.+)', page, re.IGNORECASE)
        if not route_m:
            continue
        dep_place = route_m.group(1).strip()
        arr_place = route_m.group(2).strip()

        # Depart: DD-MM-YYYY  HH:MM
        dep_m = re.search(r'Depart[:\s]+(\d{2}[-/]\d{2}[-/]\d{4})\s+(\d{2}:\d{2})', page, re.IGNORECASE)
        if not dep_m:
            continue
        dep_date = _parse_dmy_date(dep_m.group(1))
        dep_time = dep_m.group(2)

        # Estimated time of arrival: HH:MM
        arr_m = re.search(r'Estimated time of arrival[:\s]+(\d{2}:\d{2})', page, re.IGNORECASE)
        arr_time = arr_m.group(1) if arr_m else None

        # Bus/Train number: "Bus No. 72" or "Bus No 72"
        bus_m = re.search(r'Bus\s+No\.?\s*(\d+)', page, re.IGNORECASE)
        if not bus_m:
            bus_m = re.search(r'Train\s+No\.?\s*(\d+)', page, re.IGNORECASE)

        # Seat
        seat_m = re.search(r'Seat[:\s]+(\d+)', page, re.IGNORECASE)
        seat = seat_m.group(1) if seat_m else None

        # Passenger name
        name_m = re.search(r'Name[:\s]+([^\n]+)', page, re.IGNORECASE)
        passenger = name_m.group(1).strip() if name_m else None

        leg: Dict[str, Any] = {
            'pnr':             booking,
            'departure_place': dep_place,
            'departure_date':  dep_date,
            'departure_time':  dep_time,
            'arrival_place':   arr_place,
            'arrival_date':    dep_date,  # тот же день
        }
        if arr_time:
            leg['arrival_time'] = arr_time
        if bus_m:
            leg['train_number'] = bus_m.group(1)
        if seat:
            leg['seat'] = seat
        if passenger:
            leg['passengers'] = passenger

        legs.append(leg)

    return legs


def _is_belavia(text: str) -> bool:
    return bool(re.search(
        r'belavia|данные\s+брон\s*/\s*booking\s+ref',
        text, re.IGNORECASE,
    ))


def _parse_belavia_date(raw: str) -> Optional[str]:
    """DD.MM.YYYY → YYYY-MM-DD"""
    m = re.match(r'(\d{2})\.(\d{2})\.(\d{4})', raw.strip())
    return f"{m.group(3)}-{m.group(2)}-{m.group(1)}" if m else None


def _extract_belavia_legs(pages: List[str]) -> List[Dict[str, Any]]:
    """
    Parses Belavia (Belarusian Airlines) e-ticket PDFs.
    Each page = one passenger with N flight segments.
    Returns one leg dict per (passenger × segment).
    """
    FLIGHT_RE = re.compile(
        r'B2\s*(\d{3,4})\s+[A-Z]/([A-Za-z]+)\s+(\d{2}\.\d{2}\.\d{4})(\d{2}:\d{2})?'
    )
    DATE_ONLY_RE = re.compile(r'^\s*(\d{2}\.\d{2}\.\d{4})\s*$')
    TIME_START_RE = re.compile(r'^\s*(\d{1,2}:\d{2})\b')
    ROUTE_EN_RE = re.compile(
        r'([A-Z][a-z][A-Za-z ]*?)\s*\(([^)]+)\)\s*[-–]\s*([A-Z][a-z][A-Za-z ]*?)\s*\(([^)]+)\)'
    )

    legs = []

    for page in pages:
        page = page.replace('\xa0', ' ')
        lines = page.split('\n')

        # Passenger: "ФАМИЛИЯ/NAME: TSURKAN/VLADA MS"
        passenger = None
        name_m = re.search(r'(?:ФАМИЛИЯ/NAME|NAME)[:\s]+([A-Z]+/[A-Z]+)', page)
        if name_m:
            parts = name_m.group(1).split('/')
            passenger = (
                f"{parts[0].title()} {parts[1].title()}"
                if len(parts) == 2 else name_m.group(1)
            )

        # PNR: "ДАННЫЕ БРОН/BOOKING REF: 54WX48"
        pnr = None
        pnr_m = re.search(r'BOOKING\s+REF[:\s]+([A-Z0-9]{5,8})', page, re.IGNORECASE)
        if pnr_m:
            pnr = pnr_m.group(1)

        for i, line in enumerate(lines):
            fm = FLIGHT_RE.search(line)
            if not fm:
                continue

            flight_no = 'B2' + fm.group(1)
            tariff    = fm.group(2)           # "Economy"
            dep_date  = _parse_belavia_date(fm.group(3))
            dep_time  = fm.group(4)           # may be None (date+time squished)

            j = i + 1

            # dep_time may be on the next line if not squished
            if not dep_time and j < len(lines):
                tm = TIME_START_RE.match(lines[j])
                if tm:
                    dep_time = tm.group(1)
                    j += 1

            # Arrival: find date-only line, then time on the next line
            arr_date = arr_time = None
            while j < len(lines):
                if FLIGHT_RE.search(lines[j]):
                    break
                dm = DATE_ONLY_RE.match(lines[j])
                if dm:
                    arr_date = _parse_belavia_date(dm.group(1))
                    j += 1
                    if j < len(lines):
                        tm = TIME_START_RE.match(lines[j])
                        if tm:
                            arr_time = tm.group(1)
                    break
                j += 1

            # English route: join up to 8 lines before B2 line, use last match
            dep_place = arr_place = None
            context = ' '.join(lines[max(0, i - 8):i + 1])
            rm = None
            for match in ROUTE_EN_RE.finditer(context):
                rm = match  # last (closest) match
            if rm:
                dep_place = f"{rm.group(1).strip()} ({re.sub(r'  +', ' ', rm.group(2).strip())})"
                arr_place = f"{rm.group(3).strip()} ({re.sub(r'  +', ' ', rm.group(4).strip())})"

            leg: Dict[str, Any] = {'flight_number': flight_no, 'tariff': tariff}
            if pnr:
                leg['pnr'] = pnr
            if dep_place:
                leg['departure_place'] = dep_place
            if dep_date:
                leg['departure_date'] = dep_date
            if dep_time:
                leg['departure_time'] = dep_time
            if arr_place:
                leg['arrival_place'] = arr_place
            if arr_date:
                leg['arrival_date'] = arr_date
            if arr_time:
                leg['arrival_time'] = arr_time
            if passenger:
                leg['passengers'] = passenger

            legs.append(leg)

    return legs


def _is_trenitalia(text: str) -> bool:
    return bool(re.search(r'trenitalia|trenord|ticket\s+code\s*:\s*\d{8,}', text, re.IGNORECASE))


def _parse_trenitalia_date(raw: str) -> str:
    """DD/MM/YYYY → YYYY-MM-DD"""
    m = re.match(r'(\d{2})/(\d{2})/(\d{4})', raw.strip())
    if m:
        return f"{m.group(3)}-{m.group(2)}-{m.group(1)}"
    return raw


def _extract_trenitalia_legs(pages: List[str]) -> List[Dict[str, Any]]:
    """
    Разбирает каждую страницу Trenitalia PDF как отдельный сегмент.
    Формат: Ticket Code, Departure station / Hours HH:MM - DD/MM/YYYY,
            Arrival station / Hours HH:MM - DD/MM/YYYY, Service.
    """
    legs = []
    for page in pages:
        # Ticket Code
        code_m = re.search(r'Ticket\s+Code\s*:?\s*(\d{6,})', page, re.IGNORECASE)
        if not code_m:
            continue
        ticket_code = code_m.group(1)

        # Departure: "Departure station\nSTATION NAME\nHours HH:MM - DD/MM/YYYY"
        # или "Departure station\nSTATION NAMEHours HH:MM - DD/MM/YYYY" (без \n)
        dep_m = re.search(
            r'Departure\s+station\s*\n(.*?)Hours?\s+(\d{2}:\d{2})\s*[-–]\s*(\d{2}/\d{2}/\d{4})',
            page, re.IGNORECASE | re.DOTALL
        )
        arr_m = re.search(
            r'Arrival\s+station\s*\n(.*?)Hours?\s+(\d{2}:\d{2})\s*[-–]\s*(\d{2}/\d{2}/\d{4})',
            page, re.IGNORECASE | re.DOTALL
        )
        if not dep_m or not arr_m:
            continue

        dep_station = dep_m.group(1).strip().splitlines()[0].strip()
        dep_time    = dep_m.group(2)
        dep_date    = _parse_trenitalia_date(dep_m.group(3))

        arr_station = arr_m.group(1).strip().splitlines()[0].strip()
        arr_time    = arr_m.group(2)
        arr_date    = _parse_trenitalia_date(arr_m.group(3))

        # Service class
        class_m = re.search(r'Service\s*:\s*([^\n]+)', page, re.IGNORECASE)
        tariff = class_m.group(1).strip() if class_m else None
        # Normalize "2° Classe" → "2 Classe"
        if tariff:
            tariff = re.sub(r'[°º]', '', tariff).strip()

        # Train name: "Train: Regionale Trenord 2833" → full string
        train_m = re.search(r'Train\s*:\s*([^\n]+)', page, re.IGNORECASE)
        train_number = train_m.group(1).strip() if train_m else None

        # Passenger name
        pass_m = re.search(r'Passenger\s+Name.*?\n([^\n]+)', page, re.IGNORECASE)
        passenger = pass_m.group(1).strip() if pass_m else None

        leg: Dict[str, Any] = {
            'pnr':              ticket_code,
            'departure_place':  dep_station,
            'departure_date':   dep_date,
            'departure_time':   dep_time,
            'arrival_place':    arr_station,
            'arrival_date':     arr_date,
            'arrival_time':     arr_time,
        }
        if train_number:
            leg['train_number'] = train_number
        if tariff:
            leg['tariff'] = tariff
        if passenger:
            leg['passengers'] = passenger

        legs.append(leg)

    return legs


def parse_document(file_path: str, mime_type: str) -> Tuple[str, float, List[Dict[str, Any]]]:
    """
    Основной метод: парсит файл, определяет тип, извлекает данные.
    Возвращает (doc_type, confidence, list_of_segments).
    Для многосегментных билетов list_of_segments содержит по одному dict на сегмент.
    Для всех остальных документов список из одного элемента.
    """
    text = extract_text(file_path, mime_type)
    print(f"[parser] mime={mime_type} text_len={len(text)} text_preview={repr(text[:300])}")

    if not text.strip():
        return "UNKNOWN", 0.0, [{}]

    doc_type, confidence = determine_doc_type(text)
    print(f"[parser] raw doc_type={doc_type} conf={confidence:.2f} is_omio={_is_omio(text)}")

    # Omio билеты часто содержат "booking" и попадают в HOTEL_BOOKING — переопределяем
    if _is_omio(text) and doc_type != "TRAIN_TICKET":
        doc_type = "TRAIN_TICKET"
        confidence = max(confidence, 0.75)

    extracted = extract_widget_data(text, doc_type)

    if doc_type == "FLIGHT_TICKET":
        pnr = extracted.get('pnr')

        # Belavia: per-page parsing (one passenger per page, N segments each)
        if mime_type == "application/pdf" and _is_belavia(text):
            pages = extract_pdf_pages(file_path)
            legs = _extract_belavia_legs(pages)
            if legs:
                return doc_type, confidence, legs

        lines = [ln.strip() for ln in text.split('\n')]
        legs = _extract_flight_legs(lines, pnr=pnr)
        if len(legs) >= 2:
            return doc_type, confidence, legs

        # Biletix / Aviakassa: несколько пассажиров — одна страница PDF на пассажира
        if mime_type == "application/pdf":
            pages = extract_pdf_pages(file_path)
            if len(pages) >= 2:
                pax_pat = re.compile(
                    r"(?:Пассажир[^\n]*\n)([A-ZА-ЯЁ][A-ZА-ЯЁ]+\s+[A-ZА-ЯЁ][A-ZА-ЯЁ]+)\s+[A-Z0-9]{5,}",
                )
                bil_pat = re.compile(
                    r"([A-Z]{2,}\s+[A-Z]{2,})\s+[A-Z0-9]{6,}\s+\d{6,12}\s+\S+",
                )
                # Авиасейлс / Маршрутная квитанция: "ПАССАЖИР / ДОКУМЕНТ\nNAME /"
                aviasales_pat = re.compile(
                    r"ПАССАЖИР\s*/\s*ДОКУМЕНТ\s*\n([A-Z][A-Z]+\s+[A-Z][A-Z]+)\s*/",
                )
                for pat in (pax_pat, bil_pat, aviasales_pat):
                    pax_matches = [pat.search(p) for p in pages]
                    ticket_pages = [(pages[i], m.group(1)) for i, m in enumerate(pax_matches) if m]
                    unique_names = {name for _, name in ticket_pages}
                    if len(unique_names) >= 2:
                        segments = [extract_widget_data(p, doc_type) for p, _ in ticket_pages]
                        return doc_type, confidence, segments

    if mime_type == "application/pdf":
        if doc_type == "TRAIN_TICKET" and _is_trenitalia(text):
            pages = extract_pdf_pages(file_path)
            legs = _extract_trenitalia_legs(pages)
            if legs:
                return doc_type, confidence, legs

        if doc_type == "BUS_TICKET":
            pages = extract_pdf_pages(file_path)
            if len(pages) >= 2:
                legs = _extract_generic_bus_legs(pages)
                if legs:
                    return doc_type, confidence, legs

    return doc_type, confidence, [extracted]
