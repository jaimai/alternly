// Proposer un échange (ou contre-proposer). Mêmes règles que
// frontend/src/components/ExceptionDialog.tsx : foyer solo → appliqué directement ;
// contre-proposition → la proposition initiale n'est refusée qu'après l'envoi de la nouvelle.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Text, TextInput, View } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { DateField, Segmented } from '@/components/form'
import { Icon } from '@/components/Icon'
import { Body, Button, Card, ErrorBanner, Loading, Screen, Title } from '@/components/ui'
import { api } from '@/lib/api'
import { isSolo, memberById } from '@/lib/custody'
import { formatRange, todayIso } from '@/lib/dates'
import { keys, useHousehold, useMe, useUpcoming } from '@/lib/queries'
import { colors, fonts } from '@/lib/theme'
import type { Member, PendingExchange } from '@/lib/types'

export default function ProposeExchange() {
  const params = useLocalSearchParams<{ date?: string; replaces?: string }>()
  const qc = useQueryClient()
  const meId = useMe().data?.id
  const household = useHousehold().data ?? undefined
  const { calendar } = useUpcoming()

  if (!household || calendar.isPending) return <Loading />
  return (
    <Form
      key={params.replaces ?? params.date ?? 'new'}
      householdId={household.id}
      members={household.members}
      meId={meId}
      initialDate={params.date ?? todayIso()}
      replaces={calendar.data?.pending_exchanges.find((e) => String(e.id) === params.replaces)}
      currentParentOn={(d) => calendar.data?.days.find((x) => x.date === d)?.parent_id}
      onDone={() => {
        qc.invalidateQueries({ queryKey: ['calendar'] })
        qc.invalidateQueries({ queryKey: keys.notifications })
      }}
    />
  )
}

function Form({ householdId, members, meId, initialDate, replaces, currentParentOn, onDone }: {
  householdId: number
  members: Member[]
  meId?: number
  initialDate: string
  replaces?: PendingExchange
  currentParentOn: (date: string) => number | undefined
  onDone: () => void
}) {
  const solo = isSolo(members)
  const today = todayIso()
  // Par défaut, l'échange part vers le parent qui n'a pas les enfants ce jour-là.
  const otherThan = (id?: number) => members.find((m) => m.id !== id)?.id ?? members[0]?.id ?? 0
  const [dateStart, setDateStart] = useState(replaces?.date_start ?? initialDate)
  const [dateEnd, setDateEnd] = useState(replaces?.date_end ?? initialDate)
  const [parentId, setParentId] = useState<number>(
    replaces ? otherThan(replaces.proposed_parent_id) : otherThan(currentParentOn(initialDate)),
  )
  const [note, setNote] = useState('')
  const other = members.find((m) => m.id !== meId)
  const otherName = other && !other.is_placeholder ? other.display_name : 'l’autre parent'
  const label = (id: number) => {
    const m = memberById(members, id)
    if (!m) return '?'
    if (m.id === meId) return 'Moi'
    return m.is_placeholder ? 'L’autre parent' : m.display_name
  }

  const send = useMutation({
    mutationFn: async () => {
      if (dateEnd < dateStart) throw new Error('La date de fin doit être égale ou postérieure à la date de début.')
      const created = await api.createException(householdId, {
        date_start: dateStart,
        date_end: dateEnd,
        parent_id: parentId,
        note: note.trim(),
        ...(replaces ? { replaces_id: replaces.id } : {}),
      })
      if (replaces) await api.refuseExchange(householdId, replaces.id)
      return created
    },
    onSuccess: onDone,
  })

  if (send.isSuccess) {
    return (
      <Screen edges={['top', 'bottom']}>
        <Card style={{ backgroundColor: colors.pineSoft, borderColor: colors.pineSoft, flexDirection: 'row', gap: 12 }}>
          <Icon name="check" color={colors.pine} strokeWidth={2.4} />
          <Body style={{ flex: 1 }}>
            {solo
              ? `Échange enregistré (${formatRange(dateStart, dateEnd)}) : le calendrier est à jour.`
              : `Proposition envoyée à ${otherName} (${formatRange(dateStart, dateEnd)}). Rien ne change tant qu’elle n’est pas acceptée.`}
          </Body>
        </Card>
        <Button title="Retour au calendrier" onPress={() => router.back()} />
      </Screen>
    )
  }

  const title = solo ? 'Échange ponctuel' : replaces ? 'Contre-proposition' : 'Proposer un échange'

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <Title>{title}</Title>
      {replaces ? (
        <Card style={{ backgroundColor: '#fdf3ee', borderColor: '#e8c4b2' }}>
          <Body style={{ fontSize: 14 }}>
            Ajustez les dates ci-dessous. La proposition initiale ({formatRange(replaces.date_start, replaces.date_end)}) sera
            refusée à l’envoi de la vôtre.
          </Body>
        </Card>
      ) : null}

      <ErrorBanner message={send.error?.message} />

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <DateField
          label="Du"
          value={dateStart}
          min={today}
          onChange={(d) => {
            setDateStart(d)
            if (dateEnd < d) setDateEnd(d)
          }}
        />
        <DateField label="Au (inclus)" value={dateEnd} min={dateStart} onChange={setDateEnd} />
      </View>

      <Segmented
        label="Les enfants seront chez"
        value={parentId}
        onChange={setParentId}
        options={members.map((m) => ({ value: m.id, label: label(m.id), dot: m.color }))}
      />

      <View style={{ gap: 8 }}>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.inkSoft }}>Note (facultatif)</Text>
        <TextInput
          accessibilityLabel="Note (facultatif)"
          value={note}
          onChangeText={setNote}
          placeholder="ex. anniversaire de mamie"
          placeholderTextColor={colors.inkSoft}
          multiline
          maxLength={500}
          style={{
            minHeight: 88, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface,
            padding: 14, fontFamily: fonts.body, fontSize: 15, color: colors.ink, textAlignVertical: 'top',
          }}
        />
      </View>

      <Body muted style={{ fontSize: 13, textAlign: 'center' }}>
        {solo
          ? 'L’échange est appliqué directement.'
          : `${otherName.charAt(0).toUpperCase()}${otherName.slice(1)} reçoit la proposition et peut l’accepter ou la refuser.`}
      </Body>
      <Button
        title={solo ? 'Enregistrer' : replaces ? 'Envoyer la contre-proposition' : 'Envoyer la proposition'}
        onPress={() => send.mutate()}
        loading={send.isPending}
      />
    </Screen>
  )
}
