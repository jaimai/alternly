// « Continuer avec Google » et « Se connecter avec Apple » : le téléphone obtient un jeton
// d'identité du fournisseur, le backend le vérifie (POST /auth/google, /auth/apple) et
// renvoie notre propre jeton, comme une connexion e-mail. Même compte que sur le web.
import * as AppleAuthentication from 'expo-apple-authentication'
import Constants, { ExecutionEnvironment } from 'expo-constants'
import * as Linking from 'expo-linking'
import * as WebBrowser from 'expo-web-browser'
import { Platform } from 'react-native'
import { API_BASE, api } from './api'
import type { TokenResponse } from './types'

// ID client OAuth « Application Web » (le même que le web) : audience du jeton sur Android.
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
// ID client OAuth « iOS » (son schéma inversé est déclaré par app.config.ts).
const GOOGLE_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
// Services ID Apple (connexion par la page web d'Apple, hors iPhone) ; = APPLE_SERVICES_ID du backend.
const APPLE_SERVICES_ID = process.env.EXPO_PUBLIC_APPLE_SERVICES_ID

/** L'utilisateur a fermé la fenêtre du fournisseur : rien à afficher. */
export class SignInCancelled extends Error {}

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient

/** Google possible ici ? Le module natif n'existe pas dans Expo Go : build de développement requis. */
export function googleAvailable(): boolean {
  if (Platform.OS === 'web' || isExpoGo) return false
  return !!GOOGLE_WEB_CLIENT_ID && (Platform.OS !== 'ios' || !!GOOGLE_IOS_CLIENT_ID)
}

/** Apple en natif : iPhone. Ailleurs (Android), la page web d'Apple prend le relais. */
export async function appleNative(): Promise<boolean> {
  return Platform.OS === 'ios' && AppleAuthentication.isAvailableAsync()
}

// Import à la demande : charger ce module dans Expo Go ferait planter l'app (module natif absent).
async function googleModule() {
  const mod = await import('@react-native-google-signin/google-signin')
  mod.GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID, iosClientId: GOOGLE_IOS_CLIENT_ID })
  return mod
}

export async function signInWithGoogle(): Promise<TokenResponse> {
  if (!googleAvailable()) {
    throw new Error(
      isExpoGo
        ? 'La connexion Google fonctionne dans l’app installée, pas dans Expo Go.'
        : 'La connexion Google n’est pas encore configurée.',
    )
  }
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
  return (await appleNative()) ? signInWithAppleNative() : signInWithAppleWeb()
}

async function signInWithAppleNative(): Promise<TokenResponse> {
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

/**
 * Android : page web d'Apple dans un onglet du navigateur. Apple poste le jeton au backend
 * (/auth/apple/callback), qui le renvoie à l'app ; l'app le fait vérifier comme sur iPhone.
 */
async function signInWithAppleWeb(): Promise<TokenResponse> {
  if (!APPLE_SERVICES_ID) throw new Error('La connexion Apple n’est pas encore configurée sur ce téléphone.')
  const returnUrl = Linking.createURL('apple-callback')
  const nonce = randomHex(16)
  const query = {
    client_id: APPLE_SERVICES_ID,
    redirect_uri: `${API_BASE}/auth/apple/callback`,
    response_type: 'code id_token',
    response_mode: 'form_post',
    scope: 'name email',
    state: `${nonce}.${encodeURIComponent(returnUrl)}`,
  }
  const url = `https://appleid.apple.com/auth/authorize?${Object.entries(query)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&')}`

  const result = await WebBrowser.openAuthSessionAsync(url, returnUrl)
  if (result.type !== 'success') throw new SignInCancelled()
  const params = Linking.parse(result.url).queryParams ?? {}
  const param = (k: string) => (typeof params[k] === 'string' ? (params[k] as string) : undefined)
  if (param('state') !== nonce) throw new Error('Réponse d’Apple inattendue. Réessayez.')
  if (param('error') === 'user_cancelled_authorize') throw new SignInCancelled()
  const idToken = param('id_token')
  if (!idToken) throw new Error('Apple n’a pas confirmé votre identité. Réessayez.')
  return api.appleLogin(idToken, param('given_name'))
}

function randomHex(bytes: number): string {
  return Array.from({ length: bytes }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('')
}

/** À la déconnexion : la prochaine connexion Google redemandera quel compte utiliser. */
export async function forgetGoogleAccount(): Promise<void> {
  if (!googleAvailable()) return
  const { GoogleSignin } = await googleModule()
  await GoogleSignin.signOut()
}
