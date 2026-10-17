// Client de l'API Alternly — mêmes routes et même jeton JWT que l'app web
// (frontend/src/api.ts). Le jeton vit dans le trousseau (expo-secure-store).
import Constants from 'expo-constants'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import type {
  Balance,
  BillingStatus,
  ChangeRequest,
  CalendarResponse,
  CustodyRule,
  DepartureReason,
  Expense,
  ExpenseInput,
  HistoryEntry,
  Household,
  Invitation,
  InvitationPreview,
  Locale,
  Notification,
  PendingChange,
  PushPrefs,
  ScheduleException,
  SchoolVacation,
  Settlement,
  SpecialDayRule,
  TokenResponse,
  User,
  VacationRule,
  WallPost,
  WallReply,
} from './types'
import { appLanguage, t } from './i18n'
import { hasPendingInvite } from './pendingInvite'

export const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'https://web-production-d1aa3.up.railway.app/api'

const TOKEN_KEY = 'alternly_token'
const APP_VERSION = Constants.expoConfig?.version ?? 'dev'

let token: string | null = null
let onUnauthorized: (() => void) | null = null

// expo-secure-store n'existe pas sur le web : la cible web (développement) utilise localStorage.
const storage = Platform.OS === 'web'
  ? {
      get: async () => globalThis.localStorage?.getItem(TOKEN_KEY) ?? null,
      set: async (v: string) => globalThis.localStorage?.setItem(TOKEN_KEY, v),
      remove: async () => globalThis.localStorage?.removeItem(TOKEN_KEY),
    }
  : {
      get: () => SecureStore.getItemAsync(TOKEN_KEY),
      set: (v: string) => SecureStore.setItemAsync(TOKEN_KEY, v),
      remove: () => SecureStore.deleteItemAsync(TOKEN_KEY),
    }

export async function loadToken(): Promise<string | null> {
  token = await storage.get()
  return token
}

export async function saveToken(value: string | null): Promise<void> {
  token = value
  if (value) await storage.set(value)
  else await storage.remove()
}

/** Appelé quand l'API rejette le jeton (expiré, révoqué) : l'app se déconnecte. */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler
}

/** Vrai si la réponse est un changement en attente d'accord (HTTP 202). */
export function isPendingChange(x: unknown): x is PendingChange {
  return typeof x === 'object' && x !== null && 'change_request' in x
}

export class ApiError extends Error {
  status: number
  /** `detail` structuré renvoyé par l'API (ex. invitation expirée), sinon undefined. */
  data?: Record<string, unknown>
  constructor(status: number, detail: string, data?: Record<string, unknown>) {
    super(detail)
    this.status = status
    this.data = data
  }
}

/** Message lisible depuis le `detail` FastAPI (texte, objet {message} ou liste Pydantic). */
export function errorDetail(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object' || !('detail' in body)) return fallback
  const detail = (body as { detail: unknown }).detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    return detail.map((e: { msg?: string }) => e?.msg).filter(Boolean).join(' · ') || fallback
  }
  if (detail && typeof detail === 'object' && typeof (detail as { message?: unknown }).message === 'string') {
    return (detail as { message: string }).message
  }
  return fallback
}

async function request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-App-Version': APP_VERSION,
    'X-App-Platform': Platform.OS,
  }
  if (token) headers.Authorization = `Bearer ${token}`
  let resp: Response
  try {
    resp = await fetch(`${API_BASE}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    throw new ApiError(0, t('common.network'))
  }
  if (resp.status === 401 && !path.startsWith('/auth/')) {
    onUnauthorized?.()
    throw new ApiError(401, t('common.sessionExpired'))
  }
  if (!resp.ok) {
    let body: unknown = null
    try {
      body = await resp.json()
    } catch {
      /* corps non JSON */
    }
    const detail = body && typeof body === 'object' ? (body as { detail?: unknown }).detail : undefined
    const data = detail && typeof detail === 'object' && !Array.isArray(detail) ? (detail as Record<string, unknown>) : undefined
    throw new ApiError(resp.status, errorDetail(body, t('common.errorGeneric')), data)
  }
  if (resp.status === 204) return undefined as T
  return resp.json() as Promise<T>
}

export const api = {
  login: (email: string, password: string) =>
    request<TokenResponse>('/auth/login', { method: 'POST', body: { email, password } }),
  register: (data: { email: string; password: string; display_name: string; color: string }) =>
    request<TokenResponse>('/auth/register', { method: 'POST', body: { ...data, locale: appLanguage(), via_invite: hasPendingInvite() } }),
  googleLogin: (credential: string) =>
    request<TokenResponse>('/auth/google', { method: 'POST', body: { credential, locale: appLanguage(), via_invite: hasPendingInvite() } }),
  appleLogin: (identity_token: string, nonce: string, given_name?: string) =>
    request<TokenResponse>('/auth/apple', {
      method: 'POST',
      body: { identity_token, nonce, given_name, locale: appLanguage(), via_invite: hasPendingInvite() },
    }),
  resetPassword: (token: string, password: string) =>
    request<TokenResponse>('/auth/password/reset', { method: 'POST', body: { token, password } }),
  previewInvitation: (token: string) => request<InvitationPreview>(`/invitations/${encodeURIComponent(token)}`),
  acceptInvitation: (token: string) =>
    request<Household>(`/invitations/${encodeURIComponent(token)}/accept`, { method: 'POST' }),
  forgotPassword: (email: string) =>
    request<{ ok: boolean }>('/auth/password/forgot', { method: 'POST', body: { email } }),
  me: () => request<User>('/auth/me'),
  billingStatus: () => request<BillingStatus>('/billing/status'),
  /** Relit l'état des achats chez RevenueCat puis renvoie le statut à jour. */
  storeSync: () => request<BillingStatus>('/billing/store-sync', { method: 'POST' }),
  updateMe: (data: { display_name?: string; color?: string; email_opt_in?: boolean; locale?: Locale }) =>
    request<User>('/auth/me', { method: 'PATCH', body: data }),
  /** Révoque les autres sessions : renvoie un nouveau jeton pour ce téléphone. */
  changePassword: (current_password: string, new_password: string) =>
    request<TokenResponse>('/auth/password/change', { method: 'POST', body: { current_password, new_password } }),
  /** Révoque toutes les sessions, y compris celle de ce téléphone. */
  logoutAll: () => request<void>('/auth/logout-all', { method: 'POST' }),
  /** Export RGPD : profil, foyer, calendrier, dépenses, tableau (JSON). */
  exportData: () => request<unknown>('/auth/me/export'),
  sendFeedback: (data: { kind: 'problem' | 'idea' | 'question'; message: string; page: string }) =>
    request<unknown>('/feedback', { method: 'POST', body: { ...data, source: 'settings', locale: appLanguage() } }),
  deleteAccount: (reason: DepartureReason | null, comment: string) =>
    request<void>('/auth/me', { method: 'DELETE', body: { reason, comment } }),

  myHousehold: () => request<Household>('/households/mine'),
  // Dépenses (Premium : 402 sinon).
  expenses: (hid: number) => request<Expense[]>(`/households/${hid}/expenses`),
  createExpense: (hid: number, data: ExpenseInput) =>
    request<Expense>(`/households/${hid}/expenses`, { method: 'POST', body: data }),
  updateExpense: (hid: number, id: number, data: ExpenseInput) =>
    request<Expense>(`/households/${hid}/expenses/${id}`, { method: 'PATCH', body: data }),
  deleteExpense: (hid: number, id: number) => request<void>(`/households/${hid}/expenses/${id}`, { method: 'DELETE' }),
  disputeExpense: (hid: number, id: number, dispute_note: string) =>
    request<Expense>(`/households/${hid}/expenses/${id}/dispute`, { method: 'POST', body: { dispute_note } }),
  resolveExpense: (hid: number, id: number) => request<Expense>(`/households/${hid}/expenses/${id}/resolve`, { method: 'POST' }),
  settleExpense: (hid: number, id: number) => request<Expense>(`/households/${hid}/expenses/${id}/settle`, { method: 'POST' }),
  unsettleExpense: (hid: number, id: number) => request<Expense>(`/households/${hid}/expenses/${id}/unsettle`, { method: 'POST' }),
  balance: (hid: number) => request<Balance>(`/households/${hid}/balance`),
  settlements: (hid: number) => request<Settlement[]>(`/households/${hid}/settlements`),
  createSettlement: (hid: number, data: Omit<Settlement, 'id' | 'created_by'>) =>
    request<Settlement>(`/households/${hid}/settlements`, { method: 'POST', body: data }),
  deleteSettlement: (hid: number, id: number) => request<void>(`/households/${hid}/settlements/${id}`, { method: 'DELETE' }),
  // Tableau entre parents (Premium : 402 sinon).
  wall: (hid: number) => request<WallPost[]>(`/households/${hid}/wall`),
  createPost: (hid: number, data: Pick<WallPost, 'kind' | 'body' | 'child_id' | 'due_date' | 'assigned_to'>) =>
    request<WallPost>(`/households/${hid}/wall`, { method: 'POST', body: data }),
  deletePost: (hid: number, id: number) => request<void>(`/households/${hid}/wall/${id}`, { method: 'DELETE' }),
  completePost: (hid: number, id: number) => request<WallPost>(`/households/${hid}/wall/${id}/complete`, { method: 'POST' }),
  reopenPost: (hid: number, id: number) => request<WallPost>(`/households/${hid}/wall/${id}/reopen`, { method: 'POST' }),
  replyToPost: (hid: number, id: number, body: string) =>
    request<WallReply>(`/households/${hid}/wall/${id}/replies`, { method: 'POST', body: { body } }),
  deleteReply: (hid: number, id: number) => request<void>(`/households/${hid}/replies/${id}`, { method: 'DELETE' }),
  createHousehold: (data: { name: string; country: 'FR' | 'US'; school_zone: 'A' | 'B' | 'C' }) =>
    request<Household>('/households', { method: 'POST', body: data }),
  addChild: (householdId: number, first_name: string) =>
    request<unknown>(`/households/${householdId}/children`, { method: 'POST', body: { first_name } }),
  // Avec deux parents réels, les changements sensibles renvoient 202 {"change_request": …}
  // (en attente d'accord) : tester avec isPendingChange().
  setCustodyRule: (householdId: number, rule: CustodyRule) =>
    request<CustodyRule | PendingChange>(`/households/${householdId}/custody-rule`, { method: 'PUT', body: rule }),
  setVacationRule: (householdId: number, rule: VacationRule) =>
    request<VacationRule | PendingChange>(`/households/${householdId}/vacation-rule`, { method: 'PUT', body: rule }),
  setSpecialDayRules: (householdId: number, rules: SpecialDayRule[]) =>
    request<SpecialDayRule[] | PendingChange>(`/households/${householdId}/special-day-rules`, { method: 'PUT', body: rules }),
  deleteChild: (householdId: number, childId: number) =>
    request<PendingChange | undefined>(`/households/${householdId}/children/${childId}`, { method: 'DELETE' }),
  updateHousehold: (householdId: number, data: { name?: string; school_zone?: 'A' | 'B' | 'C' }) =>
    request<Household>(`/households/${householdId}`, { method: 'PATCH', body: data }),
  history: (householdId: number, beforeId?: number) =>
    request<HistoryEntry[]>(`/households/${householdId}/history?limit=50${beforeId ? `&before_id=${beforeId}` : ''}`),
  // Flux d'agenda privé (Premium) : lire le lien ne le change pas ; régénérer coupe l'ancien.
  icalLink: () => request<{ ical_token: string }>('/ical/link'),
  regenerateIcal: () => request<{ ical_token: string }>('/ical/regenerate', { method: 'POST' }),
  changeRequests: (householdId: number) =>
    request<ChangeRequest[]>(`/households/${householdId}/change-requests?status=pending`),
  answerChange: (householdId: number, id: number, action: 'accept' | 'refuse' | 'withdraw') =>
    request<ChangeRequest>(`/households/${householdId}/change-requests/${id}/${action}`, { method: 'POST' }),
  currentInvitation: (householdId: number) =>
    request<{ invitation: Invitation | null; last_expired: boolean }>(`/households/${householdId}/invitations/current`),
  createInvitation: (householdId: number) =>
    request<Invitation>(`/households/${householdId}/invitations`, { method: 'POST' }),
  calendar: (householdId: number, start: string, end: string) =>
    request<CalendarResponse>(`/households/${householdId}/calendar?start=${start}&end=${end}`),
  exceptions: (householdId: number, status?: 'pending' | 'accepted') =>
    request<ScheduleException[]>(`/households/${householdId}/exceptions${status ? `?status=${status}` : ''}`),
  /** Annule un échange (accepté : demande d'accord à l'autre parent si deux parents → 202). */
  deleteException: (householdId: number, id: number) =>
    request<PendingChange | undefined>(`/households/${householdId}/exceptions/${id}`, { method: 'DELETE' }),
  addSchoolVacation: (householdId: number, data: { label: string; start: string; end: string }) =>
    request<SchoolVacation>(`/households/${householdId}/school-vacations`, { method: 'POST', body: data }),
  deleteSchoolVacation: (householdId: number, periodId: number) =>
    request<void>(`/households/${householdId}/school-vacations/${periodId}`, { method: 'DELETE' }),
  /** Nomme le second parent tant qu'il n'a pas de compte. */
  renamePartner: (householdId: number, display_name: string) =>
    request<unknown>(`/households/${householdId}/partner`, { method: 'PATCH', body: { display_name } }),
  /** Invitation envoyée par e-mail par Alternly. */
  emailInvitation: (householdId: number, email: string) =>
    request<Invitation>(`/households/${householdId}/invitations/email`, { method: 'POST', body: { email, locale: appLanguage() } }),
  createException: (
    householdId: number,
    data: { date_start: string; date_end: string; parent_id: number; note: string; replaces_id?: number },
  ) => request<ScheduleException>(`/households/${householdId}/exceptions`, { method: 'POST', body: data }),
  withdrawExchange: (householdId: number, id: number) =>
    request<unknown>(`/households/${householdId}/exceptions/${id}/withdraw`, { method: 'POST' }),
  acceptExchange: (householdId: number, id: number) =>
    request<unknown>(`/households/${householdId}/exceptions/${id}/accept`, { method: 'POST', body: { response_note: '' } }),
  refuseExchange: (householdId: number, id: number) =>
    request<unknown>(`/households/${householdId}/exceptions/${id}/refuse`, { method: 'POST', body: { response_note: '' } }),

  notifications: () => request<Notification[]>('/notifications'),
  registerDevice: (data: { token: string; platform: 'ios' | 'android'; app_version?: string }) =>
    request<void>('/devices', { method: 'POST', body: data }),
  unregisterDevice: (token: string) => request<void>(`/devices/${encodeURIComponent(token)}`, { method: 'DELETE' }),
  pushPrefs: () => request<PushPrefs>('/devices/prefs'),
  setPushPrefs: (prefs: PushPrefs) => request<PushPrefs>('/devices/prefs', { method: 'PUT', body: prefs }),
  markRead: (ids: number[]) => request<{ updated: number }>('/notifications/read', { method: 'POST', body: { ids } }),
}
