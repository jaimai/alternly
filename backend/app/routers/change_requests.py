"""Demandes de changement soumises à l'accord de l'autre parent, et historique du foyer."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_membership, notify
from ..models import AuditLog, ChangeRequest, HouseholdMember, utcnow
from ..schemas import ChangeRequestOut, HistoryEntryOut
from ..services import audit
from ..services import change_requests as cr_service

router = APIRouter(prefix="/api/households/{household_id}", tags=["change_requests"])

HISTORY_MAX = 100


@router.get("/change-requests", response_model=list[ChangeRequestOut])
def list_change_requests(
    status: str = Query("pending", pattern="^(pending|all)$"),
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    stmt = select(ChangeRequest).where(ChangeRequest.household_id == member.household_id)
    if status == "pending":
        stmt = stmt.where(ChangeRequest.status == "pending")
    return db.scalars(stmt.order_by(ChangeRequest.id.desc())).all()


def _get_pending(db: Session, member: HouseholdMember, request_id: int) -> ChangeRequest:
    cr = db.get(ChangeRequest, request_id)
    if cr is None or cr.household_id != member.household_id:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    if cr.status != "pending":
        raise HTTPException(status_code=409, detail="Cette demande n'est plus en attente")
    return cr


def _resolve(cr: ChangeRequest, member: HouseholdMember, status: str) -> None:
    cr.status = status
    cr.resolved_by = member.user_id
    cr.resolved_at = utcnow()


@router.post("/change-requests/{request_id}/accept", response_model=ChangeRequestOut)
def accept_change_request(
    request_id: int,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    cr = _get_pending(db, member, request_id)
    if member.user_id == cr.requested_by:
        raise HTTPException(status_code=403, detail="Seul l'autre parent peut accepter cette demande")
    try:
        # Toute la revalidation précède la moindre écriture : rien à annuler en cas de conflit.
        cr_service.apply_request(db, cr)
    except cr_service.ChangeConflict as e:
        _resolve(cr, member, "refused")
        audit.record(
            db, cr.household_id, member.user_id, "change_request.refuse", "change_request", cr.id,
            f"n'a pas pu appliquer la demande, devenue caduque : {cr.summary}",
        )
        notify(db, cr.requested_by, "change_refused", {"id": cr.id, "summary": cr.summary})
        db.commit()
        raise HTTPException(status_code=409, detail=f"Demande caduque : {e}")
    _resolve(cr, member, "accepted")
    audit.record(
        db, cr.household_id, member.user_id, "change_request.accept", "change_request", cr.id,
        f"a accepté le changement : {cr.summary}",
    )
    notify(db, cr.requested_by, "change_accepted", {"id": cr.id, "summary": cr.summary})
    db.commit()
    db.refresh(cr)
    return cr


@router.post("/change-requests/{request_id}/refuse", response_model=ChangeRequestOut)
def refuse_change_request(
    request_id: int,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    cr = _get_pending(db, member, request_id)
    if member.user_id == cr.requested_by:
        raise HTTPException(status_code=403, detail="Seul l'autre parent peut refuser cette demande")
    _resolve(cr, member, "refused")
    audit.record(
        db, cr.household_id, member.user_id, "change_request.refuse", "change_request", cr.id,
        f"a refusé le changement : {cr.summary}",
    )
    notify(db, cr.requested_by, "change_refused", {"id": cr.id, "summary": cr.summary})
    db.commit()
    db.refresh(cr)
    return cr


@router.post("/change-requests/{request_id}/withdraw", response_model=ChangeRequestOut)
def withdraw_change_request(
    request_id: int,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    cr = _get_pending(db, member, request_id)
    if member.user_id != cr.requested_by:
        raise HTTPException(status_code=403, detail="Seul l'auteur peut retirer sa demande")
    _resolve(cr, member, "withdrawn")
    audit.record(
        db, cr.household_id, member.user_id, "change_request.withdraw", "change_request", cr.id,
        f"a retiré sa demande : {cr.summary}",
    )
    db.commit()
    db.refresh(cr)
    return cr


@router.get("/history", response_model=list[HistoryEntryOut])
def household_history(
    limit: int = Query(50, ge=1),
    before_id: int | None = Query(None),
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    """Journal du foyer, du plus récent au plus ancien (pagination par before_id)."""
    stmt = select(AuditLog).where(AuditLog.household_id == member.household_id)
    if before_id is not None:
        stmt = stmt.where(AuditLog.id < before_id)
    return db.scalars(stmt.order_by(AuditLog.id.desc()).limit(min(limit, HISTORY_MAX))).all()
