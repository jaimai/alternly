"""Dépendances et helpers partagés entre routers."""
from fastapi import Depends, HTTPException, Path
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import get_current_user
from .db import get_db
from .models import Household, HouseholdMember, Notification, User, utcnow
from .services import billing


def _user_is_premium(db: Session, user: User) -> bool:
    return billing.has_access(
        user.subscription_status, user.trial_ends_at, user.subscription_ends_at, utcnow()
    )


def household_has_premium(db: Session, household_id: int) -> bool:
    """Premium au niveau du foyer : un seul membre abonné débloque tout le foyer."""
    for m in db.scalars(select(HouseholdMember).where(HouseholdMember.household_id == household_id)):
        u = db.get(User, m.user_id)
        if u is not None and _user_is_premium(db, u):
            return True
    return False


def user_has_premium(db: Session, user: User) -> bool:
    """Accès premium d'un utilisateur : via son foyer (un payeur suffit), sinon
    via son propre abonnement s'il n'a pas encore de foyer."""
    member = db.scalar(select(HouseholdMember).where(HouseholdMember.user_id == user.id))
    if member is not None:
        return household_has_premium(db, member.household_id)
    return _user_is_premium(db, user)


def require_premium(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> User:
    """Réserve un endpoint aux foyers abonnés (fonctions premium). 402 sinon."""
    if not user_has_premium(db, user):
        raise HTTPException(status_code=402, detail="Abonnement premium requis")
    return user


def is_premium(db: Session, user: User) -> bool:
    return user_has_premium(db, user)


def get_membership(
    household_id: int = Path(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> HouseholdMember:
    """Vérifie que l'utilisateur courant est membre du foyer, sinon 404."""
    member = db.scalar(
        select(HouseholdMember).where(
            HouseholdMember.household_id == household_id,
            HouseholdMember.user_id == user.id,
        )
    )
    if member is None:
        raise HTTPException(status_code=404, detail="Foyer introuvable")
    return member


def household_members(db: Session, household_id: int) -> list[HouseholdMember]:
    return list(
        db.scalars(select(HouseholdMember).where(HouseholdMember.household_id == household_id))
    )


def other_parent_id(db: Session, household_id: int, user_id: int) -> int | None:
    for m in household_members(db, household_id):
        if m.user_id != user_id:
            return m.user_id
    return None


def notify(db: Session, user_id: int | None, type_: str, payload: dict) -> None:
    """Crée une notification in-app (no-op si pas de destinataire)."""
    if user_id is None:
        return
    db.add(Notification(user_id=user_id, type=type_, payload=payload))


def get_household(db: Session, household_id: int) -> Household:
    household = db.get(Household, household_id)
    if household is None:
        raise HTTPException(status_code=404, detail="Foyer introuvable")
    return household
