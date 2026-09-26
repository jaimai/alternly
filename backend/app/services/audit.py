"""Journal d'audit du foyer (ajout seul) et rendu des résumés en FR/EN.

On stocke une action structurée (`action` + `data`) ; le résumé lisible est
produit **à la lecture**, dans la langue de la personne qui consulte
(`render_summary`). Les noms des parents sont résolus au moment de la lecture
(un parent parti apparaît sous son nom anonymisé) ; les libellés susceptibles
de disparaître (prénom d'un enfant retiré, libellé d'une dépense supprimée…)
sont conservés dans `data`.
"""
from dataclasses import dataclass, field
from datetime import date

from fastapi.encoders import jsonable_encoder
from sqlalchemy.orm import Session

from ..models import AuditLog, Household, User

# ---------- formatage ----------

_DAYS = {
    "fr": ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."],
    "en": ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
}
_MONTHS = {
    "fr": ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
    "en": ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
}
DAY_NAMES = {
    "fr": ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"],
    "en": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
}
_CURRENCY_SYMBOL = {"EUR": "€", "USD": "$"}


def lang_of(locale: str | None) -> str:
    return "en" if locale == "en" else "fr"


def _as_date(d) -> date:
    return d if isinstance(d, date) else date.fromisoformat(str(d)[:10])


def fmt_date(d, lang: str = "fr") -> str:
    """FR « jeu. 1 oct. » ; EN « Thu, Oct 1 »."""
    d = _as_date(d)
    if lang == "en":
        return f"{_DAYS['en'][d.weekday()]}, {_MONTHS['en'][d.month - 1]} {d.day}"
    return f"{_DAYS['fr'][d.weekday()]} {d.day} {_MONTHS['fr'][d.month - 1]}"


def fmt_range(start, end, lang: str = "fr") -> str:
    start, end = _as_date(start), _as_date(end)
    return fmt_date(start, lang) if start == end else f"{fmt_date(start, lang)} → {fmt_date(end, lang)}"


def money(cents: int, currency: str = "EUR", lang: str = "fr") -> str:
    """FR « 1 234,50 € » ; EN « €1,234.50 »."""
    whole, frac = divmod(abs(int(cents)), 100)
    sign = "-" if cents < 0 else ""
    symbol = _CURRENCY_SYMBOL.get(currency, currency)
    if lang == "en":
        return f"{sign}{symbol}{whole:,}.{frac:02d}"
    grouped = f"{whole:,}".replace(",", " ")
    return f"{sign}{grouped},{frac:02d} {symbol}"


# Compatibilité avec la version de référence (formatage français, euros).
def fr_date(d: date) -> str:
    return fmt_date(d, "fr")


def fr_range(start: date, end: date) -> str:
    return fmt_range(start, end, "fr")


def euros(cents: int) -> str:
    return money(cents, "EUR", "fr")


def excerpt(text: str, limit: int = 60) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def quote(text: str, lang: str = "fr") -> str:
    return f"“{excerpt(text)}”" if lang == "en" else f"« {excerpt(text)} »"


# ---------- contexte de rendu ----------

@dataclass
class Ctx:
    db: Session
    lang: str = "fr"
    currency: str = "EUR"
    _names: dict = field(default_factory=dict)

    def name(self, user_id) -> str:
        if user_id not in self._names:
            user = self.db.get(User, user_id) if user_id is not None else None
            self._names[user_id] = user.display_name if user is not None else (
                "a parent" if self.lang == "en" else "un parent"
            )
        return self._names[user_id]

    def money(self, cents) -> str:
        return money(cents, self.currency, self.lang)

    def date(self, d) -> str:
        return fmt_date(d, self.lang)

    def range(self, a, b) -> str:
        return fmt_range(a, b, self.lang)

    def q(self, text) -> str:
        return quote(text, self.lang)

    def t(self, fr: str, en: str) -> str:
        return en if self.lang == "en" else fr


def make_ctx(db: Session, household_id: int | None, locale: str | None) -> Ctx:
    household = db.get(Household, household_id) if household_id is not None else None
    return Ctx(db=db, lang=lang_of(locale), currency=(household.currency if household else "EUR") or "EUR")


# ---------- détails des règles (partagés avec les demandes de changement) ----------

PATTERN_LABELS = {
    "fr": {
        "alternate_weeks": "semaine/semaine",
        "two_two_three": "2-2-3",
        "every_other_weekend": "un week-end sur deux",
        "custom": "rythme personnalisé",
    },
    "en": {
        "alternate_weeks": "week on/week off",
        "two_two_three": "2-2-3",
        "every_other_weekend": "every other weekend",
        "custom": "custom schedule",
    },
}
VACATION_LABELS = {
    "fr": {"split_half": "partage par moitié", "alternate_full": "vacances entières alternées"},
    "en": {"split_half": "split in half", "alternate_full": "alternating whole holidays"},
}
# kind -> (libellé FR, féminin ?, libellé EN)
SPECIAL_LABELS = {
    "mothers_day": ("Fête des mères", True, "Mother's Day"),
    "fathers_day": ("Fête des pères", True, "Father's Day"),
    "christmas_eve": ("Réveillon de Noël", False, "Christmas Eve"),
    "christmas_day": ("Jour de Noël", False, "Christmas Day"),
    "thanksgiving": ("Thanksgiving", False, "Thanksgiving"),
    "halloween": ("Halloween", False, "Halloween"),
    "independence_day": ("Fête de l'Indépendance", True, "Independence Day"),
    "new_years_day": ("Jour de l'An", False, "New Year's Day"),
}


def custody_detail(ctx: Ctx, old: dict | None, new: dict) -> str:
    """FR « semaine/semaine → 2-2-3, départ le lun. 5 oct. »"""
    labels = PATTERN_LABELS[ctx.lang]
    new_label = labels.get(new["pattern"], new["pattern"])
    if old is not None and old["pattern"] != new["pattern"]:
        head = f"{labels.get(old['pattern'], old['pattern'])} → {new_label}"
    else:
        head = new_label
    parts = [head, ctx.t("départ le ", "starting ") + ctx.date(new["start_date"])]
    if old is not None and (old["handover_day"], old["handover_time"]) != (new["handover_day"], new["handover_time"]):
        day = DAY_NAMES[ctx.lang][new["handover_day"]]
        parts.append(ctx.t(
            f"passage de relais le {day} à {new['handover_time']}",
            f"handover on {day} at {new['handover_time']}",
        ))
    if old is not None and old["reference_parent_id"] != new["reference_parent_id"]:
        parts.append(ctx.t("parent de référence : ", "reference parent: ") + ctx.name(new["reference_parent_id"]))
    return ", ".join(parts)


def vacation_detail(ctx: Ctx, old: dict | None, new: dict) -> str:
    """FR « partage par moitié → vacances entières alternées »"""
    labels = VACATION_LABELS[ctx.lang]
    new_label = labels.get(new["mode"], new["mode"])
    if old is not None and old["mode"] != new["mode"]:
        parts = [f"{labels.get(old['mode'], old['mode'])} → {new_label}"]
    else:
        parts = [new_label]
    pid = new["even_year_first_half_parent_id"]
    if pid is not None and (old is None or old["even_year_first_half_parent_id"] != pid):
        parts.append(ctx.t(
            f"années paires : première partie chez {ctx.name(pid)}",
            f"even years: first half with {ctx.name(pid)}",
        ))
    return ", ".join(parts)


def special_detail(ctx: Ctx, current: dict, items: list[dict]) -> str:
    """FR « Fête des mères désactivée, Jour de Noël : toujours chez Camille »"""
    parts = []
    for item in items:
        old = current.get(item["kind"])
        if old == item:
            continue
        fr_label, fem, en_label = SPECIAL_LABELS.get(item["kind"], (item["kind"], False, item["kind"]))
        label = ctx.t(fr_label, en_label)
        if old is None or old["enabled"] != item["enabled"]:
            if ctx.lang == "en":
                state = "enabled" if item["enabled"] else "disabled"
            elif item["enabled"]:
                state = "activée" if fem else "activé"
            else:
                state = "désactivée" if fem else "désactivé"
            parts.append(f"{label} {state}")
            if not item["enabled"]:
                continue
        if old is None or (old["parent_mode"], old["parent_id"]) != (item["parent_mode"], item["parent_id"]):
            if item["parent_mode"] == "fixed":
                mode = ctx.t(f"toujours chez {ctx.name(item['parent_id'])}", f"always with {ctx.name(item['parent_id'])}")
            elif item["parent_mode"] == "alternate":
                mode = ctx.t(
                    f"en alternance (années paires chez {ctx.name(item['parent_id'])})",
                    f"alternating (even years with {ctx.name(item['parent_id'])})",
                )
            else:
                mode = ctx.t("selon le calendrier habituel", "per the usual schedule")
            parts.append(f"{label} : {mode}" if ctx.lang == "fr" else f"{label}: {mode}")
    return ", ".join(parts) or ctx.t("aucun changement", "no change")


def exchange_label(ctx: Ctx, snap: dict) -> str:
    """FR « jeu. 1 oct. chez Camille » ; EN « Thu, Oct 1 with Camille »"""
    return ctx.t("{r} chez {n}", "{r} with {n}").format(
        r=ctx.range(snap["date_start"], snap["date_end"]), n=ctx.name(snap["parent_id"])
    )


# ---------- demandes de changement ----------

def change_request_summary(ctx: Ctx, kind: str, context: dict | None) -> str:
    """Résumé d'une demande de changement (sans le nom du demandeur)."""
    c = context or {}
    if kind == "custody_rule":
        return ctx.t("Rythme de garde : ", "Custody schedule: ") + custody_detail(ctx, c.get("before"), c["after"])
    if kind == "vacation_rule":
        return ctx.t("Vacances : ", "Holidays: ") + vacation_detail(ctx, c.get("before"), c["after"])
    if kind == "special_day_rules":
        return ctx.t("Jours de fête : ", "Special days: ") + special_detail(ctx, c.get("before") or {}, c["after"])
    if kind == "delete_child":
        return ctx.t("Retirer l'enfant ", "Remove child ") + str(c.get("first_name", ""))
    if kind == "cancel_exchange":
        return ctx.t("Annuler l'échange du {r} (chez {n})", "Cancel the swap of {r} (with {n})").format(
            r=ctx.range(c["date_start"], c["date_end"]), n=ctx.name(c["parent_id"])
        )
    return kind


# ---------- journal ----------

def record(
    db: Session,
    household_id: int,
    actor_id: int | None,
    action: str,
    entity: str,
    entity_id: int | None,
    data: dict | None = None,
) -> None:
    """Ajoute une entrée au journal (sans commit : même transaction que la modification)."""
    db.add(
        AuditLog(
            household_id=household_id,
            actor_id=actor_id,
            action=action,
            entity=entity,
            entity_id=entity_id,
            data=jsonable_encoder(data) if data is not None else None,
        )
    )


_WALL_NOUN = {
    "fr": {"message": "le message", "task": "la tâche", "question": "la question"},
    "en": {"message": "the message", "task": "the task", "question": "the question"},
}


def _post_label(ctx: Ctx, post: dict) -> str:
    noun = _WALL_NOUN[ctx.lang].get(post.get("kind"), _WALL_NOUN[ctx.lang]["message"])
    return f"{noun} {ctx.q(post.get('body', ''))}"


def _exp_label(ctx: Ctx, exp: dict) -> str:
    return f"{ctx.q(exp['label'])} ({ctx.money(exp['amount_cents'])})"


_EXCHANGE_VERBS = {
    "exchange.accept": ("a accepté l'échange : ", "accepted the swap: "),
    "exchange.refuse": ("a refusé l'échange : ", "declined the swap: "),
    "exchange.withdraw": ("a retiré sa proposition d'échange : ", "withdrew their swap proposal: "),
}
_CR_VERBS = {
    "change_request.create": ("a demandé un changement : ", "requested a change: "),
    "change_request.accept": ("a accepté le changement : ", "accepted the change: "),
    "change_request.refuse": ("a refusé le changement : ", "declined the change: "),
    "change_request.withdraw": ("a retiré sa demande : ", "withdrew their request: "),
    "change_request.replace": ("a remplacé sa demande : ", "replaced their request: "),
    "change_request.outdated": (
        "n'a pas pu appliquer la demande, devenue caduque : ",
        "could not apply the request, which is now outdated: ",
    ),
}
_WALL_SIMPLE = {
    "wall_post.update": ("a modifié {x}", "edited {x}"),
    "wall_post.delete": ("a supprimé {x}", "deleted {x}"),
    "wall_post.complete": ("a marqué comme fait {x}", "marked {x} as done"),
    "wall_post.reopen": ("a rouvert {x}", "reopened {x}"),
}
_EXPENSE_SIMPLE = {
    "expense.create": ("a ajouté la dépense {x}", "added the expense {x}"),
    "expense.delete": ("a supprimé la dépense {x}", "deleted the expense {x}"),
    "expense.dispute": ("a contesté la dépense {x}", "disputed the expense {x}"),
    "expense.resolve": ("a levé la contestation sur la dépense {x}", "lifted the dispute on the expense {x}"),
    "expense.settle": ("a marqué comme remboursée la dépense {x}", "marked the expense {x} as settled"),
    "expense.unsettle": ("a annulé le remboursement de la dépense {x}", "marked the expense {x} as not settled"),
}
_SUBSCRIPTION_STATUS = {
    "active": ("a activé l'abonnement Premium", "activated the Premium subscription"),
    "canceled": ("a résilié l'abonnement Premium", "cancelled the Premium subscription"),
    "past_due": ("a un paiement Premium en échec", "has a failed Premium payment"),
    "trialing": ("a démarré un essai Premium", "started a Premium trial"),
}
_PLAN_LABELS = {"annual": ("annuelle", "annual"), "monthly": ("mensuelle", "monthly")}


def _render(ctx: Ctx, action: str, d: dict, db: Session) -> str:  # noqa: C901 — table de rendu
    t = ctx.t
    if action == "custody_rule.update":
        verb = t("a défini", "set") if d.get("before") is None else t("a modifié", "changed")
        return t(f"{verb} le rythme de garde : ", f"{verb} the custody schedule: ") + custody_detail(
            ctx, d.get("before"), d["after"]
        )
    if action == "vacation_rule.update":
        verb = t("a défini", "set") if d.get("before") is None else t("a modifié", "changed")
        return t(f"{verb} le partage des vacances : ", f"{verb} the holiday split: ") + vacation_detail(
            ctx, d.get("before"), d["after"]
        )
    if action == "special_day_rules.update":
        before = d.get("before") or []
        current = {r["kind"]: r for r in before} if isinstance(before, list) else before
        return t("a modifié les jours de fête : ", "changed the special days: ") + special_detail(
            ctx, current, d["after"]
        )
    if action == "child.create":
        return t("a ajouté l'enfant ", "added child ") + d["after"]["first_name"]
    if action == "child.update":
        a, b = d["before"]["first_name"], d["after"]["first_name"]
        return t("a modifié l'enfant ", "edited child ") + (a if a == b else f"{a} → {b}")
    if action == "child.delete":
        return t("a retiré l'enfant ", "removed child ") + d["before"]["first_name"]
    if action == "exchange.propose":
        verb = t("a ajouté un échange : ", "added a swap: ") if d.get("solo") else t(
            "a proposé un échange : ", "proposed a swap: "
        )
        return verb + exchange_label(ctx, d["after"])
    if action in _EXCHANGE_VERBS:
        return t(*_EXCHANGE_VERBS[action]) + exchange_label(ctx, d["after"])
    if action == "exchange.delete":
        verb = t("a annulé l'échange : ", "cancelled the swap: ") if d.get("cancelled") else t(
            "a supprimé l'échange : ", "deleted the swap: "
        )
        return verb + exchange_label(ctx, d["before"])
    if action in _CR_VERBS:
        return t(*_CR_VERBS[action]) + change_request_summary(ctx, d["kind"], d.get("context"))
    if action in _EXPENSE_SIMPLE:
        return t(*_EXPENSE_SIMPLE[action]).format(x=_exp_label(ctx, d["expense"]))
    if action == "expense.update":
        before, after = d["before"], d["after"]
        if before["amount_cents"] != after["amount_cents"]:
            what = f"{ctx.q(after['label'])} ({ctx.money(before['amount_cents'])} → {ctx.money(after['amount_cents'])})"
        else:
            what = _exp_label(ctx, after)
        return t("a modifié la dépense ", "edited the expense ") + what
    if action == "settlement.create":
        s = d["after"]
        return t(
            "a enregistré un remboursement de {m} de {a} à {b} ({d})",
            "recorded a reimbursement of {m} from {a} to {b} ({d})",
        ).format(m=ctx.money(s["amount_cents"]), a=ctx.name(s["from_user"]), b=ctx.name(s["to_user"]), d=ctx.date(s["date"]))
    if action == "settlement.delete":
        s = d["before"]
        return t("a supprimé le remboursement de {m} du {d}", "deleted the reimbursement of {m} on {d}").format(
            m=ctx.money(s["amount_cents"]), d=ctx.date(s["date"])
        )
    if action == "wall_post.create":
        post = d["after"]
        verb = {
            "task": t("a ajouté ", "added "),
            "question": t("a posé ", "asked "),
        }.get(post.get("kind"), t("a publié ", "posted "))
        return verb + _post_label(ctx, post)
    if action in _WALL_SIMPLE:
        return t(*_WALL_SIMPLE[action]).format(x=_post_label(ctx, d["post"]))
    if action == "wall_reply.create":
        return t("a répondu {r} sur {p}", "replied {r} on {p}").format(r=ctx.q(d["body"]), p=_post_label(ctx, d["post"]))
    if action == "wall_reply.delete":
        return t("a supprimé la réponse {r} sur {p}", "deleted the reply {r} on {p}").format(
            r=ctx.q(d["body"]), p=_post_label(ctx, d["post"])
        )
    if action == "household.rename":
        return t("a renommé le foyer : ", "renamed the household: ") + f"{d['before']['name']} → {d['after']['name']}"
    if action == "household.zone":
        return t("a changé la zone scolaire : ", "changed the school zone: ") + (
            f"{d['before']['school_zone']} → {d['after']['school_zone']}"
        )
    if action == "household.country":
        return t("a changé le pays : ", "changed the country: ") + f"{d['before']['country']} → {d['after']['country']}"
    if action == "school_vacation.create":
        return t("a ajouté les congés scolaires {l} ({r})", "added the school break {l} ({r})").format(
            l=ctx.q(d["after"]["label"]), r=ctx.range(d["after"]["start"], d["after"]["end"])
        )
    if action == "school_vacation.delete":
        return t("a supprimé les congés scolaires {l} ({r})", "deleted the school break {l} ({r})").format(
            l=ctx.q(d["before"]["label"]), r=ctx.range(d["before"]["start"], d["before"]["end"])
        )
    if action == "partner.rename":
        return t("a renommé le second parent : ", "renamed the co-parent: ") + (
            f"{d['before']['display_name']} → {d['after']['display_name']}"
        )
    if action == "member.join":
        return t("a rejoint le foyer", "joined the household")
    if action == "member.leave":
        return t("a quitté le foyer (compte supprimé)", "left the household (account deleted)")
    if action == "subscription.status":
        status = d["after"]
        if status in _SUBSCRIPTION_STATUS:
            return t(*_SUBSCRIPTION_STATUS[status])
        return t(f"abonnement Premium : statut « {status} »", f"Premium subscription: status “{status}”")
    if action == "subscription.cancel":
        return t(
            "a programmé la résiliation de l'abonnement Premium (fin de période)",
            "scheduled the Premium subscription to end (end of billing period)",
        )
    if action == "subscription.change_plan":
        fr, en = _PLAN_LABELS.get(d["plan"], (d["plan"], d["plan"]))
        return t(f"a changé l'offre Premium : {fr}", f"switched the Premium plan to {en}")
    return action


def render_summary(ctx: Ctx, entry: AuditLog) -> str:
    """Résumé lisible (fragment au passé, sans le nom de l'auteur) dans la langue du contexte."""
    try:
        return _render(ctx, entry.action, entry.data or {}, ctx.db)
    except (KeyError, TypeError, ValueError, AttributeError):
        return entry.action  # donnée ancienne ou incomplète : jamais d'erreur à la lecture
