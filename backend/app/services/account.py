"""Données personnelles d'un compte : export (portabilité RGPD) et suppression."""
import secrets

from sqlalchemy import delete, inspect, select
from sqlalchemy.orm import Session

from ..deps import household_members, notify
from . import audit
from .change_requests import withdraw_pending_for_leaving
from ..models import (
    AuditLog,
    ChangeRequest,
    Child,
    CustodyRule,
    Expense,
    Household,
    HouseholdMember,
    Invitation,
    Notification,
    PasswordResetToken,
    ScheduleException,
    Settlement,
    SpecialDayRule,
    User,
    VacationRule,
    WallPost,
    WallReply,
    new_token,
    utcnow,
)

# Colonnes jamais exportées (secrets / internes).
_USER_PRIVATE = {"password_hash", "ical_token", "token_version", "deleted_at"}


def _row(obj, exclude: set[str] = frozenset()) -> dict:
    return {
        attr.key: getattr(obj, attr.key)
        for attr in inspect(obj).mapper.column_attrs
        if attr.key not in exclude
    }


def _rows(db: Session, model, household_id: int) -> list[dict]:
    stmt = select(model).where(model.household_id == household_id).order_by(model.id)
    return [_row(o, {"household_id"}) for o in db.scalars(stmt)]


def export_user_data(db: Session, user: User) -> dict:
    """Toutes les données visibles par l'utilisateur, en structure JSON-sérialisable
    (dates à passer par jsonable_encoder)."""
    data: dict = {
        "exported_at": utcnow().isoformat() + "Z",
        "user": _row(user, _USER_PRIVATE),
        "household": None,
        "notifications": [
            _row(n, {"user_id"})
            for n in db.scalars(select(Notification).where(Notification.user_id == user.id).order_by(Notification.id))
        ],
    }
    member = db.scalar(select(HouseholdMember).where(HouseholdMember.user_id == user.id))
    if member is None:
        return data
    hid = member.household_id
    household = db.get(Household, hid)
    members = []
    for m in household_members(db, hid):
        u = db.get(User, m.user_id)
        members.append({"user_id": m.user_id, "display_name": u.display_name if u else None, "role": m.role})
    posts = []
    for p in db.scalars(select(WallPost).where(WallPost.household_id == hid).order_by(WallPost.id)):
        post = _row(p, {"household_id"})
        post["replies"] = [
            _row(r, {"post_id"})
            for r in db.scalars(select(WallReply).where(WallReply.post_id == p.id).order_by(WallReply.id))
        ]
        posts.append(post)
    data["household"] = {
        "id": household.id,
        "name": household.name,
        "school_zone": household.school_zone,
        "created_at": household.created_at,
        "my_role": member.role,
        "members": members,
        "children": _rows(db, Child, hid),
        "custody_rules": _rows(db, CustodyRule, hid),
        "vacation_rules": _rows(db, VacationRule, hid),
        "special_day_rules": _rows(db, SpecialDayRule, hid),
        "schedule_exceptions": _rows(db, ScheduleException, hid),
        "expenses": _rows(db, Expense, hid),
        "settlements": _rows(db, Settlement, hid),
        "wall_posts": posts,
        "change_requests": _rows(db, ChangeRequest, hid),
        "history": _rows(db, AuditLog, hid),
    }
    return data


def _delete_household(db: Session, household_id: int) -> None:
    """Supprime un foyer et toutes ses données (ordre compatible clés étrangères)."""
    db.execute(delete(AuditLog).where(AuditLog.household_id == household_id))
    db.execute(delete(ChangeRequest).where(ChangeRequest.household_id == household_id))
    post_ids = select(WallPost.id).where(WallPost.household_id == household_id)
    db.execute(delete(WallReply).where(WallReply.post_id.in_(post_ids)))
    db.execute(delete(WallPost).where(WallPost.household_id == household_id))
    db.execute(delete(Expense).where(Expense.household_id == household_id))  # avant children (child_id)
    db.execute(delete(Settlement).where(Settlement.household_id == household_id))
    # Auto-référence replaces_id : une seule instruction (contrôle FK en fin d'instruction).
    db.execute(delete(ScheduleException).where(ScheduleException.household_id == household_id))
    db.execute(delete(Child).where(Child.household_id == household_id))
    db.execute(delete(CustodyRule).where(CustodyRule.household_id == household_id))
    db.execute(delete(VacationRule).where(VacationRule.household_id == household_id))
    db.execute(delete(SpecialDayRule).where(SpecialDayRule.household_id == household_id))
    db.execute(delete(Invitation).where(Invitation.household_id == household_id))
    db.execute(delete(HouseholdMember).where(HouseholdMember.household_id == household_id))
    db.execute(delete(Household).where(Household.id == household_id))


def _delete_user_rows(db: Session, user_id: int) -> None:
    db.execute(delete(Notification).where(Notification.user_id == user_id))
    db.execute(delete(PasswordResetToken).where(PasswordResetToken.user_id == user_id))


def delete_account(db: Session, user: User) -> None:
    """Supprime le compte (sans commit).

    - Seul parent actif du foyer → foyer et toutes ses données supprimés, puis le
      compte (ainsi que d'éventuels ex-parents déjà anonymisés de ce foyer).
    - Un coparent reste → anonymisation : l'historique partagé (dépenses, soldes,
      mur, échanges) reste cohérent pour lui ; la ligne de membre est conservée.
    """
    member = db.scalar(select(HouseholdMember).where(HouseholdMember.user_id == user.id))
    others = [] if member is None else [
        db.get(User, m.user_id) for m in household_members(db, member.household_id) if m.user_id != user.id
    ]
    active_others = [u for u in others if u is not None and u.deleted_at is None]

    if active_others:
        old_name = user.display_name
        user.deleted_at = utcnow()
        user.email = f"deleted-{user.id}@deleted.invalid"
        user.display_name = "Ancien parent"
        user.password_hash = "!" + secrets.token_hex(32)  # hash bcrypt invalide : aucune connexion possible
        user.ical_token = new_token()
        user.email_opt_in = False
        user.token_version = (user.token_version or 0) + 1
        _delete_user_rows(db, user.id)
        withdraw_pending_for_leaving(db, member.household_id)
        audit.record(
            db, member.household_id, user.id, "member.leave", "member", user.id,
            "a quitté le foyer (compte supprimé)",
        )
        for other in active_others:
            notify(db, other.id, "parent_left", {"display_name": old_name})
        return

    if member is not None:
        _delete_household(db, member.household_id)
    for u in [user, *(o for o in others if o is not None)]:
        _delete_user_rows(db, u.id)
        db.execute(delete(User).where(User.id == u.id))
