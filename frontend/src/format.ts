import { useTranslation } from 'react-i18next'
import { parseIso, parseTimestamp } from './dates'

const LOCALE_TAG: Record<string, string> = { fr: 'fr-FR', en: 'en-US' }

function tag(lng: string): string {
  return LOCALE_TAG[lng.slice(0, 2)] ?? 'fr-FR'
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** Formatage monétaire et de dates dépendant de la langue active.
 *  Les dates « calendaires » (yyyy-mm-dd) sont lues en heure locale (voir dates.ts).
 *  Phase 1 : devise EUR (la devise par foyer arrive en Phase 2 « pays »). */
export function useFormat() {
  const { t, i18n } = useTranslation()
  const locale = tag(i18n.language)

  const valid = (iso: string) => /^\d{4}-\d{2}-\d{2}/.test(iso)

  /** « sam. 26 sept. » / « Sat, Sep 26 » */
  const day = (iso: string): string =>
    valid(iso) ? parseIso(iso).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' }) : iso

  return {
    money(cents: number, currency = 'EUR'): string {
      return (cents / 100).toLocaleString(locale, { style: 'currency', currency })
    },
    /** Date ISO (yyyy-mm-dd) → « 26 sept. 2026 » / « Sep 26, 2026 ». */
    date(iso: string): string {
      if (!valid(iso)) return iso
      return parseIso(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })
    },
    day,
    /** « samedi 26 septembre » / « Saturday, September 26 » */
    dayLong(iso: string): string {
      if (!valid(iso)) return iso
      return parseIso(iso).toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })
    },
    /** « Septembre 2026 » / « September 2026 » */
    monthYear(iso: string): string {
      if (!valid(iso)) return iso
      return capitalize(parseIso(iso).toLocaleDateString(locale, { month: 'long', year: 'numeric' }))
    },
    /** Plage : « sam. 26 sept. » ou « sam. 26 sept. → lun. 28 sept. » */
    range(start: string, end?: string | null): string {
      if (!end || start === end) return day(start)
      return `${day(start)} → ${day(end)}`
    },
    /** Horodatage serveur (UTC) → « 26 sept., 14:05 » */
    timestamp(ts: string): string {
      const d = parseTimestamp(ts)
      if (Number.isNaN(d.getTime())) return ts
      return d.toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    },
    /** 0 → « aujourd'hui », 1 → « demain », n → « dans n jours » */
    relativeDays(n: number): string {
      if (n <= 0) return t('common.relToday')
      if (n === 1) return t('common.relTomorrow')
      return t('common.relInDays', { count: n })
    },
  }
}
