import secrets
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..db import get_db
from ..deps import get_membership, household_members, notify
from ..services.parents import claim_placeholder, ensure_second_parent
from ..models import (
    Child,
    CustodyRule,
    Household,
    HouseholdMember,
    Invitation,
    SchoolVacationPeriod,
    SpecialDayRule,
    User,
    VacationRule,
    utcnow,
)
from ..schemas import (
    ZONES,
    HouseholdCreate,
    HouseholdOut,
    HouseholdUpdate,
    InvitationOut,
    InvitationPreview,
    MemberOut,
    PartnerUpdate,
    SchoolVacationIn,
    SchoolVacationOut,
)

router = APIRouter(prefix="/api", tags=["household"])

# Fêtes par défaut selon le pays (mères/pères actives ; grandes fêtes à configurer).
DEFAULT_SPECIAL_RULES_BY_COUNTRY = {
    "FR": [
        ("mothers_day", True),
        ("fathers_day", True),
        ("christmas_eve", False),
        ("christmas_day", False),
    ],
    "US": [
        ("mothers_day", True),
        ("fathers_day", True),
        ("thanksgiving", False),
        ("christmas_eve", False),
        ("christmas_day", False),
    ],
}
CURRENCY_BY_COUNTRY = {"FR": "EUR", "US": "USD"}


def _member_out(db: Session, m: HouseholdMember) -> MemberOut:
    user = db.get(User, m.user_id)
    return MemberOut(
        id=user.id,
        display_name=user.display_name,
        color=user.color,
        role=m.role,
        is_placeholder=user.is_placeholder,
    )


def _household_out(db: Session, household: Household, my_user_id: int) -> HouseholdOut:
    # Foyers solo (y compris antérieurs) : on garantit un second parent (placeholder).
    me = db.get(User, my_user_id)
    if ensure_second_parent(db, household.id, locale=(me.locale if me else "fr")) is not None:
        db.commit()
    members = household_members(db, household.id)
    my_role = next((m.role for m in members if m.user_id == my_user_id), None)
    return HouseholdOut(
        id=household.id,
        name=household.name,
        school_zone=household.school_zone,
        country=household.country,
        currency=household.currency,
        members=[_member_out(db, m) for m in members],
        children=db.scalars(select(Child).where(Child.household_id == household.id)).all(),
        custody_rule=db.scalar(select(CustodyRule).where(CustodyRule.household_id == household.id)),
        vacation_rule=db.scalar(select(VacationRule).where(VacationRule.household_id == household.id)),
        special_day_rules=db.scalars(
            select(SpecialDayRule).where(SpecialDayRule.household_id == household.id)
        ).all(),
        school_vacations=db.scalars(
            select(SchoolVacationPeriod)
            .where(SchoolVacationPeriod.household_id == household.id)
            .order_by(SchoolVacationPeriod.start)
        ).all(),
        my_role=my_role,
    )


@router.post("/households", response_model=HouseholdOut, status_code=201)
def create_household(data: HouseholdCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if data.country == "FR" and data.school_zone not in ZONES:
        raise HTTPException(status_code=422, detail="Zone invalide (A, B ou C)")
    existing = db.scalar(select(HouseholdMember).where(HouseholdMember.user_id == user.id))
    if existing:
        raise HTTPException(status_code=409, detail="Vous appartenez déjà à un foyer")
    household = Household(
        name=data.name,
        country=data.country,
        currency=CURRENCY_BY_COUNTRY.get(data.country, "EUR"),
        # La zone A/B/C n'a de sens qu'en France.
        school_zone=data.school_zone if data.country == "FR" else "A",
    )
    db.add(household)
    db.flush()
    db.add(HouseholdMember(household_id=household.id, user_id=user.id, role="parent1"))
    for kind, enabled in DEFAULT_SPECIAL_RULES_BY_COUNTRY.get(data.country, DEFAULT_SPECIAL_RULES_BY_COUNTRY["FR"]):
        db.add(SpecialDayRule(household_id=household.id, kind=kind, parent_mode="auto", enabled=enabled))
    db.commit()
    return _household_out(db, household, user.id)


@router.get("/households/mine", response_model=HouseholdOut)
def my_household(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    member = db.scalar(select(HouseholdMember).where(HouseholdMember.user_id == user.id))
    if member is None:
        raise HTTPException(status_code=404, detail="Aucun foyer")
    return _household_out(db, db.get(Household, member.household_id), user.id)


@router.patch("/households/{household_id}", response_model=HouseholdOut)
def update_household(
    data: HouseholdUpdate,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    household = db.get(Household, member.household_id)
    if data.name is not None:
        household.name = data.name
    if data.country is not None:
        household.country = data.country
        household.currency = CURRENCY_BY_COUNTRY.get(data.country, household.currency)
    if data.school_zone is not None:
        if data.school_zone not in ZONES:
            raise HTTPException(status_code=422, detail="Zone invalide (A, B ou C)")
        household.school_zone = data.school_zone
    db.commit()
    return _household_out(db, household, member.user_id)


# ---------- congés scolaires (saisie manuelle, ex. US) ----------

@router.post("/households/{household_id}/school-vacations", response_model=SchoolVacationOut, status_code=201)
def add_school_vacation(
    data: SchoolVacationIn,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    if data.end < data.start:
        raise HTTPException(status_code=422, detail="La date de fin précède la date de début")
    period = SchoolVacationPeriod(
        household_id=member.household_id, label=data.label, start=data.start, end=data.end
    )
    db.add(period)
    db.commit()
    db.refresh(period)
    return period


@router.delete("/households/{household_id}/school-vacations/{period_id}", status_code=204)
def delete_school_vacation(
    period_id: int,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    period = db.get(SchoolVacationPeriod, period_id)
    if period is None or period.household_id != member.household_id:
        raise HTTPException(status_code=404, detail="Congé introuvable")
    db.delete(period)
    db.commit()


def _real_members(db: Session, household_id: int) -> list[HouseholdMember]:
    """Membres réels (hors placeholder), pour les décomptes d'invitation."""
    out = []
    for m in household_members(db, household_id):
        u = db.get(User, m.user_id)
        if u is not None and not u.is_placeholder:
            out.append(m)
    return out


@router.patch("/households/{household_id}/partner", response_model=MemberOut)
def rename_partner(
    data: PartnerUpdate,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    """Nomme le second parent placeholder (ex. « Camille ») tant qu'il n'a pas de compte."""
    ensure_second_parent(db, member.household_id)
    ghost_member = next(
        (m for m in household_members(db, member.household_id) if db.get(User, m.user_id).is_placeholder),
        None,
    )
    if ghost_member is None:
        raise HTTPException(status_code=409, detail="Le second parent a déjà un compte")
    ghost = db.get(User, ghost_member.user_id)
    ghost.display_name = data.display_name
    if data.color is not None:
        ghost.color = data.color
    db.commit()
    return _member_out(db, ghost_member)


@router.post("/households/{household_id}/invitations", response_model=InvitationOut, status_code=201)
def create_invitation(member: HouseholdMember = Depends(get_membership), db: Session = Depends(get_db)):
    if len(_real_members(db, member.household_id)) >= 2:
        raise HTTPException(status_code=409, detail="Le foyer a déjà deux parents")
    invitation = Invitation(
        household_id=member.household_id,
        token=secrets.token_urlsafe(32),
        invited_by=member.user_id,
        expires_at=utcnow() + timedelta(days=14),
    )
    db.add(invitation)
    db.commit()
    return InvitationOut(
        invite_url=f"/app/join/{invitation.token}",
        token=invitation.token,
        expires_at=invitation.expires_at,
    )


def _valid_invitation(db: Session, token: str) -> Invitation:
    invitation = db.scalar(select(Invitation).where(Invitation.token == token))
    if invitation is None:
        raise HTTPException(status_code=404, detail="Invitation introuvable")
    if invitation.used_at is not None or invitation.expires_at < utcnow():
        raise HTTPException(status_code=410, detail="Invitation expirée ou déjà utilisée")
    return invitation


@router.get("/invitations/{token}", response_model=InvitationPreview)
def preview_invitation(token: str, db: Session = Depends(get_db)):
    invitation = _valid_invitation(db, token)
    household = db.get(Household, invitation.household_id)
    inviter = db.get(User, invitation.invited_by)
    return InvitationPreview(household_name=household.name, invited_by_name=inviter.display_name)


@router.post("/invitations/{token}/accept", response_model=HouseholdOut)
def accept_invitation(token: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    invitation = _valid_invitation(db, token)
    members = household_members(db, invitation.household_id)
    if any(m.user_id == user.id for m in members):
        raise HTTPException(status_code=409, detail="Vous êtes déjà membre de ce foyer")
    if len(_real_members(db, invitation.household_id)) >= 2:
        raise HTTPException(status_code=409, detail="Le foyer a déjà deux parents")
    if db.scalar(select(HouseholdMember).where(HouseholdMember.user_id == user.id)):
        raise HTTPException(status_code=409, detail="Vous appartenez déjà à un autre foyer")
    # Le vrai parent réclame le placeholder (hérite des dépenses/tâches assignées).
    claim_placeholder(db, invitation.household_id, user.id)
    db.add(HouseholdMember(household_id=invitation.household_id, user_id=user.id, role="parent2"))
    invitation.used_at = utcnow()
    notify(db, invitation.invited_by, "parent_joined", {"display_name": user.display_name})
    db.commit()
    return _household_out(db, db.get(Household, invitation.household_id), user.id)
