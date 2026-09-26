"""Dépendances et helpers partagés entre routers."""
from fastapi import Depends, HTTPException, Path, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import get_current_user
from .db import get_db
from .models import Household, HouseholdMember, Notification, User
from .services.billing import PAYWALL_DETAIL, paywall_blocks


def get_membership(
    request: Request,
    household_id: int = Path(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> HouseholdMember:
    """Vérifie que l'utilisateur courant est membre du foyer, sinon 404.

    Applique aussi le paywall à toutes les routes du foyer (/api/households/{id}/…) :
    essai terminé sans abonnement → 402 sur les écritures (mode read_only) ou
    sur tout (mode block). Hors foyer, jamais de paywall : auth, facturation,
    export/suppression du compte, acceptation d'invitation, flux iCal, cron.
    """
    member = db.scalar(
        select(HouseholdMember).where(
            HouseholdMember.household_id == household_id,
            HouseholdMember.user_id == user.id,
        )
    )
    if member is None:
        raise HTTPException(status_code=404, detail="Foyer introuvable")
    if paywall_blocks(user, request.method):
        raise HTTPException(status_code=402, detail=PAYWALL_DETAIL)
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
