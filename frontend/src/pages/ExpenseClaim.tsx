import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import Icon from '../components/Icon'
import Spinner from '../components/Spinner'
import { parseTimestamp } from '../dates'
import { useFormat } from '../format'
import type { ExpenseClaim } from '../types'

// Demande de remboursement : document à imprimer / enregistrer en PDF et à envoyer à
// l'autre parent, y compris s'il n'utilise pas Alternly (parcours solo).
export default function ExpenseClaimPage() {
  const { t, i18n } = useTranslation()
  const { date, money } = useFormat()
  const { household } = useAuth()
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState<ExpenseClaim | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Message libre (coordonnées bancaires, délai…) : imprimé, jamais enregistré.
  const [note, setNote] = useState('')
  const start = params.get('start') ?? ''
  const end = params.get('end') ?? ''

  useEffect(() => {
    if (!household) return
    api
      .expenseClaim(household.id, start || undefined, end || undefined)
      .then(setData)
      .catch(() => setError(t('claim.loadError')))
  }, [household, start, end, t])

  useEffect(() => {
    if (data) document.title = `${t('claim.docTitle')} — ${data.author_name}`
  }, [data, t])

  function setPeriod(key: 'start' | 'end', value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }

  if (error) return <div className="print-doc"><div className="error">{error}</div></div>
  if (!data) return <Spinner />

  const locale = i18n.language.startsWith('en') ? 'en-US' : 'fr-FR'
  const cur = (cents: number) => money(cents, data.currency)
  const period =
    data.start || data.end
      ? [data.start ? date(data.start) : '…', data.end ? date(data.end) : '…'].join(' → ')
      : t('claim.allOpen')
  const generated = parseTimestamp(data.generated_at).toLocaleDateString(locale, {
    day: 'numeric', month: 'long', year: 'numeric',
  })

  return (
    <div className="print-doc ph-mask ph-sensitive">
      <div className="print-doc-toolbar claim-toolbar">
        <div className="row">
          <div>
            <label htmlFor="cfrom">{t('journal.exportFrom')}</label>
            <input id="cfrom" type="date" value={start} onChange={(e) => setPeriod('start', e.target.value)} />
          </div>
          <div>
            <label htmlFor="cto">{t('journal.exportTo')}</label>
            <input id="cto" type="date" value={end} min={start || undefined} onChange={(e) => setPeriod('end', e.target.value)} />
          </div>
        </div>
        <label htmlFor="cnote">{t('claim.noteLabel')}</label>
        <textarea
          id="cnote"
          rows={2}
          maxLength={600}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('claim.notePlaceholder')}
        />
        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={() => window.print()} disabled={data.lines.length === 0}>
            <Icon name="download" size={15} /> {t('journal.print')}
          </button>
          <Link className="button secondary" to="/expenses">
            {t('claim.back')}
          </Link>
        </div>
      </div>

      <h1>{t('claim.docTitle')}</h1>
      <p className="doc-meta">{t('claim.from', { name: data.author_name })}</p>
      {data.other_name && <p className="doc-meta">{t('claim.to', { name: data.other_name })}</p>}
      <p className="doc-meta">{t('claim.period', { period })}</p>
      <p className="doc-meta">{t('claim.date', { date: generated })}</p>

      {data.lines.length === 0 ? (
        <p style={{ marginTop: 20 }}>{t('claim.empty')}</p>
      ) : (
        <>
          <p style={{ marginTop: 18 }}>
            {t('claim.intro', { name: data.other_name || t('claim.otherParent'), amount: cur(data.total_owed_cents) })}
          </p>
          <table>
            <thead>
              <tr>
                <th>{t('claim.colDate')}</th>
                <th>{t('claim.colLabel')}</th>
                <th className="num">{t('claim.colPaid')}</th>
                <th className="num">{t('claim.colShare')}</th>
                <th className="num">{t('claim.colOwed')}</th>
              </tr>
            </thead>
            <tbody>
              {data.lines.map((l) => {
                const child = l.child_id !== null ? data.children[String(l.child_id)] : undefined
                const category = t(`expenses.category${l.category.charAt(0).toUpperCase()}${l.category.slice(1)}`)
                return (
                  <tr key={l.id}>
                    <td className="when">{date(l.date)}</td>
                    <td>
                      {l.label}
                      <div className="entry-sub">{[category, child].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="num">{cur(l.amount_cents)}</td>
                    <td className="num">{100 - l.payer_percent} %</td>
                    <td className="num">{cur(l.owed_cents)}</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>{t('claim.total')}</td>
                <td className="num">{cur(data.total_paid_cents)}</td>
                <td />
                <td className="num">{cur(data.total_owed_cents)}</td>
              </tr>
            </tfoot>
          </table>
          {note.trim() && <p className="entry-body claim-note">{note.trim()}</p>}
          <p style={{ marginTop: 18 }}>{t('claim.closing')}</p>
          <p>{data.author_name}</p>
        </>
      )}

      <div className="doc-foot">
        <p>{t('claim.footer')}</p>
      </div>
    </div>
  )
}
