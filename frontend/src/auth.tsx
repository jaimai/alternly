import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { api, getToken, setToken } from './api'
import Paywall from './components/Paywall'
import type { BillingStatus, User } from './types'

interface AuthState {
  user: User | null
  billing: BillingStatus | null
  loading: boolean
  setUser: (u: User | null) => void
  refreshBilling: () => void
  logout: () => void
}

const AuthContext = createContext<AuthState>({
  user: null,
  billing: null,
  loading: true,
  setUser: () => {},
  refreshBilling: () => {},
  logout: () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [billing, setBilling] = useState<BillingStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const refreshBilling = useCallback(() => {
    api.billingStatus().then(setBilling).catch(() => {})
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
      })
      .catch(() => setToken(null))
      .finally(() => setLoading(false))
  }, [refreshBilling])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
    setBilling(null)
    window.location.href = '/login'
  }, [])

  return (
    <AuthContext.Provider value={{ user, billing, loading, setUser, refreshBilling, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, billing, loading, refreshBilling } = useAuth()
  if (loading) return <div className="page-loading">Chargement…</div>
  if (!user) return <Navigate to="/login" replace />
  // Accès bloqué (essai expiré, non abonné) → paywall.
  if (billing && !billing.access) return <Paywall user={user} onSubscribed={refreshBilling} />
  return <>{children}</>
}
