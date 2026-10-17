// Bandeaux du calendrier (comme le web) : propositions qui expirent demain, et vacances
// scolaires non chargées (le calendrier n'affiche alors que le rythme de base).
import { Text, View } from 'react-native'
import { todayIso } from '@/lib/dates'
import { colors, fonts, radius } from '@/lib/theme'
import type { CalendarResponse } from '@/lib/types'
import { Icon } from './Icon'

export function CalendarNotices({ cal }: { cal: Pick<CalendarResponse, 'pending_exchanges' | 'school_holidays_loaded'> }) {
  const tomorrow = todayIso(1)
  const expiring = cal.pending_exchanges.filter((e) => e.date_start === tomorrow).length
  return (
    <>
      {expiring > 0 ? (
        <Notice
          tone="warn"
          text={`${expiring === 1 ? 'Une proposition expire demain' : `${expiring} propositions expirent demain`} si elle${expiring > 1 ? 's ne sont' : ' n’est'} pas traitée${expiring > 1 ? 's' : ''}.`}
        />
      ) : null}
      {!cal.school_holidays_loaded ? (
        <Notice tone="info" text="Les vacances scolaires n’ont pas pu être chargées : le calendrier affiche uniquement le rythme de base." />
      ) : null}
    </>
  )
}

function Notice({ tone, text }: { tone: 'warn' | 'info'; text: string }) {
  const warn = tone === 'warn'
  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: radius.md,
        backgroundColor: warn ? colors.terraSoft : colors.paperDeep,
      }}
    >
      <Icon name={warn ? 'swap' : 'calendar'} size={18} color={warn ? colors.terraText : colors.inkSoft} strokeWidth={2} />
      <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink }}>{text}</Text>
    </View>
  )
}
