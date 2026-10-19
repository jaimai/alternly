// Mon organisation : les règles du foyer empilées, de la plus précise (qui l'emporte)
// au rythme habituel. Les règles qui se répètent se retirent d'ici.
import { router, type Href } from 'expo-router'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { PENDING_MESSAGE } from '@/components/ChangeRequests'
import { Body, Card, ErrorBanner, Loading, Screen, Title } from '@/components/ui'
import { api, isPendingChange } from '@/lib/api'
import { useHousehold, useHouseholdAction, useMe } from '@/lib/queries'
import { describeRule, ruleInput } from '@/lib/recurring'
import { colors, fonts } from '@/lib/theme'
import type { RecurringRule, VacationMode } from '@/lib/types'

const PATTERN_LABEL = {
  alternate_weeks: 'Semaine / semaine',
  two_two_three: '2-2-3',
  every_other_weekend: 'Un week-end sur deux',
  custom: 'Rythme personnalisé',
} as const
const VAC_LABEL: Record<VacationMode, string> = {
  split_half: 'Moitié chacun',
  alternate_full: 'Toutes les vacances, une année sur deux',
  july_august: 'Juillet / août',
  weekly: 'Une semaine sur deux',
}

export default function Organisation() {
  const household = useHousehold().data
  const meId = useMe().data?.id
  const [notice, setNotice] = useState<string | null>(null)
  const save = useHouseholdAction(
    (rules: RecurringRule[]) => api.setRecurringRules(household!.id, rules.map(ruleInput)),
    (r) => setNotice(isPendingChange(r) ? PENDING_MESSAGE : 'Règle retirée.'),
  )

  if (!household || meId === undefined) return <Loading />

  const rules = household.recurring_rules ?? []
  const otherOf = (id: number) => household.members.find((m) => m.id !== id)?.id ?? id
  const who = (id: number) => {
    const m = household.members.find((x) => x.id === id)
    if (id === meId) return 'chez vous'
    return m && !m.is_placeholder ? `chez ${m.display_name}` : 'chez l’autre parent'
  }
  const specials = household.special_day_rules.filter((r) => r.enabled).length
  const vac = household.vacation_rule

  const ruleList = (kind: 'weekly' | 'yearly') => {
    const list = rules.filter((r) => r.kind === kind)
    if (!list.length) return <Text style={s.title}>Aucune</Text>
    return list.map((r) => (
      <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={[s.title, { flex: 1 }]}>{describeRule(r, who, otherOf)}</Text>
        <Text
          accessibilityRole="button"
          onPress={() => !save.isPending && save.mutate(rules.filter((x) => x.id !== r.id))}
          style={s.remove}
        >
          Retirer
        </Text>
      </View>
    ))
  }

  const layers: { kind: string; body: React.ReactNode; hint?: string; href?: Href }[] = [
    { kind: 'Jours personnalisés', body: <Text style={s.title}>Ajustés à la main, ou échanges acceptés</Text>, href: '/calendar' },
    { kind: 'Jours spéciaux', body: <Text style={s.title}>{specials ? `${specials} jour${specials > 1 ? 's' : ''} spécia${specials > 1 ? 'ux' : 'l'}` : 'Aucun'}</Text>, href: '/settings/special-days' },
    { kind: 'Périodes de l’année', body: ruleList('yearly'), hint: 'Depuis Calendrier › Ajuster › Une période, « une année sur deux » ou « tous les ans ».' },
    {
      kind: 'Vacances',
      body: <Text style={s.title}>{vac ? VAC_LABEL[vac.mode] : 'Aucun'}</Text>,
      hint: vac?.period_modes && Object.keys(vac.period_modes).length ? 'Réglé période par période' : undefined,
      href: '/settings/rules',
    },
    { kind: 'Règles de la semaine', body: ruleList('weekly'), hint: 'Depuis Calendrier › Ajuster mon planning › Répéter.' },
    { kind: 'Rythme habituel', body: <Text style={s.title}>{household.custody_rule ? PATTERN_LABEL[household.custody_rule.pattern] : 'Aucun'}</Text>, href: '/settings/rules' },
  ]

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <View style={{ gap: 6 }}>
        <Title>Mon organisation</Title>
        <Body muted>Vos règles s’empilent : quand deux tombent le même jour, celle du dessus l’emporte.</Body>
      </View>
      <ErrorBanner message={save.error?.message} />
      {notice ? (
        <Card style={{ backgroundColor: colors.pineSoft, borderColor: colors.pineSoft }}>
          <Body style={{ fontSize: 14 }}>{notice}</Body>
        </Card>
      ) : null}
      <View style={{ gap: 8 }}>
        {layers.map((l, i) => (
          <View key={l.kind} style={s.layer}>
            <View style={[s.rank, i === layers.length - 1 && { backgroundColor: colors.ink }]}>
              <Text style={[s.rankText, i === layers.length - 1 && { color: colors.paper }]}>{i + 1}</Text>
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={s.kind}>{l.kind.toUpperCase()}</Text>
              {l.body}
              {l.hint ? <Text style={s.hint}>{l.hint}</Text> : null}
            </View>
            {l.href ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`Modifier : ${l.kind}`} onPress={() => router.push(l.href!)} hitSlop={8}>
                <Text style={s.edit}>Modifier</Text>
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>
    </Screen>
  )
}

const s = StyleSheet.create({
  layer: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  rank: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paperDeep },
  rankText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.ink },
  kind: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 0.4, color: colors.inkSoft },
  title: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  hint: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
  edit: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.pine },
  remove: { fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.danger, padding: 4 },
})
