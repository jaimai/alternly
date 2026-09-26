"""Validation et application des règles de garde, retrait d'enfant, suppression
d'échange — avec journal d'audit.

Partagé entre l'application directe (routers/rules, routers/children) et
l'acceptation d'une demande de changement (services/change_requests).
"""
from datetime import date

from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..deps import household_members
from ..models import (
    Child,
    CustodyRule,
    Expense,
    ScheduleException,
    SpecialDayRule,
    VacationRule,
    WallPost,
)
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


def get_custody(db: Session, household_id: int) -> CustodyRule | None:
    return db.scalar(select(CustodyRule).where(CustodyRule.household_id == household_id))


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


def apply_custody(db: Session, household_id: int, new: dict, actor_id: int) -> CustodyRule:
    rule = get_custody(db, household_id)
    old = custody_snapshot(rule)
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
    audit.record(
        db, household_id, actor_id, "custody_rule.update", "custody_rule", rule.id,
        {"before": old, "after": new},
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


def apply_vacation(db: Session, household_id: int, new: dict, actor_id: int) -> VacationRule:
    rule = get_vacation(db, household_id)
    old = vacation_snapshot(rule)
    if rule is None:
        rule = VacationRule(household_id=household_id)
        db.add(rule)
    rule.mode = new["mode"]
    rule.even_year_first_half_parent_id = new["even_year_first_half_parent_id"]
    db.flush()
    audit.record(
        db, household_id, actor_id, "vacation_rule.update", "vacation_rule", rule.id,
        {"before": old, "after": new},
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


def apply_special(db: Session, household_id: int, items: list[dict], actor_id: int) -> None:
    current = special_snapshot(get_special(db, household_id))
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
        {"before": list(current.values()), "after": items},
    )


# ---------- enfants ----------

def child_snapshot(child: Child) -> dict:
    return {"first_name": child.first_name, "birthdate": child.birthdate}


def delete_child(db: Session, child: Child, actor_id: int) -> None:
    # Les dépenses et messages liés sont conservés, simplement détachés de
    # l'enfant (sinon violation de clé étrangère sous Postgres).
    for model in (Expense, WallPost):
        db.execute(update(model).where(model.child_id == child.id).values(child_id=None))
    audit.record(
        db, child.household_id, actor_id, "child.delete", "child", child.id, {"before": child_snapshot(child)},
    )
    db.delete(child)


# ---------- échanges ----------

def exchange_snapshot(exc: ScheduleException) -> dict:
    return {
        "date_start": exc.date_start,
        "date_end": exc.date_end,
        "parent_id": exc.parent_id,
        "note": exc.note,
        "status": exc.status,
    }


def delete_exchange(db: Session, exc: ScheduleException, actor_id: int, cancelled: bool = False) -> None:
    audit.record(
        db, exc.household_id, actor_id, "exchange.delete", "exception", exc.id,
        {"before": exchange_snapshot(exc), "cancelled": cancelled},
    )
    # Contre-propositions qui la remplaçaient : lien rompu (clé étrangère replaces_id).
    db.execute(
        update(ScheduleException).where(ScheduleException.replaces_id == exc.id).values(replaces_id=None)
    )
    db.delete(exc)
