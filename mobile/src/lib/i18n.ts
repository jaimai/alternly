// Langue de l'app : français ou anglais. Au lancement, celle du téléphone ; une fois
// connecté, celle du compte (qui décide aussi de la langue des push et des e-mails).
// Composants : useTranslation() de react-i18next ; code hors React : t() exporté ici.
import { getLocales } from 'expo-localization'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { resources } from '@/locales'
import type { Locale } from './types'

function deviceLanguage(): Locale {
  // Tests : textes de référence en français.
  if (process.env.NODE_ENV === 'test') return 'fr'
  try {
    return getLocales()[0]?.languageCode === 'en' ? 'en' : 'fr'
  } catch {
    return 'fr'
  }
}

void i18n.use(initReactI18next).init({
  resources,
  lng: deviceLanguage(),
  fallbackLng: 'fr',
  interpolation: { escapeValue: false }, // React échappe déjà
  returnNull: false,
})

export const t = i18n.t.bind(i18n)

export function appLanguage(): Locale {
  return i18n.language === 'en' ? 'en' : 'fr'
}

/** Locale des formats de date et de montant (Intl). */
export function intlLocale(): string {
  return appLanguage() === 'en' ? 'en-US' : 'fr-FR'
}

export function setAppLanguage(lang: Locale): Promise<unknown> {
  return i18n.changeLanguage(lang)
}

export default i18n
