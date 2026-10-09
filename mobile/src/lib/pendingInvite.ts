// Invitation ouverte avant d'avoir un compte : gardée jusqu'à la connexion, pour rejoindre
// le foyer au lieu de lancer l'onboarding (qui créerait un second foyer).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as SecureStore from 'expo-secure-store'
import { useCallback } from 'react'
import { Platform } from 'react-native'

const KEY = 'alternly_pending_invite'
const QUERY_KEY = ['pendingInvite'] as const

let current: string | null = null

const storage = Platform.OS === 'web'
  ? {
      get: async () => globalThis.localStorage?.getItem(KEY) ?? null,
      set: async (v: string) => globalThis.localStorage?.setItem(KEY, v),
      remove: async () => globalThis.localStorage?.removeItem(KEY),
    }
  : {
      get: () => SecureStore.getItemAsync(KEY),
      set: (v: string) => SecureStore.setItemAsync(KEY, v),
      remove: () => SecureStore.deleteItemAsync(KEY),
    }

/** Inscription en cours depuis une invitation ? (analytics, pas d'e-mail de bienvenue) */
export function hasPendingInvite(): boolean {
  return current !== null
}

async function load(): Promise<string | null> {
  current = await storage.get()
  return current
}

export function usePendingInvite() {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: load, staleTime: Infinity })
  const set = useCallback(
    async (token: string | null) => {
      current = token
      if (token) await storage.set(token)
      else await storage.remove()
      qc.setQueryData(QUERY_KEY, token)
    },
    [qc],
  )
  return { token: query.data ?? null, loaded: !query.isPending, set }
}
