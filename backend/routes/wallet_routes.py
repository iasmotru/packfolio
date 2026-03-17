"""
Apple Wallet: генерация .pkpass для документов.
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response, JSONResponse
from sqlalchemy.orm import Session

from auth import get_current_user_id
from models import Document, get_db
from wallet import generate_pkpass, is_wallet_configured

router = APIRouter(prefix="/api/wallet", tags=["wallet"])


@router.get("/{doc_id}.pkpass")
def download_pkpass(
    doc_id:  int,
    user_id: int     = Depends(get_current_user_id),
    db:      Session = Depends(get_db),
):
    """
    Генерирует и отдаёт .pkpass файл для документа.
    Если Wallet не настроен — возвращает JSON с инструкцией.
    """
    if not is_wallet_configured():
        return JSONResponse(
            status_code=200,
            content={
                "error": "wallet_not_configured",
                "message": (
                    "Apple Wallet не настроен. "
                    "Задайте переменные окружения: "
                    "PASS_TYPE_ID, TEAM_ID, ORGANIZATION_NAME, "
                    "CERT_P12_BASE64, CERT_P12_PASSWORD, WWDR_CERT_BASE64."
                ),
                "doc_url": f"/api/documents/{doc_id}/file",
            },
        )

    doc = db.query(Document).filter(
        Document.id == doc_id, Document.user_id == user_id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Документ не найден")

    wd = doc.widget_data
    widget_data = wd.data if wd else {}

    try:
        pkpass_bytes = generate_pkpass(doc_id, doc.doc_type, widget_data)
    except ValueError as e:
        return JSONResponse(
            status_code=200,
            content={
                "error": "wallet_generation_failed",
                "message": str(e),
            },
        )

    return Response(
        content=pkpass_bytes,
        media_type="application/vnd.apple.pkpass",
        headers={
            "Content-Disposition": f'attachment; filename="packfolio-{doc_id}.pkpass"',
        },
    )
