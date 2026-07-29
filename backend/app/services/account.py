"""Suppression / anonymisation de compte (droit à l'effacement RGPD).

- Dernier parent réel du foyer → suppression complète du foyer et de ses données.
- Un co-parent réel subsiste → anonymisation en place : les PII du parent partant
  sont effacées et son e-mail libéré, mais l'historique partagé (dépenses, calendrier)
  reste cohérent pour le co-parent (le compte devient un « placeholder »).
"""
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from ..deps import household_members
from ..models import (
    Child,
    CustodyRule,
    Expense,
    Household,
    HouseholdMember,
    Invitation,
    Notification,
    ScheduleException,
    SchoolVacationPeriod,
    Settlement,
    SpecialDayRule,
    User,
    VacationRule,
    WallPost,
    WallReply,
    new_token,
)


def _delete_household(db: Session, household_id: int) -> None:
    member_ids = [m.user_id for m in household_members(db, household_id)]

    post_ids = [p.id for p in db.scalars(select(WallPost).where(WallPost.household_id == household_id))]
    if post_ids:
        db.execute(delete(WallReply).where(WallReply.post_id.in_(post_ids)))

    for model in (
        WallPost, Expense, Settlement, ScheduleException, SchoolVacationPeriod,
        SpecialDayRule, VacationRule, CustodyRule, Child, Invitation, HouseholdMember,
    ):
        db.execute(delete(model).where(model.household_id == household_id))

    if member_ids:
        db.execute(delete(Notification).where(Notification.user_id.in_(member_ids)))
        db.execute(delete(User).where(User.id.in_(member_ids)))

    db.execute(delete(Household).where(Household.id == household_id))


def _anonymize(db: Session, user: User) -> None:
    db.execute(delete(Notification).where(Notification.user_id == user.id))
    user.email = f"deleted-{user.id}-{new_token()}@alternly.invalid"
    user.password_hash = ""  # inutilisable : plus aucune connexion possible
    user.display_name = "Ancien parent"
    user.is_placeholder = True
    user.email_opt_in = False
    user.subscription_status = "none"
    user.paddle_customer_id = None
    user.paddle_subscription_id = None


def delete_account(db: Session, user: User) -> None:
    """Supprime le compte et les données personnelles de l'utilisateur. Ne commit pas."""
    member = db.scalar(select(HouseholdMember).where(HouseholdMember.user_id == user.id))
    if member is None:
        db.execute(delete(Notification).where(Notification.user_id == user.id))
        db.execute(delete(User).where(User.id == user.id))
        return

    others_real = [
        m for m in household_members(db, member.household_id)
        if m.user_id != user.id and not (db.get(User, m.user_id) or User()).is_placeholder
    ]
    if others_real:
        _anonymize(db, user)
    else:
        _delete_household(db, member.household_id)
