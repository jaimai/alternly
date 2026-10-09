// Ajouter une dépense, ou la modifier (?id=…). Mêmes champs que le formulaire du web.
import { router, useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pressable, Text, View } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { Chips, DateField } from '@/components/form'
import { Body, Button, ErrorBanner, Field, Loading, Screen, Title } from '@/components/ui'
import { api } from '@/lib/api'
import { todayIso } from '@/lib/dates'
import { amountInput, categories, parseAmount, sharePresets } from '@/lib/expenses'
import { useExpenseAction, useExpenses, useHousehold, useMe } from '@/lib/queries'
import { colors, fonts } from '@/lib/theme'
import type { Expense, ExpenseCategory, Household } from '@/lib/types'

export default function EditExpense() {
  const { t } = useTranslation()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const household = useHousehold().data ?? undefined
  const meId = useMe().data?.id
  const { expenses } = useExpenses(household?.id)

  if (!household || meId === undefined || (id && expenses.isPending)) return <Loading />
  const initial = id ? expenses.data?.find((e) => e.id === Number(id)) : undefined
  if (id && !initial) {
    // Jamais de repli sur « Nouvelle dépense » : enregistrer créerait un doublon.
    return (
      <Screen edges={['top', 'bottom']}>
        <BackButton />
        <Title>{t('expenses.detail.notFoundTitle')}</Title>
        <Body muted>{t('expenses.detail.notFoundBody')}</Body>
      </Screen>
    )
  }
  return <Form key={id ?? 'new'} household={household} meId={meId} initial={initial} />
}

function Form({ household, meId, initial }: { household: Household; meId: number; initial?: Expense }) {
  const { t } = useTranslation()
  const [amount, setAmount] = useState(initial ? amountInput(initial.amount_cents) : '')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [date, setDate] = useState(initial?.date ?? todayIso())
  const [category, setCategory] = useState<ExpenseCategory>(initial?.category ?? 'autre')
  const [childId, setChildId] = useState<number>(initial?.child_id ?? 0) // 0 = tous les enfants
  const [paidBy, setPaidBy] = useState(initial?.paid_by ?? meId)
  const [payerPercent, setPayerPercent] = useState(initial?.payer_percent ?? 50)
  const [custom, setCustom] = useState(![0, 50, 100].includes(initial?.payer_percent ?? 50))

  const cents = parseAmount(amount)
  const other = household.members.find((m) => m.id !== meId)
  const presets = sharePresets(paidBy === meId, other?.display_name ?? t('common.otherParent'))
  const symbol = household.currency === 'USD' ? '$' : '€'

  const save = useExpenseAction(
    () => {
      const data = {
        label: label.trim(),
        amount_cents: cents ?? 0,
        date,
        category,
        child_id: childId === 0 ? null : childId,
        paid_by: paidBy,
        payer_percent: payerPercent,
      }
      return initial ? api.updateExpense(household.id, initial.id, data) : api.createExpense(household.id, data)
    },
    () => router.back(),
  )

  function changePayer(id: number) {
    // « À ma charge » / « à la charge de l'autre » gardent leur sens si le payeur change.
    if (id !== paidBy && !custom && payerPercent !== 50) setPayerPercent(100 - payerPercent)
    setPaidBy(id)
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <Title>{initial ? t('expenses.form.titleEdit') : t('expenses.form.titleNew')}</Title>

      <ErrorBanner message={save.error?.message} />

      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Field label={t('expenses.fields.amount', { symbol })} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder={t('expenses.fields.amountPlaceholder')} />
        </View>
        <DateField label={t('expenses.fields.date')} value={date} onChange={setDate} />
      </View>
      <Field label={t('expenses.form.label')} value={label} onChangeText={setLabel} placeholder={t('expenses.form.labelPlaceholder')} maxLength={120} />

      <Chips label={t('expenses.fields.category')} options={categories()} value={category} onChange={setCategory} />

      {household.children.length > 0 ? (
        <Chips
          label={t('expenses.fields.child')}
          options={[{ value: 0, label: t('common.everyone') }, ...household.children.map((c) => ({ value: c.id, label: c.first_name }))]}
          value={childId}
          onChange={setChildId}
        />
      ) : null}

      <Chips
        label={t('expenses.fields.paidBy')}
        options={household.members.map((m) => ({ value: m.id, label: m.id === meId ? t('common.youSuffix', { name: m.display_name }) : m.display_name, dot: m.color }))}
        value={paidBy}
        onChange={changePayer}
      />

      <View style={{ gap: 8 }}>
        <Chips
          label={t('expenses.fields.split')}
          options={[...presets, { value: -1, label: t('expenses.form.splitOther') }]}
          value={custom ? -1 : payerPercent}
          onChange={(v) => {
            if (v === -1) return setCustom(true)
            setCustom(false)
            setPayerPercent(v)
          }}
        />
        {custom ? <Stepper value={payerPercent} onChange={setPayerPercent} /> : null}
        <Body muted style={{ fontSize: 13 }}>{t('expenses.form.splitSummary', { payer: payerPercent, other: 100 - payerPercent })}</Body>
      </View>

      {initial?.status === 'disputed' ? (
        <Body muted style={{ fontSize: 13 }}>{t('expenses.form.disputeStillOpen')}</Body>
      ) : null}

      <Button
        title={initial ? t('common.save') : t('common.add')}
        onPress={() => save.mutate()}
        loading={save.isPending}
        disabled={!cents || !label.trim()}
      />
    </Screen>
  )
}

/** Part du payeur, par pas de 5 %. */
function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const { t } = useTranslation()
  const step = (d: number) => onChange(Math.min(100, Math.max(0, value + d)))
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }} accessibilityLabel={t('expenses.form.payerShare', { value })}>
      <StepButton label="−" a11y={t('expenses.form.decrease')} onPress={() => step(-5)} disabled={value <= 0} />
      <Text style={{ flex: 1, textAlign: 'center', fontFamily: fonts.bodyBold, fontSize: 18, color: colors.ink }}>{t('expenses.form.percent', { value })}</Text>
      <StepButton label="+" a11y={t('expenses.form.increase')} onPress={() => step(5)} disabled={value >= 100} />
    </View>
  )
}

function StepButton({ label, a11y, onPress, disabled }: { label: string; a11y: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled }}
      onPress={disabled ? undefined : onPress}
      style={{
        width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
        backgroundColor: colors.pineSoft, opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text style={{ fontFamily: fonts.bodyBold, fontSize: 22, color: colors.pine }}>{label}</Text>
    </Pressable>
  )
}
