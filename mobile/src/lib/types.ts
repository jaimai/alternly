// Sous-ensemble des types de l'API utilisés par l'app (cf. frontend/src/types.ts).
// À extraire dans packages/shared en phase 2 (docs/mobile/architecture-technique.md §5).
import type { Pattern } from './custodyPreview'

export type Locale = 'fr' | 'en'

export interface User {
  id: number
  email: string
  display_name: string
  color: string
  email_opt_in: boolean
  onboarding_seen: boolean
  locale: Locale
  has_password?: boolean
  auth_method?: 'email' | 'google' | 'apple'
  created_at?: string | null
}

export interface TokenResponse {
  access_token: string
  user: User
}

export interface Member {
  id: number
  display_name: string
  color: string
  role: 'parent1' | 'parent2'
  is_placeholder: boolean
}

export interface Child {
  id: number
  first_name: string
  birthdate: string | null
}

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

export interface Household {
  id: number
  name: string
  school_zone: 'A' | 'B' | 'C'
  country: 'FR' | 'US'
  currency: 'EUR' | 'USD'
  members: Member[]
  children: Child[]
  custody_rule: CustodyRule | null
  vacation_rule: VacationRule | null
  my_role: string | null
}

export interface ScheduleException {
  id: number
  date_start: string
  date_end: string
  parent_id: number
  note: string
  created_by: number
  status: 'pending' | 'accepted' | 'refused' | 'withdrawn'
  replaces_id: number | null
}

export interface Invitation {
  invite_url: string
  token: string
  expires_at: string
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
  tasks: { id: number; body: string; due_date: string; child_id: number | null; assigned_to: number | null }[]
}

export interface Notification {
  id: number
  type: string
  payload: Record<string, string>
  read_at: string | null
  created_at: string
}

/** Notifications push par catégorie (GET/PUT /api/devices/prefs). */
export interface PushPrefs {
  handover: boolean
  exchanges: boolean
  expenses: boolean
  wall: boolean
  household: boolean
}

export interface InvitationPreview {
  household_name: string
  invited_by_name: string
  already_member: boolean
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
  settled_at: string | null
  created_by: number
}

export type ExpenseInput = Pick<Expense, 'label' | 'amount_cents' | 'date' | 'category' | 'child_id' | 'paid_by' | 'payer_percent'>

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
  owed_to_me_cents: number
  i_owe_cents: number
}

export type WallKind = 'message' | 'task' | 'question'

export interface WallReply {
  id: number
  author_id: number
  body: string
  created_at: string
}

export interface WallPost {
  id: number
  author_id: number
  kind: WallKind
  body: string
  child_id: number | null
  due_date: string | null
  assigned_to: number | null
  completed_at: string | null
  completed_by: number | null
  created_at: string
  edited_at: string | null
  replies: WallReply[]
}
