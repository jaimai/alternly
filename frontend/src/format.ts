import { useTranslation } from 'react-i18next'

const LOCALE_TAG: Record<string, string> = { fr: 'fr-FR', en: 'en-US' }

function tag(lng: string): string {
  return LOCALE_TAG[lng.slice(0, 2)] ?? 'fr-FR'
}

/** Formatage monétaire et de dates dépendant de la langue active.
 *  Phase 1 : devise EUR (la devise par foyer arrive en Phase 2 « pays »). */
export function useFormat() {
  const { i18n } = useTranslation()
  const locale = tag(i18n.language)
  return {
    money(cents: number, currency = 'EUR'): string {
      return (cents / 100).toLocaleString(locale, { style: 'currency', currency })
    },
    /** Date ISO (yyyy-mm-dd) → format court localisé. */
    date(iso: string): string {
      const d = new Date(`${iso}T00:00:00`)
      if (Number.isNaN(d.getTime())) return iso
      return d.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
    },
  }
}
