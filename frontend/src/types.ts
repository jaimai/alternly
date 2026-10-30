export type Locale = 'fr' | 'en'

export interface User {
  id: number
  email: string
  display_name: string
  color: string
  email_opt_in: boolean
  onboarding_seen: boolean
  whats_new_seen?: string | null
  locale: Locale
  /** Faux pour un compte créé via Google sans mot de passe défini. */
  has_password?: boolean
  auth_method?: 'email' | 'google' | 'apple'
  /** Consentement à la mesure d'audience (null = jamais répondu). */
  analytics_consent?: boolean | null
  created_at?: string | null
  /** Compte de l'équipe : événements marqués is_internal (exclus des stats). */
  is_internal?: boolean
}

export interface BillingStatus {
  status: 'trialing' | 'active' | 'past_due' | 'canceled' | 'none'
  access: boolean
  trial_days_left: number | null
  trial_ends_at: string | null
  subscription_ends_at: string | null
  /** Canal de l'abonnement du foyer : paddle (ce site) ou un store (achat dans l'app). */
  source?: 'paddle' | 'app_store' | 'play_store' | null
  /** Vrai si c'est l'abonnement de ce parent (et non celui de l'autre parent). */
  is_payer?: boolean
  /** Page d'abonnements du store, pour un achat fait dans l'app. */
  manage_url?: string | null
}

export interface SubscriptionInfo {
  manageable: boolean
  is_payer?: boolean
  status?: string
  plan?: 'annual' | 'monthly' | null
  next_billed_at?: string | null
  scheduled_change?: { action: string; effective_at: string } | null
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

export type Pattern = 'alternate_weeks' | 'two_two_three' | 'every_other_weekend' | 'custom'

export interface CustodyRule {
  pattern: Pattern
  start_date: string
  reference_parent_id: number
  handover_day: number
  handover_time: string
  custom_weeks: string[] | null
}

export type VacationMode = 'split_half' | 'alternate_full' | 'july_august' | 'weekly'
export type VacationPeriodKind = 'toussaint' | 'noel' | 'hiver' | 'printemps' | 'ete'
/** Réglage période par période ; `flip` inverse le parent qui commence pour cette période. */
export type VacationPeriodModes = Partial<Record<VacationPeriodKind, { mode: VacationMode; flip: boolean }>>

/** Règle qui se répète : jours de la semaine (weekly) ou période de l'année (yearly, « MM-DD »). */
export interface RecurringRuleInput {
  kind: 'weekly' | 'yearly'
  parent_id: number
  weekdays?: number[] | null // 0 = lundi
  every_other_week?: boolean
  anchor_date?: string | null
  include_vacations?: boolean
  start_md?: string | null
  end_md?: string | null
  alternate?: boolean
}

export interface RecurringRule extends RecurringRuleInput {
  id: number
}

export interface VacationRule {
  mode: VacationMode
  even_year_first_half_parent_id: number | null
  period_modes?: VacationPeriodModes | null
}

export type SpecialDayKind =
  | 'christmas_eve'
  | 'christmas_day'
  | 'mothers_day'
  | 'fathers_day'
  | 'thanksgiving'
  | 'halloween'
  | 'independence_day'
  | 'new_years_day'

export interface SpecialDayRule {
  kind: SpecialDayKind
  parent_mode: 'auto' | 'fixed' | 'alternate'
  parent_id: number | null
  enabled: boolean
}

export type Country = 'FR' | 'US'
export type Currency = 'EUR' | 'USD'

export interface SchoolVacation {
  id: number
  label: string
  start: string
  end: string
}

export interface Household {
  id: number
  name: string
  school_zone: 'A' | 'B' | 'C'
  country: Country
  currency: Currency
  members: Member[]
  children: Child[]
  custody_rule: CustodyRule | null
  vacation_rule: VacationRule | null
  special_day_rules: SpecialDayRule[]
  recurring_rules?: RecurringRule[]
  school_vacations: SchoolVacation[]
  my_role: string | null
}

export interface CalendarDay {
  date: string
  parent_id: number
  source: 'rule' | 'vacation' | 'special' | 'exception' | 'adjustment' | 'recurring'
}

export interface PendingExchange {
  id: number
  date_start: string
  date_end: string
  proposed_parent_id: number
  proposed_by: number
  note: string
  kind?: 'exchange' | 'adjustment'
}

export interface WallTask {
  id: number
  body: string
  due_date: string
  child_id: number | null
  assigned_to: number | null
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
  tasks: WallTask[]
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
  /** exchange : échange ; adjustment : jour personnalisé (« Ajuster mon planning »). */
  kind?: 'exchange' | 'adjustment'
  group_id?: string | null
}

export interface AdjustmentsResult {
  status: 'applied' | 'proposed' | 'pending_consent'
  created: number
  cleared: number
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
  settled_at: string | null
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
  owed_to_me_cents: number
  i_owe_cents: number
}

export type ChangeKind =
  | 'custody_rule'
  | 'vacation_rule'
  | 'special_day_rules'
  | 'recurring_rules'
  | 'delete_child'
  | 'cancel_exchange'

/** Changement sensible soumis à l'accord de l'autre parent. */
export interface ChangeRequest {
  id: number
  kind: ChangeKind
  /** Résumé lisible généré par le serveur, ex. « Rythme : semaine/semaine → 2-2-3 » */
  summary: string
  status: 'pending' | 'accepted' | 'refused' | 'withdrawn'
  requested_by: number
  created_at: string
  resolved_by: number | null
  resolved_at: string | null
}

/** Réponse 202 d'une modification qui attend l'accord de l'autre parent. */
export interface PendingChange {
  change_request: ChangeRequest
}

/** Entrée du journal (immuable) des modifications du foyer. */
export interface HistoryEntry {
  id: number
  actor_id: number | null
  action: string
  summary: string
  created_at: string
}

/** Invitation du second parent (lien /join/:token). */
export interface Invitation {
  invite_url: string
  token: string
  expires_at: string
  created_at: string | null
  invitee_email: string | null
  email_sent: boolean
}

/** Aperçu public du planning de l'invité (page /join). */
export interface InvitationPreview {
  household_name: string
  invited_by_name: string
  already_member: boolean
}

export interface InvitationSchedulePreview {
  inviter_first_name: string
  children: string[]
  has_schedule: boolean
  handover_time: string | null
  days: { date: string; who: 'you' | 'inviter' }[]
  your_periods: { start: string; end: string }[]
}

export type JournalKind = 'handover' | 'late' | 'missed' | 'change' | 'health' | 'school' | 'expense' | 'incident' | 'other'

/** Journal de garde : note privée, visible par son seul auteur. */
export interface JournalEntry {
  id: number
  day: string
  time: string | null
  kind: JournalKind
  child_id: number | null
  body: string
  created_at: string
  edited_at: string | null
}

export interface JournalEntryInput {
  day: string
  time: string | null
  kind: JournalKind
  child_id: number | null
  body: string
}

export interface JournalExport {
  author_name: string
  household_name: string
  children: Record<string, string>
  start: string | null
  end: string | null
  generated_at: string
  entries: JournalEntry[]
  /** Jour (yyyy-mm-dd) → prénom du parent qui avait les enfants selon le calendrier. */
  scheduled: Record<string, string>
}

/** Demande de remboursement imprimable : dépenses avancées, part due par l'autre parent. */
export interface ExpenseClaim {
  author_name: string
  other_name: string
  household_name: string
  currency: string
  children: Record<string, string>
  start: string | null
  end: string | null
  generated_at: string
  lines: {
    id: number
    date: string
    label: string
    category: ExpenseCategory
    child_id: number | null
    amount_cents: number
    payer_percent: number
    owed_cents: number
  }[]
  total_paid_cents: number
  total_owed_cents: number
}

export type PensionMonthStatus = 'paid' | 'partial' | 'missing' | 'upcoming'

export interface PensionPayment {
  id: number
  month: string
  amount_cents: number
  paid_on: string
  note: string
  created_by: number
}

/** Pension alimentaire du foyer : montant en vigueur, échéancier, versements. */
export interface Pension {
  payer_id: number
  payee_id: number
  due_day: number
  start_month: string
  amount_cents: number
  base_amount_cents: number | null
  base_index: number | null
  index_label: string | null
  revaluation_month: number | null
  rates: { id: number; effective_from: string; amount_cents: number; index_value: number | null }[]
  payments: PensionPayment[]
  months: { month: string; due_cents: number; paid_cents: number; status: PensionMonthStatus }[]
  arrears_cents: number
}

export interface PensionInput {
  payer_id: number
  amount_cents: number
  due_day: number
  start_month: string
  base_amount_cents: number | null
  base_index: number | null
  index_label: string | null
  revaluation_month: number | null
}

export interface Revaluation {
  current_cents: number
  new_cents: number
  base_amount_cents: number
  base_index: number
  new_index: number
  applied: boolean
}
