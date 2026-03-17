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
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user_id
from models import Document, DocumentTag, Tag, WidgetData, get_db
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
            "extracted_data": wd.extracted_data if wd else {},
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


# ──────────────────────────────────────────────
# Эндпоинты
# ──────────────────────────────────────────────

@router.post("", status_code=status.HTTP_201_CREATED)
async def upload_document(
    file:    UploadFile = File(...),
    title:   Optional[str] = Form(None),
    trip_id: Optional[int] = Form(None),
    tags:    Optional[str] = Form(None),   # JSON-array строка "[1,2,3]"
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

    # Парсинг
    doc_type, confidence, extracted = parse_document(file_path, mime)

    # Создаём документ
    doc = Document(
        user_id=user_id,
        trip_id=trip_id,
        doc_type=doc_type,
        title=title or (file.filename or "Без названия"),
        file_path=file_path,
        file_mime=mime,
    )
    db.add(doc)
    db.flush()  # получаем doc.id

    # Создаём WidgetData
    wd = WidgetData(
        document_id=doc.id,
        data=extracted,
        extracted_data=extracted,
        confidence=confidence,
        last_parsed_at=datetime.utcnow(),
    )
    db.add(wd)

    # Теги
    if tags:
        import json
        try:
            tag_ids = json.loads(tags)
            set_document_tags(db, doc, tag_ids, user_id)
        except Exception:
            pass

    db.commit()
    db.refresh(doc)
    return doc_to_dict(doc)


@router.get("")
def list_documents(
    trip_id:  Optional[int] = Query(None),
    doc_type: Optional[str] = Query(None),
    tag_id:   Optional[int] = Query(None),
    q:        Optional[str] = Query(None),
    user_id: int     = Depends(get_current_user_id),
    db:      Session = Depends(get_db),
):
    query = db.query(Document).filter(Document.user_id == user_id)

    if trip_id is not None:
        query = query.filter(Document.trip_id == trip_id)
    if doc_type:
        query = query.filter(Document.doc_type == doc_type)
    if tag_id:
        query = query.join(DocumentTag).filter(DocumentTag.tag_id == tag_id)
    if q:
        query = query.filter(Document.title.ilike(f"%{q}%"))

    docs = query.order_by(Document.created_at.desc()).all()
    return [doc_to_dict(d) for d in docs]


@router.get("/{doc_id}")
def get_document(
    doc_id:  int,
    user_id: int     = Depends(get_current_user_id),
    db:      Session = Depends(get_db),
):
    doc = db.query(Document).filter(Document.id == doc_id, Document.user_id == user_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")
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
    doc = db.query(Document).filter(Document.id == doc_id, Document.user_id == user_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")

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
    doc = db.query(Document).filter(Document.id == doc_id, Document.user_id == user_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")

    wd = doc.widget_data
    if not wd:
        wd = WidgetData(document_id=doc.id, data={}, extracted_data={}, confidence=0.0)
        db.add(wd)
        db.flush()

    # Мержим новые поля поверх существующих
    current = dict(wd.data or {})
    current.update(body)
    wd.data = current

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
    doc = db.query(Document).filter(Document.id == doc_id, Document.user_id == user_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")

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
    doc_type, confidence, extracted = parse_document(file_path, mime)
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
    doc_id:  int,
    user_id: int     = Depends(get_current_user_id),
    db:      Session = Depends(get_db),
):
    """Отдаёт исходный файл (inline для изображений, attachment для PDF)."""
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


@router.delete("/{doc_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    doc_id:  int,
    user_id: int     = Depends(get_current_user_id),
    db:      Session = Depends(get_db),
):
    doc = db.query(Document).filter(Document.id == doc_id, Document.user_id == user_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")

    if doc.file_path and os.path.exists(doc.file_path):
        os.remove(doc.file_path)

    db.delete(doc)
    db.commit()
