// Cible web (développement) : pas de notifications push, on n'importe pas expo-notifications.
export type PushStatus = 'unavailable' | 'undetermined' | 'denied' | 'granted'

export const pushAvailable = (): boolean => false
export const pushStatus = async (): Promise<PushStatus> => 'unavailable'
export const enablePush = async (): Promise<PushStatus> => 'unavailable'
export const syncPushRegistration = async (): Promise<void> => {}
export const unregisterPush = async (): Promise<void> => {}
