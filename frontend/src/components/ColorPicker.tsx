import { useTranslation } from 'react-i18next'
import { PARENT_COLORS } from '../colors'

export default function ColorPicker({
  value,
  onChange,
  taken,
  labelledBy,
}: {
  value: string
  onChange: (color: string) => void
  /** Couleur déjà prise par l'autre parent : signalée, pas bloquée. */
  taken?: string
  labelledBy?: string
}) {
  const { t } = useTranslation()
  return (
    <div className="swatches" role="radiogroup" aria-labelledby={labelledBy}>
      {PARENT_COLORS.map((c) => {
        const selected = c.value.toLowerCase() === value.toLowerCase()
        const isTaken = taken?.toLowerCase() === c.value.toLowerCase() && !selected
        const label = t(c.labelKey)
        return (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={isTaken ? t('common.colorTakenAria', { color: label }) : label}
            title={isTaken ? t('common.colorTakenTitle', { color: label }) : label}
            className={`swatch${selected ? ' selected' : ''}${isTaken ? ' taken' : ''}`}
            style={{ background: c.value }}
            onClick={() => onChange(c.value)}
          />
        )
      })}
    </div>
  )
}
