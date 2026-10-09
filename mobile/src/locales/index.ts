// Traductions de l'app, une paire de fichiers par domaine (fr / en). Les clés sont
// imbriquées sous le nom du domaine : t('expenses.balance.settled').
import authEn from './auth.en.json'
import authFr from './auth.fr.json'
import calendarEn from './calendar.en.json'
import calendarFr from './calendar.fr.json'
import commonEn from './common.en.json'
import commonFr from './common.fr.json'
import expensesEn from './expenses.en.json'
import expensesFr from './expenses.fr.json'
import notificationsEn from './notifications.en.json'
import notificationsFr from './notifications.fr.json'
import onboardingEn from './onboarding.en.json'
import onboardingFr from './onboarding.fr.json'
import premiumEn from './premium.en.json'
import premiumFr from './premium.fr.json'
import settingsEn from './settings.en.json'
import settingsFr from './settings.fr.json'
import wallEn from './wall.en.json'
import wallFr from './wall.fr.json'

export const resources = {
  fr: {
    translation: {
      common: commonFr, auth: authFr, onboarding: onboardingFr, calendar: calendarFr, notifications: notificationsFr,
      expenses: expensesFr, wall: wallFr, settings: settingsFr, premium: premiumFr,
    },
  },
  en: {
    translation: {
      common: commonEn, auth: authEn, onboarding: onboardingEn, calendar: calendarEn, notifications: notificationsEn,
      expenses: expensesEn, wall: wallEn, settings: settingsEn, premium: premiumEn,
    },
  },
} as const
