import { useAuth } from './auth'

// Avantages Premium présentés selon la situation du foyer : un parent encore seul
// (l'autre parent n'a pas rejoint) voit d'abord ce qui marche sans lui.
const SHARED = [
  'paywall.perkExpenses',
  'paywall.perkMessageBoard',
  'paywall.perkEmailReminders',
  'paywall.perkCalendarSync',
  'paywall.perkJournal',
  'paywall.perkPension',
]
const SOLO = [
  'paywall.perkJournal',
  'paywall.perkClaim',
  'paywall.perkPension',
  'paywall.perkCalendarSync',
  'paywall.perkEmailReminders',
]

/** Clés i18n des avantages et du sous-titre à afficher sur le paywall. */
export function usePremiumPerks(): { perks: string[]; subtitleKey: string; solo: boolean } {
  const { household } = useAuth()
  const solo = Boolean(household?.members.some((m) => m.is_placeholder))
  return solo
    ? { perks: SOLO, subtitleKey: 'paywall.subtitleSolo', solo }
    : { perks: SHARED, subtitleKey: 'paywall.subtitle', solo }
}
