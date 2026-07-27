import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { api, ApiError, getToken, setToken } from './api'
import Spinner from './components/Spinner'
import i18n from './i18n'
import type { BillingStatus, Household, User } from './types'

interface AuthState {
  user: User | null
  billing: BillingStatus | null
  household: Household | null
  householdLoaded: boolean
  loading: boolean
  setUser: (u: User | null) => void
  refreshBilling: () => void
  refreshHousehold: () => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState>({
  user: null,
  billing: null,
  household: null,
  householdLoaded: false,
  loading: true,
  setUser: () => {},
  refreshBilling: () => {},
  refreshHousehold: async () => {},
  logout: () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [billing, setBilling] = useState<BillingStatus | null>(null)
  const [household, setHousehold] = useState<Household | null>(null)
  const [householdLoaded, setHouseholdLoaded] = useState(false)
  const [loading, setLoading] = useState(true)

  const refreshBilling = useCallback(() => {
    api.billingStatus().then(setBilling).catch(() => {})
  }, [])

  // Le foyer est chargé une seule fois et partagé : la navigation entre les
  // pages est instantanée (plus de re-fetch à chaque montage).
  const refreshHousehold = useCallback(async () => {
    try {
      setHousehold(await api.myHousehold())
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setHousehold(null)
    } finally {
      setHouseholdLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (!getToken()) {
      setLoading(false)
      return
    }
    api
      .me()
      .then((u) => {
        setUser(u)
        refreshBilling()
        refreshHousehold()
      })
      .catch(() => setToken(null))
      .finally(() => setLoading(false))
  }, [refreshBilling, refreshHousehold])

  // La langue de l'UI suit la préférence du compte.
  useEffect(() => {
    if (user?.locale && i18n.language !== user.locale) i18n.changeLanguage(user.locale)
  }, [user?.locale])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
    setBilling(null)
    setHousehold(null)
    window.location.href = '/login'
  }, [])

  return (
    <AuthContext.Provider
      value={{ user, billing, household, householdLoaded, loading, setUser, refreshBilling, refreshHousehold, logout }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <Spinner />
  if (!user) return <Navigate to="/login" replace />
  // Freemium : l'app (calendrier) est toujours accessible. Les fonctions premium
  // sont protégées séparément par <PremiumGate>.
  return <>{children}</>
}

/** Accès premium (abonnement actif). `billing === null` = pas encore chargé. */
export function usePremium(): boolean {
  const { billing } = useAuth()
  return billing?.access === true
}
