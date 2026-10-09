// Nouveau post du tableau : info, tâche (échéance, pour qui) ou question.
import { router } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { Chips, DateField } from '@/components/form'
import { Button, ErrorBanner, Loading, Screen, Title } from '@/components/ui'
import { api } from '@/lib/api'
import { todayIso } from '@/lib/dates'
import { useHousehold, useMe, useWallAction } from '@/lib/queries'
import { colors, fonts, radius } from '@/lib/theme'
import type { WallKind } from '@/lib/types'
import { KIND_LABEL } from '@/lib/wall'

const PLACEHOLDER: Record<WallKind, string> = {
  message: 'Une info à partager…',
  task: 'Ce qu’il y a à faire…',
  question: 'Votre question à l’autre parent…',
}

export default function NewPost() {
  const household = useHousehold().data ?? undefined
  const meId = useMe().data?.id
  const [kind, setKind] = useState<WallKind>('message')
  const [body, setBody] = useState('')
  const [childId, setChildId] = useState(0) // 0 = aucun enfant en particulier
  const [hasDue, setHasDue] = useState(false)
  const [dueDate, setDueDate] = useState(todayIso(1))
  const [assignedTo, setAssignedTo] = useState(0) // 0 = l'un ou l'autre

  const publish = useWallAction(
    () =>
      api.createPost(household!.id, {
        kind,
        body: body.trim(),
        child_id: childId || null,
        due_date: kind === 'task' && hasDue ? dueDate : null,
        assigned_to: kind === 'task' && assignedTo ? assignedTo : null,
      }),
    () => router.back(),
  )

  if (!household) return <Loading />

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <Title>Nouveau post</Title>
      <ErrorBanner message={publish.error?.message} />

      <Chips
        label="Type"
        options={(['message', 'task', 'question'] as const).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
        value={kind}
        onChange={setKind}
      />
      <TextInput
        value={body}
        onChangeText={setBody}
        placeholder={PLACEHOLDER[kind]}
        placeholderTextColor={colors.inkSoft}
        multiline
        autoFocus
        maxLength={2000}
        accessibilityLabel="Message"
        style={s.input}
      />

      {household.children.length > 0 ? (
        <Chips
          label="Enfant concerné"
          options={[{ value: 0, label: 'Aucun' }, ...household.children.map((c) => ({ value: c.id, label: c.first_name }))]}
          value={childId}
          onChange={setChildId}
        />
      ) : null}

      {kind === 'task' ? (
        <>
          <Chips
            label="Pour"
            options={[
              { value: 0, label: 'L’un ou l’autre' },
              ...household.members.map((m) => ({ value: m.id, label: m.id === meId ? `${m.display_name} (vous)` : m.display_name, dot: m.color })),
            ]}
            value={assignedTo}
            onChange={setAssignedTo}
          />
          <Chips
            label="Échéance"
            options={[{ value: 0, label: 'Aucune' }, { value: 1, label: 'Choisir une date' }]}
            value={hasDue ? 1 : 0}
            onChange={(v) => setHasDue(v === 1)}
          />
          {hasDue ? (
            <View style={{ flexDirection: 'row' }}>
              <DateField label="Date" value={dueDate} onChange={setDueDate} min={todayIso()} />
            </View>
          ) : null}
        </>
      ) : null}

      <Button title="Publier" onPress={() => publish.mutate()} loading={publish.isPending} disabled={!body.trim()} />
    </Screen>
  )
}

const s = StyleSheet.create({
  input: {
    minHeight: 110, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12,
    fontFamily: fonts.body, fontSize: 16, color: colors.ink, backgroundColor: colors.surface, textAlignVertical: 'top',
  },
})
