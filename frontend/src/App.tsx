import { Navigate, Route, Routes } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { RequireAuth } from './auth'
import CalendarPage from './pages/Calendar'
import ExpensesPage from './pages/Expenses'
import JoinPage from './pages/Join'
import LoginPage from './pages/Login'
import OnboardingPage from './pages/Onboarding'
import RegisterPage from './pages/Register'
import SettingsPage from './pages/Settings'
import WallPage from './pages/Wall'

export default function App() {
  return (
    <>
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
        path="/app"
        element={
          <RequireAuth>
            <CalendarPage />
          </RequireAuth>
        }
      />
      {/* `/` = landing (servie par le backend, proxifiée par Vercel). En dev ou en
          navigation directe côté SPA, on renvoie vers l'app. */}
      <Route path="/" element={<Navigate to="/app" replace />} />
    </Routes>
    <Analytics />
    </>
  )
}
