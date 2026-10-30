// Nouvelle note du journal de garde, ou modification (?id=…). Mêmes champs que le web.
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Alert, StyleSheet, TextInput, View } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { Chips, DateField } from '@/components/form'
import { Body, Button, ErrorBanner, Field, Loading, Screen, Title } from '@/components/ui'
import { api } from '@/lib/api'
import { todayIso } from '@/lib/dates'
import { JOURNAL_KINDS, JOURNAL_LABEL } from '@/lib/journal'
import { useHousehold, useJournal, useJournalAction } from '@/lib/queries'
import { colors, fonts, radius } from '@/lib/theme'
import type { Household, JournalEntry, JournalKind } from '@/lib/types'

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export default function EditJournalEntry() {
  const { id } = useLocalSearchParams<{ id?: string }>()
  const household = useHousehold().data ?? undefined
  const { journal } = useJournal(household?.id)

  if (!household || (id && journal.isPending)) return <Loading />
  const initial = id ? journal.data?.find((e) => e.id === Number(id)) : undefined
  if (id && !initial) {
    return (
      <Screen edges={['top', 'bottom']}>
        <BackButton />
        <Title>Note introuvable</Title>
        <Body muted>Elle a peut-être été supprimée depuis un autre appareil.</Body>
      </Screen>
    )
  }
  return <Form key={id ?? 'new'} household={household} initial={initial} />
}

function Form({ household, initial }: { household: Household; initial?: JournalEntry }) {
  const [kind, setKind] = useState<JournalKind>(initial?.kind ?? 'handover')
  const [day, setDay] = useState(initial?.day ?? todayIso())
  const [time, setTime] = useState(initial?.time ?? '')
  const [childId, setChildId] = useState(initial?.child_id ?? 0) // 0 = tous / non précisé
  const [body, setBody] = useState(initial?.body ?? '')
  const timeError = time && !TIME.test(time) ? 'Format attendu : 18:30' : null

  const save = useJournalAction(
    () => {
      const data = { day, time: time || null, kind, child_id: childId || null, body: body.trim() }
      return initial ? api.updateJournalEntry(household.id, initial.id, data) : api.createJournalEntry(household.id, data)
    },
    () => router.back(),
  )
  const remove = useJournalAction(() => api.deleteJournalEntry(household.id, initial!.id), () => router.back())

  function confirmDelete() {
    Alert.alert('Supprimer cette note ?', 'Elle disparaîtra de votre journal et des prochains exports.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => remove.mutate() },
    ])
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <Title>{initial ? 'Modifier la note' : 'Nouvelle note'}</Title>
      <ErrorBanner message={save.error?.message ?? remove.error?.message} />

      <Chips
        label="Type"
        options={JOURNAL_KINDS.map((k) => ({ value: k, label: JOURNAL_LABEL[k] }))}
        value={kind}
        onChange={setKind}
      />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <DateField label="Jour" value={day} onChange={setDay} />
        <View style={{ flex: 1 }}>
          <Field
            label="Heure (facultatif)"
            value={time}
            onChangeText={setTime}
            placeholder="18:30"
            keyboardType="numbers-and-punctuation"
            maxLength={5}
            error={timeError}
          />
        </View>
      </View>
      {household.children.length > 0 ? (
        <Chips
          label="Enfant"
          options={[{ value: 0, label: 'Tous / non précisé' }, ...household.children.map((c) => ({ value: c.id, label: c.first_name }))]}
          value={childId}
          onChange={setChildId}
        />
      ) : null}
      <TextInput
        value={body}
        onChangeText={setBody}
        placeholder="Ex. : passage prévu à 18h, enfants récupérés à 18h40, sans message préalable."
        placeholderTextColor={colors.inkSoft}
        multiline
        autoFocus={!initial}
        maxLength={2000}
        accessibilityLabel="Ce qui s’est passé"
        style={s.input}
      />
      <Body muted style={{ fontSize: 13 }}>
        Restez factuel (qui, quoi, quand) : un journal neutre est plus utile et plus crédible.
      </Body>

      <Button
        title="Enregistrer"
        onPress={() => save.mutate()}
        loading={save.isPending}
        disabled={!body.trim() || Boolean(timeError) || day > todayIso()}
      />
      {initial ? <Button title="Supprimer" variant="danger" onPress={confirmDelete} loading={remove.isPending} /> : null}
    </Screen>
  )
}

const s = StyleSheet.create({
  input: {
    minHeight: 120, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12,
    fontFamily: fonts.body, fontSize: 16, color: colors.ink, backgroundColor: colors.surface, textAlignVertical: 'top',
  },
})
