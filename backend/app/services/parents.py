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

# Nom par défaut du second parent placeholder, selon la langue du créateur.
DEFAULT_PARTNER_NAME_BY_LOCALE = {"fr": "L'autre parent", "en": "Co-parent"}
DEFAULT_PARTNER_NAME = DEFAULT_PARTNER_NAME_BY_LOCALE["fr"]
PLACEHOLDER_COLOR = "#c9784f"
# Couleurs de repli pour le placeholder, dans l'ordre de préférence : la première
# assez éloignée de celle du parent réel est retenue (palette de l'app).
_PLACEHOLDER_CHOICES = (PLACEHOLDER_COLOR, "#2f6b57", "#4a6fa5", "#8a5a9e", "#c9a227", "#5b8f8a")
# Distance RGB minimale pour que deux parents se distinguent d'un coup d'œil sur
# le calendrier (terracotta #c96f4a et #c9784f : ~10, pin #2f6b57 et terracotta : ~200).
_MIN_COLOR_DISTANCE = 100


def _rgb(color: str) -> tuple[int, int, int] | None:
    c = (color or "").lstrip("#")
    if len(c) != 6:
        return None
    try:
        return int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16)
    except ValueError:
        return None


def color_distance(a: str, b: str) -> float:
    ra, rb = _rgb(a), _rgb(b)
    if ra is None or rb is None:
        return 999.0
    return sum((x - y) ** 2 for x, y in zip(ra, rb)) ** 0.5


def contrasting_color(avoid: str | None) -> str:
    """Couleur du placeholder bien distincte de `avoid` (celle du parent réel)."""
    if not avoid:
        return PLACEHOLDER_COLOR
    for color in _PLACEHOLDER_CHOICES:
        if color_distance(color, avoid) >= _MIN_COLOR_DISTANCE:
            return color
    return PLACEHOLDER_COLOR

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


def placeholder_member(db: Session, household_id: int) -> HouseholdMember | None:
    for m in db.scalars(
        select(HouseholdMember).where(HouseholdMember.household_id == household_id)
    ):
        u = db.get(User, m.user_id)
        if u is not None and u.is_placeholder:
            return m
    return None


def ensure_second_parent(
    db: Session, household_id: int, name: str | None = None, locale: str = "fr"
) -> User | None:
    """Garantit qu'un second parent existe. Crée un placeholder si le foyer n'a
    qu'un membre. Idempotent : ne fait rien si deux membres existent déjà.
    Le nom par défaut suit la langue du créateur (`locale`).
    Renvoie le placeholder créé, sinon None. Ne commit pas."""
    members = list(
        db.scalars(select(HouseholdMember).where(HouseholdMember.household_id == household_id))
    )
    if len(members) >= 2:
        return None
    default_name = DEFAULT_PARTNER_NAME_BY_LOCALE.get(locale, DEFAULT_PARTNER_NAME)
    owner = db.get(User, members[0].user_id) if members else None
    ghost = User(
        email=f"placeholder-{household_id}-{new_token()}@alternly.invalid",
        password_hash="",  # inutilisable : aucune connexion possible
        display_name=(name or default_name),
        color=contrasting_color(owner.color if owner else None),
        is_placeholder=True,
        email_opt_in=False,
        subscription_status="none",
    )
    db.add(ghost)
    db.flush()
    db.add(HouseholdMember(household_id=household_id, user_id=ghost.id, role="parent2"))
    return ghost


def fix_placeholder_color(db: Session, household_id: int) -> bool:
    """Si le placeholder a (presque) la couleur du parent réel — parent qui a choisi
    terracotta, ou qui a changé de couleur depuis —, lui en donne une distincte.
    Renvoie True si une couleur a changé. Ne commit pas."""
    ghost_member = placeholder_member(db, household_id)
    if ghost_member is None:
        return False
    ghost = db.get(User, ghost_member.user_id)
    real = [
        u for m in db.scalars(select(HouseholdMember).where(HouseholdMember.household_id == household_id))
        if (u := db.get(User, m.user_id)) is not None and not u.is_placeholder
    ]
    if not real or ghost is None:
        return False
    if color_distance(ghost.color, real[0].color) >= _MIN_COLOR_DISTANCE:
        return False
    ghost.color = contrasting_color(real[0].color)
    return True


def claim_placeholder(db: Session, household_id: int, real_user_id: int) -> bool:
    """Le vrai parent réclame le placeholder du foyer : bascule ses références
    vers le vrai compte, supprime l'adhésion puis le compte fantôme.
    Renvoie True si un placeholder a été réclamé. Ne commit pas."""
    member = placeholder_member(db, household_id)
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
