// Détail d'une dépense et ses actions. Mêmes droits que le web : le créateur modifie et
// supprime ; l'autre parent (non payeur) conteste ou lève la contestation ; tout le monde
// marque remboursée.
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
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
        <Title>{t('expenses.detail.notFoundTitle')}</Title>
        <Body muted>{t('expenses.detail.notFoundBody')}</Body>
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
    Alert.alert(t('expenses.detail.deleteTitle'), t('expenses.detail.deleteBody', { label: e!.label, amount: money }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => remove.mutate() },
    ])
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {e.status === 'disputed' ? <Tag label={t('expenses.status.disputed')} bg={colors.dangerSoft} fg={colors.danger} /> : null}
          {isSettled ? <Tag label={t('expenses.status.settled')} bg={colors.pineSoft} fg={colors.pine} /> : null}
        </View>
        <Title>{e.label}</Title>
        <Text style={s.amount}>{money}</Text>
      </View>

      <ErrorBanner message={error} />

      <Card>
        <Row label={t('expenses.fields.date')} value={formatLong(e.date)} />
        <Row label={t('expenses.fields.category')} value={categoryLabel(e.category)} />
        <Row label={t('expenses.fields.child')} value={child ?? t('common.everyone')} />
        <Row label={t('expenses.fields.paidBy')} value={e.paid_by === meId ? t('common.youSuffix', { name: name(e.paid_by) }) : name(e.paid_by)} />
        <Row
          label={t('expenses.fields.split')}
          value={t('expenses.detail.splitValue', { payer: e.payer_percent, other: 100 - e.payer_percent })}
          hint={t('expenses.detail.payerShare', { name: name(e.paid_by), amount: formatMoney(payerShare, household.currency) })}
        />
      </Card>

      {e.status === 'disputed' && e.dispute_note ? (
        <Card style={{ backgroundColor: colors.dangerSoft, borderColor: colors.dangerSoft }}>
          <Text style={s.label}>{t('expenses.detail.disputeReason')}</Text>
          <Body>{t('expenses.detail.quoted', { text: e.dispute_note })}</Body>
        </Card>
      ) : null}

      {disputing ? (
        <Card>
          <Text style={s.label}>{t('expenses.detail.disputeTitle')}</Text>
          <Body muted style={{ fontSize: 14 }}>{t('expenses.detail.disputeBody')}</Body>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder={t('expenses.detail.disputePlaceholder')}
            placeholderTextColor={colors.inkSoft}
            multiline
            maxLength={2000}
            style={s.input}
            accessibilityLabel={t('expenses.detail.disputeReasonLabel')}
          />
          <Button title={t('expenses.detail.dispute')} variant="danger" onPress={() => dispute.mutate()} loading={dispute.isPending} />
          <Button title={t('common.cancel')} variant="ghost" onPress={() => setDisputing(false)} disabled={busy} />
        </Card>
      ) : (
        <View style={{ gap: 10 }}>
          {!isSettled && e.status === 'active' ? (
            <Button title={t('expenses.detail.markSettled')} onPress={() => settle.mutate()} loading={settle.isPending} disabled={busy} />
          ) : null}
          {isSettled ? (
            <Button title={t('expenses.detail.unsettle')} variant="secondary" onPress={() => unsettle.mutate()} loading={unsettle.isPending} disabled={busy} />
          ) : null}
          {e.status === 'disputed' && !iAmPayer ? (
            <Button title={t('expenses.detail.resolve')} variant="secondary" onPress={() => resolve.mutate()} loading={resolve.isPending} disabled={busy} />
          ) : null}
          {iAmCreator && !isSettled ? (
            <Button
              title={t('expenses.detail.edit')}
              variant="secondary"
              onPress={() => router.push({ pathname: '/expense/edit', params: { id: String(e.id) } })}
              disabled={busy}
            />
          ) : null}
          {!isSettled && e.status === 'active' && !iAmPayer ? (
            <Button title={t('expenses.detail.dispute')} variant="ghost" onPress={() => setDisputing(true)} disabled={busy} />
          ) : null}
          {iAmCreator ? <Button title={t('common.delete')} variant="danger" onPress={confirmDelete} loading={remove.isPending} disabled={busy} /> : null}
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
