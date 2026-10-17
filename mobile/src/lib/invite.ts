// Message d'invitation de l'autre parent (mêmes textes que invite.message / invite.messageNoChildren du web).
import { kidsLabel } from './custody'
import { t } from './i18n'

export function inviteMessage(childNames: string[], link: string): string {
  if (childNames.length === 0) return t('calendar.invite.messageNoChildren', { link })
  return t('calendar.invite.message', { kids: kidsLabel(childNames), link })
}
