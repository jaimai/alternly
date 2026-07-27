from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

# Alias : un champ nommé « date » masque le type `date` dans son annotation
# quand il a une valeur par défaut (ex. `date: date | None = None`).
DateType = date

PATTERNS = {"alternate_weeks", "two_two_three", "every_other_weekend", "custom"}
VACATION_MODES = {"split_half", "alternate_full"}
SPECIAL_KINDS = {"christmas_eve", "christmas_day", "mothers_day", "fathers_day"}
PARENT_MODES = {"auto", "fixed", "alternate"}
EXPENSE_CATEGORIES = {"sante", "ecole", "activites", "vetements", "cantine", "autre"}
WALL_KINDS = {"message", "task", "question"}
ZONES = {"A", "B", "C"}


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


COLOR_PATTERN = r"^#[0-9a-fA-F]{6}$"


class UserCreate(BaseModel):
    email: EmailStr
    # bcrypt tronque à 72 octets : borne haute explicite
    password: str = Field(min_length=8, max_length=72)
    display_name: str = Field(min_length=1, max_length=50)
    color: str = Field(default="#4f7cac", pattern=COLOR_PATTERN)


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(ORMModel):
    id: int
    email: str
    display_name: str
    color: str
    email_opt_in: bool
    onboarding_seen: bool


class UserUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=50)
    color: str | None = Field(default=None, pattern=COLOR_PATTERN)
    email_opt_in: bool | None = None
    onboarding_seen: bool | None = None


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class MemberOut(ORMModel):
    id: int
    display_name: str
    color: str
    role: str
    is_placeholder: bool = False


class PartnerUpdate(BaseModel):
    display_name: str = Field(min_length=1, max_length=50)
    color: str | None = Field(default=None, pattern=COLOR_PATTERN)


class ChildIn(BaseModel):
    first_name: str = Field(min_length=1)
    birthdate: date | None = None


class ChildOut(ORMModel):
    id: int
    first_name: str
    birthdate: date | None


class CustodyRuleIn(BaseModel):
    pattern: str
    start_date: date
    reference_parent_id: int
    handover_day: int = Field(default=0, ge=0, le=6)
    handover_time: str = "18:00"
    custom_weeks: list[str] | None = None


class CustodyRuleOut(ORMModel):
    pattern: str
    start_date: date
    reference_parent_id: int
    handover_day: int
    handover_time: str
    custom_weeks: list[str] | None


class VacationRuleIn(BaseModel):
    mode: str = "split_half"
    even_year_first_half_parent_id: int | None = None


class VacationRuleOut(ORMModel):
    mode: str
    even_year_first_half_parent_id: int | None


class SpecialDayRuleIn(BaseModel):
    kind: str
    parent_mode: str = "auto"  # auto | fixed
    parent_id: int | None = None
    enabled: bool = True


class SpecialDayRuleOut(ORMModel):
    kind: str
    parent_mode: str
    parent_id: int | None
    enabled: bool


class HouseholdCreate(BaseModel):
    name: str = Field(min_length=1)
    school_zone: str = "A"


class HouseholdUpdate(BaseModel):
    name: str | None = None
    school_zone: str | None = None


class HouseholdOut(ORMModel):
    id: int
    name: str
    school_zone: str
    members: list[MemberOut] = []
    children: list[ChildOut] = []
    custody_rule: CustodyRuleOut | None = None
    vacation_rule: VacationRuleOut | None = None
    special_day_rules: list[SpecialDayRuleOut] = []
    my_role: str | None = None


class ExceptionIn(BaseModel):
    date_start: date
    date_end: date
    parent_id: int
    note: str = ""
    replaces_id: int | None = None


class ExchangeResponseIn(BaseModel):
    response_note: str = ""


class ExceptionOut(ORMModel):
    id: int
    date_start: date
    date_end: date
    parent_id: int
    note: str
    created_by: int
    status: str
    resolved_by: int | None
    resolved_at: datetime | None
    response_note: str
    replaces_id: int | None


class PendingExchange(BaseModel):
    id: int
    date_start: date
    date_end: date
    proposed_parent_id: int
    proposed_by: int
    note: str


class InvitationOut(BaseModel):
    invite_url: str
    token: str
    expires_at: datetime


class InvitationPreview(BaseModel):
    household_name: str
    invited_by_name: str


class CalendarDay(BaseModel):
    date: date
    parent_id: int
    source: str  # rule | vacation | special | exception


class LabeledDate(BaseModel):
    date: date
    label: str


class LabeledPeriod(BaseModel):
    label: str
    start: date
    end: date


class WallTaskOut(BaseModel):
    id: int
    body: str
    due_date: DateType
    child_id: int | None
    assigned_to: int | None


class CalendarResponse(BaseModel):
    days: list[CalendarDay]
    public_holidays: list[LabeledDate]
    school_holidays: list[LabeledPeriod]
    school_holidays_loaded: bool
    handover_day: int
    handover_time: str
    members: list[MemberOut]
    pending_exchanges: list[PendingExchange] = []
    tasks: list[WallTaskOut] = []


class ExpenseIn(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    amount_cents: int = Field(gt=0)
    date: date
    category: str
    child_id: int | None = None
    paid_by: int | None = None  # défaut = créateur
    payer_percent: int = Field(default=50, ge=0, le=100)


class ExpensePatch(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    amount_cents: int | None = Field(default=None, gt=0)
    date: DateType | None = None
    category: str | None = None
    child_id: int | None = None
    paid_by: int | None = None
    payer_percent: int | None = Field(default=None, ge=0, le=100)


class ExpenseOut(ORMModel):
    id: int
    label: str
    amount_cents: int
    date: date
    category: str
    child_id: int | None
    paid_by: int
    payer_percent: int
    status: str
    dispute_note: str
    settled_at: datetime | None = None
    created_by: int


class DisputeIn(BaseModel):
    dispute_note: str = ""


class SettlementIn(BaseModel):
    from_user: int
    to_user: int
    amount_cents: int = Field(gt=0)
    date: date
    note: str = ""


class SettlementOut(ORMModel):
    id: int
    from_user: int
    to_user: int
    amount_cents: int
    date: date
    note: str
    created_by: int


class BalanceNet(BaseModel):
    user_id: int
    amount_cents: int


class BalanceOut(BaseModel):
    net: list[BalanceNet]
    debtor_id: int | None
    creditor_id: int | None
    amount_cents: int
    # Visu rapide, du point de vue du parent qui interroge (dépenses ouvertes).
    owed_to_me_cents: int = 0  # ce qu'on me doit (à me faire rembourser)
    i_owe_cents: int = 0       # ce que je dois (à payer)


class WallPostIn(BaseModel):
    kind: str
    body: str = Field(min_length=1, max_length=2000)
    child_id: int | None = None
    due_date: DateType | None = None
    assigned_to: int | None = None


class WallPostPatch(BaseModel):
    body: str | None = Field(default=None, min_length=1, max_length=2000)
    child_id: int | None = None
    due_date: DateType | None = None
    assigned_to: int | None = None


class WallReplyIn(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class WallReplyOut(ORMModel):
    id: int
    author_id: int
    body: str
    created_at: datetime


class WallPostOut(ORMModel):
    id: int
    author_id: int
    kind: str
    body: str
    child_id: int | None
    due_date: DateType | None
    assigned_to: int | None
    completed_at: datetime | None
    completed_by: int | None
    created_at: datetime
    edited_at: datetime | None
    replies: list[WallReplyOut] = []


class NotificationOut(ORMModel):
    id: int
    type: str
    payload: dict
    read_at: datetime | None
    created_at: datetime


class ReadNotificationsIn(BaseModel):
    ids: list[int]
