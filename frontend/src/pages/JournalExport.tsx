import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import Icon from '../components/Icon'
import Spinner from '../components/Spinner'
import { parseTimestamp } from '../dates'
import { useFormat } from '../format'
import type { JournalExport } from '../types'

// Export du journal de garde : document sobre (noir sur blanc), à imprimer ou
// enregistrer en PDF depuis le navigateur. Pas de TopBar : la page est le document.
export default function JournalExportPage() {
  const { t, i18n } = useTranslation()
  const { date, dayLong } = useFormat()
  const { household } = useAuth()
  const [params] = useSearchParams()
  const [data, setData] = useState<JournalExport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const start = params.get('start') ?? undefined
  const end = params.get('end') ?? undefined

  useEffect(() => {
    if (!household) return
    api
      .exportJournal(household.id, start, end)
      .then(setData)
      .catch(() => setError(t('journal.loadError')))
  }, [household, start, end, t])

  useEffect(() => {
    if (data) document.title = `${t('journal.docTitle')} — ${data.author_name}`
  }, [data, t])

  if (error) return <div className="print-doc"><div className="error">{error}</div></div>
  if (!data) return <Spinner />

  const locale = i18n.language.startsWith('en') ? 'en-US' : 'fr-FR'
  // Horodatage complet avec l'année : le document peut couvrir plusieurs années.
  const stamp = (ts: string) =>
    parseTimestamp(ts).toLocaleString(locale, {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  const period =
    data.start || data.end
      ? [data.start ? date(data.start) : '…', data.end ? date(data.end) : '…'].join(' → ')
      : t('journal.docAllPeriod')
  const children = Object.values(data.children)
  // Ordre chronologique dans le document (l'API renvoie le plus récent d'abord).
  const entries = [...data.entries].reverse()

  return (
    <div className="print-doc ph-mask ph-sensitive">
      <div className="print-doc-toolbar">
        <button onClick={() => window.print()}>
          <Icon name="download" size={15} /> {t('journal.print')}
        </button>
        <Link className="button secondary" to="/journal">
          {t('journal.back')}
        </Link>
      </div>

      <h1>{t('journal.docTitle')}</h1>
      <p className="doc-meta">{t('journal.docBy', { name: data.author_name, household: data.household_name })}</p>
      <p className="doc-meta">{t('journal.docPeriod', { period })}</p>
      {children.length > 0 && (
        <p className="doc-meta">
          {t('journal.docChildren', {
            children: new Intl.ListFormat(locale, { type: 'conjunction' }).format(children),
          })}
        </p>
      )}
      <p className="doc-meta">{t('journal.docCount', { count: entries.length })}</p>

      {entries.length === 0 ? (
        <p style={{ marginTop: 20 }}>{t('journal.docEmpty')}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>{t('journal.dayLabel')}</th>
              <th>{t('journal.kindLabel')}</th>
              <th>{t('journal.bodyLabel')}</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const child = e.child_id !== null ? data.children[String(e.child_id)] : undefined
              const scheduled = data.scheduled[e.day]
              return (
                <tr key={e.id}>
                  <td className="when">
                    {dayLong(e.day)} {e.day.slice(0, 4)}
                    {e.time && <div>{e.time}</div>}
                  </td>
                  <td>{t(`journal.kind.${e.kind}`)}</td>
                  <td>
                    <p className="entry-body">{e.body}</p>
                    <div className="entry-sub">
                      {[
                        child && t('journal.docChild', { name: child }),
                        scheduled && t('journal.docScheduled', { name: scheduled }),
                        t('journal.docRecorded', { date: stamp(e.created_at) }),
                        e.edited_at && t('journal.docEdited', { date: stamp(e.edited_at) }),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <div className="doc-foot">
        <p>{t('journal.docGenerated', { date: stamp(data.generated_at) })}</p>
        <p>{t('journal.docDisclaimer')}</p>
      </div>
    </div>
  )
}
