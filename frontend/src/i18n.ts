import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import fr from './locales/fr.json'
import type { Locale } from './types'

export const SUPPORTED_LOCALES: Locale[] = ['fr', 'en']
const STORAGE_KEY = 'alternly_locale'

function normalize(v: string | null | undefined): Locale | null {
  return v === 'en' || v === 'fr' ? v : null
}

/** Priorité : ?lang= (venu de la landing) > préférence mémorisée > navigateur > fr.
 *  Ainsi la langue choisie sur la landing suit l'utilisateur jusque dans l'app. */
function detectInitial(): Locale {
  if (typeof window !== 'undefined') {
    const fromQuery = normalize(new URLSearchParams(window.location.search).get('lang'))
    if (fromQuery) {
      localStorage.setItem(STORAGE_KEY, fromQuery)
      return fromQuery
    }
    const stored = normalize(localStorage.getItem(STORAGE_KEY))
    if (stored) return stored
  }
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'fr').slice(0, 2)
  return nav === 'en' ? 'en' : 'fr'
}

i18n.use(initReactI18next).init({
  resources: {
    fr: { translation: fr },
    en: { translation: en },
  },
  lng: detectInitial(),
  fallbackLng: 'fr',
  interpolation: { escapeValue: false }, // React échappe déjà
  returnNull: false,
  // Clés plates et littérales : les libellés FR contiennent souvent « : »,
  // et on assemble les fichiers de traduction par simple fusion à plat.
  keySeparator: false,
  nsSeparator: false,
})

// Mémorise tout changement de langue (sélecteur des réglages, connexion…).
i18n.on('languageChanged', (lng) => {
  const loc = normalize(lng.slice(0, 2))
  if (loc && typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, loc)
})

export default i18n
