import uuid
from datetime import date, datetime, timezone

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    # naïf UTC : cohérent entre SQLite et Postgres (colonnes sans timezone)
    return datetime.now(timezone.utc).replace(tzinfo=None)


def new_token() -> str:
    return uuid.uuid4().hex


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String, unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String)
    display_name: Mapped[str] = mapped_column(String)
    color: Mapped[str] = mapped_column(String, default="#4f7cac")
    ical_token: Mapped[str] = mapped_column(String, unique=True, default=new_token)
    email_opt_in: Mapped[bool] = mapped_column(Boolean, default=True)
    onboarding_seen: Mapped[bool] = mapped_column(Boolean, default=False)
    locale: Mapped[str] = mapped_column(String, default="fr")  # langue de l'UI : fr | en
    # Second parent « fantôme » : créé automatiquement pour un foyer solo afin
    # de pouvoir lui assigner des dépenses avant qu'il n'ait un vrai compte.
    # Ne peut pas se connecter ; réclamé (claim) quand le vrai parent rejoint.
    is_placeholder: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    # Abonnement Paddle. status : trialing | active | past_due | canceled | none.
    subscription_status: Mapped[str] = mapped_column(String, default="trialing")
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Accès payé jusqu'à (fin de période) ; permet de garder l'accès après résiliation.
    subscription_ends_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    paddle_customer_id: Mapped[str | None] = mapped_column(String, nullable=True)
    paddle_subscription_id: Mapped[str | None] = mapped_column(String, nullable=True)


class Household(Base):
    __tablename__ = "households"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String)
    school_zone: Mapped[str] = mapped_column(String, default="A")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    members: Mapped[list["HouseholdMember"]] = relationship(back_populates="household")
    children: Mapped[list["Child"]] = relationship()


class HouseholdMember(Base):
    __tablename__ = "household_members"
    __table_args__ = (UniqueConstraint("household_id", "user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    household_id: Mapped[int] = mapped_column(ForeignKey("households.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    role: Mapped[str] = mapped_column(String)  # parent1 | parent2

    household: Mapped[Household] = relationship(back_populates="members")
    user: Mapped[User] = relationship()


class Child(Base):
    __tablename__ = "children"

    id: Mapped[int] = mapped_column(primary_key=True)
    household_id: Mapped[int] = mapped_column(ForeignKey("households.id"))
    first_name: Mapped[str] = mapped_column(String)
    birthdate: Mapped[date | None] = mapped_column(Date, nullable=True)


class CustodyRule(Base):
    __tablename__ = "custody_rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    household_id: Mapped[int] = mapped_column(ForeignKey("households.id"), unique=True)
    pattern: Mapped[str] = mapped_column(String)  # alternate_weeks | two_two_three | every_other_weekend | custom
    start_date: Mapped[date] = mapped_column(Date)
    reference_parent_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    handover_day: Mapped[int] = mapped_column(Integer, default=0)  # 0 = lundi
    handover_time: Mapped[str] = mapped_column(String, default="18:00")
    custom_weeks: Mapped[list | None] = mapped_column(JSON, nullable=True)  # 14 x "ref"/"other"


class VacationRule(Base):
    __tablename__ = "vacation_rules"

    id: Mapped[int] = mapped_column(primary_key=True)
    household_id: Mapped[int] = mapped_column(ForeignKey("households.id"), unique=True)
    mode: Mapped[str] = mapped_column(String, default="split_half")  # split_half | alternate_full
    even_year_first_half_parent_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)


class SpecialDayRule(Base):
    __tablename__ = "special_day_rules"
    __table_args__ = (UniqueConstraint("household_id", "kind"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    household_id: Mapped[int] = mapped_column(ForeignKey("households.id"))
    kind: Mapped[str] = mapped_column(String)  # christmas_eve | christmas_day | mothers_day | fathers_day
    parent_mode: Mapped[str] = mapped_column(String, default="auto")  # auto | fixed
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class ScheduleException(Base):
    __tablename__ = "schedule_exceptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    household_id: Mapped[int] = mapped_column(ForeignKey("households.id"))
    date_start: Mapped[date] = mapped_column(Date)
    date_end: Mapped[date] = mapped_column(Date)
    parent_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str] = mapped_column(String, default="")
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    # Cycle de vie proposer/accepter. `expired` n'est jamais stocké : il se
    # calcule (status == pending et date_start < aujourd'hui). Voir routers/rules.
    status: Mapped[str] = mapped_column(String, default="pending")  # pending | accepted | refused | withdrawn
    resolved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    response_note: Mapped[str] = mapped_column(String, default="")
    replaces_id: Mapped[int | None] = mapped_column(ForeignKey("schedule_exceptions.id"), nullable=True)
    reminder_sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Expense(Base):
    __tablename__ = "expenses"

    id: Mapped[int] = mapped_column(primary_key=True)
    household_id: Mapped[int] = mapped_column(ForeignKey("households.id"))
    label: Mapped[str] = mapped_column(String)
    amount_cents: Mapped[int] = mapped_column(Integer)  # > 0
    date: Mapped[date] = mapped_column(Date)
    category: Mapped[str] = mapped_column(String)  # sante|ecole|activites|vetements|cantine|autre
    child_id: Mapped[int | None] = mapped_column(ForeignKey("children.id"), nullable=True)
    paid_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    payer_percent: Mapped[int] = mapped_column(Integer, default=50)  # part à charge du payeur
    status: Mapped[str] = mapped_column(String, default="active")  # active | disputed
    dispute_note: Mapped[str] = mapped_column(String, default="")
    # Marquée remboursée : sortie des soldes, indépendante des Settlements globaux.
    settled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    settled_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Settlement(Base):
    __tablename__ = "settlements"

    id: Mapped[int] = mapped_column(primary_key=True)
    household_id: Mapped[int] = mapped_column(ForeignKey("households.id"))
    from_user: Mapped[int] = mapped_column(ForeignKey("users.id"))
    to_user: Mapped[int] = mapped_column(ForeignKey("users.id"))
    amount_cents: Mapped[int] = mapped_column(Integer)  # > 0
    date: Mapped[date] = mapped_column(Date)
    note: Mapped[str] = mapped_column(String, default="")
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class WallPost(Base):
    __tablename__ = "wall_posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    household_id: Mapped[int] = mapped_column(ForeignKey("households.id"))
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    kind: Mapped[str] = mapped_column(String)  # message | task | question
    body: Mapped[str] = mapped_column(String)
    child_id: Mapped[int | None] = mapped_column(ForeignKey("children.id"), nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)  # tâche datée
    assigned_to: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)  # fait / résolu
    completed_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    edited_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class WallReply(Base):
    __tablename__ = "wall_replies"

    id: Mapped[int] = mapped_column(primary_key=True)
    post_id: Mapped[int] = mapped_column(ForeignKey("wall_posts.id"))
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(String)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Invitation(Base):
    __tablename__ = "invitations"

    id: Mapped[int] = mapped_column(primary_key=True)
    household_id: Mapped[int] = mapped_column(ForeignKey("households.id"))
    token: Mapped[str] = mapped_column(String, unique=True)
    invited_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    type: Mapped[str] = mapped_column(String)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class SchoolHolidayCache(Base):
    __tablename__ = "school_holiday_cache"
    __table_args__ = (UniqueConstraint("zone", "label", "school_year"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    zone: Mapped[str] = mapped_column(String)
    label: Mapped[str] = mapped_column(String)
    start: Mapped[date] = mapped_column(Date)
    end: Mapped[date] = mapped_column(Date)  # borne incluse
    school_year: Mapped[str] = mapped_column(String)  # ex: 2026-2027


class PublicHolidayCache(Base):
    __tablename__ = "public_holiday_cache"

    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(Date, unique=True)
    label: Mapped[str] = mapped_column(String)
