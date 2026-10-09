// Client de l'API Alternly — mêmes routes et même jeton JWT que l'app web
// (frontend/src/api.ts). Le jeton vit dans le trousseau (expo-secure-store).
import Constants from 'expo-constants'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import type { CalendarResponse, Household, Notification, TokenResponse, User } from './types'

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

export class ApiError extends Error {
  status: number
  constructor(status: number, detail: string) {
    super(detail)
    this.status = status
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
    throw new ApiError(0, 'Connexion impossible. Vérifiez votre réseau.')
  }
  if (resp.status === 401 && !path.startsWith('/auth/')) {
    onUnauthorized?.()
    throw new ApiError(401, 'Session expirée, reconnectez-vous.')
  }
  if (!resp.ok) {
    let body: unknown = null
    try {
      body = await resp.json()
    } catch {
      /* corps non JSON */
    }
    throw new ApiError(resp.status, errorDetail(body, 'Une erreur est survenue.'))
  }
  if (resp.status === 204) return undefined as T
  return resp.json() as Promise<T>
}

export const api = {
  login: (email: string, password: string) =>
    request<TokenResponse>('/auth/login', { method: 'POST', body: { email, password } }),
  register: (data: { email: string; password: string; display_name: string; color: string }) =>
    request<TokenResponse>('/auth/register', { method: 'POST', body: { ...data, locale: 'fr' } }),
  forgotPassword: (email: string) =>
    request<{ ok: boolean }>('/auth/password/forgot', { method: 'POST', body: { email } }),
  me: () => request<User>('/auth/me'),

  myHousehold: () => request<Household>('/households/mine'),
  calendar: (householdId: number, start: string, end: string) =>
    request<CalendarResponse>(`/households/${householdId}/calendar?start=${start}&end=${end}`),
  acceptExchange: (householdId: number, id: number) =>
    request<unknown>(`/households/${householdId}/exceptions/${id}/accept`, { method: 'POST', body: { response_note: '' } }),
  refuseExchange: (householdId: number, id: number) =>
    request<unknown>(`/households/${householdId}/exceptions/${id}/refuse`, { method: 'POST', body: { response_note: '' } }),

  notifications: () => request<Notification[]>('/notifications'),
  markRead: (ids: number[]) => request<{ updated: number }>('/notifications/read', { method: 'POST', body: { ids } }),
}
