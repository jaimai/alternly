import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Analytics } from '@vercel/analytics/react'
import { RedirectIfAuthed, RequireAuth } from './auth'
import { getToken } from './api'
import AnalyticsBridge from './components/AnalyticsBridge'
import ConsentBanner from './components/ConsentBanner'
import PremiumGate from './components/PremiumGate'
import Spinner from './components/Spinner'

// Routes chargées à la demande : le bundle initial ne contient plus FullCalendar,
// les pages premium ni les réglages.
const loadCalendarPage = () => import('./pages/Calendar')
const CalendarPage = lazy(loadCalendarPage)
// Parent déjà connecté qui ouvre l'app : le code du calendrier se charge pendant
// la vérification de la session plutôt qu'après.
if (getToken() && window.location.pathname.startsWith('/app')) void loadCalendarPage()
const ExpensesPage = lazy(() => import('./pages/Expenses'))
const FeedbackPage = lazy(() => import('./pages/Feedback'))
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPassword'))
const HistoryPage = lazy(() => import('./pages/History'))
const JoinPage = lazy(() => import('./pages/Join'))
const LoginPage = lazy(() => import('./pages/Login'))
const NotFoundPage = lazy(() => import('./pages/NotFound'))
const OnboardingPage = lazy(() => import('./pages/Onboarding'))
const RegisterPage = lazy(() => import('./pages/Register'))
const ResetPasswordPage = lazy(() => import('./pages/ResetPassword'))
const SettingsPage = lazy(() => import('./pages/Settings'))
const WallPage = lazy(() => import('./pages/Wall'))

export default function App() {
  const { t } = useTranslation()
  return (
    <>
    <Suspense fallback={<Spinner />}>
    <Routes>
      <Route path="/login" element={<RedirectIfAuthed><LoginPage /></RedirectIfAuthed>} />
      <Route path="/register" element={<RedirectIfAuthed><RegisterPage /></RedirectIfAuthed>} />
      <Route path="/join/:token" element={<JoinPage />} />
      <Route path="/feedback" element={<FeedbackPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
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
        path="/history"
        element={
          <RequireAuth>
            <HistoryPage />
          </RequireAuth>
        }
      />
      <Route
        path="/expenses"
        element={
          <RequireAuth>
            <PremiumGate feature={t('paywall.featureExpenses')} featureKey="expenses">
              <ExpensesPage />
            </PremiumGate>
          </RequireAuth>
        }
      />
      <Route
        path="/wall"
        element={
          <RequireAuth>
            <PremiumGate feature={t('paywall.featureWall')} featureKey="wall">
              <WallPage />
            </PremiumGate>
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
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    </Suspense>
    <Analytics />
    <AnalyticsBridge />
    <ConsentBanner />
    </>
  )
}
