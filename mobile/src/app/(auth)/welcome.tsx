import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { StyleSheet, Text, View } from 'react-native'
import { LogoMark } from '@/components/Icon'
import { Body, Button, Card, Screen } from '@/components/ui'
import { colors, fonts } from '@/lib/theme'

// Illustration : une semaine type, passation le vendredi.
const WEEK: { day: string; split?: boolean; other?: boolean }[] = [
  { day: 'mon' }, { day: 'tue' }, { day: 'wed' }, { day: 'thu' },
  { day: 'fri', split: true }, { day: 'sat', other: true }, { day: 'sun', other: true },
]

export default function Welcome() {
  const { t } = useTranslation()
  return (
    <Screen edges={['top', 'bottom']} contentStyle={{ flexGrow: 1, justifyContent: 'space-between', paddingHorizontal: 24 }}>
      <View style={s.hero}>
        <LogoMark size={76} />
        <Text accessibilityRole="header" style={s.brand}>Alternly</Text>
        <Body muted style={s.tagline}>{t('auth.welcome.tagline')}</Body>

        <Card style={s.preview}>
          <Text style={s.previewTitle}>{t('auth.welcome.previewTitle')}</Text>
          <View style={s.week} accessible accessibilityLabel={t('auth.welcome.previewA11y')}>
            {WEEK.map((d, i) => (
              <View key={i} style={s.dayCol}>
                <Text style={s.dayLabel}>{t(`auth.welcome.days.${d.day}`)}</Text>
                <View style={[s.dayCell, { backgroundColor: d.other ? colors.terra : '#2f6b57' }]}>
                  {d.split ? <View style={s.half} /> : null}
                </View>
              </View>
            ))}
          </View>
          <View style={s.legend}>
            <Legend color="#2f6b57" label={t('common.youTitle')} />
            <Legend color={colors.terra} label={t('auth.welcome.otherParent')} />
          </View>
        </Card>
      </View>

      <View style={{ gap: 10 }}>
        <Button title={t('auth.createAccount')} onPress={() => router.push('/register')} />
        <Button title={t('auth.haveAccount')} variant="secondary" onPress={() => router.push('/login')} />
        <Body muted style={{ textAlign: 'center', fontSize: 13 }}>{t('auth.welcome.sameAccount')}</Body>
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
