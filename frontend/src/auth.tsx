import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { api, getToken, setToken } from './api'
import type { User } from './types'

interface AuthState {
  user: User | null
  loading: boolean
  setUser: (u: User | null) => void
  logout: () => void
}

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  setUser: () => {},
  logout: () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getToken()) {
      setLoading(false)
      return
    }
    api
      .me()
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setLoading(false))
  }, [])

  const logout = useCallback(() => {
    setToken(null)
    setUser(null)
    window.location.href = '/login'
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, setUser, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="page-loading">Chargement…</div>
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}
