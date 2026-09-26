import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useAuth } from '../auth'
import Modal, { useConfirm } from '../components/Modal'
import TopBar from '../components/TopBar'
import { fmtDate, fmtDay, parseIso, todayIso } from '../dates'
import type { Balance, Expense, ExpenseCategory, Household, Settlement } from '../types'

const CATEGORIES: { value: ExpenseCategory; label: string; icon: string }[] = [
  { value: 'sante', label: 'Santé', icon: '🩺' },
  { value: 'ecole', label: 'École', icon: '🎒' },
  { value: 'activites', label: 'Activités', icon: '⚽' },
  { value: 'vetements', label: 'Vêtements', icon: '👕' },
  { value: 'cantine', label: 'Cantine', icon: '🍽️' },
  { value: 'autre', label: 'Autre', icon: '🧾' },
]
const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.value, c]))

const SHARE_PRESETS = [
  { value: 50, label: '50 / 50' },
  { value: 100, label: 'À ma charge' },
  { value: 0, label: "À la charge de l'autre" },
]

function euros(cents: number): string {
  return (cents / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
}

function parseEuros(input: string): number {
  return Math.round(parseFloat(input.replace(/\s/g, '').replace(',', '.')) * 100)
}

function monthLabel(iso: string): string {
  const s = parseIso(iso).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

type Dialog =
  | { kind: 'expense'; expense?: Expense }
  | { kind: 'settle'; prefill?: { from: number; to: number; cents: number } }
  | { kind: 'dispute'; expense: Expense }

export default function ExpensesPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [household, setHousehold] = useState<Household | null>(null)
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [balance, setBalance] = useState<Balance | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [confirm, confirmNode] = useConfirm()

  useEffect(() => {
    api
      .myHousehold()
      .then((h) => {
        if (!h.custody_rule) navigate('/onboarding')
        else setHousehold(h)
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) navigate('/onboarding')
        else setError(err instanceof Error ? err.message : 'Erreur')
      })
  }, [navigate])

  const load = useCallback(() => {
    if (!household) return
    const onErr = (err: unknown) => setError(err instanceof Error ? err.message : 'Chargement impossible')
    api.listExpenses(household.id).then(setExpenses).catch(onErr)
    api.listSettlements(household.id).then(setSettlements).catch(onErr)
    api.balance(household.id).then(setBalance).catch(onErr)
  }, [household])

  useEffect(load, [load])

  if (!household || !user) return <div className="page-loading">Chargement…</div>

  const name = (id: number | null) =>
    id === null ? 'Tous' : id === user.id ? 'vous' : household.members.find((m) => m.id === id)?.display_name ?? '?'
  const color = (id: number) => household.members.find((m) => m.id === id)?.color ?? 'var(--line)'
  const childName = (id: number | null) =>
    id === null ? null : household.children.find((c) => c.id === id)?.first_name ?? null

  const run = (fn: () => Promise<unknown>) =>
    fn()
      .then(load)
      .catch((err) => setError(err instanceof Error ? err.message : 'Erreur'))

  const settled = !balance || balance.amount_cents === 0
  let balanceTitle = 'Les comptes sont à jour'
  if (!settled && balance) {
    if (balance.debtor_id === user.id) balanceTitle = `Vous devez ${euros(balance.amount_cents)} à ${name(balance.creditor_id)}`
    else if (balance.creditor_id === user.id) balanceTitle = `${name(balance.debtor_id)} vous doit ${euros(balance.amount_cents)}`
    else balanceTitle = `${name(balance.debtor_id)} doit ${euros(balance.amount_cents)} à ${name(balance.creditor_id)}`
  }

  // Dépenses groupées par mois, les plus récentes d'abord.
  const groups = new Map<string, Expense[]>()
  for (const e of [...expenses].sort((a, b) => b.date.localeCompare(a.date))) {
    const key = e.date.slice(0, 7)
    groups.set(key, [...(groups.get(key) ?? []), e])
  }

  return (
    <>
      <TopBar householdName={household.name} />
      <div className="layout narrow">
        <div className="page-head">
          <h1>Dépenses partagées</h1>
          <button onClick={() => setDialog({ kind: 'expense' })}>+ Ajouter une dépense</button>
        </div>
        {error && <div className="error">{error}</div>}

        <section className={`balance-card${settled ? ' settled' : ''}`}>
          <div>
            <p className="eyebrow">Solde</p>
            <p className="balance-title">{balanceTitle}</p>
            {settled && <p className="hint">Rien à régler pour l'instant.</p>}
          </div>
          <div className="actions">
            {!settled && balance?.debtor_id && balance.creditor_id && (
              <button
                onClick={() =>
                  setDialog({
                    kind: 'settle',
                    prefill: { from: balance.debtor_id!, to: balance.creditor_id!, cents: balance.amount_cents },
                  })
                }
              >
                Enregistrer le règlement
              </button>
            )}
            <button className="secondary" onClick={() => setDialog({ kind: 'settle' })}>
              Autre remboursement
            </button>
          </div>
        </section>

        {expenses.length === 0 && (
          <div className="empty-state">
            <span className="empty-icon" aria-hidden="true">🧾</span>
            <h2>Aucune dépense pour l'instant</h2>
            <p>
              Cantine, lunettes, licence de foot… Notez ce que vous avancez pour les enfants : Alternly tient le solde
              à jour pour vous deux.
            </p>
            <button onClick={() => setDialog({ kind: 'expense' })}>Ajouter la première dépense</button>
          </div>
        )}

        {[...groups.entries()].map(([month, items]) => (
          <section key={month} className="list-group">
            <h2 className="section-label">{monthLabel(month + '-01')}</h2>
            <div className="list-card">
              {items.map((e) => {
                const iAmCreator = e.created_by === user.id
                const iAmPayer = e.paid_by === user.id
                const child = childName(e.child_id)
                return (
                  <article key={e.id} className="list-row">
                    <span className="cat-icon" aria-hidden="true">{CAT[e.category]?.icon ?? '🧾'}</span>
                    <div className="list-main">
                      <div className="list-title">
                        {e.label}
                        {e.status === 'disputed' && <span className="tag tag-pending">Contestée</span>}
                      </div>
                      <div className="hint">
                        {fmtDay(e.date)} · {CAT[e.category]?.label}
                        {child ? ` · ${child}` : ''} ·{' '}
                        <span className="payer-dot" style={{ background: color(e.paid_by) }} />
                        payé par {name(e.paid_by)}
                        {e.payer_percent !== 50 ? ` · partage ${e.payer_percent}/${100 - e.payer_percent}` : ''}
                      </div>
                      {e.status === 'disputed' && e.dispute_note && (
                        <p className="dispute-note">« {e.dispute_note} »</p>
                      )}
                      <div className="row-actions">
                        {e.status === 'active' && !iAmPayer && (
                          <button className="link" onClick={() => setDialog({ kind: 'dispute', expense: e })}>
                            Contester
                          </button>
                        )}
                        {e.status === 'disputed' && !iAmPayer && (
                          <button className="link" onClick={() => run(() => api.resolveExpense(household.id, e.id))}>
                            Lever la contestation
                          </button>
                        )}
                        {iAmCreator && (
                          <button className="link" onClick={() => setDialog({ kind: 'expense', expense: e })}>
                            Modifier
                          </button>
                        )}
                        {iAmCreator && (
                          <button
                            className="link danger-text"
                            onClick={async () => {
                              if (
                                await confirm({
                                  title: 'Supprimer cette dépense ?',
                                  body: `« ${e.label} » (${euros(e.amount_cents)}) sera retirée du solde.`,
                                  confirmLabel: 'Supprimer',
                                  danger: true,
                                })
                              )
                                run(() => api.deleteExpense(household.id, e.id))
                            }}
                          >
                            Supprimer
                          </button>
                        )}
                      </div>
                    </div>
                    <strong className="list-amount">{euros(e.amount_cents)}</strong>
                  </article>
                )
              })}
            </div>
          </section>
        ))}

        {settlements.length > 0 && (
          <section className="list-group">
            <h2 className="section-label">Remboursements</h2>
            <div className="list-card">
              {settlements.map((s) => (
                <article key={s.id} className="list-row">
                  <span className="cat-icon" aria-hidden="true">↩︎</span>
                  <div className="list-main">
                    <div className="list-title">
                      {name(s.from_user)} → {name(s.to_user)}
                    </div>
                    <div className="hint">
                      {fmtDate(s.date)}
                      {s.note ? ` · ${s.note}` : ''}
                    </div>
                    {s.created_by === user.id && (
                      <div className="row-actions">
                        <button
                          className="link danger-text"
                          onClick={async () => {
                            if (
                              await confirm({
                                title: 'Supprimer ce remboursement ?',
                                body: 'Le solde sera recalculé sans lui.',
                                confirmLabel: 'Supprimer',
                                danger: true,
                              })
                            )
                              run(() => api.deleteSettlement(household.id, s.id))
                          }}
                        >
                          Supprimer
                        </button>
                      </div>
                    )}
                  </div>
                  <strong className="list-amount">{euros(s.amount_cents)}</strong>
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
  const [amount, setAmount] = useState(initial ? (initial.amount_cents / 100).toFixed(2).replace('.', ',') : '')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [date, setDate] = useState(initial?.date ?? todayIso())
  const [category, setCategory] = useState<ExpenseCategory>(initial?.category ?? 'autre')
  const [childId, setChildId] = useState<number | ''>(initial?.child_id ?? '')
  const [paidBy, setPaidBy] = useState<number>(initial?.paid_by ?? myId)
  const [payerPercent, setPayerPercent] = useState(initial?.payer_percent ?? 50)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const preset = SHARE_PRESETS.some((p) => p.value === payerPercent)
  const [custom, setCustom] = useState(!preset)

  async function submit() {
    const cents = parseEuros(amount)
    if (!cents || cents <= 0 || !label.trim()) {
      setError('Indiquez un montant et un libellé')
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
      setError(err instanceof Error ? err.message : 'Erreur')
      setBusy(false)
    }
  }

  return (
    <Modal title={initial ? 'Modifier la dépense' : 'Nouvelle dépense'} onClose={onClose}>
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
      <input id="lbl" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex. lunettes de Léo" maxLength={120} />

      <label>Catégorie</label>
      <div className="segmented wrap" role="radiogroup" aria-label="Catégorie">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={category === c.value}
            className={category === c.value ? 'on' : ''}
            onClick={() => setCategory(c.value)}
          >
            <span aria-hidden="true">{c.icon}</span> {c.label}
          </button>
        ))}
      </div>

      <div className="row">
        <div>
          <label htmlFor="ch">Enfant</label>
          <select id="ch" value={childId} onChange={(e) => setChildId(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Tous</option>
            {household.children.map((c) => (
              <option key={c.id} value={c.id}>{c.first_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pb">Payé par</label>
          <select id="pb" value={paidBy} onChange={(e) => setPaidBy(Number(e.target.value))}>
            {household.members.map((m) => (
              <option key={m.id} value={m.id}>{m.id === myId ? `${m.display_name} (vous)` : m.display_name}</option>
            ))}
          </select>
        </div>
      </div>

      <label>Répartition</label>
      <div className="segmented" role="radiogroup" aria-label="Répartition">
        {SHARE_PRESETS.map((p) => (
          <button
            key={p.value}
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
          Autre
        </button>
      </div>
      {custom && (
        <div className="range-row">
          <input
            type="range"
            aria-label="Part du payeur"
            min={0}
            max={100}
            step={5}
            value={payerPercent}
            onChange={(e) => setPayerPercent(Number(e.target.value))}
          />
          <span className="hint">
            Payeur {payerPercent} % · autre {100 - payerPercent} %
          </span>
        </div>
      )}
      {initial?.status === 'disputed' && (
        <p className="fine-print">Enregistrer une modification lève la contestation en cours.</p>
      )}
      {error && <div className="error">{error}</div>}
      <div className="actions" style={{ marginTop: 18 }}>
        <button onClick={submit} disabled={busy}>{initial ? 'Enregistrer' : 'Ajouter'}</button>
        <button className="secondary" onClick={onClose}>Annuler</button>
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
  const other = household.members.find((m) => m.id !== myId)
  const [fromUser, setFromUser] = useState<number>(prefill?.from ?? myId)
  const [toUser, setToUser] = useState<number>(prefill?.to ?? other?.id ?? myId)
  const [amount, setAmount] = useState(prefill ? (prefill.cents / 100).toFixed(2).replace('.', ',') : '')
  const [date, setDate] = useState(todayIso())
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const cents = parseEuros(amount)
    if (!cents || cents <= 0 || fromUser === toUser) {
      setError('Indiquez un montant et deux parents différents')
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

  const label = (id: number) => {
    const m = household.members.find((x) => x.id === id)
    return m ? (m.id === myId ? `${m.display_name} (vous)` : m.display_name) : '?'
  }

  return (
    <Modal title="Enregistrer un remboursement" onClose={onClose}>
      <div className="row">
        <div>
          <label htmlFor="fu">De</label>
          <select id="fu" value={fromUser} onChange={(e) => setFromUser(Number(e.target.value))}>
            {household.members.map((m) => (
              <option key={m.id} value={m.id}>{label(m.id)}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="tu">Vers</label>
          <select id="tu" value={toUser} onChange={(e) => setToUser(Number(e.target.value))}>
            {household.members.map((m) => (
              <option key={m.id} value={m.id}>{label(m.id)}</option>
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
      <input id="snote" value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex. virement" maxLength={200} />
      {error && <div className="error">{error}</div>}
      <div className="actions" style={{ marginTop: 18 }}>
        <button onClick={submit} disabled={busy}>Enregistrer</button>
        <button className="secondary" onClick={onClose}>Annuler</button>
      </div>
    </Modal>
  )
}

function DisputeForm({
  expense,
  onClose,
  onSubmit,
}: {
  expense: Expense
  onClose: () => void
  onSubmit: (note: string) => void
}) {
  const [note, setNote] = useState('')
  return (
    <Modal title="Contester la dépense" eyebrow={`${expense.label} · ${euros(expense.amount_cents)}`} onClose={onClose}>
      <p className="hint">
        La dépense reste visible mais est signalée comme contestée. L'autre parent est prévenu et peut la corriger.
      </p>
      <label htmlFor="dnote">Motif</label>
      <textarea
        id="dnote"
        rows={3}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="ex. montant différent du ticket, dépense non convenue…"
        maxLength={500}
      />
      <div className="actions" style={{ marginTop: 18 }}>
        <button onClick={() => onSubmit(note.trim())}>Contester</button>
        <button className="secondary" onClick={onClose}>Annuler</button>
      </div>
    </Modal>
  )
}
