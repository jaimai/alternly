import type {
  Balance,
  CalendarResponse,
  Child,
  CustodyRule,
  Expense,
  Household,
  Notification,
  ScheduleException,
  Settlement,
  SpecialDayRule,
  User,
  VacationRule,
} from './types'

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
  const resp = await fetch(`/api${path}`, { ...options, headers })
  if (resp.status === 401 && !path.startsWith('/auth/')) {
    setToken(null)
    window.location.href = '/app/login'
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

interface TokenResponse {
  access_token: string
  user: User
}

export const api = {
  register: (data: { email: string; password: string; display_name: string; color: string }) =>
    request<TokenResponse>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  login: (data: { email: string; password: string }) =>
    request<TokenResponse>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),
  me: () => request<User>('/auth/me'),
  updateMe: (data: { display_name?: string; color?: string; email_opt_in?: boolean }) =>
    request<User>('/auth/me', { method: 'PATCH', body: JSON.stringify(data) }),

  createHousehold: (data: { name: string; school_zone: string }) =>
    request<Household>('/households', { method: 'POST', body: JSON.stringify(data) }),
  myHousehold: () => request<Household>('/households/mine'),
  updateHousehold: (id: number, data: { name?: string; school_zone?: string }) =>
    request<Household>(`/households/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  createInvitation: (householdId: number) =>
    request<{ invite_url: string; token: string; expires_at: string }>(
      `/households/${householdId}/invitations`,
      { method: 'POST' },
    ),
  previewInvitation: (token: string) =>
    request<{ household_name: string; invited_by_name: string }>(`/invitations/${token}`),
  acceptInvitation: (token: string) =>
    request<Household>(`/invitations/${token}/accept`, { method: 'POST' }),

  addChild: (householdId: number, data: { first_name: string; birthdate?: string | null }) =>
    request<Child>(`/households/${householdId}/children`, { method: 'POST', body: JSON.stringify(data) }),
  deleteChild: (householdId: number, childId: number) =>
    request<void>(`/households/${householdId}/children/${childId}`, { method: 'DELETE' }),

  setCustodyRule: (householdId: number, data: Omit<CustodyRule, 'custom_weeks'> & { custom_weeks?: string[] | null }) =>
    request<CustodyRule>(`/households/${householdId}/custody-rule`, { method: 'PUT', body: JSON.stringify(data) }),
  setVacationRule: (householdId: number, data: VacationRule) =>
    request<VacationRule>(`/households/${householdId}/vacation-rule`, { method: 'PUT', body: JSON.stringify(data) }),
  setSpecialDayRules: (householdId: number, data: SpecialDayRule[]) =>
    request<SpecialDayRule[]>(`/households/${householdId}/special-day-rules`, { method: 'PUT', body: JSON.stringify(data) }),

  calendar: (householdId: number, start: string, end: string) =>
    request<CalendarResponse>(`/households/${householdId}/calendar?start=${start}&end=${end}`),

  listExceptions: (householdId: number, status?: 'pending' | 'accepted' | 'refused' | 'withdrawn') =>
    request<ScheduleException[]>(
      `/households/${householdId}/exceptions${status ? `?status=${status}` : ''}`,
    ),
  createException: (
    householdId: number,
    data: { date_start: string; date_end: string; parent_id: number; note: string; replaces_id?: number },
  ) => request<ScheduleException>(`/households/${householdId}/exceptions`, { method: 'POST', body: JSON.stringify(data) }),
  acceptExchange: (householdId: number, id: number, response_note = '') =>
    request<ScheduleException>(`/households/${householdId}/exceptions/${id}/accept`, {
      method: 'POST',
      body: JSON.stringify({ response_note }),
    }),
  refuseExchange: (householdId: number, id: number, response_note = '') =>
    request<ScheduleException>(`/households/${householdId}/exceptions/${id}/refuse`, {
      method: 'POST',
      body: JSON.stringify({ response_note }),
    }),
  withdrawExchange: (householdId: number, id: number) =>
    request<ScheduleException>(`/households/${householdId}/exceptions/${id}/withdraw`, { method: 'POST' }),
  deleteException: (householdId: number, id: number) =>
    request<void>(`/households/${householdId}/exceptions/${id}`, { method: 'DELETE' }),

  listExpenses: (householdId: number) =>
    request<Expense[]>(`/households/${householdId}/expenses`),
  createExpense: (
    householdId: number,
    data: {
      label: string; amount_cents: number; date: string; category: string
      child_id?: number | null; paid_by?: number; payer_percent?: number
    },
  ) => request<Expense>(`/households/${householdId}/expenses`, { method: 'POST', body: JSON.stringify(data) }),
  updateExpense: (householdId: number, id: number, data: Partial<Omit<Expense, 'id' | 'status' | 'dispute_note' | 'created_by'>>) =>
    request<Expense>(`/households/${householdId}/expenses/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteExpense: (householdId: number, id: number) =>
    request<void>(`/households/${householdId}/expenses/${id}`, { method: 'DELETE' }),
  disputeExpense: (householdId: number, id: number, dispute_note = '') =>
    request<Expense>(`/households/${householdId}/expenses/${id}/dispute`, { method: 'POST', body: JSON.stringify({ dispute_note }) }),
  resolveExpense: (householdId: number, id: number) =>
    request<Expense>(`/households/${householdId}/expenses/${id}/resolve`, { method: 'POST' }),
  balance: (householdId: number) => request<Balance>(`/households/${householdId}/balance`),
  listSettlements: (householdId: number) =>
    request<Settlement[]>(`/households/${householdId}/settlements`),
  createSettlement: (
    householdId: number,
    data: { from_user: number; to_user: number; amount_cents: number; date: string; note?: string },
  ) => request<Settlement>(`/households/${householdId}/settlements`, { method: 'POST', body: JSON.stringify(data) }),
  deleteSettlement: (householdId: number, id: number) =>
    request<void>(`/households/${householdId}/settlements/${id}`, { method: 'DELETE' }),

  notifications: () => request<Notification[]>('/notifications'),
  markRead: (ids: number[]) => request<{ updated: number }>('/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) }),
  regenerateIcal: () => request<{ ical_token: string }>('/ical/regenerate', { method: 'POST' }),
}
