// Charte Alternly (« papier chaleureux »), reprise de frontend/src/index.css.
export const colors = {
  paper: '#faf6ef',
  paperDeep: '#f3ecdf',
  surface: '#ffffff',
  ink: '#24312b',
  inkSoft: '#5d6b63',
  pine: '#1f4d3f',
  pineDeep: '#163a30',
  pineSoft: '#e4ede7',
  terra: '#c96f4a',
  terraText: '#a85a39', // terracotta assez sombre pour du texte (contraste AA)
  terraSoft: '#f5e0d5',
  line: '#e7dfd0',
  danger: '#a84a42',
  dangerSoft: '#f7e4e0',
  holiday: '#c9a227',
} as const

export const fonts = {
  display: 'Fraunces_500Medium',
  body: 'InstrumentSans_400Regular',
  bodyMedium: 'InstrumentSans_500Medium',
  bodySemiBold: 'InstrumentSans_600SemiBold',
  bodyBold: 'InstrumentSans_700Bold',
} as const

export const radius = { sm: 10, md: 14, lg: 18, pill: 999 } as const

/** Fond clair dérivé de la couleur d'un parent (cases du calendrier). */
export function tint(hex: string, alpha = 0.22): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const mix = (c: number) => Math.round(c * alpha + 255 * (1 - alpha))
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}
