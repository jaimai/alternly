// « Continuer avec Google » et « Se connecter avec Apple » : le téléphone obtient un jeton
// d'identité du fournisseur, le backend le vérifie (POST /auth/google, /auth/apple) et
// renvoie notre propre jeton, comme une connexion e-mail. Même compte que sur le web.
import * as AppleAuthentication from 'expo-apple-authentication'
import Constants, { ExecutionEnvironment } from 'expo-constants'
import { Platform } from 'react-native'
import { api } from './api'
import type { TokenResponse } from './types'

// ID client OAuth « Application Web » (le même que le web) : audience du jeton sur Android.
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
// ID client OAuth « iOS » (son schéma inversé est déclaré par app.config.ts).
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID

/** L'utilisateur a fermé la fenêtre du fournisseur : rien à afficher. */
export class SignInCancelled extends Error {}

/** Google possible ici ? Le module natif n'existe pas dans Expo Go : build de développement requis. */
export function googleAvailable(): boolean {
  if (Platform.OS === 'web' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return false
  return !!GOOGLE_WEB_CLIENT_ID && (Platform.OS !== 'ios' || !!GOOGLE_IOS_CLIENT_ID)
}

/** Apple : iPhone uniquement (Apple ne l'impose pas sur Android, où Google suffit). */
export async function appleAvailable(): Promise<boolean> {
  return Platform.OS === 'ios' && AppleAuthentication.isAvailableAsync()
}

// Import à la demande : charger ce module dans Expo Go ferait planter l'app (module natif absent).
async function googleModule() {
  const mod = await import('@react-native-google-signin/google-signin')
  mod.GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID, iosClientId: GOOGLE_IOS_CLIENT_ID })
  return mod
}

export async function signInWithGoogle(): Promise<TokenResponse> {
  const { GoogleSignin, isErrorWithCode, statusCodes } = await googleModule()
  let idToken: string | null
  try {
    if (Platform.OS === 'android') await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true })
    const result = await GoogleSignin.signIn()
    if (result.type === 'cancelled') throw new SignInCancelled()
    idToken = result.data.idToken
  } catch (e) {
    if (isErrorWithCode(e)) {
      if (e.code === statusCodes.SIGN_IN_CANCELLED || e.code === statusCodes.IN_PROGRESS) throw new SignInCancelled()
      if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new Error('Les services Google Play ne sont pas disponibles sur ce téléphone.')
      }
    }
    throw e
  }
  if (!idToken) throw new Error('Google n’a pas confirmé votre identité. Réessayez.')
  return api.googleLogin(idToken)
}

export async function signInWithApple(): Promise<TokenResponse> {
  let credential: AppleAuthentication.AppleAuthenticationCredential
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    })
  } catch (e) {
    if ((e as { code?: string })?.code === 'ERR_REQUEST_CANCELED') throw new SignInCancelled()
    throw e
  }
  if (!credential.identityToken) throw new Error('Apple n’a pas confirmé votre identité. Réessayez.')
  // Le prénom n'est transmis qu'à la toute première autorisation.
  return api.appleLogin(credential.identityToken, credential.fullName?.givenName ?? undefined)
}

/** À la déconnexion : la prochaine connexion Google redemandera quel compte utiliser. */
export async function forgetGoogleAccount(): Promise<void> {
  if (!googleAvailable()) return
  const { GoogleSignin } = await googleModule()
  await GoogleSignin.signOut()
}
