import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import Spinner from '../components/Spinner'
import TopBar from '../components/TopBar'
import type { Balance, Expense, ExpenseCategory, Household, Settlement } from '../types'

const CATEGORIES: { value: ExpenseCategory; label: string }[] = [
  { value: 'sante', label: 'Santé' },
  { value: 'ecole', label: 'École' },
  { value: 'activites', label: 'Activités' },
  { value: 'vetements', label: 'Vêtements' },
  { value: 'cantine', label: 'Cantine' },
  { value: 'autre', label: 'Autre' },
]
const CAT_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]))

function euros(cents: number): string {
  return (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function ExpensesPage() {
  const navigate = useNavigate()
  const { user, household, householdLoaded } = useAuth()
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [balance, setBalance] = useState<Balance | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showSettle, setShowSettle] = useState(false)

  useEffect(() => {
    if (householdLoaded && (!household || !household.custody_rule)) navigate('/onboarding')
  }, [householdLoaded, household, navigate])

  const load = useCallback(() => {
    if (!household) return
    api.listExpenses(household.id).then(setExpenses).catch(() => {})
    api.listSettlements(household.id).then(setSettlements).catch(() => {})
    api.balance(household.id).then(setBalance).catch(() => setError("Impossible de charger le solde"))
  }, [household])

  useEffect(load, [load])

  if (!household || !user) return <Spinner />

  const name = (id: number | null) =>
    id === null ? 'Tous' : household.members.find((m) => m.id === id)?.display_name ?? '?'
  const childName = (id: number | null) =>
    id === null ? null : household.children.find((c) => c.id === id)?.first_name ?? null

  function balanceLabel(): string {
    if (!balance || balance.amount_cents === 0) return 'Comptes à jour'
    const debtor = name(balance.debtor_id)
    const creditor = name(balance.creditor_id)
    if (balance.debtor_id === user!.id) return `Tu dois ${euros(balance.amount_cents)} à ${creditor}`
    if (balance.creditor_id === user!.id) return `${debtor} te doit ${euros(balance.amount_cents)}`
    return `${debtor} doit ${euros(balance.amount_cents)} à ${creditor}`
  }

  return (
    <>
      <TopBar householdName={household.name} />
      <div className="layout" style={{ maxWidth: 760 }}>
        <h1>Dépenses partagées</h1>
        {error && <div className="error">{error}</div>}

        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: '1.1rem', marginRight: 'auto' }}>{balanceLabel()}</strong>
          <button className="secondary" onClick={() => setShowSettle((v) => !v)}>
            Enregistrer un remboursement
          </button>
          <button onClick={() => setShowAdd((v) => !v)}>Ajouter une dépense</button>
        </div>

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

        {expenses.length === 0 && <p className="hint">Aucune dépense pour l'instant.</p>}
        {expenses.map((e) => {
          const iAmCreator = e.created_by === user.id
          const iAmPayer = e.paid_by === user.id
          return (
            <div key={e.id} className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <strong style={{ fontSize: '1.05rem' }}>{euros(e.amount_cents)}</strong>
                <span>{e.label}</span>
                {e.status === 'disputed' && <span className="tag tag-pending">Contestée</span>}
                <span className="hint" style={{ marginLeft: 'auto' }}>{e.date}</span>
              </div>
              <div className="hint" style={{ marginTop: 4 }}>
                {CAT_LABEL[e.category]}
                {childName(e.child_id) ? ` · ${childName(e.child_id)}` : ''} · payé par {name(e.paid_by)} · partage{' '}
                {e.payer_percent}/{100 - e.payer_percent}
                {e.dispute_note ? ` · « ${e.dispute_note} »` : ''}
              </div>
              <div className="row" style={{ gap: 8, marginTop: 10 }}>
                {e.status === 'active' && !iAmPayer && (
                  <button
                    className="secondary"
                    onClick={() => api.disputeExpense(household.id, e.id).then(load)}
                  >
                    Contester
                  </button>
                )}
                {e.status === 'disputed' && (
                  <button className="secondary" onClick={() => api.resolveExpense(household.id, e.id).then(load)}>
                    Rétablir
                  </button>
                )}
                {iAmCreator && (
                  <button className="danger-link" onClick={() => api.deleteExpense(household.id, e.id).then(load)}>
                    Supprimer
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {settlements.length > 0 && (
          <div className="card">
            <h2>Remboursements</h2>
            {settlements.map((s) => (
              <div key={s.id} className="row" style={{ alignItems: 'center', margin: '6px 0' }}>
                <span style={{ marginRight: 'auto' }}>
                  {name(s.from_user)} → {name(s.to_user)} : <strong>{euros(s.amount_cents)}</strong>
                  <span className="hint"> · {s.date}{s.note ? ` · ${s.note}` : ''}</span>
                </span>
                {s.created_by === user.id && (
                  <button className="danger-link" onClick={() => api.deleteSettlement(household.id, s.id).then(load)}>
                    Supprimer
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

function ExpenseForm({ household, myId, onDone }: { household: Household; myId: number; onDone: () => void }) {
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
      setError('Montant et libellé requis')
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
      setError(err instanceof Error ? err.message : 'Erreur')
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h2>Nouvelle dépense</h2>
      <div className="row">
        <div>
          <label htmlFor="amt">Montant (€)</label>
          <input id="amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="24,50" />
        </div>
        <div>
          <label htmlFor="edate">Date</label>
          <input id="edate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <label htmlFor="lbl">Libellé</label>
      <input id="lbl" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex. lunettes de Léo" />
      <div className="row">
        <div>
          <label htmlFor="cat">Catégorie</label>
          <select id="cat" value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory)}>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ch">Enfant</label>
          <select id="ch" value={childId} onChange={(e) => setChildId(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Tous</option>
            {household.children.map((c) => (
              <option key={c.id} value={c.id}>{c.first_name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        <div>
          <label htmlFor="pb">Payé par</label>
          <select id="pb" value={paidBy} onChange={(e) => setPaidBy(Number(e.target.value))}>
            {household.members.map((m) => (
              <option key={m.id} value={m.id}>{m.display_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pp">Part du payeur : {payerPercent}%</label>
          <input id="pp" type="range" min={0} max={100} step={5} value={payerPercent} onChange={(e) => setPayerPercent(Number(e.target.value))} />
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="row" style={{ marginTop: 14 }}>
        <button onClick={submit} disabled={busy}>Enregistrer</button>
        <button className="secondary" onClick={onDone}>Annuler</button>
      </div>
    </div>
  )
}

function SettlementForm({ household, myId, onDone }: { household: Household; myId: number; onDone: () => void }) {
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
      setError('Montant valide et deux parents distincts requis')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.createSettlement(household.id, { from_user: fromUser, to_user: toUser, amount_cents: cents, date, note })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h2>Remboursement</h2>
      <div className="row">
        <div>
          <label htmlFor="fu">De</label>
          <select id="fu" value={fromUser} onChange={(e) => setFromUser(Number(e.target.value))}>
            {household.members.map((m) => (
              <option key={m.id} value={m.id}>{m.display_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="tu">Vers</label>
          <select id="tu" value={toUser} onChange={(e) => setToUser(Number(e.target.value))}>
            {household.members.map((m) => (
              <option key={m.id} value={m.id}>{m.display_name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="row">
        <div>
          <label htmlFor="samt">Montant (€)</label>
          <input id="samt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="120" />
        </div>
        <div>
          <label htmlFor="sdate">Date</label>
          <input id="sdate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <label htmlFor="snote">Note (facultatif)</label>
      <input id="snote" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex. virement" />
      {error && <div className="error">{error}</div>}
      <div className="row" style={{ marginTop: 14 }}>
        <button onClick={submit} disabled={busy}>Enregistrer</button>
        <button className="secondary" onClick={onDone}>Annuler</button>
      </div>
    </div>
  )
}
