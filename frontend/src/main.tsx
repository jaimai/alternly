import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { captureException } from './analytics'
import { AuthProvider } from './auth'
import ErrorBoundary from './components/ErrorBoundary'
import './i18n'
// Polices auto-hébergées : aucun appel à Google Fonts (RGPD, CSP font-src 'self').
import '@fontsource-variable/fraunces/opsz.css'
import '@fontsource-variable/fraunces/opsz-italic.css'
import '@fontsource/instrument-sans/400.css'
import '@fontsource/instrument-sans/500.css'
import '@fontsource/instrument-sans/600.css'
import './index.css'

// Suivi d'erreurs : actif seulement si VITE_SENTRY_DSN est défini au build
// (chargé à la demande, absent du bundle initial sinon).
const sentryDsn = import.meta.env.VITE_SENTRY_DSN
if (sentryDsn) {
  import('@sentry/react').then((Sentry) =>
    Sentry.init({
      dsn: sentryDsn,
      environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || 'production',
    }),
  )
}

// Erreurs React non rattrapées par l'ErrorBoundary (ex. récupérées en cours de
// rendu) : remontées au suivi d'erreurs PostHog avec la pile de composants.
createRoot(document.getElementById('root')!, {
  onUncaughtError: (error, info) =>
    captureException(error, { source: 'react_uncaught', component_stack: info.componentStack?.slice(0, 2000) }),
  onRecoverableError: (error, info) =>
    captureException(error, { source: 'react_recoverable', component_stack: info.componentStack?.slice(0, 2000) }),
}).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
