import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import fr from './locales/fr.json'
import type { Locale } from './types'

export const SUPPORTED_LOCALES: Locale[] = ['fr', 'en']

function detectInitial(): Locale {
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

export default i18n
