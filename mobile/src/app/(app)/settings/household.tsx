// Enfants (ajouter, retirer), zone scolaire, et prénom de l'autre parent tant qu'il n'a
// pas de compte ; congés scolaires des foyers US. Avec deux parents, retirer un enfant attend l'accord de l'autre.
import { useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native'
import { PENDING_MESSAGE } from '@/components/ChangeRequests'
import { BackButton } from '@/components/BackButton'
import { Chips, DateField } from '@/components/form'
import { Icon } from '@/components/Icon'
import { Body, Button, Card, ErrorBanner, Field, Loading, Screen, SectionLabel, Title } from '@/components/ui'
import { api, isPendingChange } from '@/lib/api'
import { formatRange, todayIso } from '@/lib/dates'
import { useHousehold, useHouseholdAction } from '@/lib/queries'
import { colors, fonts } from '@/lib/theme'
import type { SchoolVacation } from '@/lib/types'

// Noms donnés par défaut au second parent sans compte (backend/app/services/parents.py).
const DEFAULT_PARTNER_NAMES = ["L'autre parent", 'Co-parent']

const ZONES = [
  { value: 'A' as const, label: 'Zone A', hint: 'Besançon, Bordeaux, Clermont, Dijon, Grenoble, Limoges, Lyon, Poitiers' },
  { value: 'B' as const, label: 'Zone B', hint: 'Aix-Marseille, Amiens, Lille, Nancy-Metz, Nantes, Nice, Normandie, Orléans-Tours, Reims, Rennes, Strasbourg' },
  { value: 'C' as const, label: 'Zone C', hint: 'Créteil, Montpellier, Paris, Toulouse, Versailles' },
]

export default function HouseholdSettings() {
  const household = useHousehold().data
  const [childName, setChildName] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const placeholder = household?.members.find((m) => m.is_placeholder)
  const [partnerName, setPartnerName] = useState<string | null>(null)

  const hid = household?.id ?? 0
  const add = useHouseholdAction(() => api.addChild(hid, childName.trim()), () => setChildName(''))
  const remove = useHouseholdAction((id: number) => api.deleteChild(hid, id), (r) => setNotice(isPendingChange(r) ? PENDING_MESSAGE : null))
  const zone = useHouseholdAction((z: 'A' | 'B' | 'C') => api.updateHousehold(hid, { school_zone: z }), () => setNotice('Zone mise à jour.'))
  const rename = useHouseholdAction(
    () => api.renamePartner(hid, (partnerName ?? '').trim()),
    () => {
      setPartnerName(null)
      setNotice('Prénom enregistré.')
    },
  )
  const error = [add, remove, zone, rename].find((m) => m.error)?.error?.message

  if (!household) return <Loading />

  function confirmRemove(id: number, name: string) {
    Alert.alert(`Retirer ${name} du foyer ?`, 'Son prénom disparaît du foyer pour les deux parents. Vous pourrez l’ajouter de nouveau plus tard.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Retirer', style: 'destructive', onPress: () => remove.mutate(id) },
    ])
  }

  const currentZone = ZONES.find((z) => z.value === household.school_zone)

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <Title>Foyer</Title>
      <ErrorBanner message={error} />
      {notice ? (
        <Card style={{ backgroundColor: colors.pineSoft, borderColor: colors.pineSoft }}>
          <Body>{notice}</Body>
        </Card>
      ) : null}

      <View style={{ gap: 8 }}>
        <SectionLabel>Enfants</SectionLabel>
        <View style={s.group}>
          {household.children.map((c) => (
            <View key={c.id} style={s.row}>
              <Text style={[s.strong, { flex: 1 }]}>{c.first_name}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Retirer ${c.first_name}`}
                hitSlop={8}
                onPress={() => confirmRemove(c.id, c.first_name)}
                disabled={remove.isPending}
              >
                <Icon name="close" size={18} color={colors.danger} />
              </Pressable>
            </View>
          ))}
          {household.children.length === 0 ? <Text style={[s.muted, { padding: 14 }]}>Aucun enfant pour l’instant.</Text> : null}
        </View>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Field label="Ajouter un enfant" placeholder="Prénom" value={childName} onChangeText={setChildName} maxLength={50} returnKeyType="done" onSubmitEditing={() => childName.trim() && add.mutate()} />
          </View>
          <Button title="Ajouter" variant="secondary" onPress={() => add.mutate()} loading={add.isPending} disabled={!childName.trim()} />
        </View>
      </View>

      {placeholder ? (
        <View style={{ gap: 8 }}>
          <SectionLabel>L’autre parent</SectionLabel>
          <Body muted style={{ fontSize: 14 }}>
            Pas encore de compte : vous pouvez déjà lui attribuer des dépenses. Il ou elle retrouvera tout en rejoignant le foyer.
          </Body>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <Field
                label="Son prénom"
                placeholder="ex. Camille"
                value={partnerName ?? (DEFAULT_PARTNER_NAMES.includes(placeholder.display_name) ? '' : placeholder.display_name)}
                onChangeText={setPartnerName}
                maxLength={50}
              />
            </View>
            <Button
              title="Enregistrer"
              variant="secondary"
              onPress={() => rename.mutate()}
              loading={rename.isPending}
              disabled={!partnerName?.trim()}
            />
          </View>
        </View>
      ) : null}

      {household.country === 'US' ? <SchoolBreaks householdId={household.id} breaks={household.school_vacations} /> : null}

      {household.country === 'FR' ? (
        <View style={{ gap: 8 }}>
          <SectionLabel>Zone scolaire</SectionLabel>
          <Chips options={ZONES} value={household.school_zone} onChange={(z) => z !== household.school_zone && zone.mutate(z)} />
          {currentZone ? <Body muted style={{ fontSize: 13 }}>{currentZone.hint}</Body> : null}
        </View>
      ) : null}
    </Screen>
  )
}

/** Foyers US : pas de calendrier scolaire national, les congés se saisissent à la main. */
function SchoolBreaks({ householdId, breaks }: { householdId: number; breaks: SchoolVacation[] }) {
  const [label, setLabel] = useState('')
  const [start, setStart] = useState(todayIso())
  const [end, setEnd] = useState(todayIso(7))
  const add = useHouseholdAction(
    () => api.addSchoolVacation(householdId, { label: label.trim(), start, end }),
    () => setLabel(''),
  )
  const remove = useHouseholdAction((id: number) => api.deleteSchoolVacation(householdId, id))

  function confirmRemove(v: SchoolVacation) {
    Alert.alert(`Supprimer « ${v.label} » ?`, 'Le calendrier reprend le rythme habituel sur ces dates.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => remove.mutate(v.id) },
    ])
  }

  return (
    <View style={{ gap: 8 }}>
      <SectionLabel>Congés scolaires</SectionLabel>
      <Body muted style={{ fontSize: 14 }}>
        Pas de calendrier national aux États-Unis : ajoutez les congés de votre district (Thanksgiving, hiver, printemps,
        été…). Ils suivent la règle de partage des vacances.
      </Body>
      <ErrorBanner message={add.error?.message ?? remove.error?.message} />
      <View style={s.group}>
        {breaks.length === 0 ? <Text style={[s.muted, { padding: 14 }]}>Aucun congé pour l’instant.</Text> : null}
        {[...breaks].sort((a, b) => a.start.localeCompare(b.start)).map((v) => (
          <View key={v.id} style={s.row}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.strong}>{v.label}</Text>
              <Text style={s.muted}>{formatRange(v.start, v.end)}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Supprimer ${v.label}`} hitSlop={8} onPress={() => confirmRemove(v)}>
              <Icon name="close" size={18} color={colors.danger} />
            </Pressable>
          </View>
        ))}
      </View>
      <Field label="Nom du congé" placeholder="ex. Winter break" value={label} onChangeText={setLabel} maxLength={80} />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <DateField
          label="Début"
          value={start}
          onChange={(d) => {
            setStart(d)
            if (d > end) setEnd(d)
          }}
        />
        <DateField label="Fin" value={end} onChange={setEnd} min={start} />
      </View>
      <Button title="Ajouter le congé" variant="secondary" onPress={() => add.mutate()} loading={add.isPending} disabled={!label.trim() || end < start} />
    </View>
  )
}

const s = StyleSheet.create({
  group: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line,
  },
  strong: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  muted: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
})
