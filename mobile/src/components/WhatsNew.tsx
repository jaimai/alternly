// Fenêtre « Quoi de neuf » (portage de frontend/src/components/WhatsNew.tsx) : trois
// diapositives courtes, une fois par compte (whats_new_seen côté serveur).
import { useState } from 'react'
import { Modal, StyleSheet, Text, View } from 'react-native'
import { colors, fonts } from '@/lib/theme'
import { Icon } from './Icon'
import { Button } from './ui'

/** Annonce « Outils du calendrier » (pinceau, répéter, été) : sert aussi au badge « Nouveau » d'Ajuster. */
export const TOOLS_ID = '2026-10-calendar-tools'
export const TOOLS_SINCE = '2026-10-19'
/** Identifiant de la dernière fenêtre : le changer la remontre à tous. */
export const WHATS_NEW_ID = '2026-10-goto-date'
/** Les comptes créés après la mise à jour découvrent ces outils d'eux-mêmes. */
export const WHATS_NEW_SINCE = '2026-10-22'

const SLIDES = [
  {
    title: 'Coloriez plusieurs jours d’un coup',
    body: 'Dans « Ajuster mon planning », choisissez « Chez vous » ou « Chez l’autre parent », puis touchez les jours. Une période entière ? L’outil « Une période » le fait en deux touches.',
    cells: 'aaaaaaaaabbbbb', ring: [7, 8], bg: colors.pineSoft,
  },
  {
    title: 'Une règle qui revient',
    body: '« Chaque mercredi chez l’autre parent », « juillet chez vous une année sur deux » : ajoutez-les avec « Répéter », sans toucher à votre rythme habituel.',
    cells: 'aabaaaabbabbbb', ring: [2, 9], bg: colors.terraSoft,
  },
  {
    title: 'Juillet / août pour l’été',
    body: 'Nouveaux choix pour les vacances : un mois chacun, une semaine sur deux, ou période par période. À régler dans Réglages › Garde et vacances.',
    cells: 'aaaaaaabbbbbbb', ring: [] as number[], bg: colors.paperDeep,
  },
  {
    title: 'Allez directement à n’importe quelle date',
    body: 'Touchez le mois en haut du calendrier, puis choisissez l’année et le mois. Fini les flèches pour retrouver les vacances d’été.',
    cells: 'jump', ring: [] as number[], bg: colors.pineSoft,
  },
]
const JUMP = SLIDES.length - 1
const MONTHS = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc']

/** Diapositives à montrer : l'annonce « Aller à », précédée des outils si ce compte ne les a jamais vus. */
export function slidesFor(me: { whats_new_seen?: string | null; created_at?: string | null }): number[] {
  const sawTools = me.whats_new_seen === TOOLS_ID || (me.created_at ?? '') >= TOOLS_SINCE
  return sawTools ? [JUMP] : SLIDES.map((_, k) => k)
}

export function WhatsNew({ visible, onClose, onTry, slides = SLIDES.map((_, k) => k) }: {
  visible: boolean
  onClose: () => void
  onTry?: () => void
  /** Index des diapositives à montrer, dans l'ordre. */
  slides?: number[]
}) {
  const [i, setI] = useState(0)
  const slide = SLIDES[slides[i]]
  const last = i === slides.length - 1
  const close = () => {
    setI(0)
    onClose()
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={s.backdrop}>
        <View style={s.sheet} accessibilityViewIsModal>
          <Text style={s.eyebrow}>{slides.length > 1 ? `NOUVEAU · ${i + 1}/${slides.length}` : 'NOUVEAU'}</Text>
          <Text accessibilityRole="header" style={s.title}>{slide.title}</Text>
          {slide.cells === 'jump' ? (
            <View style={[s.art, { backgroundColor: slide.bg, paddingHorizontal: 16 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <View style={s.pill}>
                <Icon name="calendar" size={15} color={colors.pine} />
                <Text style={s.pillText}>Juillet {new Date().getFullYear() + 1} ▾</Text>
              </View>
              <View style={s.months}>
                {MONTHS.map((m, k) => (
                  <View key={m} style={[s.month, k === 6 && { backgroundColor: colors.pine }]}>
                    <Text style={[s.monthText, k === 6 && { color: '#fff' }]}>{m}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : (
          <View style={[s.art, { backgroundColor: slide.bg }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {[0, 1].map((w) => (
              <View key={w} style={{ flexDirection: 'row', gap: 6 }}>
                {slide.cells.slice(w * 7, w * 7 + 7).split('').map((c, k) => (
                  <View
                    key={k}
                    style={[s.cell, { backgroundColor: c === 'a' ? colors.pine : colors.terra }, slide.ring.includes(w * 7 + k) && s.ring]}
                  />
                ))}
              </View>
            ))}
          </View>
          )}
          <Text style={s.body}>{slide.body}</Text>
          {slides.length > 1 ? (
            <View style={s.dots}>
              {slides.map((_, k) => (
                <View key={k} style={[s.dot, k === i && s.dotOn]} />
              ))}
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Plus tard" variant="secondary" onPress={close} style={{ flex: 1 }} />
            <Button
              title={last ? (onTry ? 'Essayer maintenant' : 'C’est noté') : 'Suivant'}
              onPress={() => {
                if (!last) setI(i + 1)
                else if (onTry) {
                  setI(0)
                  onTry()
                } else close()
              }}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </View>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(36, 49, 43, 0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, gap: 12 },
  eyebrow: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 0.5, color: colors.terraText },
  title: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: colors.ink },
  art: { alignItems: 'center', gap: 6, paddingVertical: 22, borderRadius: 16 },
  cell: { width: 30, height: 30, borderRadius: 8 },
  ring: { borderWidth: 3, borderColor: colors.ink },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.inkSoft },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.line },
  dotOn: { width: 22, backgroundColor: colors.pine },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, paddingHorizontal: 14,
    borderRadius: 999, borderWidth: 1.5, borderColor: colors.pine, backgroundColor: colors.surface,
  },
  pillText: { fontFamily: fonts.display, fontSize: 17, color: colors.ink },
  months: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, padding: 8, borderRadius: 12, backgroundColor: colors.surface, alignSelf: 'stretch' },
  month: { width: '23%', flexGrow: 1, paddingVertical: 6, borderRadius: 8, backgroundColor: colors.paper, alignItems: 'center' },
  monthText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.ink },
})
