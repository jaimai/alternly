import secrets
from datetime import date, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..config import settings
from ..db import get_db
from ..deps import get_membership, household_members, notify
from ..ratelimit import DAY, HOUR, rate_limit
from ..services import analytics, audit, lifecycle
from ..services import email as email_service
from ..services.invite_reminders import INVITATION_TTL
from ..services.calendar_service import NoCustodyRule, build_calendar
from ..services.parents import claim_placeholder, ensure_second_parent, placeholder_member
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
    InvitationCurrent,
    InvitationEmailIn,
    InvitationOut,
    InvitationPreview,
    InvitationSchedulePreview,
    PreviewDay,
    PreviewPeriod,
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
    analytics.capture_for_user(
        user, "household_created", {"country": household.country}, household_id=household.id
    )
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
    if data.school_zone is not None and data.school_zone not in ZONES:
        raise HTTPException(status_code=422, detail="Zone invalide (A, B ou C)")

    def journal(action: str, field: str, new) -> None:
        audit.record(
            db, household.id, member.user_id, action, "household", household.id,
            {"before": {field: getattr(household, field)}, "after": {field: new}},
        )

    if data.name is not None and data.name != household.name:
        journal("household.rename", "name", data.name)
        household.name = data.name
    if data.country is not None and data.country != household.country:
        journal("household.country", "country", data.country)
        household.country = data.country
        household.currency = CURRENCY_BY_COUNTRY.get(data.country, household.currency)
    if data.school_zone is not None and data.school_zone != household.school_zone:
        journal("household.zone", "school_zone", data.school_zone)
        household.school_zone = data.school_zone
    db.commit()
    return _household_out(db, household, member.user_id)


# ---------- congés scolaires (saisie manuelle, ex. US) ----------

@router.post(
    "/households/{household_id}/school-vacations",
    response_model=SchoolVacationOut,
    status_code=201,
    dependencies=[Depends(rate_limit("school_vacations", 100, DAY, by="household"))],
)
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
    db.flush()
    audit.record(
        db, member.household_id, member.user_id, "school_vacation.create", "school_vacation", period.id,
        {"after": {"label": period.label, "start": period.start, "end": period.end}},
    )
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
    audit.record(
        db, member.household_id, member.user_id, "school_vacation.delete", "school_vacation", period.id,
        {"before": {"label": period.label, "start": period.start, "end": period.end}},
    )
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
    if data.display_name != ghost.display_name:
        audit.record(
            db, member.household_id, member.user_id, "partner.rename", "member", ghost.id,
            {"before": {"display_name": ghost.display_name}, "after": {"display_name": data.display_name}},
        )
    ghost.display_name = data.display_name
    if data.color is not None:
        ghost.color = data.color
    db.commit()
    return _member_out(db, ghost_member)


def _invitation_out(invitation: Invitation) -> InvitationOut:
    return InvitationOut(
        # Lien absolu vers la route SPA /join/:token.
        invite_url=f"{settings.app_url.rstrip('/')}/join/{invitation.token}",
        token=invitation.token,
        expires_at=invitation.expires_at,
        created_at=invitation.created_at,
        invitee_email=invitation.invitee_email,
        email_sent=invitation.email_sent_at is not None,
    )


def latest_invitation(db: Session, household_id: int) -> Invitation | None:
    """Dernière invitation émise par le foyer (la seule relancée par le cron)."""
    return db.scalar(
        select(Invitation)
        .where(Invitation.household_id == household_id)
        .order_by(Invitation.id.desc())
        .limit(1)
    )


def _active_invitation(db: Session, household_id: int) -> Invitation | None:
    inv = latest_invitation(db, household_id)
    if inv is None or inv.used_at is not None or inv.expires_at < utcnow():
        return None
    return inv


def _ensure_solo(db: Session, household_id: int) -> None:
    if len(_real_members(db, household_id)) >= 2:
        raise HTTPException(status_code=409, detail="Le foyer a déjà deux parents")


def _new_invitation(db: Session, member: HouseholdMember) -> Invitation:
    invitation = Invitation(
        household_id=member.household_id,
        token=secrets.token_urlsafe(32),
        invited_by=member.user_id,
        created_at=utcnow(),
        expires_at=utcnow() + INVITATION_TTL,
    )
    db.add(invitation)
    db.flush()
    return invitation


@router.post("/households/{household_id}/invitations", response_model=InvitationOut, status_code=201)
def create_invitation(member: HouseholdMember = Depends(get_membership), db: Session = Depends(get_db)):
    _ensure_solo(db, member.household_id)
    invitation = _new_invitation(db, member)
    db.commit()
    return _invitation_out(invitation)


@router.get("/households/{household_id}/invitations/current", response_model=InvitationCurrent)
def current_invitation(member: HouseholdMember = Depends(get_membership), db: Session = Depends(get_db)):
    """Invitation encore valide (réutilisée par l'écran de partage), sinon l'état
    de la dernière : expirée → l'inviteur peut en régénérer une en un clic."""
    latest = latest_invitation(db, member.household_id)
    active = _active_invitation(db, member.household_id)
    return InvitationCurrent(
        invitation=_invitation_out(active) if active else None,
        last_expired=bool(latest and latest.used_at is None and latest.expires_at < utcnow()),
    )


def _send_invitation_email(to: str, subject: str, html: str, inviter: User, household_id: int) -> None:
    """Tâche d'arrière-plan : envoi Resend puis événement analytics si accepté."""
    if email_service.send_email(to, subject, html):
        analytics.capture_for_user(inviter, "invite_email_sent", {"reminder": False}, household_id=household_id)


@router.post(
    "/households/{household_id}/invitations/email",
    response_model=InvitationOut,
    dependencies=[Depends(rate_limit("invitation_email", 5, DAY, by="household"))],
)
def email_invitation(
    data: InvitationEmailIn,
    background: BackgroundTasks,
    member: HouseholdMember = Depends(get_membership),
    db: Session = Depends(get_db),
):
    """Alternly envoie lui-même l'invitation à l'adresse saisie (facultative).

    Ne révèle jamais si l'adresse a déjà un compte : même réponse dans tous les cas.
    """
    _ensure_solo(db, member.household_id)
    inviter = db.get(User, member.user_id)
    address = data.email.strip().lower()
    if address == inviter.email.lower():
        raise HTTPException(status_code=422, detail="Saisissez l'adresse de l'autre parent, pas la vôtre")
    invitation = _active_invitation(db, member.household_id) or _new_invitation(db, member)
    locale = data.locale or inviter.locale or "fr"
    invitation.invitee_email = address
    invitation.invitee_locale = locale
    invitation.email_sent_at = utcnow()
    db.commit()
    children = [
        c.first_name
        for c in db.scalars(select(Child).where(Child.household_id == member.household_id).order_by(Child.id))
    ]
    subject, html = email_service.invitation_email(inviter.display_name, children, invitation.token, locale)
    background.add_task(_send_invitation_email, address, subject, html, inviter, member.household_id)
    return _invitation_out(invitation)


def _valid_invitation(db: Session, token: str, rich: bool = False) -> Invitation:
    """Invitation utilisable. `rich` : erreurs détaillées pour la page /join
    (prénom de l'inviteur pour « demande un nouveau lien à … »)."""
    invitation = db.scalar(select(Invitation).where(Invitation.token == token))
    if invitation is None:
        raise HTTPException(status_code=404, detail="Invitation introuvable")
    if invitation.used_at is not None or invitation.expires_at < utcnow():
        message = "Invitation expirée ou déjà utilisée"
        if not rich:
            raise HTTPException(status_code=410, detail=message)
        inviter = db.get(User, invitation.invited_by)
        raise HTTPException(
            status_code=410,
            detail={
                "code": "used" if invitation.used_at is not None else "expired",
                "message": message,
                "inviter_first_name": email_service.first_name(inviter.display_name) if inviter else "",
            },
        )
    return invitation


@router.get(
    "/invitations/{token}",
    response_model=InvitationPreview,
    dependencies=[Depends(rate_limit("invitation", 30, HOUR))],
)
def preview_invitation(token: str, db: Session = Depends(get_db)):
    invitation = _valid_invitation(db, token, rich=True)
    household = db.get(Household, invitation.household_id)
    inviter = db.get(User, invitation.invited_by)
    return InvitationPreview(household_name=household.name, invited_by_name=inviter.display_name)


PREVIEW_DAYS = 28
PREVIEW_PERIOD_DAYS = 70


def _periods(days: list[tuple[date, bool]]) -> list[PreviewPeriod]:
    """Plages consécutives où l'invité a les enfants."""
    out: list[PreviewPeriod] = []
    for d, mine in days:
        if not mine:
            continue
        if out and out[-1].end == d - timedelta(days=1):
            out[-1].end = d
        else:
            out.append(PreviewPeriod(start=d, end=d))
    return out


@router.get(
    "/invitations/{token}/preview-schedule",
    response_model=InvitationSchedulePreview,
    dependencies=[Depends(rate_limit("invitation_preview", 30, HOUR))],
)
def preview_invitation_schedule(token: str, db: Session = Depends(get_db)):
    """Aperçu public du planning de l'invité (le jeton fait office de secret).

    L'invité réclamera le second parent placeholder : « vous » = ce placeholder.
    Ne contient que des dates, « vous / inviteur », le prénom de l'inviteur et les
    prénoms des enfants — jamais d'e-mail, de dépense, de note ni de message.
    """
    invitation = _valid_invitation(db, token, rich=True)
    household = db.get(Household, invitation.household_id)
    inviter = db.get(User, invitation.invited_by)
    children = [
        c.first_name
        for c in db.scalars(select(Child).where(Child.household_id == household.id).order_by(Child.id))
    ]
    out = InvitationSchedulePreview(
        inviter_first_name=email_service.first_name(inviter.display_name),
        children=children,
        has_schedule=False,
    )
    analytics.capture(None, "invite_preview_viewed", {"country": household.country})
    ghost = placeholder_member(db, household.id)
    if ghost is None:
        return out
    start = date.today()
    end = start + timedelta(days=PREVIEW_PERIOD_DAYS - 1)
    try:
        cal = build_calendar(db, household, start, end)
    except NoCustodyRule:
        return out
    marked = [(d.day, d.parent == str(ghost.user_id)) for d in cal.days]
    out.has_schedule = True
    out.handover_time = cal.rule.handover_time
    out.days = [PreviewDay(date=d, who="you" if mine else "inviter") for d, mine in marked[:PREVIEW_DAYS]]
    out.your_periods = _periods(marked)
    return out


@router.post(
    "/invitations/{token}/accept",
    response_model=HouseholdOut,
    dependencies=[Depends(rate_limit("invitation", 30, HOUR))],
)
def accept_invitation(
    token: str,
    background: BackgroundTasks,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
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
    audit.record(db, invitation.household_id, user.id, "member.join", "member", user.id)
    notify(db, invitation.invited_by, "parent_joined", {"display_name": user.display_name})
    db.commit()
    household = db.get(Household, invitation.household_id)
    days_to_join = (utcnow() - household.created_at).days if household.created_at else None
    analytics.capture_for_user(
        user, "partner_joined",
        {"country": household.country, "days_since_household_created": days_to_join},
        household_id=household.id,
    )
    lifecycle.queue_partner_welcome(db, user, household, db.get(User, invitation.invited_by), background)
    return _household_out(db, db.get(Household, invitation.household_id), user.id)
