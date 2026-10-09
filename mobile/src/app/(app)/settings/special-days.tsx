// Jours de fête : ils passent outre le rythme habituel et le partage des vacances.
// Avec deux parents, chaque modification part en demande.
import { useState } from 'react'
import { StyleSheet, Switch, Text, View } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { PENDING_MESSAGE } from '@/components/ChangeRequests'
import { Chips } from '@/components/form'
import { Body, Card, ErrorBanner, Loading, Screen, Title } from '@/components/ui'
import { api, isPendingChange } from '@/lib/api'
import { useHousehold, useHouseholdAction } from '@/lib/queries'
import { colors, fonts } from '@/lib/theme'
import type { SpecialDayKind, SpecialDayRule } from '@/lib/types'

const LABEL: Record<SpecialDayKind, string> = {
  christmas_eve: 'Réveillon de Noël (24 déc.)',
  christmas_day: 'Jour de Noël (25 déc.)',
  new_years_day: 'Jour de l’An (1er janv.)',
  mothers_day: 'Fête des mères',
  fathers_day: 'Fête des pères',
  thanksgiving: 'Thanksgiving',
  halloween: 'Halloween',
  independence_day: 'Fête nationale américaine (4 juillet)',
}

export default function SpecialDays() {
  const household = useHousehold().data
  const [notice, setNotice] = useState<string | null>(null)
  const save = useHouseholdAction(
    (rules: SpecialDayRule[]) => api.setSpecialDayRules(household!.id, rules),
    (r) => setNotice(isPendingChange(r) ? PENDING_MESSAGE : null),
  )

  if (!household) return <Loading />

  function update(kind: SpecialDayKind, patch: Partial<SpecialDayRule>) {
    save.mutate(household!.special_day_rules.map((r) => (r.kind === kind ? { ...r, ...patch } : r)))
  }

  // Valeur du choix « qui a les enfants » : auto, toujours X, ou X les années paires (Noël).
  const choiceValue = (r: SpecialDayRule) =>
    r.parent_id && r.parent_mode !== 'auto' ? `${r.parent_mode}:${r.parent_id}` : 'auto'

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <Title>Jours de fête</Title>
      <Body muted>Ces jours passent outre le rythme habituel et le partage des vacances.</Body>
      <ErrorBanner message={save.error?.message} />
      {notice ? (
        <Card style={{ backgroundColor: colors.pineSoft, borderColor: colors.pineSoft }}>
          <Body>{notice}</Body>
        </Card>
      ) : null}

      {household.special_day_rules.map((r) => {
        const christmas = r.kind === 'christmas_eve' || r.kind === 'christmas_day'
        const options = [
          { value: 'auto', label: 'Automatique' },
          ...household.members.map((m) => ({ value: `fixed:${m.id}`, label: `Toujours ${m.display_name}`, dot: m.color })),
          ...(christmas
            ? household.members.map((m) => ({ value: `alternate:${m.id}`, label: `${m.display_name} les années paires`, dot: m.color }))
            : []),
        ]
        return (
          <Card key={r.kind}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Text style={s.label}>{LABEL[r.kind]}</Text>
              <Switch
                accessibilityLabel={LABEL[r.kind]}
                value={r.enabled}
                disabled={save.isPending}
                onValueChange={(enabled) => update(r.kind, { enabled })}
                trackColor={{ true: colors.pine, false: colors.line }}
              />
            </View>
            {r.enabled ? (
              <Chips
                options={options}
                value={choiceValue(r)}
                onChange={(v) => {
                  if (v === 'auto') return update(r.kind, { parent_mode: 'auto', parent_id: null })
                  const [mode, id] = v.split(':')
                  update(r.kind, { parent_mode: mode as 'fixed' | 'alternate', parent_id: Number(id) })
                }}
              />
            ) : null}
          </Card>
        )
      })}
    </Screen>
  )
}

const s = StyleSheet.create({
  label: { flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
})
