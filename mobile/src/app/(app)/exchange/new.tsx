// Proposer un échange (ou contre-proposer). Mêmes règles que
// frontend/src/components/ExceptionDialog.tsx : foyer solo → appliqué directement ;
// contre-proposition → la proposition initiale n'est refusée qu'après l'envoi de la nouvelle.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
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
  const otherName = other && !other.is_placeholder ? other.display_name : t('common.otherParent')
  const label = (id: number) => {
    const m = memberById(members, id)
    if (!m) return '?'
    if (m.id === meId) return t('calendar.exchangeNew.me')
    return m.is_placeholder ? t('common.otherParentTitle') : m.display_name
  }

  const send = useMutation({
    mutationFn: async () => {
      if (dateEnd < dateStart) throw new Error(t('calendar.exchangeNew.endBeforeStart'))
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
              ? t('calendar.exchangeNew.doneSolo', { range: formatRange(dateStart, dateEnd) })
              : t('calendar.exchangeNew.doneSent', { name: otherName, range: formatRange(dateStart, dateEnd) })}
          </Body>
        </Card>
        <Button title={t('calendar.exchangeNew.backToCalendar')} onPress={() => router.back()} />
      </Screen>
    )
  }

  const title = solo
    ? t('calendar.exchangeNew.titleSolo')
    : replaces
      ? t('calendar.exchangeNew.titleCounter')
      : t('calendar.exchangeNew.titlePropose')

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <Title>{title}</Title>
      {replaces ? (
        <Card style={{ backgroundColor: '#fdf3ee', borderColor: '#e8c4b2' }}>
          <Body style={{ fontSize: 14 }}>
            {t('calendar.exchangeNew.counterHint', { range: formatRange(replaces.date_start, replaces.date_end) })}
          </Body>
        </Card>
      ) : null}

      <ErrorBanner message={send.error?.message} />

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <DateField
          label={t('calendar.exchangeNew.from')}
          value={dateStart}
          min={today}
          onChange={(d) => {
            setDateStart(d)
            if (dateEnd < d) setDateEnd(d)
          }}
        />
        <DateField label={t('calendar.exchangeNew.to')} value={dateEnd} min={dateStart} onChange={setDateEnd} />
      </View>

      <Segmented
        label={t('calendar.exchangeNew.kidsWith')}
        value={parentId}
        onChange={setParentId}
        options={members.map((m) => ({ value: m.id, label: label(m.id), dot: m.color }))}
      />

      <View style={{ gap: 8 }}>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.inkSoft }}>{t('calendar.exchangeNew.note')}</Text>
        <TextInput
          accessibilityLabel={t('calendar.exchangeNew.note')}
          value={note}
          onChangeText={setNote}
          placeholder={t('calendar.exchangeNew.notePlaceholder')}
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
          ? t('calendar.exchangeNew.soloHint')
          : t('calendar.exchangeNew.receivesHint', { name: `${otherName.charAt(0).toUpperCase()}${otherName.slice(1)}` })}
      </Body>
      <Button
        title={solo ? t('common.save') : replaces ? t('calendar.exchangeNew.sendCounter') : t('calendar.exchangeNew.send')}
        onPress={() => send.mutate()}
        loading={send.isPending}
      />
    </Screen>
  )
}
