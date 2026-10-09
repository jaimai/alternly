"""Données personnelles d'un compte : export (portabilité RGPD) et
suppression / anonymisation (droit à l'effacement).

- Dernier parent réel du foyer → suppression complète du foyer et de ses données.
- Un co-parent réel subsiste → anonymisation en place : les PII du parent partant
  sont effacées et son e-mail libéré, mais l'historique partagé (dépenses, calendrier)
  reste cohérent pour le co-parent (le compte devient un « placeholder »).
"""
from sqlalchemy import delete, inspect, select
from sqlalchemy.orm import Session

from ..deps import household_members, notify
from . import audit
from .change_requests import summary as change_request_summary
from .change_requests import withdraw_pending_for_leaving
from ..models import (
    AuditLog,
    ChangeRequest,
    Child,
    CustodyRule,
    DeviceToken,
    EmailLog,
    Expense,
    Household,
    HouseholdMember,
    Invitation,
    Notification,
    PasswordResetToken,
    ScheduleException,
    SchoolVacationPeriod,
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
_USER_PRIVATE = {"password_hash", "ical_token", "token_version"}


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
        members.append({
            "user_id": m.user_id,
            "display_name": u.display_name if u else None,
            "role": m.role,
            "is_placeholder": bool(u.is_placeholder) if u else False,
        })
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
        "country": household.country,
        "currency": household.currency,
        "school_zone": household.school_zone,
        "created_at": household.created_at,
        "my_role": member.role,
        "members": members,
        "children": _rows(db, Child, hid),
        "custody_rules": _rows(db, CustodyRule, hid),
        "vacation_rules": _rows(db, VacationRule, hid),
        "special_day_rules": _rows(db, SpecialDayRule, hid),
        "school_vacations": _rows(db, SchoolVacationPeriod, hid),
        "schedule_exceptions": _rows(db, ScheduleException, hid),
        "expenses": _rows(db, Expense, hid),
        "settlements": _rows(db, Settlement, hid),
        "wall_posts": posts,
        "change_requests": [
            {**_row(cr, {"household_id", "context"}), "summary": change_request_summary(db, cr, user.locale)}
            for cr in db.scalars(select(ChangeRequest).where(ChangeRequest.household_id == hid).order_by(ChangeRequest.id))
        ],
        "history": history_rows(db, hid, user.locale),
    }
    return data


def history_rows(db: Session, household_id: int, locale: str | None) -> list[dict]:
    """Journal du foyer, résumés rendus dans la langue du lecteur."""
    ctx = audit.make_ctx(db, household_id, locale)
    return [
        {"id": e.id, "actor_id": e.actor_id, "action": e.action, "summary": audit.render_summary(ctx, e),
         "created_at": e.created_at}
        for e in db.scalars(select(AuditLog).where(AuditLog.household_id == household_id).order_by(AuditLog.id))
    ]


def _delete_user_rows(db: Session, user_ids: list[int]) -> None:
    """Lignes personnelles rattachées à un compte (hors foyer)."""
    db.execute(delete(Notification).where(Notification.user_id.in_(user_ids)))
    db.execute(delete(PasswordResetToken).where(PasswordResetToken.user_id.in_(user_ids)))
    db.execute(delete(EmailLog).where(EmailLog.user_id.in_(user_ids)))
    db.execute(delete(DeviceToken).where(DeviceToken.user_id.in_(user_ids)))


def _delete_household(db: Session, household_id: int) -> None:
    member_ids = [m.user_id for m in household_members(db, household_id)]

    db.execute(delete(AuditLog).where(AuditLog.household_id == household_id))
    db.execute(delete(ChangeRequest).where(ChangeRequest.household_id == household_id))
    post_ids = [p.id for p in db.scalars(select(WallPost).where(WallPost.household_id == household_id))]
    if post_ids:
        db.execute(delete(WallReply).where(WallReply.post_id.in_(post_ids)))

    for model in (
        WallPost, Expense, Settlement, ScheduleException, SchoolVacationPeriod,
        SpecialDayRule, VacationRule, CustodyRule, Child, Invitation, HouseholdMember,
    ):
        db.execute(delete(model).where(model.household_id == household_id))

    if member_ids:
        _delete_user_rows(db, member_ids)
        db.execute(delete(User).where(User.id.in_(member_ids)))

    db.execute(delete(Household).where(Household.id == household_id))


def _anonymize(db: Session, user: User) -> None:
    _delete_user_rows(db, [user.id])
    user.email = f"deleted-{user.id}-{new_token()}@alternly.invalid"
    user.password_hash = ""  # inutilisable : plus aucune connexion possible
    user.google_sub = None  # plus de connexion via Google non plus
    user.display_name = "Ancien parent"
    user.is_placeholder = True
    user.email_opt_in = False
    user.subscription_status = "none"
    user.paddle_customer_id = None
    user.paddle_subscription_id = None
    user.ical_token = new_token()  # flux iCal de l'ancien parent coupé
    user.token_version = (user.token_version or 0) + 1  # jetons émis révoqués


def delete_account(db: Session, user: User) -> None:
    """Supprime le compte et les données personnelles de l'utilisateur. Ne commit pas."""
    member = db.scalar(select(HouseholdMember).where(HouseholdMember.user_id == user.id))
    if member is None:
        _delete_user_rows(db, [user.id])
        db.execute(delete(User).where(User.id == user.id))
        return

    others_real = [
        m for m in household_members(db, member.household_id)
        if m.user_id != user.id and not (db.get(User, m.user_id) or User()).is_placeholder
    ]
    if others_real:
        old_name = user.display_name
        _anonymize(db, user)
        withdraw_pending_for_leaving(db, member.household_id)
        audit.record(db, member.household_id, user.id, "member.leave", "member", user.id)
        for m in others_real:
            notify(db, m.user_id, "parent_left", {"display_name": old_name})
    else:
        _delete_household(db, member.household_id)
