import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import Icon from '../components/Icon'
import type { IconName } from '../components/Icon'
import Modal from '../components/Modal'
import Spinner from '../components/Spinner'
import TopBar from '../components/TopBar'
import { useConfirm } from '../components/useConfirm'
import { todayIso } from '../dates'
import { useFormat } from '../format'
import type { Balance, Expense, ExpenseCategory, Household, Settlement } from '../types'

const CATEGORIES: { value: ExpenseCategory; labelKey: string; icon: IconName }[] = [
  { value: 'sante', labelKey: 'expenses.categorySante', icon: 'health' },
  { value: 'ecole', labelKey: 'expenses.categoryEcole', icon: 'school' },
  { value: 'activites', labelKey: 'expenses.categoryActivites', icon: 'activity' },
  { value: 'vetements', labelKey: 'expenses.categoryVetements', icon: 'shirt' },
  { value: 'cantine', labelKey: 'expenses.categoryCantine', icon: 'utensils' },
  { value: 'autre', labelKey: 'expenses.categoryAutre', icon: 'receipt' },
]
const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.value, c]))


/** « 24,50 » / « 24.50 » / « 1 200 » → centimes. */
function parseAmount(input: string): number {
  return Math.round(parseFloat(input.replace(/[\s  ]/g, '').replace(',', '.')) * 100)
}

function amountInput(cents: number, lang: string): string {
  const s = (cents / 100).toFixed(2)
  return lang.startsWith('fr') ? s.replace('.', ',') : s
}

function currencySymbol(currency: string, lang: string): string {
  return (
    new Intl.NumberFormat(lang, { style: 'currency', currency }).formatToParts(0).find((p) => p.type === 'currency')
      ?.value ?? currency
  )
}

type Dialog =
  | { kind: 'expense'; expense?: Expense }
  | { kind: 'settle'; prefill?: { from: number; to: number; cents: number } }
  | { kind: 'dispute'; expense: Expense }

export default function ExpensesPage() {
  const { t } = useTranslation()
  const { money: fmtMoney, date, day, monthYear } = useFormat()
  const navigate = useNavigate()
  const { user, household, householdLoaded, refreshHousehold } = useAuth()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [balance, setBalance] = useState<Balance | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [confirm, confirmNode] = useConfirm()

  useEffect(() => {
    if (householdLoaded && (!household || !household.custody_rule)) navigate('/onboarding')
  }, [householdLoaded, household, navigate])

  const load = useCallback(() => {
    if (!household) return
    api.listExpenses(household.id).then(setExpenses).catch(() => {})
    api.listSettlements(household.id).then(setSettlements).catch(() => {})
    api.balance(household.id).then(setBalance).catch(() => setError(t('expenses.balanceLoadError')))
  }, [household, t])

  useEffect(load, [load])

  if (!household || !user) return <Spinner />

  // Montants dans la devise du foyer (EUR en France, USD aux US).
  const money = (cents: number) => fmtMoney(cents, household.currency)

  const name = (id: number | null) =>
    id === null ? t('expenses.everyone') : household.members.find((m) => m.id === id)?.display_name ?? '?'
  const color = (id: number) => household.members.find((m) => m.id === id)?.color ?? 'var(--line)'
  const childName = (id: number | null) =>
    id === null ? null : household.children.find((c) => c.id === id)?.first_name ?? null

  const run = (fn: () => Promise<unknown>) =>
    fn()
      .then(load)
      .catch((err) => setError(err instanceof Error ? err.message : t('expenses.errorGeneric')))

  function balanceLabel(): string {
    if (!balance || balance.amount_cents === 0) return t('expenses.balanceSettled')
    const debtor = name(balance.debtor_id)
    const creditor = name(balance.creditor_id)
    if (balance.debtor_id === user!.id) return t('expenses.youOweTo', { amount: money(balance.amount_cents), name: creditor })
    if (balance.creditor_id === user!.id) return t('expenses.owesYou', { name: debtor, amount: money(balance.amount_cents) })
    return t('expenses.owesTo', { debtor, amount: money(balance.amount_cents), creditor })
  }

  const otherMember = household.members.find((m) => m.id !== user.id)
  const partnerIsPlaceholder = otherMember?.is_placeholder ?? false
  const owedToMe = balance?.owed_to_me_cents ?? 0
  const iOwe = balance?.i_owe_cents ?? 0

  const byDateDesc = (a: Expense, b: Expense) => b.date.localeCompare(a.date) || b.id - a.id
  const active = expenses.filter((e) => !e.settled_at).sort(byDateDesc)
  const settled = expenses.filter((e) => e.settled_at).sort(byDateDesc)

  // Dépenses en cours groupées par mois, les plus récentes d'abord.
  const months = new Map<string, Expense[]>()
  for (const e of active) {
    const key = e.date.slice(0, 7)
    months.set(key, [...(months.get(key) ?? []), e])
  }

  const settlePrefill =
    balance && balance.amount_cents > 0 && balance.debtor_id && balance.creditor_id
      ? { from: balance.debtor_id, to: balance.creditor_id, cents: balance.amount_cents }
      : undefined

  function renderExpense(e: Expense) {
    const iAmCreator = e.created_by === user!.id
    const iAmPayer = e.paid_by === user!.id
    const isSettled = Boolean(e.settled_at)
    const child = childName(e.child_id)
    const cat = CAT[e.category] ?? CAT.autre
    return (
      <article key={e.id} className={`list-row expense${isSettled ? ' settled' : ''}`}>
        <span className="cat-icon" aria-hidden="true">
          <Icon name={cat.icon} size={18} />
        </span>
        <div className="list-main">
          <div className="list-title">
            {e.label}
            {e.status === 'disputed' && <span className="tag tag-pending">{t('expenses.tagDisputed')}</span>}
            {isSettled && <span className="tag tag-settled">{t('expenses.tagReimbursed')}</span>}
          </div>
          <div className="hint">
            {day(e.date)} · {t(cat.labelKey)}
            {child ? ` · ${child}` : ''} · <span className="payer-dot" style={{ background: color(e.paid_by) }} />
            {t('expenses.paidBy', { name: name(e.paid_by) })}
            {e.payer_percent !== 50 ? ` · ${t('expenses.split')} ${e.payer_percent}/${100 - e.payer_percent}` : ''}
          </div>
          {e.status === 'disputed' && e.dispute_note && <p className="dispute-note">« {e.dispute_note} »</p>}
          <div className="row-actions">
            {!isSettled && e.status === 'active' && (
              <button className="link" onClick={() => run(() => api.settleExpense(household!.id, e.id))}>
                {t('expenses.markReimbursed')}
              </button>
            )}
            {isSettled && (
              <button className="link" onClick={() => run(() => api.unsettleExpense(household!.id, e.id))}>
                {t('expenses.undoReimbursement')}
              </button>
            )}
            {!isSettled && e.status === 'active' && !iAmPayer && (
              <button className="link" onClick={() => setDialog({ kind: 'dispute', expense: e })}>
                {t('expenses.dispute')}
              </button>
            )}
            {e.status === 'disputed' && !iAmPayer && (
              <button className="link" onClick={() => run(() => api.resolveExpense(household!.id, e.id))}>
                {t('expenses.liftDispute')}
              </button>
            )}
            {iAmCreator && !isSettled && (
              <button className="link" onClick={() => setDialog({ kind: 'expense', expense: e })}>
                {t('expenses.edit')}
              </button>
            )}
            {iAmCreator && (
              <button
                className="link danger-text"
                onClick={async () => {
                  const ok = await confirm({
                    title: t('expenses.deleteTitle'),
                    body: t('expenses.deleteBody', { label: e.label, amount: money(e.amount_cents) }),
                    confirmLabel: t('expenses.delete'),
                    danger: true,
                  })
                  if (ok) run(() => api.deleteExpense(household!.id, e.id))
                }}
              >
                {t('expenses.delete')}
              </button>
            )}
          </div>
        </div>
        <strong className="list-amount">{money(e.amount_cents)}</strong>
      </article>
    )
  }

  return (
    <>
      <TopBar householdName={household.name} />
      <div className="layout narrow ph-mask ph-sensitive">
        <div className="page-head">
          <h1>{t('expenses.title')}</h1>
          <button className="with-icon" onClick={() => setDialog({ kind: 'expense' })}>
            <Icon name="plus" size={16} /> {t('expenses.addExpense')}
          </button>
        </div>
        {error && <div className="error">{error}</div>}

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: '1.1rem', marginRight: 'auto' }}>{balanceLabel()}</strong>
            <button className="secondary" onClick={() => setDialog({ kind: 'settle', prefill: settlePrefill })}>
              {t('expenses.recordReimbursement')}
            </button>
          </div>
          <div className="stat-grid">
            <div className={`stat ${owedToMe > 0 ? 'credit' : 'zero'}`}>
              <div className="stat-label">{t('expenses.statOwedToMe')}</div>
              <div className="stat-num">{money(owedToMe)}</div>
            </div>
            <div className={`stat ${iOwe > 0 ? 'debit' : 'zero'}`}>
              <div className="stat-label">{t('expenses.statIOwe')}</div>
              <div className="stat-num">{money(iOwe)}</div>
            </div>
          </div>
          <p className="hint" style={{ margin: 0 }}>
            {t('expenses.statsHint')}
          </p>
        </div>

        {partnerIsPlaceholder && (
          <div className="partner-banner">
            {renaming ? (
              <RenamePartner
                householdId={household.id}
                current={otherMember!.display_name}
                onDone={async () => {
                  setRenaming(false)
                  await refreshHousehold()
                }}
              />
            ) : (
              <>
                <span>
                  <strong>{otherMember!.display_name}</strong> {t('expenses.partnerBanner')}
                </span>
                <span className="banner-actions">
                  <button className="secondary" onClick={() => setRenaming(true)}>{t('expenses.nameThem')}</button>
                  <button className="secondary" onClick={() => navigate('/settings')}>{t('expenses.inviteThem')}</button>
                </span>
              </>
            )}
          </div>
        )}

        {expenses.length === 0 && (
          <div className="empty-state">
            <span className="empty-icon" aria-hidden="true">
              <Icon name="receipt" size={24} />
            </span>
            <h2>{t('expenses.emptyTitle')}</h2>
            <p>{t('expenses.emptyBody')}</p>
            <button onClick={() => setDialog({ kind: 'expense' })}>{t('expenses.addFirst')}</button>
          </div>
        )}

        {[...months.entries()].map(([month, items]) => (
          <section key={month} className="list-group">
            <h2 className="section-label">{monthYear(month + '-01')}</h2>
            <div className="list-card">{items.map(renderExpense)}</div>
          </section>
        ))}

        {settled.length > 0 && (
          <section className="list-group">
            <h2 className="section-label">{t('expenses.reimbursedGroup', { count: settled.length })}</h2>
            <div className="list-card">{settled.map(renderExpense)}</div>
          </section>
        )}

        {settlements.length > 0 && (
          <section className="list-group">
            <h2 className="section-label">{t('expenses.settlementsTitle')}</h2>
            <div className="list-card">
              {settlements.map((s) => (
                <article key={s.id} className="list-row">
                  <span className="cat-icon" aria-hidden="true">
                    <Icon name="undo" size={18} />
                  </span>
                  <div className="list-main">
                    <div className="list-title">
                      {name(s.from_user)} → {name(s.to_user)}
                    </div>
                    <div className="hint">
                      {date(s.date)}
                      {s.note ? ` · ${s.note}` : ''}
                    </div>
                    {s.created_by === user.id && (
                      <div className="row-actions">
                        <button
                          className="link danger-text"
                          onClick={async () => {
                            const ok = await confirm({
                              title: t('expenses.deleteSettlementTitle'),
                              body: t('expenses.deleteSettlementBody'),
                              confirmLabel: t('expenses.delete'),
                              danger: true,
                            })
                            if (ok) run(() => api.deleteSettlement(household.id, s.id))
                          }}
                        >
                          {t('expenses.delete')}
                        </button>
                      </div>
                    )}
                  </div>
                  <strong className="list-amount">{money(s.amount_cents)}</strong>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>

      {dialog?.kind === 'expense' && (
        <ExpenseForm
          household={household}
          myId={user.id}
          initial={dialog.expense}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null)
            load()
          }}
        />
      )}
      {dialog?.kind === 'settle' && (
        <SettlementForm
          household={household}
          myId={user.id}
          prefill={dialog.prefill}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null)
            load()
          }}
        />
      )}
      {dialog?.kind === 'dispute' && (
        <DisputeForm
          expense={dialog.expense}
          amount={money(dialog.expense.amount_cents)}
          onClose={() => setDialog(null)}
          onSubmit={(note) => {
            setDialog(null)
            run(() => api.disputeExpense(household.id, dialog.expense.id, note))
          }}
        />
      )}
      {confirmNode}
    </>
  )
}

function RenamePartner({ householdId, current, onDone }: { householdId: number; current: string; onDone: () => void }) {
  const { t } = useTranslation()
  const [name, setName] = useState(current === "L'autre parent" ? '' : current)
  const [busy, setBusy] = useState(false)
  async function save() {
    if (!name.trim()) return
    setBusy(true)
    try {
      await api.renamePartner(householdId, { display_name: name.trim() })
      onDone()
    } catch {
      setBusy(false)
    }
  }
  return (
    <div className="row" style={{ gap: 8, width: '100%', alignItems: 'flex-end' }}>
      <div style={{ flex: '1 1 200px' }}>
        <label htmlFor="pn">{t('expenses.secondParentName')}</label>
        <input id="pn" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder={t('expenses.secondParentNamePlaceholder')} />
      </div>
      <button style={{ flex: '0 0 auto' }} onClick={save} disabled={busy}>{t('expenses.save')}</button>
      <button style={{ flex: '0 0 auto' }} className="secondary" onClick={onDone}>{t('expenses.cancel')}</button>
    </div>
  )
}

function ExpenseForm({
  household,
  myId,
  initial,
  onClose,
  onDone,
}: {
  household: Household
  myId: number
  initial?: Expense
  onClose: () => void
  onDone: () => void
}) {
  const { t, i18n } = useTranslation()
  const [amount, setAmount] = useState(initial ? amountInput(initial.amount_cents, i18n.language) : '')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [date, setDate] = useState(initial?.date ?? todayIso())
  const [category, setCategory] = useState<ExpenseCategory>(initial?.category ?? 'autre')
  const [childId, setChildId] = useState<number | ''>(initial?.child_id ?? '')
  const [paidBy, setPaidBy] = useState<number>(initial?.paid_by ?? myId)
  const [payerPercent, setPayerPercent] = useState(initial?.payer_percent ?? 50)
  // Répartitions prédéfinies, exprimées en part du payeur (%) : « à ma charge »
  // vaut 100 si je suis le payeur, 0 si c'est l'autre parent qui a payé.
  const otherParent = household.members.find((m) => m.id !== myId)
  const payerIsMe = paidBy === myId
  const presets = [
    { value: 50, label: t('expenses.share5050') },
    { value: payerIsMe ? 100 : 0, label: t('expenses.shareMine') },
    { value: payerIsMe ? 0 : 100, label: t('expenses.shareOther', { name: otherParent?.display_name ?? '' }) },
  ]
  const [custom, setCustom] = useState(![0, 50, 100].includes(payerPercent))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const cents = parseAmount(amount)
    if (!cents || cents <= 0 || !label.trim()) {
      setError(t('expenses.errorAmountLabelRequired'))
      return
    }
    setBusy(true)
    setError(null)
    const payload = {
      label: label.trim(),
      amount_cents: cents,
      date,
      category,
      child_id: childId === '' ? null : Number(childId),
      paid_by: paidBy,
      payer_percent: payerPercent,
    }
    try {
      if (initial) await api.updateExpense(household.id, initial.id, payload)
      else await api.createExpense(household.id, payload)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('expenses.errorGeneric'))
      setBusy(false)
    }
  }

  const memberLabel = (id: number, n: string) => (id === myId ? t('expenses.memberYou', { name: n }) : n)

  return (
    <Modal title={initial ? t('expenses.editExpense') : t('expenses.newExpense')} onClose={onClose}>
      <div className="row">
        <div>
          <label htmlFor="amt">{t('expenses.amountLabelCur', { symbol: currencySymbol(household.currency, i18n.language) })}</label>
          <input id="amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={i18n.language.startsWith('fr') ? '24,50' : '24.50'} />
        </div>
        <div>
          <label htmlFor="edate">{t('expenses.dateLabel')}</label>
          <input id="edate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <label htmlFor="lbl">{t('expenses.labelLabel')}</label>
      <input id="lbl" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('expenses.labelPlaceholder')} maxLength={120} />

      <label id="cat-label">{t('expenses.categoryLabel')}</label>
      <div className="segmented wrap" role="radiogroup" aria-labelledby="cat-label">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={category === c.value}
            className={category === c.value ? 'on' : ''}
            onClick={() => setCategory(c.value)}
          >
            <Icon name={c.icon} size={14} /> {t(c.labelKey)}
          </button>
        ))}
      </div>

      <div className="row">
        <div>
          <label htmlFor="ch">{t('expenses.childLabel')}</label>
          <select id="ch" value={childId} onChange={(e) => setChildId(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">{t('expenses.everyone')}</option>
            {household.children.map((c) => (
              <option key={c.id} value={c.id}>{c.first_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pb">{t('expenses.paidByLabel')}</label>
          <select
            id="pb"
            value={paidBy}
            onChange={(e) => {
              setPaidBy(Number(e.target.value))
              // « À ma charge » / « à la charge de l'autre » gardent leur sens si le payeur change.
              if (!custom && payerPercent !== 50) setPayerPercent(100 - payerPercent)
            }}
          >
            {household.members.map((m) => (
              <option key={m.id} value={m.id}>{memberLabel(m.id, m.display_name)}</option>
            ))}
          </select>
        </div>
      </div>

      <label id="share-label">{t('expenses.shareLabel')}</label>
      <div className="segmented wrap" role="radiogroup" aria-labelledby="share-label">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            role="radio"
            aria-checked={!custom && payerPercent === p.value}
            className={!custom && payerPercent === p.value ? 'on' : ''}
            onClick={() => {
              setCustom(false)
              setPayerPercent(p.value)
            }}
          >
            {p.label}
          </button>
        ))}
        <button type="button" role="radio" aria-checked={custom} className={custom ? 'on' : ''} onClick={() => setCustom(true)}>
          {t('expenses.shareCustom')}
        </button>
      </div>
      <p className="fine-print" style={{ marginTop: 6 }}>
        {t('expenses.shareHint', { payer: payerPercent, other: 100 - payerPercent })}
      </p>
      {custom && (
        <div className="range-row">
          <input
            type="range"
            aria-label={t('expenses.payerShareLabel', { percent: payerPercent })}
            min={0}
            max={100}
            step={5}
            value={payerPercent}
            onChange={(e) => setPayerPercent(Number(e.target.value))}
          />
        </div>
      )}
      {initial?.status === 'disputed' && <p className="fine-print">{t('expenses.editLiftsDispute')}</p>}
      {error && <div className="error">{error}</div>}
      <div className="actions" style={{ marginTop: 18 }}>
        <button onClick={submit} disabled={busy}>{initial ? t('expenses.save') : t('expenses.add')}</button>
        <button className="secondary" onClick={onClose}>{t('expenses.cancel')}</button>
      </div>
    </Modal>
  )
}

function SettlementForm({
  household,
  myId,
  prefill,
  onClose,
  onDone,
}: {
  household: Household
  myId: number
  prefill?: { from: number; to: number; cents: number }
  onClose: () => void
  onDone: () => void
}) {
  const { t, i18n } = useTranslation()
  const other = household.members.find((m) => m.id !== myId)
  const [fromUser, setFromUser] = useState<number>(prefill?.from ?? myId)
  const [toUser, setToUser] = useState<number>(prefill?.to ?? other?.id ?? myId)
  const [amount, setAmount] = useState(prefill ? amountInput(prefill.cents, i18n.language) : '')
  const [date, setDate] = useState(todayIso())
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const cents = parseAmount(amount)
    if (!cents || cents <= 0 || fromUser === toUser) {
      setError(t('expenses.errorSettlementInvalid'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.createSettlement(household.id, { from_user: fromUser, to_user: toUser, amount_cents: cents, date, note })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('expenses.errorGeneric'))
      setBusy(false)
    }
  }

  const memberLabel = (id: number, n: string) => (id === myId ? t('expenses.memberYou', { name: n }) : n)

  return (
    <Modal title={t('expenses.reimbursementTitle')} onClose={onClose}>
      <div className="row">
        <div>
          <label htmlFor="fu">{t('expenses.fromLabel')}</label>
          <select id="fu" value={fromUser} onChange={(e) => setFromUser(Number(e.target.value))}>
            {household.members.map((m) => (
              <option key={m.id} value={m.id}>{memberLabel(m.id, m.display_name)}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="tu">{t('expenses.toLabel')}</label>
          <select id="tu" value={toUser} onChange={(e) => setToUser(Number(e.target.value))}>
            {household.members.map((m) => (
              <option key={m.id} value={m.id}>{memberLabel(m.id, m.display_name)}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        <div>
          <label htmlFor="samt">{t('expenses.amountLabelCur', { symbol: currencySymbol(household.currency, i18n.language) })}</label>
          <input id="samt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="120" />
        </div>
        <div>
          <label htmlFor="sdate">{t('expenses.dateLabel')}</label>
          <input id="sdate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <label htmlFor="snote">{t('expenses.noteLabel')}</label>
      <input id="snote" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('expenses.notePlaceholder')} maxLength={200} />
      {error && <div className="error">{error}</div>}
      <div className="actions" style={{ marginTop: 18 }}>
        <button onClick={submit} disabled={busy}>{t('expenses.save')}</button>
        <button className="secondary" onClick={onClose}>{t('expenses.cancel')}</button>
      </div>
    </Modal>
  )
}

function DisputeForm({
  expense,
  amount,
  onClose,
  onSubmit,
}: {
  expense: Expense
  amount: string
  onClose: () => void
  onSubmit: (note: string) => void
}) {
  const { t } = useTranslation()
  const [note, setNote] = useState('')
  return (
    <Modal title={t('expenses.disputeTitle')} eyebrow={`${expense.label} · ${amount}`} onClose={onClose}>
      <p className="hint">{t('expenses.disputeHint')}</p>
      <label htmlFor="dnote">{t('expenses.disputeReasonLabel')}</label>
      <textarea
        id="dnote"
        rows={3}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('expenses.disputeReasonPlaceholder')}
        maxLength={500}
      />
      <div className="actions" style={{ marginTop: 18 }}>
        <button onClick={() => onSubmit(note.trim())}>{t('expenses.dispute')}</button>
        <button className="secondary" onClick={onClose}>{t('expenses.cancel')}</button>
      </div>
    </Modal>
  )
}
