// Suivi des erreurs et des performances (Sentry). Sans EXPO_PUBLIC_SENTRY_DSN, rien n'est envoyé.
import * as Sentry from '@sentry/react-native'

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  enabled: !!process.env.EXPO_PUBLIC_SENTRY_DSN,
  environment: __DEV__ ? 'development' : 'production',
  // Données personnelles : pas d'IP ni d'en-têtes ; l'utilisateur est identifié par son seul id.
  sendDefaultPii: false,
  integrations: [Sentry.mobileReplayIntegration({ maskAllText: true, maskAllImages: true })],
  // Tout en local pour vérifier ; un échantillon en production.
  tracesSampleRate: __DEV__ ? 1.0 : 0.1,
  profilesSampleRate: __DEV__ ? 1.0 : 0.1,
  enableLogs: true,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,
})

export { Sentry }
