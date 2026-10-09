// Dépenses partagées : solde, dépenses en cours par mois, remboursées, remboursements.
// Mêmes règles que frontend/src/pages/Expenses.tsx ; fonction Premium (402 sinon).
import { router } from 'expo-router'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Icon } from '@/components/Icon'
import { Paywall } from '@/components/Paywall'
import { Tag } from '@/components/Tag'
import { Body, Button, Card, ErrorState, Loading, SectionLabel } from '@/components/ui'
import { formatMonth, formatShort } from '@/lib/dates'
import { balanceLabel, categoryLabel, formatMoney, groupExpenses } from '@/lib/expenses'
import { useExpenses, useHousehold, useMe } from '@/lib/queries'
import { colors, fonts, radius } from '@/lib/theme'
import type { Expense, Household, Settlement } from '@/lib/types'

export default function Expenses() {
  const household = useHousehold().data ?? undefined
  const meId = useMe().data?.id
  const { expenses, settlements, balance, locked } = useExpenses(household?.id)

  const refetch = () => Promise.all([expenses.refetch(), settlements.refetch(), balance.refetch()])
  const refreshing = expenses.isRefetching || balance.isRefetching

  let body
  if (!household || expenses.isPending || balance.isPending) body = <Loading />
  else if (locked) {
    body = (
      <ScrollView contentContainerStyle={s.content}>
        <Paywall
          title="Les dépenses, avec Premium"
          intro="Notez ce que vous avancez pour les enfants : Alternly tient le solde à jour pour vous deux. Un seul abonnement suffit pour les deux parents."
        />
      </ScrollView>
    )
  }
  else if (expenses.isError || balance.isError || settlements.isError) {
    // Sans le solde, « Comptes à jour » serait faux : on le dit plutôt que d'afficher 0.
    const failed = expenses.error ?? balance.error ?? settlements.error
    body = <ErrorState message={failed?.message ?? 'Une erreur est survenue.'} onRetry={refetch} />
  }
  else {
    body = (
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refetch} tintColor={colors.pine} />}
      >
        <Content household={household} meId={meId} expenses={expenses.data} settlements={settlements.data ?? []} balance={balance.data} />
      </ScrollView>
    )
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top']}>
      <View style={s.header}>
        <Text accessibilityRole="header" style={s.title}>Dépenses</Text>
        {!locked && household ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ajouter une dépense"
            onPress={() => router.push('/expense/edit')}
            style={s.add}
          >
            <Icon name="plus" color="#fff" strokeWidth={2.4} />
          </Pressable>
        ) : null}
      </View>
      {body}
    </SafeAreaView>
  )
}

function Content({ household, meId, expenses, settlements, balance }: {
  household: Household
  meId?: number
  expenses: Expense[]
  settlements: Settlement[]
  balance: Parameters<typeof balanceLabel>[0]
}) {
  const money = (c: number) => formatMoney(c, household.currency)
  const name = (id: number) => household.members.find((m) => m.id === id)?.display_name ?? '?'
  const { months, settled } = groupExpenses(expenses)
  const partner = household.members.find((m) => m.id !== meId)
  const owedToMe = balance?.owed_to_me_cents ?? 0
  const iOwe = balance?.i_owe_cents ?? 0

  return (
    <>
      <Card>
        <Text style={s.balance}>{balanceLabel(balance, household.members, meId, household.currency)}</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Stat label="On me doit" value={money(owedToMe)} tone={owedToMe > 0 ? 'credit' : 'zero'} />
          <Stat label="Je dois" value={money(iOwe)} tone={iOwe > 0 ? 'debit' : 'zero'} />
        </View>
        <Body muted style={{ fontSize: 13 }}>Sur les dépenses en cours (hors remboursées et contestées).</Body>
        <Button title="Enregistrer un remboursement" variant="secondary" onPress={() => router.push('/expense/settle')} />
      </Card>

      {partner?.is_placeholder ? (
        <Body muted style={{ fontSize: 14 }}>
          {partner.display_name} n’a pas encore de compte. Vous pouvez déjà lui attribuer des dépenses : elles seront à son
          nom dès qu’il ou elle rejoindra le foyer.
        </Body>
      ) : null}

      {expenses.length === 0 ? (
        <Card style={{ alignItems: 'center' }}>
          <View style={s.emptyIcon}>
            <Icon name="receipt" color={colors.pine} />
          </View>
          <Text style={s.emptyTitle}>Aucune dépense pour l’instant</Text>
          <Body muted style={{ textAlign: 'center' }}>
            Cantine, lunettes, licence de foot… Notez ce que vous avancez pour les enfants : Alternly tient le solde à jour pour
            vous deux.
          </Body>
          <Button title="Ajouter la première dépense" onPress={() => router.push('/expense/edit')} style={{ alignSelf: 'stretch' }} />
        </Card>
      ) : null}

      {months.map(({ month, items }) => (
        <View key={month} style={{ gap: 8 }}>
          <SectionLabel>{capitalize(formatMonth(`${month}-01`))}</SectionLabel>
          <Card style={s.list}>
            {items.map((e, i) => <ExpenseRow key={e.id} e={e} first={i === 0} household={household} name={name} money={money} />)}
          </Card>
        </View>
      ))}

      {settled.length > 0 ? (
        <View style={{ gap: 8 }}>
          <SectionLabel>{`Remboursées (${settled.length})`}</SectionLabel>
          <Card style={s.list}>
            {settled.map((e, i) => <ExpenseRow key={e.id} e={e} first={i === 0} household={household} name={name} money={money} />)}
          </Card>
        </View>
      ) : null}

      {settlements.length > 0 ? (
        <View style={{ gap: 8 }}>
          <SectionLabel>Remboursements</SectionLabel>
          <Card style={s.list}>
            {settlements.map((st, i) => (
              <Pressable
                key={st.id}
                accessibilityRole="button"
                onPress={() => router.push({ pathname: '/expense/settle', params: { id: String(st.id) } })}
                style={[s.row, i > 0 && s.rowBorder]}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.rowTitle}>{`${name(st.from_user)} → ${name(st.to_user)}`}</Text>
                  <Text style={s.rowHint}>{[formatShort(st.date), st.note].filter(Boolean).join(' · ')}</Text>
                </View>
                <Text style={s.amount}>{money(st.amount_cents)}</Text>
              </Pressable>
            ))}
          </Card>
        </View>
      ) : null}
    </>
  )
}

function ExpenseRow({ e, first, household, name, money }: {
  e: Expense
  first: boolean
  household: Household
  name: (id: number) => string
  money: (c: number) => string
}) {
  const child = household.children.find((c) => c.id === e.child_id)?.first_name
  const color = household.members.find((m) => m.id === e.paid_by)?.color ?? colors.line
  const hint = [
    formatShort(e.date),
    categoryLabel(e.category),
    child,
    `payé par ${name(e.paid_by)}`,
    e.payer_percent !== 50 ? `partage ${e.payer_percent}/${100 - e.payer_percent}` : null,
  ].filter(Boolean).join(' · ')
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/expense/[id]', params: { id: String(e.id) } })}
      style={({ pressed }) => [s.row, !first && s.rowBorder, pressed && { backgroundColor: colors.paperDeep }]}
    >
      <View style={[s.payer, { backgroundColor: color }]} />
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Text style={[s.rowTitle, e.settled_at ? { color: colors.inkSoft } : null]} numberOfLines={1}>{e.label}</Text>
          {e.status === 'disputed' ? <Tag label="Contestée" bg={colors.dangerSoft} fg={colors.danger} /> : null}
          {e.settled_at ? <Tag label="Remboursée" bg={colors.pineSoft} fg={colors.pine} /> : null}
        </View>
        <Text style={s.rowHint} numberOfLines={2}>{hint}</Text>
      </View>
      <Text style={[s.amount, e.settled_at ? { color: colors.inkSoft } : null]}>{money(e.amount_cents)}</Text>
    </Pressable>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone: 'credit' | 'debit' | 'zero' }) {
  const fg = tone === 'credit' ? colors.pine : tone === 'debit' ? colors.danger : colors.inkSoft
  const bg = tone === 'credit' ? colors.pineSoft : tone === 'debit' ? colors.dangerSoft : colors.paperDeep
  return (
    <View style={{ flex: 1, backgroundColor: bg, borderRadius: radius.md, padding: 12, gap: 2 }}>
      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12, color: fg }}>{label}</Text>
      <Text style={{ fontFamily: fonts.bodyBold, fontSize: 18, color: fg }}>{value}</Text>
    </View>
  )
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const s = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12 },
  title: { flex: 1, fontFamily: fonts.display, fontSize: 30, color: colors.ink },
  add: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.pine, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 20, paddingTop: 4, gap: 16 },
  balance: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.ink },
  list: { padding: 0, gap: 0, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  rowTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink, flexShrink: 1 },
  rowHint: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
  amount: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.ink },
  payer: { width: 8, height: 8, borderRadius: 4 },
  emptyIcon: { width: 52, height: 52, borderRadius: 16, backgroundColor: colors.pineSoft, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: fonts.display, fontSize: 22, color: colors.ink },
})
