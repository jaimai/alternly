import type {
  CalendarResponse,
  Child,
  CustodyRule,
  Household,
  Notification,
  ScheduleException,
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
    window.location.href = '/login'
    throw new ApiError(401, 'Session expirée')
  }
  if (!resp.ok) {
    let detail = resp.statusText
    try {
      const body = await resp.json()
      if (typeof body.detail === 'string') detail = body.detail
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
  updateMe: (data: { display_name?: string; color?: string }) =>
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

  listExceptions: (householdId: number) =>
    request<ScheduleException[]>(`/households/${householdId}/exceptions`),
  createException: (
    householdId: number,
    data: { date_start: string; date_end: string; parent_id: number; note: string },
  ) => request<ScheduleException>(`/households/${householdId}/exceptions`, { method: 'POST', body: JSON.stringify(data) }),
  deleteException: (householdId: number, id: number) =>
    request<void>(`/households/${householdId}/exceptions/${id}`, { method: 'DELETE' }),

  notifications: () => request<Notification[]>('/notifications'),
  markRead: (ids: number[]) => request<{ updated: number }>('/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) }),
  regenerateIcal: () => request<{ ical_token: string }>('/ical/regenerate', { method: 'POST' }),
}
