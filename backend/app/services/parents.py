"""Second parent « fantôme » (placeholder).

Un foyer solo dispose d'un second parent virtuel, non connectable, pour pouvoir
lui assigner des dépenses/tâches avant qu'il ne crée son compte. Quand le vrai
parent rejoint le foyer, il « réclame » le placeholder : toutes les références
qui le désignent basculent vers le vrai compte, puis le placeholder est supprimé.
"""
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..models import (
    CustodyRule,
    Expense,
    HouseholdMember,
    ScheduleException,
    Settlement,
    SpecialDayRule,
    User,
    VacationRule,
    WallPost,
    new_token,
)

DEFAULT_PARTNER_NAME = "L'autre parent"
PLACEHOLDER_COLOR = "#c9784f"

# Colonnes où un placeholder peut apparaître comme « sujet » (à qui l'on assigne
# quelque chose). Author/created_by ne sont jamais un placeholder : il n'agit pas.
_SUBJECT_COLUMNS = [
    (Expense, "paid_by"),
    (Settlement, "from_user"),
    (Settlement, "to_user"),
    (WallPost, "assigned_to"),
    (ScheduleException, "parent_id"),
    (CustodyRule, "reference_parent_id"),
    (VacationRule, "even_year_first_half_parent_id"),
    (SpecialDayRule, "parent_id"),
]


def _placeholder_member(db: Session, household_id: int) -> HouseholdMember | None:
    for m in db.scalars(
        select(HouseholdMember).where(HouseholdMember.household_id == household_id)
    ):
        u = db.get(User, m.user_id)
        if u is not None and u.is_placeholder:
            return m
    return None


def ensure_second_parent(db: Session, household_id: int, name: str | None = None) -> User | None:
    """Garantit qu'un second parent existe. Crée un placeholder si le foyer n'a
    qu'un membre. Idempotent : ne fait rien si deux membres existent déjà.
    Renvoie le placeholder créé, sinon None. Ne commit pas."""
    members = list(
        db.scalars(select(HouseholdMember).where(HouseholdMember.household_id == household_id))
    )
    if len(members) >= 2:
        return None
    ghost = User(
        email=f"placeholder-{household_id}-{new_token()}@alternly.invalid",
        password_hash="",  # inutilisable : aucune connexion possible
        display_name=(name or DEFAULT_PARTNER_NAME),
        color=PLACEHOLDER_COLOR,
        is_placeholder=True,
        email_opt_in=False,
        subscription_status="none",
    )
    db.add(ghost)
    db.flush()
    db.add(HouseholdMember(household_id=household_id, user_id=ghost.id, role="parent2"))
    return ghost


def claim_placeholder(db: Session, household_id: int, real_user_id: int) -> bool:
    """Le vrai parent réclame le placeholder du foyer : bascule ses références
    vers le vrai compte, supprime l'adhésion puis le compte fantôme.
    Renvoie True si un placeholder a été réclamé. Ne commit pas."""
    member = _placeholder_member(db, household_id)
    if member is None:
        return False
    ghost_id = member.user_id
    for model, column in _SUBJECT_COLUMNS:
        db.execute(
            update(model)
            .where(getattr(model, column) == ghost_id)
            .values({column: real_user_id})
        )
    db.delete(member)
    ghost = db.get(User, ghost_id)
    if ghost is not None:
        db.delete(ghost)
    return True
