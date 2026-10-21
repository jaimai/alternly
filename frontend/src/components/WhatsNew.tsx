import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Icon from './Icon'
import Modal from './Modal'

/** Annonce « Outils du calendrier » (pinceau, répéter, été) : sert aussi au badge « Nouveau » d'Ajuster. */
export const TOOLS_ID = '2026-10-calendar-tools'
export const TOOLS_SINCE = '2026-10-19'
/** Identifiant de la dernière fenêtre « Quoi de neuf » : la changer la remontre à tous. */
export const WHATS_NEW_ID = '2026-10-goto-date'
/** Les comptes créés après la mise à jour découvrent ces outils d'eux-mêmes. */
export const WHATS_NEW_SINCE = '2026-10-22'

export type SlideKey = 'brush' | 'repeat' | 'summer' | 'jump'
// Mini-calendrier de chaque diapositive : a = un parent, b = l'autre, ring = jour touché.
const ART: Record<Exclude<SlideKey, 'jump'>, { cells: string; ring: number[] }> = {
  brush: { cells: 'aaaaaaaaabbbbb', ring: [7, 8] },
  repeat: { cells: 'aabaaaabbabbbb', ring: [2, 9] },
  summer: { cells: 'aaaaaaabbbbbbb', ring: [] },
}
export const ALL_SLIDES: SlideKey[] = ['brush', 'repeat', 'summer', 'jump']

/** Diapositives à montrer : l'annonce « Aller à », précédée des outils si ce compte ne les a jamais vus. */
export function slidesFor(user: { whats_new_seen?: string | null; created_at?: string | null }): SlideKey[] {
  const sawTools = user.whats_new_seen === TOOLS_ID || (user.created_at ?? '') >= TOOLS_SINCE
  return sawTools ? ['jump'] : ALL_SLIDES
}

interface Props {
  slides?: SlideKey[]
  onClose: () => void
  /** « Essayer maintenant » : ouvre l'outil présenté. */
  onTry?: () => void
}

/** Fenêtre « Quoi de neuf » : trois diapositives courtes sur la dernière mise à jour. */
export default function WhatsNew({ slides = ALL_SLIDES, onClose, onTry }: Props) {
  const { t } = useTranslation()
  const [i, setI] = useState(0)
  const key = slides[i]
  const last = i === slides.length - 1
  const eyebrow = slides.length > 1 ? t('whatsNew.eyebrow', { n: i + 1, total: slides.length }) : t('whatsNew.badge')

  return (
    <Modal eyebrow={eyebrow} title={t(`whatsNew.${key}Title`)} onClose={onClose}>
      {key === 'jump' ? <JumpArt /> : (
        <div className={`wn-art wn-${key}`} aria-hidden="true">
          {ART[key].cells.split('').map((c, k) => (
            <span key={k} className={`wn-cell ${c}${ART[key].ring.includes(k) ? ' ring' : ''}`} />
          ))}
        </div>
      )}
      <p className="wn-body">{t(`whatsNew.${key}Body`)}</p>
      {slides.length > 1 && (
        <div className="wn-dots" aria-hidden="true">
          {slides.map((s, k) => (
            <span key={s} className={k === i ? 'on' : ''} />
          ))}
        </div>
      )}
      <div className="wn-actions">
        <button type="button" className="secondary" onClick={onClose}>
          {t('whatsNew.later')}
        </button>
        <button
          type="button"
          onClick={() => {
            if (!last) setI(i + 1)
            else if (onTry) onTry()
            else onClose()
          }}
        >
          {last ? (onTry ? t('whatsNew.try') : t('whatsNew.done')) : t('whatsNew.next')}
        </button>
      </div>
    </Modal>
  )
}

/** Illustration « Aller à » : le titre-bouton et la grille des mois, juillet choisi. */
function JumpArt() {
  const { i18n } = useTranslation()
  const locale = i18n.language.startsWith('fr') ? 'fr-FR' : 'en-US'
  const year = new Date().getFullYear() + 1
  const month = (m: number) => new Date(year, m, 1).toLocaleDateString(locale, { month: 'short' }).replace('.', '')
  const title = new Date(year, 6, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  return (
    <div className="wn-art wn-jump" aria-hidden="true">
      <span className="wn-jump-pill">
        <Icon name="calendar" size={15} /> {title} ▾
      </span>
      <span className="wn-jump-grid">
        {Array.from({ length: 12 }, (_, m) => (
          <span key={m} className={m === 6 ? 'on' : ''}>{month(m)}</span>
        ))}
      </span>
    </div>
  )
}
