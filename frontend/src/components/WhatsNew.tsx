import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from './Modal'

/** Identifiant de la dernière fenêtre « Quoi de neuf » : la changer la remontre à tous. */
export const WHATS_NEW_ID = '2026-10-calendar-tools'
/** Les comptes créés après la mise à jour découvrent ces outils d'eux-mêmes. */
export const WHATS_NEW_SINCE = '2026-10-19'

// Mini-calendrier de chaque diapositive : a = un parent, b = l'autre, ring = jour touché.
const SLIDES = [
  { key: 'brush', cells: 'aaaaaaaaabbbbb', ring: [7, 8] },
  { key: 'repeat', cells: 'aabaaaabbabbbb', ring: [2, 9] },
  { key: 'summer', cells: 'aaaaaaabbbbbbb', ring: [] as number[] },
]

interface Props {
  onClose: () => void
  /** « Essayer maintenant » : ouvre l'outil présenté. */
  onTry?: () => void
}

/** Fenêtre « Quoi de neuf » : trois diapositives courtes sur la dernière mise à jour. */
export default function WhatsNew({ onClose, onTry }: Props) {
  const { t } = useTranslation()
  const [i, setI] = useState(0)
  const slide = SLIDES[i]
  const last = i === SLIDES.length - 1

  return (
    <Modal eyebrow={t('whatsNew.eyebrow', { n: i + 1, total: SLIDES.length })} title={t(`whatsNew.${slide.key}Title`)} onClose={onClose}>
      <div className={`wn-art wn-${slide.key}`} aria-hidden="true">
        {slide.cells.split('').map((c, k) => (
          <span key={k} className={`wn-cell ${c}${slide.ring.includes(k) ? ' ring' : ''}`} />
        ))}
      </div>
      <p className="wn-body">{t(`whatsNew.${slide.key}Body`)}</p>
      <div className="wn-dots" aria-hidden="true">
        {SLIDES.map((s, k) => (
          <span key={s.key} className={k === i ? 'on' : ''} />
        ))}
      </div>
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
