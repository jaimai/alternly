import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { RequireAuth } from './auth'
const CalendarPage = lazy(() => import('./pages/Calendar'))
const ExpensesPage = lazy(() => import('./pages/Expenses'))
const JoinPage = lazy(() => import('./pages/Join'))
const LoginPage = lazy(() => import('./pages/Login'))
const NotFoundPage = lazy(() => import('./pages/NotFound'))
const OnboardingPage = lazy(() => import('./pages/Onboarding'))
const RegisterPage = lazy(() => import('./pages/Register'))
const SettingsPage = lazy(() => import('./pages/Settings'))
const WallPage = lazy(() => import('./pages/Wall'))

export default function App() {
  return (
    <Suspense fallback={<div className="page-loading">Chargement…</div>}>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/join/:token" element={<JoinPage />} />
      <Route
        path="/onboarding"
        element={
          <RequireAuth>
            <OnboardingPage />
          </RequireAuth>
        }
      />
      <Route
        path="/settings"
        element={
          <RequireAuth>
            <SettingsPage />
          </RequireAuth>
        }
      />
      <Route
        path="/expenses"
        element={
          <RequireAuth>
            <ExpensesPage />
          </RequireAuth>
        }
      />
      <Route
        path="/wall"
        element={
          <RequireAuth>
            <WallPage />
          </RequireAuth>
        }
      />
      <Route
        path="/"
        element={
          <RequireAuth>
            <CalendarPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    <Analytics />
    </Suspense>
  )
}
