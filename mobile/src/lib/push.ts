// Notifications push : permission, jeton Expo envoyé au backend (POST /api/devices),
// affichage au premier plan et ouverture du bon écran au toucher.
// Le backend envoie un push pour chaque notification in-app (backend/app/services/push.py).
import Constants, { ExecutionEnvironment } from 'expo-constants'
import * as Device from 'expo-device'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { api } from './api'

const DEVICE_TOKEN_KEY = 'alternly_push_token'

export type PushStatus = 'unavailable' | 'undetermined' | 'denied' | 'granted'

/** Identifiant du projet EAS (écrit dans app.json par `eas init`), requis pour le jeton Expo. */
function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId
}

/** Push possible ici ? (pas sur le web ni le simulateur, et projet EAS configuré) */
export function pushAvailable(): boolean {
  // Expo Go ne reçoit plus les push distants sur Android : il faut un build de développement.
  const expoGoAndroid = Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient
  return Platform.OS !== 'web' && Device.isDevice && !expoGoAndroid && !!projectId()
}

// Au premier plan : bannière + son, comme en arrière-plan.
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  })
}

export async function pushStatus(): Promise<PushStatus> {
  if (!pushAvailable()) return 'unavailable'
  const { status } = await Notifications.getPermissionsAsync()
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined'
}

/** Inscrit ce téléphone auprès du backend (le jeton peut changer : appelé à chaque lancement). */
async function register(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Alternly',
      importance: Notifications.AndroidImportance.HIGH,
    })
  }
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: projectId() })
  await api.registerDevice({
    token,
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    app_version: Constants.expoConfig?.version,
  })
  await SecureStore.setItemAsync(DEVICE_TOKEN_KEY, token)
}

/** Demande la permission (si besoin) puis inscrit le téléphone. */
export async function enablePush(): Promise<PushStatus> {
  if (!pushAvailable()) return 'unavailable'
  const current = await Notifications.getPermissionsAsync()
  const status = current.status === 'granted' ? 'granted' : (await Notifications.requestPermissionsAsync()).status
  if (status !== 'granted') return status === 'denied' ? 'denied' : 'undetermined'
  await register()
  return 'granted'
}

/** Au lancement (connecté) : réinscrit le téléphone si la permission est déjà accordée. */
export async function syncPushRegistration(): Promise<void> {
  if ((await pushStatus()) === 'granted') await register()
}

/** À la déconnexion : ce téléphone ne doit plus recevoir les push de ce compte. */
export async function unregisterPush(): Promise<void> {
  if (Platform.OS === 'web') return
  const token = await SecureStore.getItemAsync(DEVICE_TOKEN_KEY)
  if (!token) return
  // Oublié d'abord : si la session a expiré, l'appel répond 401, ce qui relance la
  // déconnexion… qui ne doit pas rappeler l'API en boucle.
  await SecureStore.deleteItemAsync(DEVICE_TOKEN_KEY)
  await api.unregisterDevice(token)
}
