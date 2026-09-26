// Couleurs de parent tirées de la charte (papier chaleureux) : assez contrastées
// entre elles pour colorer le calendrier, assez douces pour rester lisibles.
export const PARENT_COLORS: { value: string; labelKey: string }[] = [
  { value: '#2f6b57', labelKey: 'common.colorPine' },
  { value: '#c96f4a', labelKey: 'common.colorTerracotta' },
  { value: '#4a6fa5', labelKey: 'common.colorSlate' },
  { value: '#c9a227', labelKey: 'common.colorMustard' },
  { value: '#8a5a9e', labelKey: 'common.colorPlum' },
  { value: '#5b8f8a', labelKey: 'common.colorLagoon' },
]

export const DEFAULT_PARENT_COLOR = PARENT_COLORS[0].value

/** Couleur par défaut qui ne reprend pas celle de l'autre parent. */
export function defaultColorAvoiding(taken?: string): string {
  return PARENT_COLORS.find((c) => c.value.toLowerCase() !== taken?.toLowerCase())?.value ?? DEFAULT_PARENT_COLOR
}
