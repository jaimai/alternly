// Suivi des plantages (Sentry), comme le web. Désactivé sans DSN (développement local,
// Expo Go) ; aucune donnée personnelle : seulement l'id du compte, jamais l'e-mail.
import * as Sentry from '@sentry/react-native'

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: __DEV__ ? 'development' : 'production',
    sendDefaultPii: false,
    tracesSampleRate: 0,
  })
}

export function setErrorUser(userId: number | null): void {
  if (DSN) Sentry.setUser(userId === null ? null : { id: String(userId) })
}

export function reportError(error: unknown): void {
  if (DSN) Sentry.captureException(error)
}

/** Enveloppe le composant racine (navigation, plantages natifs) ; neutre sans DSN. */
export const wrapRoot = <P extends Record<string, unknown>>(component: React.ComponentType<P>) =>
  DSN ? Sentry.wrap(component) : component
