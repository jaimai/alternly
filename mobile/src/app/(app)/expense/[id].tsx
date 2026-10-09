// Détail d'une dépense et ses actions. Mêmes droits que le web : le créateur modifie et
// supprime ; l'autre parent (non payeur) conteste ou lève la contestation ; tout le monde
// marque remboursée.
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { Tag } from '@/components/Tag'
import { Body, Button, Card, ErrorBanner, Loading, Screen, Title } from '@/components/ui'
import { api } from '@/lib/api'
import { formatLong } from '@/lib/dates'
import { categoryLabel, formatMoney } from '@/lib/expenses'
import { useExpenseAction, useExpenses, useHousehold, useMe } from '@/lib/queries'
import { colors, fonts, radius } from '@/lib/theme'

export default function ExpenseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const household = useHousehold().data ?? undefined
  const meId = useMe().data?.id
  const { expenses } = useExpenses(household?.id)
  const [disputing, setDisputing] = useState(false)
  const [note, setNote] = useState('')

  const hid = household?.id ?? 0
  const eid = Number(id)
  const settle = useExpenseAction(() => api.settleExpense(hid, eid))
  const unsettle = useExpenseAction(() => api.unsettleExpense(hid, eid))
  const resolve = useExpenseAction(() => api.resolveExpense(hid, eid))
  const dispute = useExpenseAction(() => api.disputeExpense(hid, eid, note.trim()), () => setDisputing(false))
  const remove = useExpenseAction(() => api.deleteExpense(hid, eid), () => router.back())
  const actions = [settle, unsettle, resolve, dispute, remove]
  const busy = actions.some((a) => a.isPending)
  const error = actions.find((a) => a.error)?.error?.message

  if (!household || expenses.isPending) return <Loading />
  const e = expenses.data?.find((x) => x.id === eid)
  // Ouverte depuis une notification : la dépense peut être plus récente que la liste en cache.
  if (!e && expenses.isFetching) return <Loading />
  if (!e) {
    return (
      <Screen edges={['top', 'bottom']}>
        <BackButton />
        <Title>Dépense introuvable</Title>
        <Body muted>Elle a peut-être été supprimée par l’autre parent.</Body>
      </Screen>
    )
  }

  const money = formatMoney(e.amount_cents, household.currency)
  const name = (uid: number) => household.members.find((m) => m.id === uid)?.display_name ?? '?'
  const child = household.children.find((c) => c.id === e.child_id)?.first_name
  const iAmCreator = e.created_by === meId
  const iAmPayer = e.paid_by === meId
  const isSettled = !!e.settled_at
  const payerShare = Math.round((e.amount_cents * e.payer_percent) / 100)

  function confirmDelete() {
    Alert.alert('Supprimer cette dépense ?', `« ${e!.label} » (${money}) sera retirée du solde.`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => remove.mutate() },
    ])
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {e.status === 'disputed' ? <Tag label="Contestée" bg={colors.dangerSoft} fg={colors.danger} /> : null}
          {isSettled ? <Tag label="Remboursée" bg={colors.pineSoft} fg={colors.pine} /> : null}
        </View>
        <Title>{e.label}</Title>
        <Text style={s.amount}>{money}</Text>
      </View>

      <ErrorBanner message={error} />

      <Card>
        <Row label="Date" value={formatLong(e.date)} />
        <Row label="Catégorie" value={categoryLabel(e.category)} />
        <Row label="Enfant" value={child ?? 'Tous'} />
        <Row label="Payé par" value={e.paid_by === meId ? `${name(e.paid_by)} (vous)` : name(e.paid_by)} />
        <Row
          label="Répartition"
          value={`${e.payer_percent} % payeur · ${100 - e.payer_percent} % autre parent`}
          hint={`Part de ${name(e.paid_by)} : ${formatMoney(payerShare, household.currency)}`}
        />
      </Card>

      {e.status === 'disputed' && e.dispute_note ? (
        <Card style={{ backgroundColor: colors.dangerSoft, borderColor: colors.dangerSoft }}>
          <Text style={s.label}>Motif de la contestation</Text>
          <Body>« {e.dispute_note} »</Body>
        </Card>
      ) : null}

      {disputing ? (
        <Card>
          <Text style={s.label}>Contester la dépense</Text>
          <Body muted style={{ fontSize: 14 }}>
            Elle reste visible mais sort du solde. L’autre parent est prévenu et peut la corriger.
          </Body>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="ex. montant différent du ticket, dépense non convenue…"
            placeholderTextColor={colors.inkSoft}
            multiline
            maxLength={2000}
            style={s.input}
            accessibilityLabel="Motif"
          />
          <Button title="Contester" variant="danger" onPress={() => dispute.mutate()} loading={dispute.isPending} />
          <Button title="Annuler" variant="ghost" onPress={() => setDisputing(false)} disabled={busy} />
        </Card>
      ) : (
        <View style={{ gap: 10 }}>
          {!isSettled && e.status === 'active' ? (
            <Button title="Marquer remboursée" onPress={() => settle.mutate()} loading={settle.isPending} disabled={busy} />
          ) : null}
          {isSettled ? (
            <Button title="Annuler le remboursement" variant="secondary" onPress={() => unsettle.mutate()} loading={unsettle.isPending} disabled={busy} />
          ) : null}
          {e.status === 'disputed' && !iAmPayer ? (
            <Button title="Lever la contestation" variant="secondary" onPress={() => resolve.mutate()} loading={resolve.isPending} disabled={busy} />
          ) : null}
          {iAmCreator && !isSettled ? (
            <Button
              title="Modifier"
              variant="secondary"
              onPress={() => router.push({ pathname: '/expense/edit', params: { id: String(e.id) } })}
              disabled={busy}
            />
          ) : null}
          {!isSettled && e.status === 'active' && !iAmPayer ? (
            <Button title="Contester" variant="ghost" onPress={() => setDisputing(true)} disabled={busy} />
          ) : null}
          {iAmCreator ? <Button title="Supprimer" variant="danger" onPress={confirmDelete} loading={remove.isPending} disabled={busy} /> : null}
        </View>
      )}
    </Screen>
  )
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <Text style={[s.label, { width: 96 }]}>{label}</Text>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={s.value}>{value}</Text>
        {hint ? <Text style={s.hint}>{hint}</Text> : null}
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  amount: { fontFamily: fonts.bodyBold, fontSize: 26, color: colors.ink },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.inkSoft },
  value: { fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  hint: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
  input: {
    minHeight: 88,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    padding: 12,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
    backgroundColor: colors.surface,
    textAlignVertical: 'top',
  },
})
