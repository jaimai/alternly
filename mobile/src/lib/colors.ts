// Couleurs de parent proposées (identiques à frontend/src/colors.ts). Nom lu par les
// lecteurs d'écran : clé common.colors.<name>, traduite à l'affichage (colorLabel).
import { t } from './i18n'

export const PARENT_COLORS: { value: string; name: string }[] = [
  { value: '#2f6b57', name: 'pine' },
  { value: '#c96f4a', name: 'terracotta' },
  { value: '#4a6fa5', name: 'slate' },
  { value: '#c9a227', name: 'mustard' },
  { value: '#8a5a9e', name: 'plum' },
  { value: '#5b8f8a', name: 'lagoon' },
]

export function colorLabel(c: { name: string }): string {
  return t(`common.colors.${c.name}`)
}

export const DEFAULT_PARENT_COLOR = PARENT_COLORS[0].value

/** Site web (pages légales, fonctions pas encore disponibles dans l'app). */
export const WEB_URL = 'https://alternly.com'
