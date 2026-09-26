"""Garde-fous entre parents : changements sensibles soumis à l'accord de l'autre.

Règles de garde (rythme, vacances, jours de fête), retrait d'un enfant et
annulation d'un échange accepté : avec deux parents actifs, la modification
devient une demande (ChangeRequest) que l'autre parent accepte ou refuse. Seul
(ou si l'autre compte est anonymisé), la modification s'applique directement.

Ce module porte aussi la validation et l'application de ces changements,
partagées entre l'application directe (routers/rules, routers/children) et
l'acceptation d'une demande (routers/change_requests).
"""
from datetime import date

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..deps import household_members, notify
from ..models import (
    ChangeRequest,
    Child,
    CustodyRule,
    Expense,
    HouseholdMember,
    ScheduleException,
    SpecialDayRule,
    User,
    VacationRule,
    WallPost,
    utcnow,
)
from ..ratelimit import DAY, check_household_limit
from ..schemas import (
    PARENT_MODES,
    PATTERNS,
    SPECIAL_KINDS,
    VACATION_MODES,
    CustodyRuleIn,
    SpecialDayRuleIn,
    VacationRuleIn,
)
from . import audit
from .audit import DAY_NAMES, fr_date, fr_range

RULE_KINDS = {"custody_rule", "vacation_rule", "special_day_rules"}
KINDS = RULE_KINDS | {"delete_child", "cancel_exchange"}

PATTERN_LABELS = {
    "alternate_weeks": "semaine/semaine",
    "two_two_three": "2-2-3",
    "every_other_weekend": "un week-end sur deux",
    "custom": "rythme personnalisé",
}
VACATION_LABELS = {
    "split_half": "partage par moitié",
    "alternate_full": "vacances entières alternées",
}
# (libellé, féminin ?)
SPECIAL_LABELS = {
    "mothers_day": ("Fête des mères", True),
    "fathers_day": ("Fête des pères", True),
    "christmas_eve": ("Réveillon de Noël", False),
    "christmas_day": ("Jour de Noël", False),
}

# Création de demandes : même quota que les propositions d'échange.
CREATE_LIMIT = 30


class ChangeConflict(Exception):
    """La demande ne peut plus s'appliquer (cible disparue, parent parti…)."""


# ---------- parents ----------

def _name(db: Session, user_id: int | None) -> str:
    user = db.get(User, user_id) if user_id is not None else None
    return user.display_name if user is not None else "un parent"


def active_other_parent_id(db: Session, household_id: int, user_id: int) -> int | None:
    """L'autre parent du foyer, s'il existe et n'a pas supprimé son compte."""
    for m in household_members(db, household_id):
        if m.user_id == user_id:
            continue
        user = db.get(User, m.user_id)
        if user is not None and user.deleted_at is None:
            return m.user_id
    return None


def needs_consent(db: Session, member: HouseholdMember) -> bool:
    return active_other_parent_id(db, member.household_id, member.user_id) is not None


def check_parent(db: Session, household_id: int, parent_id: int) -> None:
    ids = {m.user_id for m in household_members(db, household_id)}
    if parent_id not in ids:
        raise HTTPException(status_code=422, detail="Ce parent n'appartient pas au foyer")


# ---------- rythme de garde ----------

def validate_custody(db: Session, household_id: int, data: CustodyRuleIn) -> dict:
    if data.pattern not in PATTERNS:
        raise HTTPException(status_code=422, detail="Schéma de garde inconnu")
    check_parent(db, household_id, data.reference_parent_id)
    if data.pattern == "custom":
        if not data.custom_weeks or len(data.custom_weeks) != 14 or any(
            v not in {"ref", "other"} for v in data.custom_weeks
        ):
            raise HTTPException(status_code=422, detail="custom_weeks doit contenir 14 valeurs ref/other")
    return {
        "pattern": data.pattern,
        "start_date": data.start_date.isoformat(),
        "reference_parent_id": data.reference_parent_id,
        "handover_day": data.handover_day,
        "handover_time": data.handover_time,
        "custom_weeks": data.custom_weeks if data.pattern == "custom" else None,
    }


def custody_snapshot(rule: CustodyRule | None) -> dict | None:
    if rule is None:
        return None
    return {
        "pattern": rule.pattern,
        "start_date": rule.start_date.isoformat(),
        "reference_parent_id": rule.reference_parent_id,
        "handover_day": rule.handover_day,
        "handover_time": rule.handover_time,
        "custom_weeks": rule.custom_weeks,
    }


def get_custody(db: Session, household_id: int) -> CustodyRule | None:
    return db.scalar(select(CustodyRule).where(CustodyRule.household_id == household_id))


def custody_detail(db: Session, old: dict | None, new: dict) -> str:
    """« semaine/semaine → 2-2-3, départ le lun. 5 oct. »"""
    new_label = PATTERN_LABELS.get(new["pattern"], new["pattern"])
    if old is not None and old["pattern"] != new["pattern"]:
        head = f"{PATTERN_LABELS.get(old['pattern'], old['pattern'])} → {new_label}"
    else:
        head = new_label
    parts = [head, f"départ le {fr_date(date.fromisoformat(new['start_date']))}"]
    if old is not None and (old["handover_day"], old["handover_time"]) != (new["handover_day"], new["handover_time"]):
        parts.append(f"passage de relais le {DAY_NAMES[new['handover_day']]} à {new['handover_time']}")
    if old is not None and old["reference_parent_id"] != new["reference_parent_id"]:
        parts.append(f"parent de référence : {_name(db, new['reference_parent_id'])}")
    return ", ".join(parts)


def apply_custody(db: Session, household_id: int, new: dict, actor_id: int) -> CustodyRule:
    rule = get_custody(db, household_id)
    old = custody_snapshot(rule)
    detail = custody_detail(db, old, new)
    if rule is None:
        rule = CustodyRule(household_id=household_id)
        db.add(rule)
    rule.pattern = new["pattern"]
    rule.start_date = date.fromisoformat(new["start_date"])
    rule.reference_parent_id = new["reference_parent_id"]
    rule.handover_day = new["handover_day"]
    rule.handover_time = new["handover_time"]
    rule.custom_weeks = new["custom_weeks"]
    db.flush()
    verb = "a défini" if old is None else "a modifié"
    audit.record(
        db, household_id, actor_id, "custody_rule.update", "custody_rule", rule.id,
        f"{verb} le rythme de garde : {detail}", {"before": old, "after": new},
    )
    return rule


# ---------- vacances ----------

def validate_vacation(db: Session, household_id: int, data: VacationRuleIn) -> dict:
    if data.mode not in VACATION_MODES:
        raise HTTPException(status_code=422, detail="Mode de partage inconnu")
    if data.even_year_first_half_parent_id is not None:
        check_parent(db, household_id, data.even_year_first_half_parent_id)
    return {"mode": data.mode, "even_year_first_half_parent_id": data.even_year_first_half_parent_id}


def get_vacation(db: Session, household_id: int) -> VacationRule | None:
    return db.scalar(select(VacationRule).where(VacationRule.household_id == household_id))


def vacation_snapshot(rule: VacationRule | None) -> dict | None:
    if rule is None:
        return None
    return {"mode": rule.mode, "even_year_first_half_parent_id": rule.even_year_first_half_parent_id}


def vacation_detail(db: Session, old: dict | None, new: dict) -> str:
    """« partage par moitié → vacances entières alternées »"""
    new_label = VACATION_LABELS.get(new["mode"], new["mode"])
    if old is not None and old["mode"] != new["mode"]:
        parts = [f"{VACATION_LABELS.get(old['mode'], old['mode'])} → {new_label}"]
    else:
        parts = [new_label]
    pid = new["even_year_first_half_parent_id"]
    if pid is not None and (old is None or old["even_year_first_half_parent_id"] != pid):
        parts.append(f"années paires : première partie chez {_name(db, pid)}")
    return ", ".join(parts)


def apply_vacation(db: Session, household_id: int, new: dict, actor_id: int) -> VacationRule:
    rule = get_vacation(db, household_id)
    old = vacation_snapshot(rule)
    detail = vacation_detail(db, old, new)
    if rule is None:
        rule = VacationRule(household_id=household_id)
        db.add(rule)
    rule.mode = new["mode"]
    rule.even_year_first_half_parent_id = new["even_year_first_half_parent_id"]
    db.flush()
    verb = "a défini" if old is None else "a modifié"
    audit.record(
        db, household_id, actor_id, "vacation_rule.update", "vacation_rule", rule.id,
        f"{verb} le partage des vacances : {detail}", {"before": old, "after": new},
    )
    return rule


# ---------- jours de fête ----------

def validate_special(db: Session, household_id: int, items: list[SpecialDayRuleIn]) -> list[dict]:
    out = []
    for item in items:
        if item.kind not in SPECIAL_KINDS:
            raise HTTPException(status_code=422, detail=f"Fête inconnue : {item.kind}")
        if item.parent_mode not in PARENT_MODES:
            raise HTTPException(status_code=422, detail=f"Mode inconnu : {item.parent_mode}")
        # fixed et alternate exigent un parent_id membre du foyer.
        if item.parent_mode in {"fixed", "alternate"}:
            if item.parent_id is None:
                raise HTTPException(status_code=422, detail="parent_id requis pour ce mode")
            check_parent(db, household_id, item.parent_id)
        out.append({
            "kind": item.kind,
            "parent_mode": item.parent_mode,
            # parent_id conservé pour fixed (parent fixe) et alternate (parent des années paires).
            "parent_id": item.parent_id if item.parent_mode in {"fixed", "alternate"} else None,
            "enabled": item.enabled,
        })
    return out


def get_special(db: Session, household_id: int) -> list[SpecialDayRule]:
    return list(db.scalars(select(SpecialDayRule).where(SpecialDayRule.household_id == household_id)))


def special_snapshot(rules: list[SpecialDayRule]) -> dict:
    return {
        r.kind: {"kind": r.kind, "parent_mode": r.parent_mode, "parent_id": r.parent_id, "enabled": r.enabled}
        for r in rules
    }


def special_changed(current: dict, items: list[dict]) -> bool:
    return any(current.get(i["kind"]) != i for i in items)


def special_detail(db: Session, current: dict, items: list[dict]) -> str:
    """« Fête des mères activée, Jour de Noël : en alternance (années paires chez Camille) »"""
    parts = []
    for item in items:
        old = current.get(item["kind"])
        if old == item:
            continue
        label, fem = SPECIAL_LABELS.get(item["kind"], (item["kind"], False))
        if old is None or old["enabled"] != item["enabled"]:
            state = "activée" if fem else "activé"
            if not item["enabled"]:
                state = "désactivée" if fem else "désactivé"
            parts.append(f"{label} {state}")
            if not item["enabled"]:
                continue
        if old is None or (old["parent_mode"], old["parent_id"]) != (item["parent_mode"], item["parent_id"]):
            if item["parent_mode"] == "fixed":
                mode = f"toujours chez {_name(db, item['parent_id'])}"
            elif item["parent_mode"] == "alternate":
                mode = f"en alternance (années paires chez {_name(db, item['parent_id'])})"
            else:
                mode = "selon le calendrier habituel"
            parts.append(f"{label} : {mode}")
    return ", ".join(parts) or "aucun changement"


def apply_special(db: Session, household_id: int, items: list[dict], actor_id: int) -> None:
    current = special_snapshot(get_special(db, household_id))
    detail = special_detail(db, current, items)
    for item in items:
        rule = db.scalar(
            select(SpecialDayRule).where(
                SpecialDayRule.household_id == household_id, SpecialDayRule.kind == item["kind"]
            )
        )
        if rule is None:
            rule = SpecialDayRule(household_id=household_id, kind=item["kind"])
            db.add(rule)
        rule.parent_mode = item["parent_mode"]
        rule.parent_id = item["parent_id"]
        rule.enabled = item["enabled"]
    db.flush()
    audit.record(
        db, household_id, actor_id, "special_day_rules.update", "special_day_rules", None,
        f"a modifié les jours de fête : {detail}",
        {"before": list(current.values()), "after": items},
    )


# ---------- enfants ----------

def delete_child(db: Session, child: Child, actor_id: int) -> None:
    # Les dépenses et messages liés sont conservés, simplement détachés de
    # l'enfant (sinon violation de clé étrangère sous Postgres).
    for model in (Expense, WallPost):
        db.execute(update(model).where(model.child_id == child.id).values(child_id=None))
    audit.record(
        db, child.household_id, actor_id, "child.delete", "child", child.id,
        f"a retiré l'enfant {child.first_name}",
        {"before": {"first_name": child.first_name, "birthdate": child.birthdate}},
    )
    db.delete(child)


# ---------- échanges ----------

def exchange_label(db: Session, exc: ScheduleException) -> str:
    """« jeu. 1 oct. chez Camille »"""
    return f"{fr_range(exc.date_start, exc.date_end)} chez {_name(db, exc.parent_id)}"


def exchange_snapshot(exc: ScheduleException) -> dict:
    return {
        "date_start": exc.date_start,
        "date_end": exc.date_end,
        "parent_id": exc.parent_id,
        "note": exc.note,
        "status": exc.status,
    }


def delete_exchange(db: Session, exc: ScheduleException, actor_id: int, cancelled: bool = False) -> None:
    verb = "a annulé" if cancelled else "a supprimé"
    audit.record(
        db, exc.household_id, actor_id, "exchange.delete", "exception", exc.id,
        f"{verb} l'échange : {exchange_label(db, exc)}", {"before": exchange_snapshot(exc)},
    )
    db.delete(exc)


# ---------- demandes ----------

def create_request(
    db: Session, member: HouseholdMember, kind: str, payload: dict, summary: str
) -> ChangeRequest:
    """Crée une demande (sans commit) et prévient l'autre parent."""
    hid = member.household_id
    check_household_limit("change_requests", hid, CREATE_LIMIT, DAY)
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
            audit.record(
                db, hid, member.user_id, "change_request.withdraw", "change_request", old.id,
                f"a remplacé sa demande : {old.summary}",
            )
        elif kind not in RULE_KINDS and old.payload == payload:
            return old  # déjà demandé pour la même cible : idempotent
    cr = ChangeRequest(household_id=hid, requested_by=member.user_id, kind=kind, payload=payload, summary=summary)
    db.add(cr)
    db.flush()
    audit.record(
        db, hid, member.user_id, "change_request.create", "change_request", cr.id,
        f"a demandé un changement : {summary}", {"kind": kind, "payload": payload},
    )
    notify(db, active_other_parent_id(db, hid, member.user_id), "change_requested", {"id": cr.id, "summary": summary})
    return cr


def apply_request(db: Session, cr: ChangeRequest) -> None:
    """Applique une demande acceptée, revalidée sur l'état actuel.

    Lève ChangeConflict si elle ne peut plus s'appliquer."""
    hid = cr.household_id
    actor = cr.requested_by
    try:
        if cr.kind == "custody_rule":
            new = validate_custody(db, hid, CustodyRuleIn(**cr.payload))
            apply_custody(db, hid, new, actor)
        elif cr.kind == "vacation_rule":
            new = validate_vacation(db, hid, VacationRuleIn(**cr.payload))
            apply_vacation(db, hid, new, actor)
        elif cr.kind == "special_day_rules":
            items = validate_special(db, hid, [SpecialDayRuleIn(**i) for i in cr.payload.get("items", [])])
            apply_special(db, hid, items, actor)
        elif cr.kind == "delete_child":
            child = db.get(Child, cr.payload.get("child_id"))
            if child is None or child.household_id != hid:
                raise ChangeConflict("Cet enfant n'existe plus")
            delete_child(db, child, actor)
        elif cr.kind == "cancel_exchange":
            exc = db.get(ScheduleException, cr.payload.get("exception_id"))
            if exc is None or exc.household_id != hid or exc.status != "accepted":
                raise ChangeConflict("Cet échange n'existe plus")
            delete_exchange(db, exc, actor, cancelled=True)
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
