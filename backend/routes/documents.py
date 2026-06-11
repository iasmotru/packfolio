"""
Работа с документами: загрузка, просмотр, редактирование, замена файла.
"""

import os
import shutil
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import (
    APIRouter, Depends, File, Form, HTTPException,
    Query, UploadFile, status,
)
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from auth import get_current_user_id, decode_token, bearer_scheme, ENV
from models import Document, DocumentTag, Tag, TripShare, WidgetData, get_db
from access import get_trip_role
from parser import parse_document

UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

router = APIRouter(prefix="/api/documents", tags=["documents"])


# ──────────────────────────────────────────────
# Утилиты
# ──────────────────────────────────────────────

ALLOWED_MIMES = {
    "application/pdf",
    "image/jpeg",
    "image/jpg",   # некоторые браузеры шлют так
    "image/png",
    "image/webp",
    "image/gif",
}

_EXT_MIME = {
    ".pdf":  "application/pdf",
    ".jpg":  "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png":  "image/png",
    ".webp": "image/webp",
    ".gif":  "image/gif",
}

def _resolve_mime(file: UploadFile) -> str:
    """Возвращает нормализованный MIME-тип: сначала из content_type, затем из расширения."""
    ct = (file.content_type or "").lower().split(";")[0].strip()
    if ct in ALLOWED_MIMES:
        # Нормализуем image/jpg → image/jpeg
        return "image/jpeg" if ct == "image/jpg" else ct
    ext = os.path.splitext(file.filename or "")[1].lower()
    return _EXT_MIME.get(ext, ct or "application/octet-stream")

def save_upload(file: UploadFile) -> tuple[str, str]:
    """Сохраняет файл в UPLOAD_DIR и возвращает (file_path, mime_type)."""
    ext = os.path.splitext(file.filename or "")[1].lower() or ".bin"
    filename = f"{uuid.uuid4().hex}{ext}"
    file_path = os.path.join(UPLOAD_DIR, filename)

    with open(file_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    mime = _resolve_mime(file)
    return file_path, mime


def doc_to_dict(doc: Document) -> dict:
    """Сериализует Document + WidgetData в dict."""
    wd = doc.widget_data
    tags = [
        {"id": dt.tag.id, "name": dt.tag.name, "kind": dt.tag.kind}
        for dt in doc.doc_tags
    ]
    return {
        "id":         doc.id,
        "user_id":    doc.user_id,
        "trip_id":    doc.trip_id,
        "doc_type":   doc.doc_type,
        "title":      doc.title,
        "file_path":  doc.file_path,
        "file_mime":  doc.file_mime,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
        "updated_at": doc.updated_at.isoformat() if doc.updated_at else None,
        "tags":       tags,
        "widget": {
            "id":             wd.id             if wd else None,
            "data":           wd.data           if wd else {},
            "extracted_data": (wd.extracted_data or {}) if wd else {},
            "confidence":     wd.confidence     if wd else 0.0,
            "last_parsed_at": wd.last_parsed_at.isoformat() if wd and wd.last_parsed_at else None,
        } if wd else None,
    }


def set_document_tags(db: Session, doc: Document, tag_ids: List[int], user_id: int):
    """Заменяет теги документа."""
    # Удаляем старые
    db.query(DocumentTag).filter(DocumentTag.document_id == doc.id).delete()

    for tid in tag_ids:
        tag = db.query(Tag).filter(Tag.id == tid, Tag.user_id == user_id).first()
        if tag:
            db.add(DocumentTag(document_id=doc.id, tag_id=tid))


def _is_duplicate_data(existing: dict, new: dict) -> bool:
    """True если все непустые поля new совпадают с existing (минимум 2 поля)."""
    if not existing or not new:
        return False
    filled = {k: v for k, v in new.items() if v not in (None, "", [])}
    if len(filled) < 2:
        return False
    return all(str(existing.get(k, "")) == str(v) for k, v in filled.items())


# Поля-идентификаторы: совпадение по любому означает «похожий» документ
_SIMILAR_KEY_FIELDS = ["pnr", "flight_number", "booking_ref"]


def _tag_old_versions(
    db: Session, user_id: int, doc_type: str, segments: list, exclude_ids: list
):
    """Ставит тег «Старая версия» на все похожие документы, кроме только что загруженных."""
    old_tag = (
        db.query(Tag)
        .filter(Tag.user_id == user_id, Tag.kind == "old_version")
        .first()
    )
    if not old_tag:
        old_tag = Tag(user_id=user_id, name="Старая версия", kind="old_version")
        db.add(old_tag)
        db.flush()

    existing_docs = (
        db.query(Document)
        .join(WidgetData, WidgetData.document_id == Document.id)
        .filter(Document.user_id == user_id, Document.doc_type == doc_type)
        .filter(Document.id.notin_(exclude_ids))
        .all()
    )
    tagged_ids: set = set()
    for seg in segments:
        for key in _SIMILAR_KEY_FIELDS:
            val = seg.get(key)
            if not val:
                continue
            for ex in existing_docs:
                if ex.id in tagged_ids:
                    continue
                ex_val = (ex.widget_data.data or {}).get(key) if ex.widget_data else None
                if ex_val and str(ex_val) == str(val):
                    already = db.query(DocumentTag).filter(
                        DocumentTag.document_id == ex.id,
                        DocumentTag.tag_id == old_tag.id,
                    ).first()
                    if not already:
                        db.add(DocumentTag(document_id=ex.id, tag_id=old_tag.id))
                    tagged_ids.add(ex.id)


def _tag_duplicates(
    db: Session, user_id: int, doc_type: str, segments: list, new_doc_ids: list
):
    """Ставит тег «Дубликат» на новые документы и все их точные копии."""
    dup_tag = (
        db.query(Tag)
        .filter(Tag.user_id == user_id, Tag.kind == "duplicate")
        .first()
    )
    if not dup_tag:
        dup_tag = Tag(user_id=user_id, name="Дубликат", kind="duplicate")
        db.add(dup_tag)
        db.flush()

    def _ensure_tag(doc_id: int):
        exists = db.query(DocumentTag).filter(
            DocumentTag.document_id == doc_id,
            DocumentTag.tag_id == dup_tag.id,
        ).first()
        if not exists:
            db.add(DocumentTag(document_id=doc_id, tag_id=dup_tag.id))

    # Находим существующие точные дубликаты и тегируем их
    existing_docs = (
        db.query(Document)
        .join(WidgetData, WidgetData.document_id == Document.id)
        .filter(Document.user_id == user_id, Document.doc_type == doc_type)
        .filter(Document.id.notin_(new_doc_ids))
        .all()
    )
    for seg in segments:
        for ex in existing_docs:
            if ex.widget_data and _is_duplicate_data(ex.widget_data.data, seg):
                _ensure_tag(ex.id)


def _find_similar_doc(
    db: Session, user_id: int, doc_type: str, segments: list
) -> Optional["Document"]:
    """Возвращает первый документ, у которого совпадает PNR/рейс, но данные отличаются."""
    existing_docs = (
        db.query(Document)
        .join(WidgetData, WidgetData.document_id == Document.id)
        .filter(Document.user_id == user_id, Document.doc_type == doc_type)
        .all()
    )
    for seg in segments:
        for key in _SIMILAR_KEY_FIELDS:
            val = seg.get(key)
            if not val:
                continue
            for ex in existing_docs:
                ex_val = (ex.widget_data.data or {}).get(key) if ex.widget_data else None
                if ex_val and str(ex_val) == str(val):
                    # Совпадает идентификатор, но не все поля — это «похожий»
                    if not _is_duplicate_data(ex.widget_data.data, seg):
                        return ex
    return None


# ──────────────────────────────────────────────
# Эндпоинты
# ──────────────────────────────────────────────

def _leg_title(seg: dict, idx: int) -> str:
    """Generates a route-based auto-title for a transport leg segment."""
    dep = seg.get('departure_place', '')
    arr = seg.get('arrival_place', '')
    if dep and arr:
        return f"{dep} → {arr}"
    return f"Сегмент {idx + 1}"


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload_document(
    file:    UploadFile = File(...),
    title:   Optional[str] = Form(None),
    trip_id: Optional[int] = Form(None),
    tags:    Optional[str] = Form(None),   # JSON-array строка "[1,2,3]"
    force:          bool = Form(False),  # True = пропустить проверку дубликата
    mark_old:       bool = Form(False),  # True = пометить похожие как «Старая версия»
    mark_duplicate: bool = Form(False),  # True = пометить все копии как «Дубликат»
    user_id: int     = Depends(get_current_user_id),
    db:      Session = Depends(get_db),
):
    """Загружает новый документ, парсит его и создаёт WidgetData."""
    # Проверяем MIME (с fallback по расширению файла)
    ext = os.path.splitext(file.filename or "")[1].lower()
    if _resolve_mime(file) not in ALLOWED_MIMES and ext not in _EXT_MIME:
        raise HTTPException(
            status_code=400,
            detail=f"Тип файла не поддерживается: {file.content_type}",
        )

    file_path, mime = save_upload(file)

    # Парсинг: segments — всегда список
    doc_type, confidence, segments = parse_document(file_path, mime)

    # ── Проверка дубликата (пропускается при force=True) ──
    if not force and doc_type != "UNKNOWN":
        existing_docs = (
            db.query(Document)
            .join(WidgetData, WidgetData.document_id == Document.id)
            .filter(Document.user_id == user_id, Document.doc_type == doc_type)
            .all()
        )
        for seg in segments:
            for ex in existing_docs:
                if ex.widget_data and _is_duplicate_data(ex.widget_data.data, seg):
                    os.remove(file_path)
                    return JSONResponse(
                        status_code=409,
                        content={"duplicate": True, "existing": doc_to_dict(ex)},
                    )

        # Проверка «похожего» документа (совпадает PNR/рейс, но данные отличаются)
        similar = _find_similar_doc(db, user_id, doc_type, segments)
        if similar:
            os.remove(file_path)
            return JSONResponse(
                status_code=202,
                content={"similar": True, "existing": doc_to_dict(similar)},
            )

    is_multi = len(segments) >= 2

    # Теги (парсим один раз)
    tag_ids: List[int] = []
    if tags:
        import json
        try:
            tag_ids = json.loads(tags)
        except Exception:
            pass

    created_docs: List[Document] = []

    for idx, seg in enumerate(segments):
        # Заголовок: если пользователь задал и сегмент один — используем его
        if title and not is_multi:
            doc_title = title
        elif doc_type in ("FLIGHT_TICKET", "TRAIN_TICKET", "BUS_TICKET"):
            doc_title = _leg_title(seg, idx)
        elif doc_type == "HOTEL_BOOKING":
            doc_title = seg.get("hotel_name") or title or (file.filename or "Без названия")
        else:
            doc_title = title or (file.filename or "Без названия")

        doc = Document(
            user_id=user_id,
            trip_id=trip_id,
            doc_type=doc_type,
            title=doc_title,
            file_path=file_path,
            file_mime=mime,
        )
        db.add(doc)
        db.flush()  # получаем doc.id

        wd = WidgetData(
            document_id=doc.id,
            data=seg,
            extracted_data=seg,
            confidence=confidence,
            last_parsed_at=datetime.utcnow(),
        )
        db.add(wd)

        if tag_ids:
            set_document_tags(db, doc, tag_ids, user_id)

        created_docs.append(doc)

    db.commit()
    for doc in created_docs:
        db.refresh(doc)

    # Пометить похожие документы как «Старая версия»
    if mark_old and doc_type != "UNKNOWN":
        _tag_old_versions(db, user_id, doc_type, segments, [d.id for d in created_docs])
        db.commit()
        for doc in created_docs:
            db.refresh(doc)

    # Пометить дубликаты
    if mark_duplicate and doc_type != "UNKNOWN":
        _tag_duplicates(db, user_id, doc_type, segments, [d.id for d in created_docs])
        db.commit()
        for doc in created_docs:
            db.refresh(doc)

    if is_multi:
        return [doc_to_dict(d) for d in created_docs]
    return doc_to_dict(created_docs[0])


@router.get("")
def list_documents(
    trip_id:  Optional[int] = Query(None),
    doc_type: Optional[str] = Query(None),
    tag_id:   Optional[int] = Query(None),
    q:        Optional[str] = Query(None),
    user_id: int     = Depends(get_current_user_id),
    db:      Session = Depends(get_db),
):
    from sqlalchemy import or_
    # Поездки к которым у пользователя есть доступ как участник
    shared_trip_ids = [
        s.trip_id for s in db.query(TripShare).filter(
            TripShare.member_id == user_id,
            TripShare.accepted == True,
        ).all()
    ]
    if shared_trip_ids:
        base_filter = or_(Document.user_id == user_id, Document.trip_id.in_(shared_trip_ids))
    else:
        base_filter = Document.user_id == user_id
    query = db.query(Document).filter(base_filter)

    if trip_id is not None:
        query = query.filter(Document.trip_id == trip_id)
    if doc_type:
        query = query.filter(Document.doc_type == doc_type)
    if tag_id:
        query = query.join(DocumentTag).filter(DocumentTag.tag_id == tag_id)
    if q:
        query = query.filter(Document.title.ilike(f"%{q}%"))

    docs = query.order_by(Document.created_at.asc()).all()
    result = [doc_to_dict(d) for d in docs]

    def _doc_sort_key(d: dict) -> tuple:
        data = (d.get("widget") or {}).get("data") or {}
        date = ""
        time = ""
        for field in ("departure_date", "check_in", "pickup_date", "start_date"):
            val = data.get(field)
            if val:
                date = str(val)
                break
        if not date:
            date = str(d.get("created_at") or "")
        time = str(data.get("departure_time") or data.get("pickup_time") or "")
        return (date, time)

    result.sort(key=_doc_sort_key)
    return result


@router.get("/{doc_id}")
def get_document(
    doc_id:  int,
    user_id: int     = Depends(get_current_user_id),
    db:      Session = Depends(get_db),
):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
    if doc.user_id != user_id:
        if not doc.trip_id or not get_trip_role(doc.trip_id, user_id, db):
            raise HTTPException(status_code=403, detail="Нет доступа")
    return doc_to_dict(doc)


class DocumentUpdate(BaseModel):
    title:    Optional[str] = None
    doc_type: Optional[str] = None
    trip_id:  Optional[int] = None
    tag_ids:  Optional[List[int]] = None


@router.put("/{doc_id}")
def update_document(
    doc_id: int,
    body:   DocumentUpdate,
    user_id: int     = Depends(get_current_user_id),
    db:      Session = Depends(get_db),
):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
    if doc.user_id != user_id:
        role = get_trip_role(doc.trip_id, user_id, db) if doc.trip_id else None
        if role not in ("owner", "editor"):
            raise HTTPException(status_code=403, detail="Нет прав для изменения документа")

    if body.title    is not None: doc.title    = body.title
    if body.doc_type is not None: doc.doc_type = body.doc_type
    if body.trip_id  is not None: doc.trip_id  = body.trip_id
    if body.tag_ids  is not None:
        set_document_tags(db, doc, body.tag_ids, user_id)

    doc.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(doc)
    return doc_to_dict(doc)


@router.put("/{doc_id}/widget")
def patch_widget(
    doc_id: int,
    body:   Dict[str, Any],
    user_id: int     = Depends(get_current_user_id),
    db:      Session = Depends(get_db),
):
    """Патч произвольных полей виджета (пользователь редактирует поля)."""
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
    if doc.user_id != user_id:
        role = get_trip_role(doc.trip_id, user_id, db) if doc.trip_id else None
        if role not in ("owner", "editor"):
            raise HTTPException(status_code=403, detail="Нет прав для изменения документа")

    wd = doc.widget_data
    if not wd:
        wd = WidgetData(document_id=doc.id, data={}, extracted_data={}, confidence=0.0)
        db.add(wd)
        db.flush()

    # Если extracted_data пустой (легасси-документ) — фиксируем текущее data
    # как эталон перед первым редактированием, чтобы бейдж «Изменено» работал
    if not wd.extracted_data:
        wd.extracted_data = dict(wd.data or {})
        flag_modified(wd, 'extracted_data')

    # Мержим новые поля поверх существующих
    current = dict(wd.data or {})
    current.update(body)
    wd.data = current
    flag_modified(wd, 'data')

    doc.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(doc)
    return doc_to_dict(doc)


@router.post("/{doc_id}/replace")
async def replace_file(
    doc_id: int,
    file:   UploadFile = File(...),
    user_id: int     = Depends(get_current_user_id),
    db:      Session = Depends(get_db),
):
    """Заменяет файл документа и перезапускает парсинг."""
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
    if doc.user_id != user_id:
        role = get_trip_role(doc.trip_id, user_id, db) if doc.trip_id else None
        if role not in ("owner", "editor"):
            raise HTTPException(status_code=403, detail="Нет прав для замены файла")

    mime_resolved = _resolve_mime(file)
    ext = os.path.splitext(file.filename or "")[1].lower()
    if mime_resolved not in ALLOWED_MIMES and ext not in _EXT_MIME:
        raise HTTPException(status_code=400, detail=f"Тип файла не поддерживается: {file.content_type}")

    # Удаляем старый файл
    if doc.file_path and os.path.exists(doc.file_path):
        os.remove(doc.file_path)

    file_path, mime = save_upload(file)
    doc.file_path = file_path
    doc.file_mime = mime

    # Перепарсим
    doc_type, confidence, segments = parse_document(file_path, mime)
    extracted = segments[0] if segments else {}
    doc.doc_type   = doc_type
    doc.updated_at = datetime.utcnow()

    wd = doc.widget_data
    if wd:
        wd.data           = extracted
        wd.extracted_data = extracted
        wd.confidence     = confidence
        wd.last_parsed_at = datetime.utcnow()
    else:
        db.add(WidgetData(
            document_id=doc.id,
            data=extracted,
            extracted_data=extracted,
            confidence=confidence,
            last_parsed_at=datetime.utcnow(),
        ))

    db.commit()
    db.refresh(doc)
    return doc_to_dict(doc)


@router.get("/{doc_id}/file")
def download_file(
    doc_id:      int,
    db:          Session = Depends(get_db),
    token:       Optional[str] = Query(default=None, include_in_schema=False),
    credentials = Depends(bearer_scheme),
):
    """Отдаёт исходный файл. Токен принимается из Authorization-заголовка или ?token= query-параметра."""
    if ENV == "dev":
        user_id = 1
    elif credentials is not None:
        user_id = decode_token(credentials.credentials)
    elif token is not None:
        user_id = decode_token(token)
    else:
        raise HTTPException(status_code=401, detail="Отсутствует токен авторизации")

    doc = db.query(Document).filter(Document.id == doc_id, Document.user_id == user_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")

    if not doc.file_path or not os.path.exists(doc.file_path):
        raise HTTPException(status_code=404, detail="Файл не найден на сервере")

    media_type = doc.file_mime or "application/octet-stream"
    disposition = "inline" if media_type.startswith("image/") else "inline"

    return FileResponse(
        doc.file_path,
        media_type=media_type,
        headers={"Content-Disposition": f'{disposition}; filename="{os.path.basename(doc.file_path)}"'},
    )


@router.post("/{doc_id}/reparse")
def reparse_document(
    doc_id:  int,
    user_id: int     = Depends(get_current_user_id),
    db:      Session = Depends(get_db),
):
    """Перепарсивает документ с текущей версией парсера без замены файла."""
    doc = db.query(Document).filter(Document.id == doc_id, Document.user_id == user_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
    if not doc.file_path or not os.path.exists(doc.file_path):
        raise HTTPException(status_code=404, detail="Файл не найден на сервере")

    doc_type, confidence, segments = parse_document(doc.file_path, doc.file_mime or "application/pdf")
    extracted = segments[0] if segments else {}
    doc.doc_type   = doc_type
    doc.updated_at = datetime.utcnow()

    wd = doc.widget_data
    if wd:
        wd.data           = extracted
        wd.extracted_data = extracted
        wd.confidence     = confidence
        wd.last_parsed_at = datetime.utcnow()
    else:
        db.add(WidgetData(
            document_id=doc.id,
            data=extracted,
            extracted_data=extracted,
            confidence=confidence,
            last_parsed_at=datetime.utcnow(),
        ))

    db.commit()
    db.refresh(doc)
    return doc_to_dict(doc)


@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    doc_id:  int,
    user_id: int     = Depends(get_current_user_id),
    db:      Session = Depends(get_db),
):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
    if doc.user_id != user_id:
        role = get_trip_role(doc.trip_id, user_id, db) if doc.trip_id else None
        if role not in ("owner", "editor"):
            raise HTTPException(status_code=403, detail="Нет прав для удаления документа")

    if doc.file_path and os.path.exists(doc.file_path):
        os.remove(doc.file_path)

    db.delete(doc)
    db.commit()
