import { useSyncExternalStore } from 'react'
import { getConsent, subscribeConsent } from '../analytics'

/** Choix de consentement courant (mis à jour en direct). */
export function useConsent() {
  return useSyncExternalStore(subscribeConsent, getConsent, () => null)
}
