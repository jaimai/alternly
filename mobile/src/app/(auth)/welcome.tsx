import { router } from 'expo-router'
import { StyleSheet, Text, View } from 'react-native'
import { LogoMark } from '@/components/Icon'
import { Body, Button, Card, Screen } from '@/components/ui'
import { colors, fonts } from '@/lib/theme'

// Illustration : une semaine type, passation le vendredi.
const WEEK: { label: string; split?: boolean; other?: boolean }[] = [
  { label: 'L' }, { label: 'M' }, { label: 'M' }, { label: 'J' },
  { label: 'V', split: true }, { label: 'S', other: true }, { label: 'D', other: true },
]

export default function Welcome() {
  return (
    <Screen edges={['top', 'bottom']} contentStyle={{ flexGrow: 1, justifyContent: 'space-between', paddingHorizontal: 24 }}>
      <View style={s.hero}>
        <LogoMark size={76} />
        <Text accessibilityRole="header" style={s.brand}>Alternly</Text>
        <Body muted style={s.tagline}>Le calendrier de garde partagée, clair pour les deux parents.</Body>

        <Card style={s.preview}>
          <Text style={s.previewTitle}>Une semaine type</Text>
          <View style={s.week} accessible accessibilityLabel="Du lundi au vendredi chez vous, passation vendredi soir, week-end chez l'autre parent">
            {WEEK.map((d, i) => (
              <View key={i} style={s.dayCol}>
                <Text style={s.dayLabel}>{d.label}</Text>
                <View style={[s.dayCell, { backgroundColor: d.other ? colors.terra : '#2f6b57' }]}>
                  {d.split ? <View style={s.half} /> : null}
                </View>
              </View>
            ))}
          </View>
          <View style={s.legend}>
            <Legend color="#2f6b57" label="Vous" />
            <Legend color={colors.terra} label="L'autre parent" />
          </View>
        </Card>
      </View>

      <View style={{ gap: 10 }}>
        <Button title="Créer un compte" onPress={() => router.push('/register')} />
        <Button title="J'ai déjà un compte" variant="secondary" onPress={() => router.push('/login')} />
        <Body muted style={{ textAlign: 'center', fontSize: 13 }}>Le même compte que sur alternly.com</Body>
      </View>
    </Screen>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.ink }}>{label}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingVertical: 24 },
  brand: { fontFamily: fonts.display, fontSize: 40, color: colors.ink },
  tagline: { textAlign: 'center', fontSize: 17, maxWidth: 290 },
  preview: { alignSelf: 'stretch', marginTop: 12 },
  previewTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  week: { flexDirection: 'row', gap: 6 },
  dayCol: { flex: 1, alignItems: 'center', gap: 6 },
  dayLabel: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.inkSoft },
  dayCell: { alignSelf: 'stretch', height: 34, borderRadius: 10, overflow: 'hidden' },
  half: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '50%', backgroundColor: colors.terra },
  legend: { flexDirection: 'row', gap: 16 },
})
