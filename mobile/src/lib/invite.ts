// Message d'invitation de l'autre parent (mêmes textes que invite.message / invite.messageNoChildren du web).
import { kidsLabel } from './custody'

export function inviteMessage(childNames: string[], link: string): string {
  if (childNames.length === 0) {
    return `Bonjour, j'ai mis en place notre calendrier de garde sur Alternly : les semaines, les vacances et les échanges sont au même endroit, visibles par nous deux. C'est gratuit. Tu peux le rejoindre ici : ${link}`
  }
  return `Bonjour, j'ai mis en place notre calendrier de garde pour ${kidsLabel(childNames)} sur Alternly : les semaines, les vacances et les échanges sont au même endroit, visibles par nous deux. C'est gratuit. Tu peux le rejoindre ici : ${link}`
}
