import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import Icon from '../components/Icon'
import Modal from '../components/Modal'
import Spinner from '../components/Spinner'
import TopBar from '../components/TopBar'
import { useConfirm } from '../components/useConfirm'
import { todayIso } from '../dates'
import { useFormat } from '../format'
import type { Household, Pension, PensionMonthStatus, Revaluation } from '../types'

/** « 211,59 » / « 211.59 » → centimes (NaN si vide ou invalide). */
function parseAmount(input: string): number {
  return Math.round(parseFloat(input.replace(/[\s  ]/g, '').replace(',', '.')) * 100)
}

function amountInput(cents: number | null | undefined, lang: string): string {
  if (!cents) return ''
  const s = (cents / 100).toFixed(2)
  return lang.startsWith('fr') ? s.replace('.', ',') : s
}

function parseIndex(input: string): number {
  return parseFloat(input.replace(/\s/g, '').replace(',', '.'))
}

const STATUS_CLASS: Record<PensionMonthStatus, string> = {
  paid: 'pension-paid',
  partial: 'pension-partial',
  missing: 'pension-missing',
  upcoming: 'pension-upcoming',
}

// Pension alimentaire : montant, versements reçus mois par mois, revalorisation.
export default function PensionPage() {
  const { t, i18n } = useTranslation()
  const { money: fmtMoney, monthYear, date } = useFormat()
  const navigate = useNavigate()
  const { household, householdLoaded } = useAuth()
  const [pension, setPension] = useState<Pension | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [paying, setPaying] = useState<string | null>(null) // mois (yyyy-mm-01) du versement à saisir
  const [confirm, confirmNode] = useConfirm()

  useEffect(() => {
    if (householdLoaded && !household) navigate('/onboarding', { replace: true })
  }, [householdLoaded, household, navigate])

  const load = useCallback(() => {
    if (!household) return
    api
      .pension(household.id)
      .then(setPension)
      .catch(() => setError(t('pension.loadError')))
      .finally(() => setLoaded(true))
  }, [household, t])

  useEffect(load, [load])

  if (!household || !loaded) return <Spinner />
  const money = (cents: number) => fmtMoney(cents, household.currency)
  const name = (id: number) => household.members.find((m) => m.id === id)?.display_name ?? '?'

  async function removePayment(id: number) {
    const ok = await confirm({ title: t('pension.deletePaymentConfirm'), confirmLabel: t('pension.delete'), danger: true })
    if (ok) setPension(await api.deletePensionPayment(household!.id, id))
  }

  async function removePension() {
    const ok = await confirm({
      title: t('pension.deleteConfirmTitle'),
      body: t('pension.deleteConfirmBody'),
      confirmLabel: t('pension.delete'),
      danger: true,
    })
    if (!ok) return
    await api.deletePension(household!.id)
    setPension(null)
    setEditing(false)
  }

  return (
    <>
      <TopBar householdName={household.name} />
      <div className="layout narrow ph-mask ph-sensitive">
        <p style={{ margin: '0 0 4px' }}>
          <Link to="/expenses" className="back-link">← {t('pension.backToExpenses')}</Link>
        </p>
        <h1>{t('pension.title')}</h1>
        <p className="hint" style={{ marginTop: 0 }}>{t('pension.subtitle')}</p>
        {error && <div className="error">{error}</div>}

        {(!pension || editing) && (
          <PensionForm
            household={household}
            pension={pension}
            lang={i18n.language}
            onSaved={(p) => {
              setPension(p)
              setEditing(false)
            }}
            onCancel={pension ? () => setEditing(false) : undefined}
            onDelete={pension ? removePension : undefined}
          />
        )}

        {pension && !editing && (
          <>
            <div className="card">
              <div className="pension-summary">
                <div>
                  <div className="stat-label">{t('pension.currentAmount')}</div>
                  <div className="stat-num">{money(pension.amount_cents)}</div>
                  <p className="hint" style={{ margin: '4px 0 0' }}>
                    {t('pension.summary', { payer: name(pension.payer_id), payee: name(pension.payee_id), day: pension.due_day })}
                  </p>
                </div>
                <div className={`stat ${pension.arrears_cents > 0 ? 'debit' : 'zero'}`}>
                  <div className="stat-label">{t('pension.arrears')}</div>
                  <div className="stat-num">{money(pension.arrears_cents)}</div>
                </div>
              </div>
              <div className="row" style={{ marginTop: 12 }}>
                <button onClick={() => setPaying(pension.months[0]?.month ?? todayIso().slice(0, 7) + '-01')}>
                  <Icon name="plus" size={15} /> {t('pension.recordPayment')}
                </button>
                <button className="secondary" onClick={() => setEditing(true)}>{t('pension.edit')}</button>
              </div>
            </div>

            <RevaluationCard
              household={household}
              pension={pension}
              money={money}
              onApplied={load}
            />

            <section className="list-group">
              <h2 className="section-label">{t('pension.schedule')}</h2>
              <div className="list-card">
                {pension.months.map((m) => {
                  const payments = pension.payments.filter((p) => p.month === m.month)
                  return (
                    <div key={m.month} className="list-row pension-month">
                      <div className="list-main">
                        <div className="pension-month-head">
                          <strong>{monthYear(m.month)}</strong>
                          <span className={`tag ${STATUS_CLASS[m.status]}`}>{t(`pension.status.${m.status}`)}</span>
                          <span className="pension-amounts">
                            {money(m.paid_cents)} / {money(m.due_cents)}
                          </span>
                        </div>
                        {payments.map((p) => (
                          <div key={p.id} className="hint pension-payment">
                            <span>
                              {t('pension.paidOn', { date: date(p.paid_on), amount: money(p.amount_cents) })}
                              {p.note && ` · ${p.note}`}
                            </span>
                            <button className="danger-link" onClick={() => removePayment(p.id)}>
                              {t('pension.delete')}
                            </button>
                          </div>
                        ))}
                        {m.status !== 'paid' && (
                          <button className="journal-link" style={{ paddingLeft: 0 }} onClick={() => setPaying(m.month)}>
                            {t('pension.recordForMonth')}
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          </>
        )}
      </div>
      {pension && paying && (
        <PaymentDialog
          household={household}
          pension={pension}
          month={paying}
          lang={i18n.language}
          onClose={() => setPaying(null)}
          onSaved={(p) => {
            setPension(p)
            setPaying(null)
          }}
        />
      )}
      {confirmNode}
    </>
  )
}

function PensionForm({
  household,
  pension,
  lang,
  onSaved,
  onCancel,
  onDelete,
}: {
  household: Household
  pension: Pension | null
  lang: string
  onSaved: (p: Pension) => void
  onCancel?: () => void
  onDelete?: () => void
}) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const other = household.members.find((m) => m.id !== user?.id)
  const [payerId, setPayerId] = useState<number>(pension?.payer_id ?? other?.id ?? household.members[0].id)
  const [amount, setAmount] = useState(amountInput(pension?.amount_cents, lang))
  const [dueDay, setDueDay] = useState(String(pension?.due_day ?? 5))
  const [startMonth, setStartMonth] = useState((pension?.start_month ?? todayIso()).slice(0, 7))
  const [withIndex, setWithIndex] = useState(Boolean(pension?.base_index))
  const [baseAmount, setBaseAmount] = useState(amountInput(pension?.base_amount_cents, lang))
  const [baseIndex, setBaseIndex] = useState(pension?.base_index ? String(pension.base_index) : '')
  const [indexLabel, setIndexLabel] = useState(pension?.index_label ?? '')
  const [revalMonth, setRevalMonth] = useState(String(pension?.revaluation_month ?? ''))
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const months = Array.from({ length: 12 }, (_, i) =>
    new Date(2026, i, 1).toLocaleDateString(lang.startsWith('en') ? 'en-US' : 'fr-FR', { month: 'long' }),
  )

  async function submit() {
    const cents = parseAmount(amount)
    if (!Number.isFinite(cents) || cents <= 0) {
      setError(t('pension.amountError'))
      return
    }
    const base = withIndex ? parseAmount(baseAmount || amount) : NaN
    const index = withIndex ? parseIndex(baseIndex) : NaN
    if (withIndex && (!Number.isFinite(index) || index <= 0)) {
      setError(t('pension.indexError'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const saved = await api.savePension(household.id, {
        payer_id: payerId,
        amount_cents: cents,
        due_day: Math.min(28, Math.max(1, Number(dueDay) || 5)),
        start_month: `${startMonth}-01`,
        base_amount_cents: withIndex && Number.isFinite(base) ? base : null,
        base_index: withIndex ? index : null,
        index_label: withIndex && indexLabel.trim() ? indexLabel.trim() : null,
        revaluation_month: withIndex && revalMonth ? Number(revalMonth) : null,
      })
      onSaved(saved)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('pension.saveError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>{pension ? t('pension.editTitle') : t('pension.setupTitle')}</h2>
      <div className="row">
        <div>
          <label htmlFor="ppayer">{t('pension.payerLabel')}</label>
          <select id="ppayer" value={payerId} onChange={(e) => setPayerId(Number(e.target.value))}>
            {household.members.map((m) => (
              <option key={m.id} value={m.id}>{m.display_name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pamount">{t('pension.amountLabel')}</label>
          <input id="pamount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="200" />
        </div>
      </div>
      <div className="row">
        <div>
          <label htmlFor="pday">{t('pension.dueDayLabel')}</label>
          <input id="pday" type="number" min={1} max={28} value={dueDay} onChange={(e) => setDueDay(e.target.value)} />
        </div>
        <div>
          <label htmlFor="pstart">{t('pension.startLabel')}</label>
          <input id="pstart" type="month" value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
        </div>
      </div>

      <label className="consent" style={{ marginTop: 12 }}>
        <input type="checkbox" checked={withIndex} onChange={(e) => setWithIndex(e.target.checked)} />
        <span>{t('pension.withIndex')}</span>
      </label>
      {withIndex && (
        <>
          <p className="hint">{t('pension.indexHint')}</p>
          <div className="row">
            <div>
              <label htmlFor="pbase">{t('pension.baseAmountLabel')}</label>
              <input id="pbase" inputMode="decimal" value={baseAmount} onChange={(e) => setBaseAmount(e.target.value)} placeholder={amount} />
            </div>
            <div>
              <label htmlFor="pindex">{t('pension.baseIndexLabel')}</label>
              <input id="pindex" inputMode="decimal" value={baseIndex} onChange={(e) => setBaseIndex(e.target.value)} placeholder="112,03" />
            </div>
          </div>
          <div className="row">
            <div>
              <label htmlFor="plabel">{t('pension.indexLabelLabel')}</label>
              <input id="plabel" value={indexLabel} maxLength={120} onChange={(e) => setIndexLabel(e.target.value)} placeholder={t('pension.indexLabelPlaceholder')} />
            </div>
            <div>
              <label htmlFor="pmonth">{t('pension.revalMonthLabel')}</label>
              <select id="pmonth" value={revalMonth} onChange={(e) => setRevalMonth(e.target.value)}>
                <option value="">—</option>
                {months.map((label, i) => (
                  <option key={label} value={i + 1}>{label}</option>
                ))}
              </select>
            </div>
          </div>
        </>
      )}
      {error && <div className="error">{error}</div>}
      <div className="row" style={{ marginTop: 12 }}>
        <button onClick={submit} disabled={busy}>{busy ? t('pension.saving') : t('pension.save')}</button>
        {onCancel && <button className="secondary" onClick={onCancel}>{t('pension.cancel')}</button>}
      </div>
      {onDelete && (
        <p style={{ marginTop: 12 }}>
          <button className="danger-link" style={{ paddingLeft: 0 }} onClick={onDelete}>{t('pension.deleteAll')}</button>
        </p>
      )}
    </div>
  )
}

function RevaluationCard({
  household,
  pension,
  money,
  onApplied,
}: {
  household: Household
  pension: Pension
  money: (cents: number) => string
  onApplied: () => void
}) {
  const { t, i18n } = useTranslation()
  const num = (n: number) => n.toLocaleString(i18n.language.startsWith('en') ? 'en-US' : 'fr-FR', { maximumFractionDigits: 3 })
  const [index, setIndex] = useState('')
  const [result, setResult] = useState<Revaluation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!pension.base_index || !pension.base_amount_cents) {
    return (
      <div className="card pension-reval">
        <h2 style={{ marginTop: 0 }}>{t('pension.revalTitle')}</h2>
        <p className="hint" style={{ margin: 0 }}>{t('pension.revalNeedsBase')}</p>
      </div>
    )
  }

  async function run(apply: boolean) {
    const value = parseIndex(index)
    if (!Number.isFinite(value) || value <= 0) {
      setError(t('pension.indexError'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      const r = await api.revaluePension(household.id, { new_index: value, apply })
      setResult(r)
      if (apply) onApplied()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('pension.saveError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card pension-reval">
      <h2 style={{ marginTop: 0 }}>{t('pension.revalTitle')}</h2>
      <p className="hint" style={{ marginTop: 0 }}>
        {t('pension.revalBase', {
          amount: money(pension.base_amount_cents),
          index: num(pension.base_index),
          label: pension.index_label ? ` (${pension.index_label})` : '',
        })}{' '}
        <a href="https://www.insee.fr" target="_blank" rel="noreferrer">{t('pension.inseeLink')}</a>
      </p>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div>
          <label htmlFor="pnew">{t('pension.newIndexLabel')}</label>
          <input id="pnew" inputMode="decimal" value={index} onChange={(e) => { setIndex(e.target.value); setResult(null) }} placeholder="118,52" />
        </div>
        <div style={{ flex: '0 0 auto' }}>
          <button className="secondary" onClick={() => run(false)} disabled={busy || !index}>{t('pension.compute')}</button>
        </div>
      </div>
      {error && <div className="error">{error}</div>}
      {result && (
        <div className="pension-result">
          <p style={{ margin: '8px 0' }}>
            {t('pension.revalFormula', {
              base: money(result.base_amount_cents),
              newIndex: num(result.new_index),
              baseIndex: num(result.base_index),
              amount: money(result.new_cents),
            })}
          </p>
          {result.applied ? (
            <p className="hint" style={{ margin: 0 }}>{t('pension.revalApplied')}</p>
          ) : result.new_cents !== result.current_cents ? (
            <button onClick={() => run(true)} disabled={busy}>
              {t('pension.apply', { amount: money(result.new_cents) })}
            </button>
          ) : (
            <p className="hint" style={{ margin: 0 }}>{t('pension.revalSame')}</p>
          )}
        </div>
      )}
    </div>
  )
}

function PaymentDialog({
  household,
  pension,
  month,
  lang,
  onClose,
  onSaved,
}: {
  household: Household
  pension: Pension
  month: string
  lang: string
  onClose: () => void
  onSaved: (p: Pension) => void
}) {
  const { t } = useTranslation()
  const due = pension.months.find((m) => m.month === month)
  const remaining = due ? Math.max(due.due_cents - due.paid_cents, 0) : pension.amount_cents
  const [m, setM] = useState(month.slice(0, 7))
  const [amount, setAmount] = useState(amountInput(remaining || pension.amount_cents, lang))
  const [paidOn, setPaidOn] = useState(todayIso())
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const cents = parseAmount(amount)
    if (!Number.isFinite(cents) || cents <= 0) {
      setError(t('pension.amountError'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      onSaved(await api.addPensionPayment(household.id, { month: `${m}-01`, amount_cents: cents, paid_on: paidOn, note: note.trim() }))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('pension.saveError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={t('pension.recordPayment')} onClose={onClose}>
      <div className="row">
        <div>
          <label htmlFor="pymonth">{t('pension.monthLabel')}</label>
          <input id="pymonth" type="month" value={m} onChange={(e) => setM(e.target.value)} />
        </div>
        <div>
          <label htmlFor="pyamount">{t('pension.receivedLabel')}</label>
          <input id="pyamount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
      </div>
      <label htmlFor="pydate">{t('pension.paidOnLabel')}</label>
      <input id="pydate" type="date" value={paidOn} max={todayIso()} onChange={(e) => setPaidOn(e.target.value)} />
      <label htmlFor="pynote">{t('pension.noteLabel')}</label>
      <input id="pynote" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={t('pension.notePlaceholder')} />
      {error && <div className="error">{error}</div>}
      <div className="row" style={{ marginTop: 12 }}>
        <button onClick={submit} disabled={busy}>{busy ? t('pension.saving') : t('pension.save')}</button>
      </div>
    </Modal>
  )
}
