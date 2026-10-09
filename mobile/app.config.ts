// Complète app.json avec ce qui dépend de l'environnement (variables EXPO_PUBLIC_*,
// définies dans .env.local ou dans les variables d'environnement EAS).
import type { ConfigContext, ExpoConfig } from 'expo/config'

const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID

export default ({ config }: ConfigContext): ExpoConfig => {
  const plugins = [...(config.plugins ?? [])]
  if (GOOGLE_IOS_CLIENT_ID) {
    // iOS : Google renvoie vers l'app par le schéma inversé de l'ID client iOS.
    const iosUrlScheme = `com.googleusercontent.apps.${GOOGLE_IOS_CLIENT_ID.replace('.apps.googleusercontent.com', '')}`
    plugins.push(['@react-native-google-signin/google-signin', { iosUrlScheme }])
  }
  return { ...config, name: config.name ?? 'Alternly', slug: config.slug ?? 'alternly', plugins }
}
