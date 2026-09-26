import type { Member } from './types'

/** Membres réels du foyer (hors second parent « placeholder » non encore inscrit). */
export function realMembers(members: Member[]): Member[] {
  return members.filter((m) => !m.is_placeholder)
}

/** Vrai s'il n'y a pas encore de second parent réel (foyer solo). */
export function isSolo(members: Member[]): boolean {
  return realMembers(members).length < 2
}
