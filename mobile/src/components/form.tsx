// Contrôles de formulaire : segments, pastilles, cartes de choix, progression, sélecteur de date.
import { useState, type ReactNode } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { addMonths, formatLong, formatMonth, monthGrid, monthStart, parseIso } from '@/lib/dates'
import { colors, fonts, radius } from '@/lib/theme'
import { Icon } from './Icon'
import { Button } from './ui'

export function Segmented<T extends string | number>({ options, value, onChange, label }: {
  options: { value: T; label: string; dot?: string }[]
  value: T
  onChange: (v: T) => void
  label?: string
}) {
  return (
    <View style={{ gap: 8 }}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <View style={s.segment} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => {
          const selected = o.value === value
          return (
            <Pressable
              key={String(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange(o.value)}
              style={[s.segmentItem, selected && s.segmentOn]}
            >
              {o.dot ? <View style={[s.dot, { backgroundColor: o.dot }]} /> : null}
              <Text style={[s.segmentText, selected && { color: colors.ink }]} numberOfLines={1}>
                {o.label}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

/** Carte sélectionnable (rythme de garde, mode de vacances…). */
/** Choix unique sur plusieurs lignes (catégories, répartitions…), quand Segmented déborde. */
export function Chips<T extends string | number>({ options, value, onChange, label }: {
  options: { value: T; label: string; dot?: string }[]
  value: T | null
  onChange: (v: T) => void
  label?: string
}) {
  return (
    <View style={{ gap: 8 }}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => {
          const selected = o.value === value
          return (
            <Pressable
              key={String(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange(o.value)}
              style={[s.chip, selected && s.chipOn]}
            >
              {o.dot ? <View style={[s.dot, { backgroundColor: o.dot }]} /> : null}
              <Text style={[s.chipText, selected && { color: '#fff' }]}>{o.label}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

export function ChoiceCard({ title, description, selected, onPress, aside }: {
  title: string
  description?: string
  selected: boolean
  onPress: () => void
  aside?: ReactNode
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[s.choice, selected ? s.choiceOn : null]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.choiceTitle}>{title}</Text>
        {description ? <Text style={s.choiceDesc}>{description}</Text> : null}
      </View>
      {aside}
    </Pressable>
  )
}

export function Progress({ step, total, label }: { step: number; total: number; label?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }} accessibilityLabel={label ?? `Étape ${step} sur ${total}`}>
      <View style={{ flex: 1, flexDirection: 'row', gap: 6 }}>
        {Array.from({ length: total }, (_, i) => (
          <View key={i} style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: i < step ? colors.pine : colors.line }} />
        ))}
      </View>
      <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft }}>{label ?? `${step} / ${total}`}</Text>
    </View>
  )
}

/** Champ date : ouvre un calendrier mensuel en feuille modale. */
export function DateField({ label, value, onChange, min }: {
  label: string
  value: string
  onChange: (iso: string) => void
  min?: string
}) {
  const [open, setOpen] = useState(false)
  const [month, setMonth] = useState(monthStart(value))
  const grid = monthGrid(month)

  return (
    <View style={{ gap: 8, flex: 1 }}>
      <Text style={s.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label} : ${formatLong(value)}`}
        onPress={() => {
          setMonth(monthStart(value))
          setOpen(true)
        }}
        style={s.field}
      >
        <Icon name="calendar" size={18} color={colors.inkSoft} />
        <Text style={s.fieldText} numberOfLines={1}>
          {parseIso(value).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}
        </Text>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={s.backdrop} accessibilityLabel="Fermer" onPress={() => setOpen(false)} />
        <View style={s.sheet}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={s.sheetTitle}>{capitalize(formatMonth(month))}</Text>
            <NavButton icon="back" label="Mois précédent" onPress={() => setMonth(addMonths(month, -1))} />
            <NavButton icon="chevron" label="Mois suivant" onPress={() => setMonth(addMonths(month, 1))} />
          </View>
          <View style={s.grid}>
            {['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => (
              <Text key={i} style={s.weekday}>
                {d}
              </Text>
            ))}
            {grid.map((d) => {
              const disabled = (min !== undefined && d < min) || d.slice(0, 7) !== month.slice(0, 7)
              const selected = d === value
              return (
                <Pressable
                  key={d}
                  accessibilityRole="button"
                  accessibilityLabel={formatLong(d)}
                  accessibilityState={{ selected, disabled }}
                  disabled={disabled}
                  onPress={() => {
                    onChange(d)
                    setOpen(false)
                  }}
                  style={[s.day, selected && { backgroundColor: colors.pine }]}
                >
                  <Text style={[s.dayText, disabled && { color: '#c9bfae' }, selected && { color: '#fff' }]}>
                    {parseIso(d).getDate()}
                  </Text>
                </Pressable>
              )
            })}
          </View>
          <Button title="Fermer" variant="secondary" onPress={() => setOpen(false)} />
        </View>
      </Modal>
    </View>
  )
}

function NavButton({ icon, label, onPress }: { icon: 'back' | 'chevron'; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={s.nav}>
      <Icon name={icon} size={20} />
    </Pressable>
  )
}

function capitalize(str: string) {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

const s = StyleSheet.create({
  label: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.inkSoft },
  segment: { flexDirection: 'row', backgroundColor: colors.paperDeep, borderRadius: 14, padding: 4, gap: 4 },
  segmentItem: {
    flex: 1, minHeight: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 8, paddingHorizontal: 8,
  },
  segmentOn: { backgroundColor: colors.surface, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  segmentText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.inkSoft },
  dot: { width: 10, height: 10, borderRadius: 5 },
  chip: {
    minHeight: 40, borderRadius: radius.pill, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
  },
  chipOn: { backgroundColor: colors.pine, borderColor: colors.pine },
  chipText: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.ink },
  choice: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line,
  },
  choiceOn: { backgroundColor: colors.pineSoft, borderWidth: 2, borderColor: colors.pine },
  choiceTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  choiceDesc: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.inkSoft },
  field: {
    minHeight: 50, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface,
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12,
  },
  fieldText: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  backdrop: { flex: 1, backgroundColor: 'rgba(20,30,26,0.45)' },
  sheet: {
    backgroundColor: colors.paper, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 20, paddingBottom: 34, gap: 14,
  },
  sheetTitle: { flex: 1, fontFamily: fonts.display, fontSize: 22, color: colors.ink },
  nav: {
    width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  weekday: { width: `${100 / 7}%`, textAlign: 'center', fontFamily: fonts.bodyBold, fontSize: 12, color: colors.inkSoft, paddingBottom: 6 },
  day: { width: `${100 / 7}%`, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
})
