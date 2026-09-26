"""Garde-fous entre parents : changements sensibles soumis à l'accord de l'autre.

Règles de garde (rythme, vacances, jours de fête), retrait d'un enfant et
annulation d'un échange accepté : avec deux parents réels, la modification
devient une demande (ChangeRequest) que l'autre parent accepte ou refuse.
Seul — y compris quand l'autre parent n'est qu'un placeholder (pas encore de
compte) ou a supprimé son compte (anonymisé) — la modification s'applique
directement : personne ne pourrait y consentir.

Fonctionne sur l'offre gratuite (calendrier, règles et échanges sont gratuits).
"""
from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..deps import notify, other_parent_id
from ..models import ChangeRequest, Child, HouseholdMember, ScheduleException, User, utcnow
from ..ratelimit import DAY, check_household_limit
from ..schemas import ChangeRequestOut, CustodyRuleIn, SpecialDayRuleIn, VacationRuleIn
from . import audit
from . import rules as rules_service

RULE_KINDS = {"custody_rule", "vacation_rule", "special_day_rules"}
KINDS = RULE_KINDS | {"delete_child", "cancel_exchange"}

# Création de demandes : même quota que les propositions d'échange.
CREATE_LIMIT = 30


class ChangeConflict(Exception):
    """La demande ne peut plus s'appliquer (cible disparue, parent parti…)."""


def needs_consent(db: Session, member: HouseholdMember) -> bool:
    """Un autre parent *réel* (ni placeholder, ni compte supprimé) doit consentir."""
    return other_parent_id(db, member.household_id, member.user_id) is not None


def _locale(db: Session, user_id: int | None) -> str:
    user = db.get(User, user_id) if user_id is not None else None
    return user.locale if user is not None else "fr"


def summary(db: Session, cr: ChangeRequest, locale: str | None) -> str:
    ctx = audit.make_ctx(db, cr.household_id, locale)
    try:
        return audit.change_request_summary(ctx, cr.kind, cr.context)
    except (KeyError, TypeError, ValueError):
        return cr.kind


def to_out(db: Session, cr: ChangeRequest, locale: str | None) -> ChangeRequestOut:
    return ChangeRequestOut(
        id=cr.id,
        kind=cr.kind,
        summary=summary(db, cr, locale),
        status=cr.status,
        requested_by=cr.requested_by,
        created_at=cr.created_at,
        resolved_by=cr.resolved_by,
        resolved_at=cr.resolved_at,
    )


def pending_response(db: Session, member: HouseholdMember, cr: ChangeRequest) -> JSONResponse:
    """202 {"change_request": …} : la modification attend l'accord de l'autre parent."""
    return JSONResponse(
        status_code=202,
        content=jsonable_encoder({"change_request": to_out(db, cr, _locale(db, member.user_id))}),
    )


def notify_about(db: Session, recipient_id: int | None, type_: str, cr: ChangeRequest) -> None:
    """Notification in-app ; le résumé est rédigé dans la langue du destinataire."""
    if recipient_id is None:
        return
    notify(db, recipient_id, type_, {"id": cr.id, "summary": summary(db, cr, _locale(db, recipient_id))})


def journal(db: Session, cr: ChangeRequest, actor_id: int, action: str) -> None:
    audit.record(
        db, cr.household_id, actor_id, action, "change_request", cr.id,
        {"kind": cr.kind, "context": cr.context},
    )


# ---------- création ----------

def create_request(
    db: Session, member: HouseholdMember, kind: str, payload: dict, context: dict
) -> ChangeRequest:
    """Crée une demande (sans commit) et prévient l'autre parent."""
    hid = member.household_id
    check_household_limit("change_requests", hid, CREATE_LIMIT, DAY)
    payload, context = jsonable_encoder(payload), jsonable_encoder(context)
    pending = db.scalars(
        select(ChangeRequest).where(
            ChangeRequest.household_id == hid,
            ChangeRequest.kind == kind,
            ChangeRequest.status == "pending",
        )
    ).all()
    for old in pending:
        if kind in RULE_KINDS and old.requested_by == member.user_id:
            # Une nouvelle demande du même type remplace la précédente.
            old.status = "withdrawn"
            old.resolved_by = member.user_id
            old.resolved_at = utcnow()
            journal(db, old, member.user_id, "change_request.replace")
        elif kind not in RULE_KINDS and old.payload == payload:
            return old  # déjà demandé pour la même cible : idempotent
    cr = ChangeRequest(household_id=hid, requested_by=member.user_id, kind=kind, payload=payload, context=context)
    db.add(cr)
    db.flush()
    journal(db, cr, member.user_id, "change_request.create")
    notify_about(db, other_parent_id(db, hid, member.user_id), "change_requested", cr)
    return cr


# ---------- application ----------

def apply_request(db: Session, cr: ChangeRequest) -> None:
    """Applique une demande acceptée, revalidée sur l'état actuel (au nom du demandeur).

    Toute la revalidation précède la moindre écriture. Lève ChangeConflict si
    la demande ne peut plus s'appliquer."""
    hid = cr.household_id
    actor = cr.requested_by
    try:
        if cr.kind == "custody_rule":
            new = rules_service.validate_custody(db, hid, CustodyRuleIn(**cr.payload))
            rules_service.apply_custody(db, hid, new, actor)
        elif cr.kind == "vacation_rule":
            new = rules_service.validate_vacation(db, hid, VacationRuleIn(**cr.payload))
            rules_service.apply_vacation(db, hid, new, actor)
        elif cr.kind == "special_day_rules":
            items = rules_service.validate_special(
                db, hid, [SpecialDayRuleIn(**i) for i in cr.payload.get("items", [])]
            )
            rules_service.apply_special(db, hid, items, actor)
        elif cr.kind == "delete_child":
            child = db.get(Child, cr.payload.get("child_id"))
            if child is None or child.household_id != hid:
                raise ChangeConflict("Cet enfant n'existe plus")
            rules_service.delete_child(db, child, actor)
        elif cr.kind == "cancel_exchange":
            exc = db.get(ScheduleException, cr.payload.get("exception_id"))
            if exc is None or exc.household_id != hid or exc.status != "accepted":
                raise ChangeConflict("Cet échange n'existe plus")
            rules_service.delete_exchange(db, exc, actor, cancelled=True)
        else:
            raise ChangeConflict("Type de demande inconnu")
    except HTTPException as e:  # revalidation (parent parti…)
        raise ChangeConflict(str(e.detail)) from e
    except ValueError as e:  # charge utile invalide (pydantic)
        raise ChangeConflict("Demande invalide") from e


def withdraw_pending_for_leaving(db: Session, household_id: int) -> None:
    """Un parent quitte le foyer : ses demandes en attente, comme celles qui
    attendaient sa réponse, n'ont plus de sens (le parent restant peut désormais
    modifier directement)."""
    for cr in db.scalars(
        select(ChangeRequest).where(ChangeRequest.household_id == household_id, ChangeRequest.status == "pending")
    ):
        cr.status = "withdrawn"
        cr.resolved_at = utcnow()
