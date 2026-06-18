"""
Шеринг поездок: инвайты и управление участниками.
"""
import os
import secrets
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from auth import get_current_user_id
from models import Trip, TripShare, User, get_db
from access import get_trip_role

router = APIRouter(tags=["sharing"])

BOT_TOKEN            = os.getenv("BOT_TOKEN", "")
TELEGRAM_BOT_USERNAME = os.getenv("TELEGRAM_BOT_USERNAME", "")
TELEGRAM_APP_NAME    = os.getenv("TELEGRAM_APP_NAME", "")


# ─── Уведомления ──────────────────────────────────────────────────────────────

def _send_tg(chat_id: int, text: str):
    """Синхронная отправка сообщения через Telegram Bot API."""
    if not BOT_TOKEN or not chat_id:
        return
    import urllib.request, json as _json
    payload = _json.dumps({"chat_id": chat_id, "text": text}).encode()
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass


async def _notify_owner(owner_id: int, member_name: str, trip_title: str):
    _send_tg(owner_id, f"✅ {member_name} принял приглашение в поездку «{trip_title}»")


async def _notify_removed_member(member_id: int, owner_name: str, trip_title: str):
    _send_tg(member_id, f"❌ {owner_name} удалил(а) вас из поездки «{trip_title}»")


# ─── POST /api/trips/{trip_id}/invites ───────────────────────────────────────

class InviteCreate(BaseModel):
    role: str = "reader"   # "reader" | "editor"


@router.post("/api/trips/{trip_id}/invites")
def create_invite(
    trip_id: int,
    body: InviteCreate,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Создаёт одноразовую инвайт-ссылку. Только владелец поездки."""
    trip = db.query(Trip).filter(Trip.id == trip_id, Trip.user_id == user_id).first()
    if not trip:
        raise HTTPException(404, "Поездка не найдена или нет прав")
    if body.role not in ("reader", "editor"):
        raise HTTPException(400, "role должен быть reader или editor")

    token = secrets.token_urlsafe(24)
    share = TripShare(trip_id=trip_id, owner_id=user_id, role=body.role, invite_token=token)
    db.add(share)
    db.commit()

    if TELEGRAM_BOT_USERNAME and TELEGRAM_APP_NAME:
        link = f"https://t.me/{TELEGRAM_BOT_USERNAME}/{TELEGRAM_APP_NAME}?startapp=inv_{token}"
    else:
        link = None

    return {"token": token, "link": link, "role": body.role}


# ─── GET /api/trips/{trip_id}/members ────────────────────────────────────────

@router.get("/api/trips/{trip_id}/members")
def list_members(
    trip_id: int,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Список участников поездки. Только владелец."""
    trip = db.query(Trip).filter(Trip.id == trip_id, Trip.user_id == user_id).first()
    if not trip:
        raise HTTPException(404, "Поездка не найдена или нет прав")

    shares = db.query(TripShare).filter(TripShare.trip_id == trip_id).all()
    result = []
    for s in shares:
        member = db.query(User).filter(User.id == s.member_id).first() if s.member_id else None
        result.append({
            "share_id":        s.id,
            "member_id":       s.member_id,
            "member_name":     f"{member.first_name} {member.last_name or ''}".strip() if member else None,
            "member_username": member.username if member else None,
            "role":            s.role,
            "accepted":        s.accepted,
            "invite_token":    s.invite_token,
        })
    return result


# ─── PATCH /api/trips/{trip_id}/members/{share_id} ───────────────────────────

class MemberUpdate(BaseModel):
    role: str


@router.patch("/api/trips/{trip_id}/members/{share_id}")
def update_member_role(
    trip_id: int,
    share_id: int,
    body: MemberUpdate,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    trip = db.query(Trip).filter(Trip.id == trip_id, Trip.user_id == user_id).first()
    if not trip:
        raise HTTPException(404, "Поездка не найдена или нет прав")
    share = db.query(TripShare).filter(
        TripShare.id == share_id, TripShare.trip_id == trip_id
    ).first()
    if not share:
        raise HTTPException(404, "Участник не найден")
    if body.role not in ("reader", "editor"):
        raise HTTPException(400, "role должен быть reader или editor")
    share.role = body.role
    db.commit()
    return {"ok": True}


# ─── DELETE /api/trips/{trip_id}/members/{share_id} ──────────────────────────

@router.delete("/api/trips/{trip_id}/members/{share_id}", status_code=204)
async def remove_member(
    trip_id: int,
    share_id: int,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    trip = db.query(Trip).filter(Trip.id == trip_id, Trip.user_id == user_id).first()
    if not trip:
        raise HTTPException(404, "Поездка не найдена или нет прав")
    share = db.query(TripShare).filter(
        TripShare.id == share_id, TripShare.trip_id == trip_id
    ).first()
    if not share:
        raise HTTPException(404, "Участник не найден")

    # Сохраняем данные до удаления, чтобы отправить уведомление
    removed_member_id = share.member_id
    was_accepted = share.accepted

    db.delete(share)
    # Если больше нет принятых шеров — сбрасываем is_shared
    remaining = db.query(TripShare).filter(
        TripShare.trip_id == trip_id, TripShare.accepted == True,
        TripShare.id != share_id,
    ).count()
    if remaining == 0:
        trip = db.query(Trip).filter(Trip.id == trip_id).first()
        if trip:
            trip.is_shared = False
    db.commit()

    # Уведомляем участника (только если он уже принял приглашение)
    if was_accepted and removed_member_id:
        owner = db.query(User).filter(User.id == user_id).first()
        owner_name = f"{owner.first_name} {owner.last_name or ''}".strip() if owner else "Владелец"
        await _notify_removed_member(removed_member_id, owner_name, trip.title)


# ─── GET /api/invites/{token} (без авторизации) ───────────────────────────────

@router.get("/api/invites/{token}")
def get_invite_info(
    token: str,
    db: Session = Depends(get_db),
):
    """Публичный эндпоинт — возвращает инфо об инвайте без авторизации."""
    share = db.query(TripShare).filter(TripShare.invite_token == token).first()
    if not share:
        raise HTTPException(404, "Инвайт не найден")
    if share.accepted:
        raise HTTPException(410, "Инвайт уже использован")

    trip  = db.query(Trip).filter(Trip.id == share.trip_id).first()
    owner = db.query(User).filter(User.id == share.owner_id).first()
    return {
        "token":       token,
        "trip_id":     share.trip_id,
        "trip_title":  trip.title if trip else "",
        "role":        share.role,
        "owner_name":  f"{owner.first_name} {owner.last_name or ''}".strip() if owner else "",
        "owner_username": owner.username if owner else None,
    }


# ─── POST /api/invites/{token}/accept ────────────────────────────────────────

@router.post("/api/invites/{token}/accept")
async def accept_invite(
    token: str,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    share = db.query(TripShare).filter(TripShare.invite_token == token).first()
    if not share:
        raise HTTPException(404, "Инвайт не найден")
    if share.accepted:
        raise HTTPException(410, "Инвайт уже использован")

    trip = db.query(Trip).filter(Trip.id == share.trip_id).first()
    if not trip:
        raise HTTPException(404, "Поездка не найдена")

    if trip.user_id == user_id:
        raise HTTPException(400, "Вы владелец этой поездки")

    existing = db.query(TripShare).filter(
        TripShare.trip_id == share.trip_id,
        TripShare.member_id == user_id,
        TripShare.accepted == True,
    ).first()
    if existing:
        raise HTTPException(400, "Вы уже участник этой поездки")

    share.member_id = user_id
    share.accepted  = True
    trip.is_shared  = True
    db.commit()

    # Уведомляем владельца
    member = db.query(User).filter(User.id == user_id).first()
    member_name = f"{member.first_name} {member.last_name or ''}".strip() if member else "Пользователь"
    await _notify_owner(share.owner_id, member_name, trip.title)

    return {"ok": True, "trip_id": share.trip_id, "role": share.role, "share_id": share.id}


# ─── PATCH /api/shares/{share_id}/downgrade-to-reader ────────────────────────

@router.patch("/api/shares/{share_id}/downgrade-to-reader")
def downgrade_to_reader(
    share_id: int,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Участник понижает свою роль с editor до reader (сам, без участия владельца)."""
    share = db.query(TripShare).filter(
        TripShare.id == share_id,
        TripShare.member_id == user_id,
        TripShare.accepted == True,
    ).first()
    if not share:
        raise HTTPException(404, "Участие не найдено")
    share.role = "reader"
    share.edit_request_status = None
    db.commit()
    return {"ok": True}


# ─── POST /api/trips/{trip_id}/request-editor ─────────────────────────────────

@router.post("/api/trips/{trip_id}/request-editor")
def request_editor_access(
    trip_id: int,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Читатель запрашивает доступ на редактирование."""
    share = db.query(TripShare).filter(
        TripShare.trip_id == trip_id,
        TripShare.member_id == user_id,
        TripShare.accepted == True,
        TripShare.role == "reader",
    ).first()
    if not share:
        raise HTTPException(404, "Вы не являетесь читателем этой поездки")

    share.edit_request_status = "pending"
    db.commit()

    trip  = db.query(Trip).filter(Trip.id == trip_id).first()
    owner = db.query(User).filter(User.id == share.owner_id).first()
    member = db.query(User).filter(User.id == user_id).first()
    member_name = f"{member.first_name} {member.last_name or ''}".strip() if member else "Пользователь"
    trip_title  = trip.title if trip else ""

    _send_tg(
        share.owner_id,
        f"✏️ {member_name} запрашивает доступ на редактирование поездки «{trip_title}»",
    )
    return {"ok": True}


# ─── POST /api/trips/{trip_id}/edit-requests/{share_id}/accept ───────────────

@router.post("/api/trips/{trip_id}/edit-requests/{share_id}/accept")
def accept_editor_request(
    trip_id:  int,
    share_id: int,
    user_id:  int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Владелец принимает запрос на редактирование."""
    trip = db.query(Trip).filter(Trip.id == trip_id, Trip.user_id == user_id).first()
    if not trip:
        raise HTTPException(404, "Поездка не найдена или нет прав")
    share = db.query(TripShare).filter(
        TripShare.id == share_id, TripShare.trip_id == trip_id,
    ).first()
    if not share:
        raise HTTPException(404, "Запрос не найден")

    share.role               = "editor"
    share.edit_request_status = "accepted"
    db.commit()

    owner  = db.query(User).filter(User.id == user_id).first()
    owner_name = f"{owner.first_name} {owner.last_name or ''}".strip() if owner else "Владелец"
    _send_tg(
        share.member_id,
        f"✅ {owner_name} выдал(а) Ваш доступ на редактирование поездки «{trip.title}»",
    )
    return {"ok": True}


# ─── POST /api/trips/{trip_id}/edit-requests/{share_id}/decline ──────────────

@router.post("/api/trips/{trip_id}/edit-requests/{share_id}/decline")
def decline_editor_request(
    trip_id:  int,
    share_id: int,
    user_id:  int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Владелец отклоняет запрос на редактирование."""
    trip = db.query(Trip).filter(Trip.id == trip_id, Trip.user_id == user_id).first()
    if not trip:
        raise HTTPException(404, "Поездка не найдена или нет прав")
    share = db.query(TripShare).filter(
        TripShare.id == share_id, TripShare.trip_id == trip_id,
    ).first()
    if not share:
        raise HTTPException(404, "Запрос не найден")

    share.edit_request_status = "declined"
    db.commit()

    owner  = db.query(User).filter(User.id == user_id).first()
    owner_name = f"{owner.first_name} {owner.last_name or ''}".strip() if owner else "Владелец"
    _send_tg(
        share.member_id,
        f"❌ {owner_name} отклонил(а) Ваш запрос доступа на редактирование поездки «{trip.title}»",
    )
    return {"ok": True}


# ─── PATCH /api/shares/{share_id}/dismiss-edit-request ───────────────────────

@router.patch("/api/shares/{share_id}/dismiss-edit-request")
def dismiss_edit_request(
    share_id: int,
    user_id: int = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    """Читатель подтверждает, что видел ответ (сбрасывает статус)."""
    share = db.query(TripShare).filter(
        TripShare.id == share_id,
        TripShare.member_id == user_id,
        TripShare.accepted == True,
    ).first()
    if not share:
        raise HTTPException(404, "Участие не найдено")
    share.edit_request_status = None
    db.commit()
    return {"ok": True}
