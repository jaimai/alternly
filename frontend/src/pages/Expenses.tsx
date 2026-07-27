import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import Spinner from '../components/Spinner'
import TopBar from '../components/TopBar'
import { useFormat } from '../format'
import type { Balance, Expense, ExpenseCategory, Household, Settlement } from '../types'

const CATEGORIES: { value: ExpenseCategory; labelKey: string }[] = [
  { value: 'sante', labelKey: 'expenses.categorySante' },
  { value: 'ecole', labelKey: 'expenses.categoryEcole' },
  { value: 'activites', labelKey: 'expenses.categoryActivites' },
  { value: 'vetements', labelKey: 'expenses.categoryVetements' },
  { value: 'cantine', labelKey: 'expenses.categoryCantine' },
  { value: 'autre', labelKey: 'expenses.categoryAutre' },
]
const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.labelKey]))

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function ExpensesPage() {
  const { t } = useTranslation()
  const { money, date } = useFormat()
  const navigate = useNavigate()
  const { user, household, householdLoaded, refreshHousehold } = useAuth()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [balance, setBalance] = useState<Balance | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showSettle, setShowSettle] = useState(false)
  const [renaming, setRenaming] = useState(false)

  useEffect(() => {
    if (householdLoaded && (!household || !household.custody_rule)) navigate('/onboarding')
  }, [householdLoaded, household, navigate])

  const load = useCallback(() => {
    if (!household) return
    api.listExpenses(household.id).then(setExpenses).catch(() => {})
    api.listSettlements(household.id).then(setSettlements).catch(() => {})
    api.balance(household.id).then(setBalance).catch(() => setError(t('expenses.balanceLoadError')))
  }, [household])

  useEffect(load, [load])

  if (!household || !user) return <Spinner />

  const name = (id: number | null) =>
    id === null ? t('expenses.everyone') : household.members.find((m) => m.id === id)?.display_name ?? '?'
  const childName = (id: number | null) =>
    id === null ? null : household.children.find((c) => c.id === id)?.first_name ?? null

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

  const active = expenses.filter((e) => !e.settled_at)
  const settled = expenses.filter((e) => e.settled_at)

  function renderExpense(e: Expense) {
    const iAmCreator = e.created_by === user!.id
    const iAmPayer = e.paid_by === user!.id
    const isSettled = Boolean(e.settled_at)
    return (
      <div key={e.id} className={`card expense${isSettled ? ' settled' : ''}`} style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: '1.05rem' }}>{money(e.amount_cents)}</strong>
          <span>{e.label}</span>
          {e.status === 'disputed' && <span className="tag tag-pending">{t('expenses.tagDisputed')}</span>}
          {isSettled && <span className="tag tag-settled">{t('expenses.tagReimbursed')}</span>}
          <span className="hint" style={{ marginLeft: 'auto' }}>{date(e.date)}</span>
        </div>
        <div className="hint" style={{ marginTop: 4 }}>
          {t(CAT_LABEL[e.category])}
          {childName(e.child_id) ? ` · ${childName(e.child_id)}` : ''} · {t('expenses.paidBy', { name: name(e.paid_by) })} · {t('expenses.split')}{' '}
          {e.payer_percent}/{100 - e.payer_percent}
          {e.dispute_note ? ` · « ${e.dispute_note} »` : ''}
        </div>
        <div className="row" style={{ gap: 8, marginTop: 10 }}>
          {!isSettled && e.status === 'active' && (
            <button className="secondary" onClick={() => api.settleExpense(household!.id, e.id).then(load)}>
              {t('expenses.markReimbursed')}
            </button>
          )}
          {isSettled && (
            <button className="secondary" onClick={() => api.unsettleExpense(household!.id, e.id).then(load)}>
              {t('expenses.undoReimbursement')}
            </button>
          )}
          {!isSettled && e.status === 'active' && !iAmPayer && (
            <button className="secondary" onClick={() => api.disputeExpense(household!.id, e.id).then(load)}>
              {t('expenses.dispute')}
            </button>
          )}
          {e.status === 'disputed' && (
            <button className="secondary" onClick={() => api.resolveExpense(household!.id, e.id).then(load)}>
              {t('expenses.restore')}
            </button>
          )}
          {iAmCreator && (
            <button className="danger-link" onClick={() => api.deleteExpense(household!.id, e.id).then(load)}>
              {t('expenses.delete')}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      <TopBar householdName={household.name} />
      <div className="layout" style={{ maxWidth: 760 }}>
        <h1>{t('expenses.title')}</h1>
        {error && <div className="error">{error}</div>}

        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: '1.1rem', marginRight: 'auto' }}>{balanceLabel()}</strong>
            <button className="secondary" onClick={() => setShowSettle((v) => !v)}>
              {t('expenses.recordReimbursement')}
            </button>
            <button onClick={() => setShowAdd((v) => !v)}>{t('expenses.addExpense')}</button>
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

        {showAdd && (
          <ExpenseForm
            household={household}
            myId={user.id}
            onDone={() => {
              setShowAdd(false)
              load()
            }}
          />
        )}
        {showSettle && (
          <SettlementForm
            household={household}
            myId={user.id}
            onDone={() => {
              setShowSettle(false)
              load()
            }}
          />
        )}

        {expenses.length === 0 && <p className="hint">{t('expenses.emptyState')}</p>}
        {active.map(renderExpense)}
        {settled.length > 0 && (
          <>
            <div className="expense-group-title">{t('expenses.reimbursedGroup', { count: settled.length })}</div>
            {settled.map(renderExpense)}
          </>
        )}

        {settlements.length > 0 && (
          <div className="card">
            <h2>{t('expenses.settlementsTitle')}</h2>
            {settlements.map((s) => (
              <div key={s.id} className="row" style={{ alignItems: 'center', margin: '6px 0' }}>
                <span style={{ marginRight: 'auto' }}>
                  {name(s.from_user)} → {name(s.to_user)} : <strong>{money(s.amount_cents)}</strong>
                  <span className="hint"> · {date(s.date)}{s.note ? ` · ${s.note}` : ''}</span>
                </span>
                {s.created_by === user.id && (
                  <button className="danger-link" onClick={() => api.deleteSettlement(household.id, s.id).then(load)}>
                    {t('expenses.delete')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
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
      <div style={{ flex: 1 }}>
        <label htmlFor="pn">{t('expenses.secondParentName')}</label>
        <input id="pn" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder={t('expenses.secondParentNamePlaceholder')} />
      </div>
      <button onClick={save} disabled={busy}>{t('expenses.save')}</button>
      <button className="secondary" onClick={onDone}>{t('expenses.cancel')}</button>
    </div>
  )
}

function ExpenseForm({ household, myId, onDone }: { household: Household; myId: number; onDone: () => void }) {
  const { t } = useTranslation()
  const [amount, setAmount] = useState('')
  const [label, setLabel] = useState('')
  const [date, setDate] = useState(todayIso())
  const [category, setCategory] = useState<ExpenseCategory>('autre')
  const [childId, setChildId] = useState<number | ''>('')
  const [paidBy, setPaidBy] = useState<number>(myId)
  const [payerPercent, setPayerPercent] = useState(50)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const cents = Math.round(parseFloat(amount.replace(',', '.')) * 100)
    if (!cents || cents <= 0 || !label.trim()) {
      setError(t('expenses.errorAmountLabelRequired'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.createExpense(household.id, {
        label: label.trim(),
        amount_cents: cents,
        date,
        category,
        child_id: childId === '' ? null : Number(childId),
        paid_by: paidBy,
        payer_percent: payerPercent,
      })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('expenses.errorGeneric'))
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h2>{t('expenses.newExpense')}</h2>
      <div className="row">
        <div>
          <label htmlFor="amt">{t('expenses.amountLabel')}</label>
          <input id="amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="24,50" />
        </div>
        <div>
          <label htmlFor="edate">{t('expenses.dateLabel')}</label>
          <input id="edate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <label htmlFor="lbl">{t('expenses.labelLabel')}</label>
      <input id="lbl" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('expenses.labelPlaceholder')} />
      <div className="row">
        <div>
          <label htmlFor="cat">{t('expenses.categoryLabel')}</label>
          <select id="cat" value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{t(c.labelKey)}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ch">{t('expenses.childLabel')}</label>
          <select id="ch" value={childId} onChange={(e) => setChildId(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">{t('expenses.everyone')}</option>
            {household.children.map((c) => (
              <option key={c.id} value={c.id}>{c.first_name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        <div>
          <label htmlFor="pb">{t('expenses.paidByLabel')}</label>
          <select id="pb" value={paidBy} onChange={(e) => setPaidBy(Number(e.target.value))}>
            {household.members.map((m) => (
              <option key={m.id} value={m.id}>{m.display_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pp">{t('expenses.payerShareLabel', { percent: payerPercent })}</label>
          <input id="pp" type="range" min={0} max={100} step={5} value={payerPercent} onChange={(e) => setPayerPercent(Number(e.target.value))} />
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="row" style={{ marginTop: 14 }}>
        <button onClick={submit} disabled={busy}>{t('expenses.save')}</button>
        <button className="secondary" onClick={onDone}>{t('expenses.cancel')}</button>
      </div>
    </div>
  )
}

function SettlementForm({ household, myId, onDone }: { household: Household; myId: number; onDone: () => void }) {
  const { t } = useTranslation()
  const other = household.members.find((m) => m.id !== myId)
  const [fromUser, setFromUser] = useState<number>(myId)
  const [toUser, setToUser] = useState<number>(other?.id ?? myId)
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(todayIso())
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const cents = Math.round(parseFloat(amount.replace(',', '.')) * 100)
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

  return (
    <div className="card">
      <h2>{t('expenses.reimbursementTitle')}</h2>
      <div className="row">
        <div>
          <label htmlFor="fu">{t('expenses.fromLabel')}</label>
          <select id="fu" value={fromUser} onChange={(e) => setFromUser(Number(e.target.value))}>
            {household.members.map((m) => (
              <option key={m.id} value={m.id}>{m.display_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="tu">{t('expenses.toLabel')}</label>
          <select id="tu" value={toUser} onChange={(e) => setToUser(Number(e.target.value))}>
            {household.members.map((m) => (
              <option key={m.id} value={m.id}>{m.display_name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        <div>
          <label htmlFor="samt">{t('expenses.amountLabel')}</label>
          <input id="samt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="120" />
        </div>
        <div>
          <label htmlFor="sdate">{t('expenses.dateLabel')}</label>
          <input id="sdate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <label htmlFor="snote">{t('expenses.noteLabel')}</label>
      <input id="snote" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('expenses.notePlaceholder')} />
      {error && <div className="error">{error}</div>}
      <div className="row" style={{ marginTop: 14 }}>
        <button onClick={submit} disabled={busy}>{t('expenses.save')}</button>
        <button className="secondary" onClick={onDone}>{t('expenses.cancel')}</button>
      </div>
    </div>
  )
}
