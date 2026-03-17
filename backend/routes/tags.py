"""
CRUD для тегов (Tag).
"""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user_id
from models import Tag, get_db

router = APIRouter(prefix="/api/tags", tags=["tags"])


# ──────────────────────────────────────────────
# Pydantic схемы
# ──────────────────────────────────────────────

class TagCreate(BaseModel):
    name: str
    kind: Optional[str] = "custom"   # tripType | custom


class TagUpdate(BaseModel):
    name: Optional[str] = None
    kind: Optional[str] = None


class TagOut(BaseModel):
    id:      int
    user_id: int
    name:    str
    kind:    str

    class Config:
        from_attributes = True


# ──────────────────────────────────────────────
# Эндпоинты
# ──────────────────────────────────────────────

@router.get("", response_model=List[TagOut])
def list_tags(
    kind: Optional[str] = None,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    q = db.query(Tag).filter(Tag.user_id == user_id)
    if kind:
        q = q.filter(Tag.kind == kind)
    return q.order_by(Tag.name).all()


@router.post("", response_model=TagOut, status_code=status.HTTP_201_CREATED)
def create_tag(
    body: TagCreate,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    # Проверяем уникальность имени для пользователя
    existing = db.query(Tag).filter(
        Tag.user_id == user_id, Tag.name == body.name
    ).first()
    if existing:
        return existing  # возвращаем существующий тег (идемпотентно)

    tag = Tag(user_id=user_id, name=body.name, kind=body.kind or "custom")
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return tag


@router.put("/{tag_id}", response_model=TagOut)
def update_tag(
    tag_id: int,
    body: TagUpdate,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    tag = db.query(Tag).filter(Tag.id == tag_id, Tag.user_id == user_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Тег не найден")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(tag, field, value)

    db.commit()
    db.refresh(tag)
    return tag


@router.delete("/{tag_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tag(
    tag_id: int,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    tag = db.query(Tag).filter(Tag.id == tag_id, Tag.user_id == user_id).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Тег не найден")
    db.delete(tag)
    db.commit()
