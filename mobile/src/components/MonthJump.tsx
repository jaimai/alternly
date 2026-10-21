// « Aller à… » (portage de frontend/src/components/MonthJump.tsx) : sélecteur
// mois / année ouvert depuis le titre du calendrier, pour sauter plusieurs mois
// ou d'une année à l'autre sans enchaîner les flèches.
import { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { todayIso } from '@/lib/dates'
import { colors, fonts } from '@/lib/theme'
import { Icon } from './Icon'
import { Button } from './ui'

const MONTHS = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc']

export function MonthJump({ visible, month, onPick, onClose }: {
  visible: boolean
  /** Mois affiché (AAAA-MM-01). */
  month: string
  /** Premier jour du mois choisi (AAAA-MM-01). */
  onPick: (monthIso: string) => void
  onClose: () => void
}) {
  const shownYear = Number(month.slice(0, 4))
  const shownMonth = Number(month.slice(5, 7)) - 1
  const today = todayIso()
  // Monté à chaque ouverture : l'année repart du mois affiché.
  const [year, setYear] = useState(shownYear)

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} accessibilityLabel="Fermer">
        <Pressable style={s.sheet} accessibilityViewIsModal onPress={() => {}}>
          <Text accessibilityRole="header" style={s.title}>Aller à…</Text>
          <View style={s.yearRow}>
            <Pressable accessibilityRole="button" accessibilityLabel="Année précédente" onPress={() => setYear(year - 1)} style={s.arrow}>
              <Icon name="back" size={20} />
            </Pressable>
            <Text style={s.year}>{year}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Année suivante" onPress={() => setYear(year + 1)} style={s.arrow}>
              <Icon name="chevron" size={20} />
            </Pressable>
          </View>
          <View style={s.grid}>
            {MONTHS.map((label, m) => {
              const isShown = year === shownYear && m === shownMonth
              const isToday = year === Number(today.slice(0, 4)) && m === Number(today.slice(5, 7)) - 1
              return (
                <Pressable
                  key={m}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isShown }}
                  onPress={() => onPick(`${year}-${String(m + 1).padStart(2, '0')}-01`)}
                  style={[s.cell, isToday && s.cellToday, isShown && s.cellShown]}
                >
                  <Text style={[s.cellText, isToday && { color: colors.terraText }, isShown && { color: '#fff' }]}>{label}</Text>
                </Pressable>
              )
            })}
          </View>
          <Button title="Aujourd’hui" variant="secondary" onPress={() => onPick(today.slice(0, 8) + '01')} />
        </Pressable>
      </Pressable>
    </Modal>
  )
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(36, 49, 43, 0.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, gap: 14 },
  title: { fontFamily: fonts.display, fontSize: 24, color: colors.ink },
  yearRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  year: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },
  arrow: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.pineSoft, alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: {
    width: '23%', flexGrow: 1, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center',
  },
  cellToday: { borderColor: colors.terra },
  cellShown: { backgroundColor: colors.pine, borderColor: colors.pine },
  cellText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
})
