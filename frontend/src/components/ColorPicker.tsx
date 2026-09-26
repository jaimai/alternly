// Couleurs de parent tirées de la charte (papier chaleureux) : assez contrastées
// entre elles pour colorer le calendrier, assez douces pour rester lisibles.
export const PARENT_COLORS: { value: string; label: string }[] = [
  { value: '#2f6b57', label: 'Sapin' },
  { value: '#c96f4a', label: 'Terracotta' },
  { value: '#4a6fa5', label: 'Ardoise' },
  { value: '#c9a227', label: 'Moutarde' },
  { value: '#8a5a9e', label: 'Prune' },
  { value: '#5b8f8a', label: 'Lagon' },
]

export const DEFAULT_PARENT_COLOR = PARENT_COLORS[0].value

export default function ColorPicker({
  value,
  onChange,
  taken,
}: {
  value: string
  onChange: (color: string) => void
  /** Couleur déjà prise par l'autre parent : signalée, pas bloquée. */
  taken?: string
}) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Couleur sur le calendrier">
      {PARENT_COLORS.map((c) => {
        const selected = c.value.toLowerCase() === value.toLowerCase()
        const isTaken = taken?.toLowerCase() === c.value.toLowerCase() && !selected
        return (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={isTaken ? `${c.label} (couleur de l'autre parent)` : c.label}
            title={isTaken ? `${c.label} — déjà utilisée par l'autre parent` : c.label}
            className={`swatch${selected ? ' selected' : ''}${isTaken ? ' taken' : ''}`}
            style={{ background: c.value }}
            onClick={() => onChange(c.value)}
          />
        )
      })}
    </div>
  )
}
