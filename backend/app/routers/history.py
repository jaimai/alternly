"""Journal du foyer (historique des modifications), en lecture seule."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db
from ..deps import get_membership
from ..models import AuditLog, HouseholdMember, User
from ..schemas import HistoryEntryOut
from ..services import audit

router = APIRouter(prefix="/api/households/{household_id}", tags=["history"])

HISTORY_MAX = 100


@router.get("/history", response_model=list[HistoryEntryOut])
def household_history(
    limit: int = Query(50, ge=1),
    before_id: int | None = Query(None),
    member: HouseholdMember = Depends(get_membership),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Journal du foyer, du plus récent au plus ancien (pagination par before_id).
    Résumés rendus dans la langue de l'utilisateur (fr/en)."""
    stmt = select(AuditLog).where(AuditLog.household_id == member.household_id)
    if before_id is not None:
        stmt = stmt.where(AuditLog.id < before_id)
    entries = db.scalars(stmt.order_by(AuditLog.id.desc()).limit(min(limit, HISTORY_MAX))).all()
    ctx = audit.make_ctx(db, member.household_id, user.locale)
    return [
        HistoryEntryOut(
            id=e.id, actor_id=e.actor_id, action=e.action, summary=audit.render_summary(ctx, e),
            created_at=e.created_at,
        )
        for e in entries
    ]
