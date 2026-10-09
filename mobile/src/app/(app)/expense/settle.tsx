// Enregistrer un remboursement (pré-rempli avec le solde), ou en consulter un (?id=…)
// pour le supprimer si on en est l'auteur.
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, View } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { Chips, DateField } from '@/components/form'
import { Body, Button, Card, ErrorBanner, Field, Loading, Screen, Title } from '@/components/ui'
import { api } from '@/lib/api'
import { formatLong, todayIso } from '@/lib/dates'
import { amountInput, formatMoney, parseAmount } from '@/lib/expenses'
import { useExpenseAction, useExpenses, useHousehold, useMe } from '@/lib/queries'
import type { Balance, Household, Settlement } from '@/lib/types'

export default function Settle() {
  const { id } = useLocalSearchParams<{ id?: string }>()
  const household = useHousehold().data ?? undefined
  const meId = useMe().data?.id
  const { settlements, balance } = useExpenses(household?.id)

  if (!household || meId === undefined || settlements.isPending || balance.isPending) return <Loading />
  if (id) {
    const existing = settlements.data?.find((x) => x.id === Number(id))
    return <Existing household={household} meId={meId} settlement={existing} />
  }
  return <NewSettlement household={household} meId={meId} balance={balance.data} />
}

function NewSettlement({ household, meId, balance }: { household: Household; meId: number; balance?: Balance }) {
  const { t } = useTranslation()
  const owed = balance && balance.amount_cents > 0 && balance.debtor_id && balance.creditor_id ? balance : undefined
  const other = household.members.find((m) => m.id !== meId)?.id ?? meId
  const [from, setFrom] = useState(owed?.debtor_id ?? meId)
  const [amount, setAmount] = useState(owed ? amountInput(owed.amount_cents) : '')
  const [date, setDate] = useState(todayIso())
  const [note, setNote] = useState('')
  const to = household.members.find((m) => m.id !== from)?.id ?? other
  const cents = parseAmount(amount)
  const symbol = household.currency === 'USD' ? '$' : '€'

  const save = useExpenseAction(
    () => api.createSettlement(household.id, { from_user: from, to_user: to, amount_cents: cents ?? 0, date, note: note.trim() }),
    () => router.back(),
  )
  const name = (uid: number) => household.members.find((m) => m.id === uid)?.display_name ?? '?'

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <View style={{ gap: 6 }}>
        <Title>{t('expenses.settle.title')}</Title>
        <Body muted>{t('expenses.settle.intro')}</Body>
      </View>

      <ErrorBanner message={save.error?.message} />

      <Chips
        label={t('expenses.settle.who')}
        options={household.members.map((m) => ({ value: m.id, label: m.id === meId ? t('common.youSuffix', { name: m.display_name }) : m.display_name, dot: m.color }))}
        value={from}
        onChange={setFrom}
      />
      <Body muted style={{ fontSize: 14 }}>{`${name(from)} → ${name(to)}`}</Body>

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Field label={t('expenses.fields.amount', { symbol })} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder={t('expenses.fields.amountPlaceholder')} />
        </View>
        <DateField label={t('expenses.fields.date')} value={date} onChange={setDate} />
      </View>
      <Field label={t('expenses.settle.note')} value={note} onChangeText={setNote} placeholder={t('expenses.settle.notePlaceholder')} maxLength={2000} />

      <Button title={t('common.save')} onPress={() => save.mutate()} loading={save.isPending} disabled={!cents || from === to} />
    </Screen>
  )
}

function Existing({ household, meId, settlement }: { household: Household; meId: number; settlement?: Settlement }) {
  const { t } = useTranslation()
  const remove = useExpenseAction(() => api.deleteSettlement(household.id, settlement!.id), () => router.back())
  if (!settlement) {
    return (
      <Screen edges={['top', 'bottom']}>
        <BackButton />
        <Title>{t('expenses.settle.notFound')}</Title>
      </Screen>
    )
  }
  const name = (uid: number) => household.members.find((m) => m.id === uid)?.display_name ?? '?'

  function confirmDelete() {
    Alert.alert(t('expenses.settle.deleteTitle'), t('expenses.settle.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => remove.mutate() },
    ])
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <Title>{t('expenses.settle.title')}</Title>
      <ErrorBanner message={remove.error?.message} />
      <Card>
        <Body style={{ fontSize: 18 }}>{`${name(settlement.from_user)} → ${name(settlement.to_user)}`}</Body>
        <Body>{formatMoney(settlement.amount_cents, household.currency)}</Body>
        <Body muted>{formatLong(settlement.date)}</Body>
        {settlement.note ? <Body muted>{settlement.note}</Body> : null}
      </Card>
      {settlement.created_by === meId ? (
        <Button title={t('common.delete')} variant="danger" onPress={confirmDelete} loading={remove.isPending} />
      ) : (
        <Body muted style={{ fontSize: 14 }}>{t('expenses.settle.onlyAuthor')}</Body>
      )}
    </Screen>
  )
}
