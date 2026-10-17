// Dépenses partagées : catégories, montants, solde (mêmes règles que frontend/src/pages/Expenses.tsx).
// Le solde est calculé par le backend (/balance) ; ici, seulement la mise en forme.
import type { Balance, Expense, ExpenseCategory, Member } from './types'
import { intlLocale, t } from './i18n'

const CATEGORY_VALUES: ExpenseCategory[] = ['sante', 'ecole', 'activites', 'vetements', 'cantine', 'autre']

/** Catégories avec leur libellé dans la langue courante. */
export function categories(): { value: ExpenseCategory; label: string }[] {
  return CATEGORY_VALUES.map((value) => ({ value, label: t(`expenses.categories.${value}`) }))
}

export function categoryLabel(value: string): string {
  return categories().find((c) => c.value === value)?.label ?? t('expenses.categories.autre')
}

/**
 * « 24,50 » / « 24.50 » / « 1 200 » → centimes. Vide, zéro ou format ambigu (« 1,200.50 »,
 * « 12abc ») → null : mieux vaut refuser que d'enregistrer un montant faux.
 */
export function parseAmount(input: string): number | null {
  const compact = input.replace(/[\s  ]/g, '')
  if (!/^\d+([.,]\d{1,2})?$/.test(compact)) return null
  const cents = Math.round(parseFloat(compact.replace(',', '.')) * 100)
  return cents > 0 ? cents : null
}

/** Centimes → « 24,50 » pour pré-remplir le champ montant. */
export function amountInput(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',')
}

export function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat(intlLocale(), { style: 'currency', currency }).format(cents / 100)
}

/** Phrase du solde, du point de vue du parent connecté. */
export function balanceLabel(balance: Balance | undefined, members: Member[], meId: number | undefined, currency: string): string {
  if (!balance || balance.amount_cents === 0) return t('expenses.balance.settled')
  const name = (id: number | null) => members.find((m) => m.id === id)?.display_name ?? '?'
  const amount = formatMoney(balance.amount_cents, currency)
  if (balance.debtor_id === meId) return t('expenses.balance.youOwe', { amount, name: name(balance.creditor_id) })
  if (balance.creditor_id === meId) return t('expenses.balance.owesYou', { amount, name: name(balance.debtor_id) })
  return t('expenses.balance.owes', { amount, debtor: name(balance.debtor_id), creditor: name(balance.creditor_id) })
}

const byDateDesc = (a: Expense, b: Expense) => b.date.localeCompare(a.date) || b.id - a.id

/** Dépenses en cours groupées par mois (« 2026-10 »), les plus récentes d'abord, puis les remboursées. */
export function groupExpenses(expenses: Expense[]): { months: { month: string; items: Expense[] }[]; settled: Expense[] } {
  const months = new Map<string, Expense[]>()
  for (const e of expenses.filter((x) => !x.settled_at).sort(byDateDesc)) {
    const key = e.date.slice(0, 7)
    months.set(key, [...(months.get(key) ?? []), e])
  }
  return {
    months: [...months.entries()].map(([month, items]) => ({ month, items })),
    settled: expenses.filter((x) => x.settled_at).sort(byDateDesc),
  }
}

/**
 * Répartitions proposées, en part du payeur (%) : « à ma charge » vaut 100 si je suis
 * le payeur, 0 si c'est l'autre parent qui a payé.
 */
export function sharePresets(payerIsMe: boolean, otherName: string): { value: number; label: string }[] {
  return [
    { value: 50, label: t('expenses.share.half') },
    { value: payerIsMe ? 100 : 0, label: t('expenses.share.mine') },
    { value: payerIsMe ? 0 : 100, label: t('expenses.share.theirs', { name: otherName }) },
  ]
}
