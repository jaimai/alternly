// Fenêtre « Quoi de neuf » (portage de frontend/src/components/WhatsNew.tsx) : trois
// diapositives courtes, une fois par compte (whats_new_seen côté serveur).
import { useState } from 'react'
import { Modal, StyleSheet, Text, View } from 'react-native'
import { colors, fonts } from '@/lib/theme'
import { Button } from './ui'

/** Identifiant de la dernière fenêtre : le changer la remontre à tous. */
export const WHATS_NEW_ID = '2026-10-calendar-tools'
/** Les comptes créés après la mise à jour découvrent ces outils d'eux-mêmes. */
export const WHATS_NEW_SINCE = '2026-10-19'

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
]

export function WhatsNew({ visible, onClose, onTry }: { visible: boolean; onClose: () => void; onTry?: () => void }) {
  const [i, setI] = useState(0)
  const slide = SLIDES[i]
  const last = i === SLIDES.length - 1
  const close = () => {
    setI(0)
    onClose()
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={s.backdrop}>
        <View style={s.sheet} accessibilityViewIsModal>
          <Text style={s.eyebrow}>NOUVEAU · {i + 1}/{SLIDES.length}</Text>
          <Text accessibilityRole="header" style={s.title}>{slide.title}</Text>
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
          <Text style={s.body}>{slide.body}</Text>
          <View style={s.dots}>
            {SLIDES.map((_, k) => (
              <View key={k} style={[s.dot, k === i && s.dotOn]} />
            ))}
          </View>
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
})
