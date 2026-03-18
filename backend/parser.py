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
        r"\bэлектронный\s+билет\b",
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
      CITY FLIGHT_NO CL DATE HHMM STATUS ...
      (AIRPORT) ... arrival date and time: DATE HHMM
      ARRIVAL_CITY
      (ARRIVAL_AIRPORT)
    Используется для билетов без IATA-кодов в скобках (Pobeda, S7 и т.п.).
    """
    for i, line in enumerate(lines):
        m = re.search(
            r'^([A-Z][A-Z ]{1,20})\s+([A-Z]{2})\s*(\d{3,4})\s+[A-Z]\s+'
            r'(\d{1,2}[A-Za-z]{3}\d{2,4})\s+(\d{4})\b',
            line.strip(),
        )
        if not m:
            continue

        dep_city = m.group(1).strip().title()
        flight_no = m.group(2) + m.group(3)
        dep_date = normalize_date_str(m.group(4))
        dep_time_raw = m.group(5)
        dep_time = f"{dep_time_raw[:2]}:{dep_time_raw[2:]}"

        result: Dict[str, Any] = {
            'flight_no': flight_no,
            'dep_city': dep_city,
            'dep_date': dep_date,
            'dep_time': dep_time,
            'arr_date': None,
            'arr_time': None,
            'arr_city': None,
        }

        for j in range(i + 1, min(len(lines), i + 8)):
            ln = lines[j].strip()

            # Arrival datetime: "arrival date and time: DATE HHMM" / "прибытия: DATE HHMM"
            if not result['arr_date']:
                am = re.search(
                    r'(?:arrival\s+date\s+and\s+time|прибытия)[:\s/]+(\d{1,2}[A-Za-z]{3}\d{2,4})\s+(\d{4})',
                    ln, re.IGNORECASE,
                )
                if am:
                    result['arr_date'] = normalize_date_str(am.group(1))
                    result['arr_time'] = f"{am.group(2)[:2]}:{am.group(2)[2:]}"

            # Arrival city: строка только из заглавных букв и пробелов (не заголовок)
            if not result['arr_city'] and re.match(r'^[A-Z][A-Z ]+$', ln) and 3 < len(ln) < 40:
                result['arr_city'] = ln.strip().title()

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


def extract_ticket_data(text: str, doc_type: str) -> Dict[str, Any]:
    # Нормализуем неразрывные пробелы и мягкие дефисы
    text = text.replace('\xa0', ' ').replace('\xad', '')

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

        # Подход 1: маршрутная строка вида "CITY FLIGHT CL DATE HHMM"
        itinerary = _extract_airline_itinerary(lines)
        if itinerary:
            if not data.get('flight_number'):
                data['flight_number'] = itinerary['flight_no']
            if itinerary['dep_city']:
                data['departure_place'] = itinerary['dep_city']
            if itinerary['dep_date']:
                data['departure_date'] = itinerary['dep_date']
            if itinerary['dep_time']:
                data['departure_time'] = itinerary['dep_time']
            if itinerary['arr_city']:
                data['arrival_place'] = itinerary['arr_city']
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

    # ── Специфика TRAIN_TICKET / BUS_TICKET ───────────────────────────────
    else:
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


def parse_document(file_path: str, mime_type: str) -> Tuple[str, float, List[Dict[str, Any]]]:
    """
    Основной метод: парсит файл, определяет тип, извлекает данные.
    Возвращает (doc_type, confidence, list_of_segments).
    Для многосегментных билетов list_of_segments содержит по одному dict на сегмент.
    Для всех остальных документов список из одного элемента.
    """
    text = extract_text(file_path, mime_type)

    if not text.strip():
        return "UNKNOWN", 0.0, [{}]

    doc_type, confidence = determine_doc_type(text)
    extracted = extract_widget_data(text, doc_type)

    if doc_type == "FLIGHT_TICKET":
        pnr = extracted.get('pnr')
        lines = [ln.strip() for ln in text.split('\n')]
        legs = _extract_flight_legs(lines, pnr=pnr)
        if len(legs) >= 2:
            return doc_type, confidence, legs

    return doc_type, confidence, [extracted]
