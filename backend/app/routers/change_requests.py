"""Demandes de changement soumises à l'accord de l'autre parent."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db
from ..deps import get_membership
from ..models import ChangeRequest, HouseholdMember, User, utcnow
from ..schemas import ChangeRequestOut
from ..services import analytics
from ..services import change_requests as cr_service

router = APIRouter(prefix="/api/households/{household_id}", tags=["change_requests"])


@router.get("/change-requests", response_model=list[ChangeRequestOut])
def list_change_requests(
    status: str = Query("pending", pattern="^(pending|all)$"),
    member: HouseholdMember = Depends(get_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    stmt = select(ChangeRequest).where(ChangeRequest.household_id == member.household_id)
    if status == "pending":
        stmt = stmt.where(ChangeRequest.status == "pending")
    rows = db.scalars(stmt.order_by(ChangeRequest.id.desc())).all()
    return [cr_service.to_out(db, cr, user.locale) for cr in rows]


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


def _track(db: Session, member: HouseholdMember, cr: ChangeRequest, outcome: str) -> None:
    analytics.capture_for_member(db, member, "change_request_resolved", {"kind": cr.kind, "status": outcome})


@router.post("/change-requests/{request_id}/accept", response_model=ChangeRequestOut)
def accept_change_request(
    request_id: int,
    member: HouseholdMember = Depends(get_membership),
    user: User = Depends(get_current_user),
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
        cr_service.journal(db, cr, member.user_id, "change_request.outdated")
        cr_service.notify_about(db, cr.requested_by, "change_refused", cr)
        db.commit()
        _track(db, member, cr, "outdated")
        raise HTTPException(status_code=409, detail=f"Demande caduque : {e}")
    _resolve(cr, member, "accepted")
    cr_service.journal(db, cr, member.user_id, "change_request.accept")
    cr_service.notify_about(db, cr.requested_by, "change_accepted", cr)
    db.commit()
    db.refresh(cr)
    _track(db, member, cr, "accepted")
    return cr_service.to_out(db, cr, user.locale)


@router.post("/change-requests/{request_id}/refuse", response_model=ChangeRequestOut)
def refuse_change_request(
    request_id: int,
    member: HouseholdMember = Depends(get_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cr = _get_pending(db, member, request_id)
    if member.user_id == cr.requested_by:
        raise HTTPException(status_code=403, detail="Seul l'autre parent peut refuser cette demande")
    _resolve(cr, member, "refused")
    cr_service.journal(db, cr, member.user_id, "change_request.refuse")
    cr_service.notify_about(db, cr.requested_by, "change_refused", cr)
    db.commit()
    db.refresh(cr)
    _track(db, member, cr, "refused")
    return cr_service.to_out(db, cr, user.locale)


@router.post("/change-requests/{request_id}/withdraw", response_model=ChangeRequestOut)
def withdraw_change_request(
    request_id: int,
    member: HouseholdMember = Depends(get_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    cr = _get_pending(db, member, request_id)
    if member.user_id != cr.requested_by:
        raise HTTPException(status_code=403, detail="Seul l'auteur peut retirer sa demande")
    _resolve(cr, member, "withdrawn")
    cr_service.journal(db, cr, member.user_id, "change_request.withdraw")
    db.commit()
    db.refresh(cr)
    _track(db, member, cr, "withdrawn")
    return cr_service.to_out(db, cr, user.locale)
