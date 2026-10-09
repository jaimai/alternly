import { useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError, api, loadToken, saveToken, setUnauthorizedHandler } from './api'
import { forgetPurchaser } from './purchases'
import { unregisterPush } from './push'
import { forgetGoogleAccount } from './socialAuth'
import type { TokenResponse, User } from './types'

type Status = 'loading' | 'signedOut' | 'signedIn'

interface AuthState {
  status: Status
  user: User | null
  signIn: (resp: TokenResponse) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUser] = useState<User | null>(null)

  const signOut = useCallback(async () => {
    // Avant d'oublier le jeton : ce téléphone ne doit plus recevoir les push du compte.
    await unregisterPush().catch(() => {})
    await forgetGoogleAccount().catch(() => {})
    await forgetPurchaser()
    await saveToken(null)
    queryClient.clear()
    setUser(null)
    setStatus('signedOut')
  }, [queryClient])

  const signIn = useCallback(async (resp: TokenResponse) => {
    await saveToken(resp.access_token)
    setUser(resp.user)
    // Profil en cache (keys.me de queries.ts) à jour aussi : useMe ne reprend la valeur de
    // connexion que si le cache est vide (ex. has_password après un premier mot de passe).
    queryClient.setQueryData(['me'], resp.user)
    setStatus('signedIn')
  }, [queryClient])

  useEffect(() => {
    setUnauthorizedHandler(() => void signOut())
    return () => setUnauthorizedHandler(null)
  }, [signOut])

  // Au lancement : jeton du trousseau → profil. Hors ligne, on reste connecté
  // (le jeton est encore valable côté serveur) et les écrans réessaieront.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const stored = await loadToken()
      if (!stored) {
        if (!cancelled) setStatus('signedOut')
        return
      }
      try {
        const me = await api.me()
        if (!cancelled) {
          setUser(me)
          setStatus('signedIn')
        }
      } catch (e) {
        if (cancelled) return
        if (e instanceof ApiError && e.status === 401) await signOut()
        else setStatus('signedIn')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [signOut])

  const value = useMemo(() => ({ status, user, signIn, signOut }), [status, user, signIn, signOut])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth doit être utilisé dans <AuthProvider>')
  return ctx
}
