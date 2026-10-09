// Complète app.json avec ce qui dépend de l'environnement (variables EXPO_PUBLIC_*,
// définies dans .env.local ou dans les variables d'environnement EAS).
import type { ConfigContext, ExpoConfig } from 'expo/config'

const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
// Envoi des source maps à Sentry pendant le build (avec SENTRY_AUTH_TOKEN, secret EAS).
// Sans ces variables, pas d'étape Sentry : le build ne dépend pas d'un compte Sentry.
const SENTRY_ORG = process.env.SENTRY_ORG
const SENTRY_PROJECT = process.env.SENTRY_PROJECT

export default ({ config }: ConfigContext): ExpoConfig => {
  const plugins = [...(config.plugins ?? [])]
  if (GOOGLE_IOS_CLIENT_ID) {
    // iOS : Google renvoie vers l'app par le schéma inversé de l'ID client iOS.
    const iosUrlScheme = `com.googleusercontent.apps.${GOOGLE_IOS_CLIENT_ID.replace('.apps.googleusercontent.com', '')}`
    plugins.push(['@react-native-google-signin/google-signin', { iosUrlScheme }])
  }
  if (SENTRY_ORG && SENTRY_PROJECT) {
    plugins.push(['@sentry/react-native/expo', { organization: SENTRY_ORG, project: SENTRY_PROJECT, url: 'https://sentry.io/' }])
  }
  return { ...config, name: config.name ?? 'Alternly', slug: config.slug ?? 'alternly', plugins }
}
