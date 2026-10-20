// Réglages repris de l'outil « vacances » du site (zone, règle de vacances) pour
// pré-remplir l'onboarding : le parent qui vient de faire son calcul n'a pas à
// refaire ses choix. Conservés le temps de l'inscription (localStorage).
import type { VacationMode } from './types'

const KEY = 'tool_prefill'
const VAC_MODES: readonly VacationMode[] = ['split_half', 'alternate_full', 'july_august', 'weekly']

export interface ToolPrefill {
  zone?: 'A' | 'B' | 'C'
  vacMode?: VacationMode
}

export function saveToolPrefill(params: URLSearchParams): ToolPrefill | null {
  const zone = params.get('zone')
  const vacMode = params.get('vac_mode')
  const value: ToolPrefill = {}
  if (zone === 'A' || zone === 'B' || zone === 'C') value.zone = zone
  if (vacMode && (VAC_MODES as readonly string[]).includes(vacMode)) value.vacMode = vacMode as VacationMode
  if (!value.zone && !value.vacMode) return null
  try {
    localStorage.setItem(KEY, JSON.stringify(value))
  } catch {
    // stockage indisponible : simple absence de pré-remplissage
  }
  return value
}

export function readToolPrefill(): ToolPrefill {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as ToolPrefill) : {}
  } catch {
    return {}
  }
}

export function clearToolPrefill() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // rien à nettoyer
  }
}
