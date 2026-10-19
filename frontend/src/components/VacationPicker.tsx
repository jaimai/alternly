import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { VacationMode, VacationPeriodKind, VacationPeriodModes } from '../types'

const MODES: VacationMode[] = ['july_august', 'split_half', 'weekly', 'alternate_full']
const NEW_MODES = new Set<VacationMode>(['july_august', 'weekly'])
const MODE_KEY: Record<VacationMode, string> = {
  split_half: 'Half',
  alternate_full: 'Full',
  july_august: 'JulyAugust',
  weekly: 'Weekly',
}
const PERIODS: VacationPeriodKind[] = ['toussaint', 'noel', 'hiver', 'printemps', 'ete']

interface Props {
  mode: VacationMode
  onMode: (mode: VacationMode) => void
  periodModes: VacationPeriodModes
  onPeriodModes: (value: VacationPeriodModes) => void
  /** Couleur du parent qui commence cette année, puis de l'autre. */
  first: string
  second: string
  year: number
}

/**
 * Choix du partage des vacances scolaires : un mode général, et au besoin un
 * réglage période par période (Toussaint, Noël, hiver, printemps, été).
 */
export default function VacationPicker({ mode, onMode, periodModes, onPeriodModes, first, second, year }: Props) {
  const { t } = useTranslation()
  const [showPeriods, setShowPeriods] = useState(Object.keys(periodModes).length > 0)

  const half = (a: string, b: string) => `linear-gradient(90deg, ${a} 0 50%, ${b} 50% 100%)`
  const stripes = (a: string, b: string) => `repeating-linear-gradient(90deg, ${a} 0 12.5%, ${b} 12.5% 25%)`
  const bars: Record<VacationMode, [string, string]> = {
    split_half: [half(first, second), half(second, first)],
    july_august: [half(first, second), half(second, first)],
    weekly: [stripes(first, second), stripes(second, first)],
    alternate_full: [first, second],
  }

  function setPeriod(kind: VacationPeriodKind, patch: Partial<{ mode: VacationMode; flip: boolean }>) {
    const current = periodModes[kind] ?? { mode, flip: false }
    const next = { ...current, ...patch }
    // « Juillet / août » ne vaut que pour l'été : ailleurs, c'est un partage par moitié.
    if (next.mode === 'july_august' && kind !== 'ete') next.mode = 'split_half'
    const copy = { ...periodModes }
    // Identique au réglage général : pas de surcharge à garder.
    const general = mode === 'july_august' && kind !== 'ete' ? 'split_half' : mode
    if (next.mode === general && !next.flip) delete copy[kind]
    else copy[kind] = next
    onPeriodModes(copy)
  }

  return (
    <>
      <div className="wz-options">
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            className={`wz-option wz-vac${mode === m ? ' selected' : ''}`}
            onClick={() => onMode(m)}
          >
            <span className="wz-option-text">
              <strong>
                {t(`wizard.vac${MODE_KEY[m]}Title`)}
                {NEW_MODES.has(m) && <span className="vac-new">{t('wizard.vacNew')}</span>}
              </strong>
              <span>{t(`wizard.vac${MODE_KEY[m]}Desc`)}</span>
            </span>
            <span className="wz-bars" aria-hidden="true">
              {bars[m].map((bg, i) => (
                <span key={i} className="wz-bar-row">
                  <span>{year + i}</span>
                  <span className="wz-bar" style={{ background: bg }} />
                </span>
              ))}
            </span>
          </button>
        ))}
      </div>

      {showPeriods ? (
        <div className="vac-periods">
          <p className="wz-hint">{t('wizard.vacPeriodsHint')}</p>
          {PERIODS.map((kind) => {
            const value = periodModes[kind] ?? { mode, flip: false }
            const options: VacationMode[] =
              kind === 'ete' ? ['split_half', 'july_august', 'alternate_full', 'weekly'] : ['split_half', 'alternate_full', 'weekly']
            const effective = value.mode === 'july_august' && kind !== 'ete' ? 'split_half' : value.mode
            return (
              <div key={kind} className="vac-period">
                <div className="vac-period-head">
                  <strong>{t(`wizard.vacPeriod_${kind}`)}</strong>
                  <button
                    type="button"
                    className={`vac-flip${value.flip ? ' on' : ''}`}
                    aria-pressed={value.flip}
                    onClick={() => setPeriod(kind, { flip: !value.flip })}
                  >
                    <span className="dot" style={{ background: value.flip ? second : first }} />
                    {t(value.flip ? 'wizard.vacStartsOther' : 'wizard.vacStartsUsual')}
                  </button>
                </div>
                <div className="segmented vac-seg" role="radiogroup" aria-label={t(`wizard.vacPeriod_${kind}`)}>
                  {options.map((o) => (
                    <button
                      key={o}
                      type="button"
                      role="radio"
                      aria-checked={effective === o}
                      className={effective === o ? 'on' : ''}
                      onClick={() => setPeriod(kind, { mode: o })}
                    >
                      {t(`wizard.vacShort${MODE_KEY[o]}`)}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
          {Object.keys(periodModes).length > 0 && (
            <button type="button" className="link vac-reset" onClick={() => onPeriodModes({})}>
              {t('wizard.vacPeriodsReset')}
            </button>
          )}
        </div>
      ) : (
        <button type="button" className="vac-more" onClick={() => setShowPeriods(true)}>
          <span>
            <strong>{t('wizard.vacPeriodsTitle')}</strong>
            <span>{t('wizard.vacPeriodsDesc')}</span>
          </span>
          <span aria-hidden="true">›</span>
        </button>
      )}
    </>
  )
}
