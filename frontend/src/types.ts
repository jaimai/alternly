export interface User {
  id: number
  email: string
  display_name: string
  color: string
  email_opt_in: boolean
}

export interface Member {
  id: number
  display_name: string
  color: string
  role: 'parent1' | 'parent2'
}

export interface Child {
  id: number
  first_name: string
  birthdate: string | null
}

export type Pattern = 'alternate_weeks' | 'two_two_three' | 'every_other_weekend' | 'custom'

export interface CustodyRule {
  pattern: Pattern
  start_date: string
  reference_parent_id: number
  handover_day: number
  handover_time: string
  custom_weeks: string[] | null
}

export interface VacationRule {
  mode: 'split_half' | 'alternate_full'
  even_year_first_half_parent_id: number | null
}

export interface SpecialDayRule {
  kind: 'christmas_eve' | 'christmas_day' | 'mothers_day' | 'fathers_day'
  parent_mode: 'auto' | 'fixed' | 'alternate'
  parent_id: number | null
  enabled: boolean
}

export interface Household {
  id: number
  name: string
  school_zone: 'A' | 'B' | 'C'
  members: Member[]
  children: Child[]
  custody_rule: CustodyRule | null
  vacation_rule: VacationRule | null
  special_day_rules: SpecialDayRule[]
  my_role: string | null
}

export interface CalendarDay {
  date: string
  parent_id: number
  source: 'rule' | 'vacation' | 'special' | 'exception'
}

export interface PendingExchange {
  id: number
  date_start: string
  date_end: string
  proposed_parent_id: number
  proposed_by: number
  note: string
}

export interface CalendarResponse {
  days: CalendarDay[]
  public_holidays: { date: string; label: string }[]
  school_holidays: { label: string; start: string; end: string }[]
  school_holidays_loaded: boolean
  handover_day: number
  handover_time: string
  members: Member[]
  pending_exchanges: PendingExchange[]
}

export type ExchangeStatus = 'pending' | 'accepted' | 'refused' | 'withdrawn'

export interface ScheduleException {
  id: number
  date_start: string
  date_end: string
  parent_id: number
  note: string
  created_by: number
  status: ExchangeStatus
  resolved_by: number | null
  resolved_at: string | null
  response_note: string
  replaces_id: number | null
}

export interface Notification {
  id: number
  type: string
  payload: Record<string, string>
  read_at: string | null
  created_at: string
}

export type ExpenseCategory = 'sante' | 'ecole' | 'activites' | 'vetements' | 'cantine' | 'autre'

export interface Expense {
  id: number
  label: string
  amount_cents: number
  date: string
  category: ExpenseCategory
  child_id: number | null
  paid_by: number
  payer_percent: number
  status: 'active' | 'disputed'
  dispute_note: string
  created_by: number
}

export interface Settlement {
  id: number
  from_user: number
  to_user: number
  amount_cents: number
  date: string
  note: string
  created_by: number
}

export interface Balance {
  net: { user_id: number; amount_cents: number }[]
  debtor_id: number | null
  creditor_id: number | null
  amount_cents: number
}
