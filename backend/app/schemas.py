from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

PATTERNS = {"alternate_weeks", "two_two_three", "every_other_weekend", "custom"}
VACATION_MODES = {"split_half", "alternate_full"}
SPECIAL_KINDS = {"christmas_eve", "christmas_day", "mothers_day", "fathers_day"}
ZONES = {"A", "B", "C"}


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    display_name: str = Field(min_length=1)
    color: str = "#4f7cac"


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserOut(ORMModel):
    id: int
    email: str
    display_name: str
    color: str


class UserUpdate(BaseModel):
    display_name: str | None = None
    color: str | None = None


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class MemberOut(ORMModel):
    id: int
    display_name: str
    color: str
    role: str


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


class ExceptionOut(ORMModel):
    id: int
    date_start: date
    date_end: date
    parent_id: int
    note: str
    created_by: int


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


class CalendarResponse(BaseModel):
    days: list[CalendarDay]
    public_holidays: list[LabeledDate]
    school_holidays: list[LabeledPeriod]
    school_holidays_loaded: bool
    handover_day: int
    handover_time: str
    members: list[MemberOut]


class NotificationOut(ORMModel):
    id: int
    type: str
    payload: dict
    read_at: datetime | None
    created_at: datetime


class ReadNotificationsIn(BaseModel):
    ids: list[int]
