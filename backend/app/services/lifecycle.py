"""E-mails de cycle de vie : séquence de bienvenue et rappels de vacances scolaires.

- J0 (inscription, immédiat via BackgroundTasks) : « Bienvenue » ; le parent qui
  rejoint un foyer par invitation reçoit à la place « Bienvenue dans le foyer de
  {prénom} » (envoyé à l'acceptation). Un seul J0 par compte (type `welcome`).
- Cron quotidien (`POST /api/cron/lifecycle`, voir `run`) :
  - J1 (âge 1–3 j) : aucune règle de garde → « Il ne manque que votre règle de garde » ;
  - J3 (âge 3–7 j) : foyer encore solo → conseils pour inviter l'autre parent ;
  - J7 (âge 7–10 j) : règle posée → synchro d'agenda + échanges (mention Premium
    douce si le foyer est gratuit) ;
  - rappel ~10 jours avant chaque période de vacances scolaires (FR : zone
    officielle ; US : congés saisis), calculé par le même moteur que l'app.

Garde-fous communs : `email_opt_in` respecté, jamais de placeholder ni de compte
anonymisé, idempotence par `email_log (user_id, kind)` unique, et au plus un
e-mail « non sollicité » par personne et par jour, relances de la boucle
d'invitation comprises (le workflow cron lance ce job après `invite-reminders`).

Premium : les rappels par e-mail sont une fonction Premium (cf. rappels
d'échange, `routers/cron.py`). Les rappels de vacances partent donc aux foyers
Premium ; un foyer gratuit en reçoit un seul, « offert » (première période après
l'inscription), qui mentionne que Premium les envoie avant chaque vacances. La
séquence de bienvenue (onboarding) n'est pas une fonction Premium.
"""
from datetime import date, datetime, timedelta
from types import SimpleNamespace

from fastapi import BackgroundTasks
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..deps import household_has_premium
from ..models import (
    Child,
    CustodyRule,
    EmailLog,
    Household,
    HouseholdMember,
    Invitation,
    SchoolVacationPeriod,
    User,
    utcnow,
)
from . import analytics, school_holidays
from . import email as email_service
from . import lifecycle_emails as tpl
from .calendar_service import NoCustodyRule, build_calendar
from .custody_engine import Period
from .public_holidays import PublicDataUnavailable

WELCOME = "welcome"
J1_RULE = "j1_rule"
J3_INVITE = "j3_invite"
J7_VALUE = "j7_value"
HOLIDAY_PREFIX = "holiday:"

# Fenêtres d'âge du compte (bornes [min, max[) : un envoi retardé par le garde-fou
# quotidien part le lendemain, et un compte plus ancien ne reçoit pas les étapes passées.
SEQUENCE: list[tuple[str, timedelta, timedelta]] = [
    (J1_RULE, timedelta(days=1), timedelta(days=3)),
    (J3_INVITE, timedelta(days=3), timedelta(days=7)),
    (J7_VALUE, timedelta(days=7), timedelta(days=10)),
]
# « Un e-mail par jour » : 20 h plutôt que 24 pour absorber la gigue du cron quotidien.
DAILY_GUARD = timedelta(hours=20)
# Rappel de vacances : envoyé entre J-10 et J-6 (rattrapage si un cron saute).
HOLIDAY_LEAD_MAX = 10
HOLIDAY_LEAD_MIN = 6
PARTNER_PREVIEW_DAYS = 28


# ---------------------------------------------------------------- garde-fous


def can_email(user: User | None) -> bool:
    """Compte réel, joignable et qui n'a pas refusé les e-mails."""
    return (
        user is not None
        and not user.is_placeholder
        and bool(user.email_opt_in)
        and not user.email.endswith(".invalid")  # compte anonymisé
    )


def already_sent(db: Session, user_id: int, kind: str) -> bool:
    return db.scalar(select(EmailLog.id).where(EmailLog.user_id == user_id, EmailLog.kind == kind)) is not None


def last_email_at(db: Session, user: User) -> datetime | None:
    """Dernier e-mail non sollicité : cycle de vie + relances de la boucle d'invitation."""
    stamps = [
        db.scalar(select(func.max(EmailLog.sent_at)).where(EmailLog.user_id == user.id)),
        user.invite_nudge_sent_at,
        db.scalar(select(func.max(Invitation.inviter_reminder_d2_at)).where(Invitation.invited_by == user.id)),
        db.scalar(select(func.max(Invitation.inviter_reminder_d5_at)).where(Invitation.invited_by == user.id)),
    ]
    stamps = [s for s in stamps if s is not None]
    return max(stamps) if stamps else None


def emailed_recently(db: Session, user: User, now: datetime) -> bool:
    last = last_email_at(db, user)
    return last is not None and last > now - DAILY_GUARD


def _claim(db: Session, user: User, kind: str, now: datetime) -> bool:
    """Réserve l'envoi (ligne unique user/kind) et commit. False si déjà pris
    (y compris par une exécution concurrente)."""
    if already_sent(db, user.id, kind):
        return False
    db.add(EmailLog(user_id=user.id, kind=kind, sent_at=now))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return False
    return True


def _send(user: User, email: tpl.Email) -> bool:
    return email_service.send_lifecycle_email(
        user.email, email.subject, email.html, email.text, tpl.unsubscribe_url(user.id)
    )


def _membership(db: Session, user_id: int) -> HouseholdMember | None:
    return db.scalar(select(HouseholdMember).where(HouseholdMember.user_id == user_id))


def _real_members(db: Session, household_id: int) -> list[User]:
    out = []
    for m in db.scalars(select(HouseholdMember).where(HouseholdMember.household_id == household_id)):
        u = db.get(User, m.user_id)
        if u is not None and not u.is_placeholder:
            out.append(u)
    return out


def _children(db: Session, household_id: int) -> list[str]:
    return [
        c.first_name
        for c in db.scalars(select(Child).where(Child.household_id == household_id).order_by(Child.id))
    ]


def _has_rule(db: Session, household_id: int) -> bool:
    return db.scalar(select(CustodyRule.id).where(CustodyRule.household_id == household_id)) is not None


def _segments(days) -> list[tuple[str, date, date]]:
    """Plages consécutives (parent, début, fin) d'une liste de DayAssignment."""
    out: list[list] = []
    for d in days:
        if out and out[-1][0] == d.parent and out[-1][2] == d.day - timedelta(days=1):
            out[-1][2] = d.day
        else:
            out.append([d.parent, d.day, d.day])
    return [(p, s, e) for p, s, e in out]


# ---------------------------------------------------------------- J0


def _deliver_welcome(to: str, email: tpl.Email, unsub: str, who: SimpleNamespace, variant: str,
                     household_id: int | None) -> None:
    """Tâche d'arrière-plan : n'utilise que des valeurs copiées (la session de la
    requête peut être fermée quand elle s'exécute)."""
    if email_service.send_lifecycle_email(to, email.subject, email.html, email.text, unsub):
        analytics.capture_for_user(
            who, "lifecycle_email_sent", {"kind": WELCOME, "variant": variant}, household_id=household_id
        )


def _queue(background: BackgroundTasks, user: User, email: tpl.Email, variant: str,
           household_id: int | None) -> None:
    who = SimpleNamespace(id=user.id, analytics_consent=user.analytics_consent)
    background.add_task(
        _deliver_welcome, user.email, email, tpl.unsubscribe_url(user.id), who, variant, household_id
    )


def queue_welcome(db: Session, user: User, background: BackgroundTasks) -> None:
    """J0 « Bienvenue » (inscription hors invitation). L'envoi réseau part après la réponse."""
    if not can_email(user) or not _claim(db, user, WELCOME, utcnow()):
        return
    _queue(background, user, tpl.welcome_email(user.display_name, user.locale, tpl.unsubscribe_url(user.id)),
           "owner", None)


def queue_partner_welcome(db: Session, user: User, household: Household, inviter: User | None,
                          background: BackgroundTasks) -> None:
    """J0 du parent invité, à l'acceptation : « Bienvenue dans le foyer de {prénom} »
    avec ses prochaines périodes de garde (même calcul que le calendrier de l'app)."""
    if not can_email(user) or already_sent(db, user.id, WELCOME):
        return
    periods: list[tuple[date, date]] = []
    start = date.today()
    try:
        cal = build_calendar(db, household, start, start + timedelta(days=PARTNER_PREVIEW_DAYS - 1))
        periods = [(s, e) for p, s, e in _segments(cal.days) if p == str(user.id)]
    except NoCustodyRule:
        pass
    email = tpl.welcome_partner_email(
        inviter.display_name if inviter else "", _children(db, household.id), periods,
        user.locale, tpl.unsubscribe_url(user.id),
    )
    if not _claim(db, user, WELCOME, utcnow()):
        return
    _queue(background, user, email, "partner", household.id)


# ---------------------------------------------------------------- séquence J1 / J3 / J7


def _sequence_email(db: Session, user: User, kind: str) -> tuple[tpl.Email, dict, int | None] | None:
    """E-mail de l'étape si ses conditions sont remplies, sinon None (étape sautée)."""
    member = _membership(db, user.id)
    hid = member.household_id if member else None
    unsub = tpl.unsubscribe_url(user.id)
    if kind == J1_RULE:
        if hid is not None and _has_rule(db, hid):
            return None
        return tpl.rule_missing_email(user.locale, unsub), {"kind": kind}, hid
    if hid is None:
        return None
    if kind == J3_INVITE:
        if len(_real_members(db, hid)) >= 2:
            return None
        return tpl.invite_tips_email(user.locale, unsub), {"kind": kind}, hid
    if kind == J7_VALUE:
        if not _has_rule(db, hid):
            return None
        premium = household_has_premium(db, hid)
        return tpl.value_email(premium, user.locale, unsub), {"kind": kind, "premium": premium}, hid
    return None


def run_sequence(db: Session, now: datetime) -> dict[str, int]:
    stats = {kind: 0 for kind, _, _ in SEQUENCE}
    oldest = now - max(hi for _, _, hi in SEQUENCE)
    youngest = now - min(lo for _, lo, _ in SEQUENCE)
    users = db.scalars(
        select(User).where(User.created_at > oldest, User.created_at <= youngest).order_by(User.id)
    ).all()
    for user in users:
        if not can_email(user) or emailed_recently(db, user, now):
            continue
        age = now - user.created_at
        step = next((k for k, lo, hi in SEQUENCE if lo <= age < hi), None)
        if step is None or already_sent(db, user.id, step):
            continue
        built = _sequence_email(db, user, step)
        if built is None or not _claim(db, user, step, now):
            continue
        email, props, hid = built
        if _send(user, email):
            stats[step] += 1
            analytics.capture_for_user(user, "lifecycle_email_sent", props, household_id=hid)
    return stats


# ---------------------------------------------------------------- rappels de vacances


def _upcoming_periods(db: Session, household: Household, today: date, zone_cache: dict) -> list[Period]:
    """Périodes dont le début tombe dans la fenêtre du rappel (J-10 à J-6)."""
    lo, hi = today + timedelta(days=HOLIDAY_LEAD_MIN), today + timedelta(days=HOLIDAY_LEAD_MAX)
    if household.country == "US":
        rows = db.scalars(
            select(SchoolVacationPeriod).where(
                SchoolVacationPeriod.household_id == household.id,
                SchoolVacationPeriod.start >= lo,
                SchoolVacationPeriod.start <= hi,
            ).order_by(SchoolVacationPeriod.start)
        ).all()
        return [Period(label=r.label, start=r.start, end=r.end) for r in rows]
    zone = household.school_zone
    if zone not in zone_cache:
        try:
            zone_cache[zone] = school_holidays.get(db, zone, school_holidays.school_years_for_range(lo, hi))
        except PublicDataUnavailable:
            zone_cache[zone] = None  # réessayé au prochain cron (fenêtre de rattrapage)
    periods = zone_cache[zone] or []
    return [p for p in periods if lo <= p.start <= hi]


def _holiday_kind(period: Period) -> str:
    return f"{HOLIDAY_PREFIX}{period.label}:{period.start.isoformat()}"


def _had_holiday_email(db: Session, user_id: int) -> bool:
    return db.scalar(
        select(EmailLog.id).where(EmailLog.user_id == user_id, EmailLog.kind.startswith(HOLIDAY_PREFIX))
    ) is not None


def run_holidays(db: Session, now: datetime, today: date) -> dict[str, int]:
    stats = {"holiday_reminders": 0, "holiday_teasers": 0}
    zone_cache: dict = {}
    households = db.scalars(
        select(Household).join(CustodyRule, CustodyRule.household_id == Household.id).order_by(Household.id)
    ).all()
    for household in households:
        periods = _upcoming_periods(db, household, today, zone_cache)
        if not periods:
            continue
        members = [u for u in _real_members(db, household.id) if can_email(u)]
        if not members:
            continue
        premium = household_has_premium(db, household.id)
        children = _children(db, household.id)
        all_members = {
            m.user_id: db.get(User, m.user_id)
            for m in db.scalars(select(HouseholdMember).where(HouseholdMember.household_id == household.id))
        }
        for period in periods:
            try:
                cal = build_calendar(db, household, period.start, period.end)
            except NoCustodyRule:
                continue
            if not cal.school_holidays_loaded and household.country != "US":
                continue  # données publiques indisponibles : calendrier potentiellement faux
            segments = _segments(cal.days)
            kind = _holiday_kind(period)
            days_until = (period.start - today).days
            for user in members:
                if already_sent(db, user.id, kind) or emailed_recently(db, user, now):
                    continue
                teaser = not premium
                if teaser and _had_holiday_email(db, user.id):
                    continue  # foyer gratuit : un seul rappel offert
                segs = []
                for parent_id, s, e in segments:
                    other = all_members.get(int(parent_id))
                    is_me = parent_id == str(user.id)
                    who = ("you" if user.locale == "en" else "vous") if is_me else (
                        email_service.first_name(other.display_name) if other else "?"
                    )
                    segs.append(tpl.Segment(who=who, is_me=is_me, start=s, end=e))
                other_parent = next((u for u in _real_members(db, household.id) if u.id != user.id), None)
                email = tpl.holiday_reminder_email(
                    period.label, period.start, days_until, children, segs, cal.rule.handover_time,
                    other_parent.display_name if other_parent else None, teaser,
                    user.locale, tpl.unsubscribe_url(user.id),
                )
                if not _claim(db, user, kind, now):
                    continue
                if _send(user, email):
                    stats["holiday_teasers" if teaser else "holiday_reminders"] += 1
                    analytics.capture_for_user(
                        user, "holiday_reminder_sent",
                        {"period": tpl.holiday_key(period.label), "teaser": teaser, "country": household.country},
                        household_id=household.id,
                    )
    return stats


def run(db: Session, now: datetime | None = None, today: date | None = None) -> dict[str, int]:
    """Tâche quotidienne. Rappels de vacances d'abord (datés), puis la séquence :
    une étape retardée par le garde-fou quotidien part le lendemain."""
    now = now or utcnow()
    today = today or date.today()
    return {**run_holidays(db, now, today), **run_sequence(db, now)}
