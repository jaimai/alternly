import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from './api'
import { useAuth } from './auth'
import { todayIso } from './dates'

export const keys = {
  me: ['me'] as const,
  household: ['household'] as const,
  calendar: (hid: number, start: string, end: string) => ['calendar', hid, start, end] as const,
  notifications: ['notifications'] as const,
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
