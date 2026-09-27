import type {
  Balance,
  BillingStatus,
  CalendarResponse,
  ChangeRequest,
  Child,
  CustodyRule,
  Expense,
  Country,
  HistoryEntry,
  Household,
  Locale,
  Member,
  Notification,
  PendingChange,
  SchoolVacation,
  SubscriptionInfo,
  ScheduleException,
  Settlement,
  SpecialDayRule,
  User,
  VacationRule,
  WallPost,
  WallReply,
} from './types'
import { getAttribution, getConsent, resetIdentity, track } from './analytics'
import type { EventProps } from './analytics'
import { EV } from './analyticsEvents'
import type { AnalyticsEvent } from './analyticsEvents'

// Base de l'API : en prod (Vercel), pointe vers le backend Railway via
// VITE_API_URL (ex. https://xxx.up.railway.app/api). En dev, proxy Vite sur /api.
export const API_BASE = import.meta.env.VITE_API_URL || '/api'

const TOKEN_KEY = 'coparent_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number
  constructor(status: number, detail: string) {
    super(detail)
    this.status = status
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  const resp = await fetch(`${API_BASE}${path}`, { ...options, headers })
  if (resp.status === 401 && !path.startsWith('/auth/')) {
    setToken(null)
    resetIdentity()
    window.location.href = '/login'
    throw new ApiError(401, 'Session expirée')
  }
  if (!resp.ok) {
    let detail = resp.statusText
    try {
      const body = await resp.json()
      if (typeof body.detail === 'string') {
        detail = body.detail
      } else if (Array.isArray(body.detail)) {
        // Erreur de validation FastAPI/Pydantic : detail = liste d'objets {loc, msg}
        detail = body.detail.map((e: { msg?: string }) => e.msg).filter(Boolean).join(' · ') || detail
      }
    } catch {
      /* corps non JSON */
    }
    throw new ApiError(resp.status, detail)
  }
  if (resp.status === 204) return undefined as T
  return resp.json()
}

// ---------- analytics : événements émis au succès des actions (jamais de texte libre)

/** Exécute `onOk` (tracking) après succès, sans jamais affecter la réponse. */
function tracked<T>(p: Promise<T>, onOk: (r: T) => void): Promise<T> {
  return p.then((r) => {
    try {
      onOk(r)
    } catch {
      /* l'analytics ne casse jamais l'app */
    }
    return r
  })
}

function ev<T>(p: Promise<T>, event: AnalyticsEvent, props?: EventProps): Promise<T> {
  return tracked(p, () => track(event, props))
}

/** Modification sensible : en attente d'accord (202) → change_request_created. */
function evChange<T>(p: Promise<T>, kind: string, otherwise?: AnalyticsEvent): Promise<T> {
  return tracked(p, (r) => {
    if (isPendingChange(r)) track(EV.changeRequestCreated, { kind })
    else if (otherwise) track(otherwise)
  })
}

function signupContext() {
  const consent = getConsent()
  return {
    analytics_consent: consent === null ? undefined : consent === 'granted',
    via_invite: Boolean(localStorage.getItem('pending_invite')),
  }
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
}

/** Compte créé il y a moins de 2 minutes (connexion Google = inscription). */
function justCreated(user: User): boolean {
  if (!user.created_at) return false
  const iso = /(?:[zZ]|[+-]\d\d:\d\d)$/.test(user.created_at) ? user.created_at : `${user.created_at}Z`
  return Date.now() - Date.parse(iso) < 120_000
}

export interface TokenResponse {
  access_token: string
  user: User
}

export const api = {
  register: (data: {
    email: string; password: string; display_name: string; color: string; locale?: Locale
    analytics_consent?: boolean; via_invite?: boolean
  }) =>
    tracked(
      request<TokenResponse>('/auth/register', { method: 'POST', body: JSON.stringify({ ...signupContext(), ...data }) }),
      () => track(EV.signedUp, { method: 'email', via_invite: signupContext().via_invite, ...getAttribution() }),
    ),
  login: (data: { email: string; password: string }) =>
    ev(request<TokenResponse>('/auth/login', { method: 'POST', body: JSON.stringify(data) }), EV.login, { method: 'email' }),
  me: () => request<User>('/auth/me'),
  googleLogin: (credential: string, locale: 'fr' | 'en', extra: { analytics_consent?: boolean; via_invite?: boolean } = {}) =>
    tracked(
      request<TokenResponse>('/auth/google', {
        method: 'POST',
        body: JSON.stringify({ credential, locale, ...signupContext(), ...extra }),
      }),
      (r) =>
        justCreated(r.user)
          ? track(EV.signedUp, { method: 'google', via_invite: signupContext().via_invite, ...getAttribution() })
          : track(EV.login, { method: 'google' }),
    ),
  forgotPassword: (email: string) =>
    ev(
      request<{ ok: boolean }>('/auth/password/forgot', { method: 'POST', body: JSON.stringify({ email }) }),
      EV.passwordResetRequested,
    ),
  resetPassword: (token: string, password: string) =>
    request<TokenResponse>('/auth/password/reset', { method: 'POST', body: JSON.stringify({ token, password }) }),
  changePassword: (current_password: string, new_password: string) =>
    ev(
      request<TokenResponse>('/auth/password/change', {
        method: 'POST',
        body: JSON.stringify({ current_password, new_password }),
      }),
      EV.passwordChanged,
      { first_password: !current_password },
    ),
  /** Révoque toutes les sessions (y compris celle-ci). */
  logoutAll: () => request<void>('/auth/logout-all', { method: 'POST' }),
  /** Export RGPD : profil, foyer, calendrier, dépenses, mur (JSON). */
  exportData: () => ev(request<unknown>('/auth/me/export'), EV.dataExported),
  updateMe: (data: {
    display_name?: string; color?: string; email_opt_in?: boolean; onboarding_seen?: boolean; locale?: Locale
    analytics_consent?: boolean
  }) =>
    request<User>('/auth/me', { method: 'PATCH', body: JSON.stringify(data) }),
  deleteAccount: () => request<void>('/auth/me', { method: 'DELETE' }),

  createHousehold: (data: { name: string; school_zone?: string; country?: Country }) =>
    request<Household>('/households', { method: 'POST', body: JSON.stringify(data) }),
  myHousehold: () => request<Household>('/households/mine'),
  updateHousehold: (id: number, data: { name?: string; school_zone?: string; country?: Country }) =>
    request<Household>(`/households/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  renamePartner: (householdId: number, data: { display_name: string; color?: string }) =>
    request<Member>(`/households/${householdId}/partner`, { method: 'PATCH', body: JSON.stringify(data) }),
  addSchoolVacation: (householdId: number, data: { label: string; start: string; end: string }) =>
    request<SchoolVacation>(`/households/${householdId}/school-vacations`, { method: 'POST', body: JSON.stringify(data) }),
  deleteSchoolVacation: (householdId: number, periodId: number) =>
    request<void>(`/households/${householdId}/school-vacations/${periodId}`, { method: 'DELETE' }),

  createInvitation: (householdId: number) =>
    ev(
      request<{ invite_url: string; token: string; expires_at: string }>(
        `/households/${householdId}/invitations`,
        { method: 'POST' },
      ),
      EV.inviteCreated,
    ),
  previewInvitation: (token: string) =>
    request<{ household_name: string; invited_by_name: string }>(`/invitations/${token}`),
  acceptInvitation: (token: string) =>
    ev(request<Household>(`/invitations/${token}/accept`, { method: 'POST' }), EV.inviteAccepted),

  addChild: (householdId: number, data: { first_name: string; birthdate?: string | null }) =>
    ev(
      request<Child>(`/households/${householdId}/children`, { method: 'POST', body: JSON.stringify(data) }),
      EV.childAdded,
      { has_birthdate: Boolean(data.birthdate) },
    ),
  // Avec deux parents réels, les changements sensibles renvoient 202
  // {"change_request": …} (en attente d'accord) : tester avec isPendingChange().
  deleteChild: (householdId: number, childId: number) =>
    evChange(
      request<PendingChange | undefined>(`/households/${householdId}/children/${childId}`, { method: 'DELETE' }),
      'delete_child',
    ),

  setCustodyRule: (householdId: number, data: Omit<CustodyRule, 'custom_weeks'> & { custom_weeks?: string[] | null }) =>
    evChange(
      request<CustodyRule | PendingChange>(`/households/${householdId}/custody-rule`, { method: 'PUT', body: JSON.stringify(data) }),
      'custody_rule',
    ),
  setVacationRule: (householdId: number, data: VacationRule) =>
    evChange(
      request<VacationRule | PendingChange>(`/households/${householdId}/vacation-rule`, { method: 'PUT', body: JSON.stringify(data) }),
      'vacation_rule',
    ),
  setSpecialDayRules: (householdId: number, data: SpecialDayRule[]) =>
    evChange(
      request<SpecialDayRule[] | PendingChange>(`/households/${householdId}/special-day-rules`, { method: 'PUT', body: JSON.stringify(data) }),
      'special_day_rules',
    ),

  listChangeRequests: (householdId: number, status: 'pending' | 'all' = 'pending') =>
    request<ChangeRequest[]>(`/households/${householdId}/change-requests?status=${status}`),
  acceptChange: (householdId: number, id: number) =>
    tracked(
      request<ChangeRequest>(`/households/${householdId}/change-requests/${id}/accept`, { method: 'POST' }),
      (r) => track(EV.changeRequestAccepted, { kind: r.kind }),
    ),
  refuseChange: (householdId: number, id: number) =>
    tracked(
      request<ChangeRequest>(`/households/${householdId}/change-requests/${id}/refuse`, { method: 'POST' }),
      (r) => track(EV.changeRequestRefused, { kind: r.kind }),
    ),
  withdrawChange: (householdId: number, id: number) =>
    tracked(
      request<ChangeRequest>(`/households/${householdId}/change-requests/${id}/withdraw`, { method: 'POST' }),
      (r) => track(EV.changeRequestWithdrawn, { kind: r.kind }),
    ),
  history: (householdId: number, beforeId?: number) =>
    request<HistoryEntry[]>(`/households/${householdId}/history?limit=50${beforeId ? `&before_id=${beforeId}` : ''}`),

  calendar: (householdId: number, start: string, end: string) =>
    request<CalendarResponse>(`/households/${householdId}/calendar?start=${start}&end=${end}`),

  listExceptions: (householdId: number, status?: 'pending' | 'accepted' | 'refused' | 'withdrawn') =>
    request<ScheduleException[]>(
      `/households/${householdId}/exceptions${status ? `?status=${status}` : ''}`,
    ),
  createException: (
    householdId: number,
    data: { date_start: string; date_end: string; parent_id: number; note: string; replaces_id?: number },
  ) =>
    ev(
      request<ScheduleException>(`/households/${householdId}/exceptions`, { method: 'POST', body: JSON.stringify(data) }),
      data.replaces_id ? EV.exchangeCountered : EV.exchangeProposed,
      {
        days: daysBetween(data.date_start, data.date_end) + 1,
        lead_days: daysBetween(new Date().toISOString().slice(0, 10), data.date_start),
        has_note: Boolean(data.note),
      },
    ),
  acceptExchange: (householdId: number, id: number, response_note = '') =>
    ev(
      request<ScheduleException>(`/households/${householdId}/exceptions/${id}/accept`, {
        method: 'POST',
        body: JSON.stringify({ response_note }),
      }),
      EV.exchangeAccepted,
    ),
  refuseExchange: (householdId: number, id: number, response_note = '') =>
    ev(
      request<ScheduleException>(`/households/${householdId}/exceptions/${id}/refuse`, {
        method: 'POST',
        body: JSON.stringify({ response_note }),
      }),
      EV.exchangeRefused,
    ),
  withdrawExchange: (householdId: number, id: number) =>
    ev(request<ScheduleException>(`/households/${householdId}/exceptions/${id}/withdraw`, { method: 'POST' }), EV.exchangeWithdrawn),
  deleteException: (householdId: number, id: number) =>
    evChange(
      request<PendingChange | undefined>(`/households/${householdId}/exceptions/${id}`, { method: 'DELETE' }),
      'cancel_exchange',
      EV.exchangeDeleted,
    ),

  listExpenses: (householdId: number) =>
    request<Expense[]>(`/households/${householdId}/expenses`),
  createExpense: (
    householdId: number,
    data: {
      label: string; amount_cents: number; date: string; category: string
      child_id?: number | null; paid_by?: number; payer_percent?: number
    },
  ) =>
    ev(
      request<Expense>(`/households/${householdId}/expenses`, { method: 'POST', body: JSON.stringify(data) }),
      EV.expenseAdded,
      {
        category: data.category,
        amount: data.amount_cents / 100,
        payer_percent: data.payer_percent ?? 50,
        split: (data.payer_percent ?? 50) === 50 ? 'equal' : 'custom',
        has_child: data.child_id != null,
      },
    ),
  updateExpense: (householdId: number, id: number, data: Partial<Omit<Expense, 'id' | 'status' | 'dispute_note' | 'created_by'>>) =>
    request<Expense>(`/households/${householdId}/expenses/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteExpense: (householdId: number, id: number) =>
    request<void>(`/households/${householdId}/expenses/${id}`, { method: 'DELETE' }),
  disputeExpense: (householdId: number, id: number, dispute_note = '') =>
    ev(
      request<Expense>(`/households/${householdId}/expenses/${id}/dispute`, { method: 'POST', body: JSON.stringify({ dispute_note }) }),
      EV.expenseDisputed,
    ),
  resolveExpense: (householdId: number, id: number) =>
    request<Expense>(`/households/${householdId}/expenses/${id}/resolve`, { method: 'POST' }),
  settleExpense: (householdId: number, id: number) =>
    ev(request<Expense>(`/households/${householdId}/expenses/${id}/settle`, { method: 'POST' }), EV.expenseSettled),
  unsettleExpense: (householdId: number, id: number) =>
    request<Expense>(`/households/${householdId}/expenses/${id}/unsettle`, { method: 'POST' }),
  balance: (householdId: number) => request<Balance>(`/households/${householdId}/balance`),
  listSettlements: (householdId: number) =>
    request<Settlement[]>(`/households/${householdId}/settlements`),
  createSettlement: (
    householdId: number,
    data: { from_user: number; to_user: number; amount_cents: number; date: string; note?: string },
  ) =>
    ev(
      request<Settlement>(`/households/${householdId}/settlements`, { method: 'POST', body: JSON.stringify(data) }),
      EV.settlementRecorded,
      { amount: data.amount_cents / 100 },
    ),
  deleteSettlement: (householdId: number, id: number) =>
    request<void>(`/households/${householdId}/settlements/${id}`, { method: 'DELETE' }),

  listWall: (householdId: number) => request<WallPost[]>(`/households/${householdId}/wall`),
  createPost: (
    householdId: number,
    data: { kind: string; body: string; child_id?: number | null; due_date?: string | null; assigned_to?: number | null },
  ) =>
    ev(
      request<WallPost>(`/households/${householdId}/wall`, { method: 'POST', body: JSON.stringify(data) }),
      EV.wallPostCreated,
      { kind: data.kind, has_due_date: Boolean(data.due_date), assigned: data.assigned_to != null, has_child: data.child_id != null },
    ),
  deletePost: (householdId: number, id: number) =>
    request<void>(`/households/${householdId}/wall/${id}`, { method: 'DELETE' }),
  completePost: (householdId: number, id: number) =>
    ev(request<WallPost>(`/households/${householdId}/wall/${id}/complete`, { method: 'POST' }), EV.taskCompleted),
  reopenPost: (householdId: number, id: number) =>
    request<WallPost>(`/households/${householdId}/wall/${id}/reopen`, { method: 'POST' }),
  addReply: (householdId: number, postId: number, body: string) =>
    ev(
      request<WallReply>(`/households/${householdId}/wall/${postId}/replies`, { method: 'POST', body: JSON.stringify({ body }) }),
      EV.wallReplyCreated,
    ),
  deleteReply: (householdId: number, replyId: number) =>
    request<void>(`/households/${householdId}/replies/${replyId}`, { method: 'DELETE' }),

  billingStatus: () => request<BillingStatus>('/billing/status'),
  subscription: () => request<SubscriptionInfo>('/billing/subscription'),
  cancelSubscription: () =>
    ev(request<{ ok: boolean }>('/billing/cancel', { method: 'POST' }), EV.subscriptionCancelRequested),
  changePlan: (plan: 'annual' | 'monthly') =>
    ev(
      request<{ ok: boolean }>('/billing/change-plan', { method: 'POST', body: JSON.stringify({ plan }) }),
      EV.planChanged,
      { plan },
    ),

  notifications: () => request<Notification[]>('/notifications'),
  markRead: (ids: number[]) => request<{ updated: number }>('/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) }),
  regenerateIcal: () =>
    ev(request<{ ical_token: string }>('/ical/regenerate', { method: 'POST' }), EV.icalLinkGenerated),
}

/** Vrai si la réponse est un changement en attente d'accord (HTTP 202). */
export function isPendingChange(x: unknown): x is PendingChange {
  return typeof x === 'object' && x !== null && 'change_request' in x
}
