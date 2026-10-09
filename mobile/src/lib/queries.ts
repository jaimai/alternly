import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from './api'
import { useAuth } from './auth'
import { todayIso } from './dates'
import type { PushPrefs } from './types'

export const keys = {
  me: ['me'] as const,
  household: ['household'] as const,
  calendar: (hid: number, start: string, end: string) => ['calendar', hid, start, end] as const,
  notifications: ['notifications'] as const,
  pushPrefs: ['pushPrefs'] as const,
  expenses: ['expenses'] as const,
  wall: ['wall'] as const,
}

/** Profil : celui de la connexion d'abord, puis rafraîchi depuis l'API. */
export function useMe() {
  const { user } = useAuth()
  return useQuery({ queryKey: keys.me, queryFn: api.me, initialData: user ?? undefined })
}

/** Foyer de l'utilisateur ; `null` s'il n'en a pas encore (onboarding à faire). */
export function useHousehold() {
  return useQuery({
    queryKey: keys.household,
    queryFn: async () => {
      try {
        return await api.myHousehold()
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null
        throw e
      }
    },
  })
}

export function useCalendar(householdId: number | undefined, start: string, end: string) {
  return useQuery({
    queryKey: keys.calendar(householdId ?? 0, start, end),
    queryFn: () => api.calendar(householdId!, start, end),
    enabled: householdId !== undefined,
    placeholderData: (prev) => prev, // garde le mois affiché pendant le chargement du suivant
  })
}

/** Les six prochains mois : accueil (statut, semaine, à venir) et échanges à valider. */
export function useUpcoming() {
  const household = useHousehold()
  const start = todayIso(-1)
  const end = todayIso(180)
  return { household: household.data ?? undefined, calendar: useCalendar(household.data?.id, start, end) }
}

export function useNotifications() {
  return useQuery({ queryKey: keys.notifications, queryFn: api.notifications, refetchInterval: 60_000 })
}

export function useMarkRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (ids: number[]) => api.markRead(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notifications }),
  })
}

export function useAnswerExchange(householdId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, accept }: { id: number; accept: boolean }) =>
      accept ? api.acceptExchange(householdId!, id) : api.refuseExchange(householdId!, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar'] })
      qc.invalidateQueries({ queryKey: keys.notifications })
    },
  })
}

export function useWithdrawExchange(householdId: number | undefined) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => api.withdrawExchange(householdId!, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar'] }),
  })
}

/** Lien d'invitation de l'autre parent : l'actif s'il existe, sinon un nouveau. */
export function useInviteLink(householdId: number | undefined) {
  return useMutation({
    mutationFn: async () => {
      const current = await api.currentInvitation(householdId!)
      return current.invitation ?? (await api.createInvitation(householdId!))
    },
  })
}

export function usePushPrefs() {
  return useQuery({ queryKey: keys.pushPrefs, queryFn: api.pushPrefs })
}

/** Enregistre les préférences, affichées tout de suite (annulé en cas d'erreur). */
export function useSetPushPrefs() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (prefs: PushPrefs) => api.setPushPrefs(prefs),
    onMutate: async (prefs) => {
      await qc.cancelQueries({ queryKey: keys.pushPrefs })
      const previous = qc.getQueryData<PushPrefs>(keys.pushPrefs)
      qc.setQueryData(keys.pushPrefs, prefs)
      return { previous }
    },
    onError: (_e, _prefs, ctx) => qc.setQueryData(keys.pushPrefs, ctx?.previous),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.pushPrefs }),
  })
}

/** Dépenses, remboursements et solde du foyer. `locked` : pas d'abonnement Premium (402). */
export function useExpenses(householdId: number | undefined) {
  const enabled = householdId !== undefined
  const hid = householdId ?? 0
  const expenses = useQuery({ queryKey: [...keys.expenses, hid, 'list'], queryFn: () => api.expenses(hid), enabled })
  const settlements = useQuery({ queryKey: [...keys.expenses, hid, 'settlements'], queryFn: () => api.settlements(hid), enabled })
  const balance = useQuery({ queryKey: [...keys.expenses, hid, 'balance'], queryFn: () => api.balance(hid), enabled })
  const locked = [expenses, settlements, balance].some((q) => q.error instanceof ApiError && q.error.status === 402)
  return { expenses, settlements, balance, locked }
}

/** Mutation qui rafraîchit ensuite les requêtes sous `queryKey`. */
function useRefreshingMutation<V, R>(queryKey: readonly unknown[], fn: (v: V) => Promise<R>, onSuccess?: (r: R) => void) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey })
      onSuccess?.(r)
    },
  })
}

/** Action sur une dépense ou un remboursement, puis rafraîchit liste et solde. */
export function useExpenseAction<V = void, R = unknown>(fn: (v: V) => Promise<R>, onSuccess?: (r: R) => void) {
  return useRefreshingMutation(keys.expenses, fn, onSuccess)
}

/** Posts du tableau, avec leurs réponses. `locked` : pas d'abonnement Premium (402). */
export function useWall(householdId: number | undefined) {
  const hid = householdId ?? 0
  const wall = useQuery({ queryKey: [...keys.wall, hid], queryFn: () => api.wall(hid), enabled: householdId !== undefined })
  const locked = wall.error instanceof ApiError && wall.error.status === 402
  return { wall, locked }
}

/** Action sur un post ou une réponse, puis rafraîchit le tableau. */
export function useWallAction<V = void, R = unknown>(fn: (v: V) => Promise<R>, onSuccess?: (r: R) => void) {
  return useRefreshingMutation(keys.wall, fn, onSuccess)
}
