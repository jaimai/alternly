// « Aller à… » : sélecteur mois / année ouvert depuis le titre du calendrier,
// pour sauter plusieurs mois (ou d'une année à l'autre) sans enchaîner les flèches.
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isoLocal, parseIso } from '../dates'

interface Props {
  /** Mois affiché (n'importe quel jour du mois). */
  shown: Date
  onPick: (date: Date) => void
  onClose: () => void
}

export default function MonthJump({ shown, onPick, onClose }: Props) {
  const { t, i18n } = useTranslation()
  const [year, setYear] = useState(shown.getFullYear())
  const box = useRef<HTMLDivElement>(null)
  const today = new Date()
  const locale = i18n.language.startsWith('fr') ? 'fr-FR' : 'en-US'
  const months = Array.from({ length: 12 }, (_, m) =>
    new Date(2000, m, 1).toLocaleDateString(locale, { month: 'short' }).replace('.', ''),
  )

  // Fermeture : Échap ou clic en dehors.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement
      if (box.current?.contains(target) || target.closest('.fc-jump-button')) return
      onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [onClose])

  return (
    <div className="month-jump" ref={box} role="dialog" aria-label={t('calendar.jumpTitle')}>
      <div className="month-jump-year">
        <button type="button" className="month-jump-arrow" onClick={() => setYear(year - 1)} aria-label={t('calendar.jumpPrevYear')}>‹</button>
        <strong>{year}</strong>
        <button type="button" className="month-jump-arrow" onClick={() => setYear(year + 1)} aria-label={t('calendar.jumpNextYear')}>›</button>
      </div>
      <div className="month-jump-grid">
        {months.map((label, m) => {
          const isShown = year === shown.getFullYear() && m === shown.getMonth()
          const isToday = year === today.getFullYear() && m === today.getMonth()
          return (
            <button
              key={m}
              type="button"
              className={`month-jump-cell${isShown ? ' is-shown' : ''}${isToday ? ' is-today' : ''}`}
              aria-current={isShown ? 'date' : undefined}
              onClick={() => onPick(new Date(year, m, 1))}
            >
              {label}
            </button>
          )
        })}
      </div>
      <div className="month-jump-foot">
        <button type="button" className="secondary" onClick={() => onPick(today)}>{t('calendar.jumpToday')}</button>
        <label className="month-jump-date">
          <span>{t('calendar.jumpDate')}</span>
          <input
            type="date"
            defaultValue={isoLocal(shown)}
            onChange={(e) => e.target.value && onPick(parseIso(e.target.value))}
          />
        </label>
      </div>
    </div>
  )
}
