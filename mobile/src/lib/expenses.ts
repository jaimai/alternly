// Dépenses partagées : catégories, montants, solde (mêmes règles que frontend/src/pages/Expenses.tsx).
// Le solde est calculé par le backend (/balance) ; ici, seulement la mise en forme.
import type { Balance, Expense, ExpenseCategory, Member } from './types'
import { intlLocale } from './i18n'

export const CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: 'sante', label: 'Santé' },
  { value: 'ecole', label: 'École' },
  { value: 'activites', label: 'Activités' },
  { value: 'vetements', label: 'Vêtements' },
  { value: 'cantine', label: 'Cantine' },
  { value: 'autre', label: 'Autre' },
]

export function categoryLabel(value: string): string {
  return CATEGORIES.find((c) => c.value === value)?.label ?? 'Autre'
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
  if (!balance || balance.amount_cents === 0) return 'Comptes à jour'
  const name = (id: number | null) => members.find((m) => m.id === id)?.display_name ?? '?'
  const amount = formatMoney(balance.amount_cents, currency)
  if (balance.debtor_id === meId) return `Vous devez ${amount} à ${name(balance.creditor_id)}`
  if (balance.creditor_id === meId) return `${name(balance.debtor_id)} vous doit ${amount}`
  return `${name(balance.debtor_id)} doit ${amount} à ${name(balance.creditor_id)}`
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
    { value: 50, label: '50 / 50' },
    { value: payerIsMe ? 100 : 0, label: 'À ma charge' },
    { value: payerIsMe ? 0 : 100, label: `À la charge de ${otherName}` },
  ]
}
