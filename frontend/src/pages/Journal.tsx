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
import type { Household, JournalEntry, JournalKind } from '../types'

const JOURNAL_KINDS: { kind: JournalKind; icon: IconName }[] = [
  { kind: 'handover', icon: 'swap' },
  { kind: 'late', icon: 'clock' },
  { kind: 'missed', icon: 'alert' },
  { kind: 'change', icon: 'calendar' },
  { kind: 'health', icon: 'health' },
  { kind: 'school', icon: 'school' },
  { kind: 'expense', icon: 'receipt' },
  { kind: 'incident', icon: 'flag' },
  { kind: 'other', icon: 'note' },
]
const ICON = Object.fromEntries(JOURNAL_KINDS.map((k) => [k.kind, k.icon])) as Record<JournalKind, IconName>

// Journal de garde : notes factuelles, datées, privées à leur auteur, exportables en PDF.
export default function JournalPage() {
  const { t } = useTranslation()
  const { dayLong, monthYear, timestamp } = useFormat()
  const navigate = useNavigate()
  const { household, householdLoaded } = useAuth()
  const [entries, setEntries] = useState<JournalEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<JournalEntry | 'new' | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [confirm, confirmNode] = useConfirm()

  useEffect(() => {
    if (householdLoaded && !household) navigate('/onboarding', { replace: true })
  }, [householdLoaded, household, navigate])

  const load = useCallback(() => {
    if (!household) return
    api
      .listJournal(household.id)
      .then(setEntries)
      .catch(() => setError(t('journal.loadError')))
      .finally(() => setLoaded(true))
  }, [household, t])

  useEffect(load, [load])

  if (!household) return <Spinner />
  const childName = (id: number | null) => household.children.find((c) => c.id === id)?.first_name ?? null

  async function remove(e: JournalEntry) {
    const ok = await confirm({
      title: t('journal.deleteConfirmTitle'),
      body: t('journal.deleteConfirmBody'),
      confirmLabel: t('journal.delete'),
      danger: true,
    })
    if (!ok) return
    await api.deleteJournalEntry(household!.id, e.id)
    load()
  }

  // Regroupement par mois (entrées déjà triées du plus récent au plus ancien).
  const months = new Map<string, JournalEntry[]>()
  for (const e of entries) {
    const key = e.day.slice(0, 7)
    months.set(key, [...(months.get(key) ?? []), e])
  }

  return (
    <>
      <TopBar householdName={household.name} />
      <div className="layout narrow ph-mask ph-sensitive">
        <div className="journal-head">
          <h1>{t('journal.title')}</h1>
          <div className="journal-actions">
            {entries.length > 0 && (
              <button className="secondary" onClick={() => setExportOpen(true)}>
                <Icon name="download" size={15} /> {t('journal.export')}
              </button>
            )}
            <button onClick={() => setEditing(editing === 'new' ? null : 'new')}>
              <Icon name={editing === 'new' ? 'x' : 'plus'} size={15} />{' '}
              {editing === 'new' ? t('journal.close') : t('journal.new')}
            </button>
          </div>
        </div>
        <p className="hint" style={{ marginTop: 0 }}>{t('journal.subtitle')}</p>
        <p className="journal-private">
          <Icon name="lock" size={13} /> {t('journal.private')}
        </p>
        {error && <div className="error">{error}</div>}

        {editing === 'new' && (
          <EntryForm
            household={household}
            onDone={() => {
              setEditing(null)
              load()
            }}
          />
        )}

        {!loaded && <Spinner inline />}
        {loaded && entries.length === 0 && !error && editing !== 'new' && (
          <div className="empty-state">
            <span className="empty-icon" aria-hidden="true">
              <Icon name="note" size={24} />
            </span>
            <h2>{t('journal.emptyTitle')}</h2>
            <p>{t('journal.emptyBody')}</p>
            <button onClick={() => setEditing('new')}>{t('journal.new')}</button>
          </div>
        )}

        {[...months.entries()].map(([month, items]) => (
          <section key={month} className="list-group">
            <h2 className="section-label">{monthYear(`${month}-01`)}</h2>
            <div className="list-card">
              {items.map((e) =>
                editing !== 'new' && editing?.id === e.id ? (
                  <div key={e.id} className="list-row">
                    <EntryForm
                      household={household}
                      entry={e}
                      onDone={() => {
                        setEditing(null)
                        load()
                      }}
                      onCancel={() => setEditing(null)}
                    />
                  </div>
                ) : (
                  <article key={e.id} className="list-row journal-row">
                    <span className="journal-icon" aria-hidden="true">
                      <Icon name={ICON[e.kind]} size={16} />
                    </span>
                    <div className="list-main">
                      <div className="journal-meta">
                        <strong>{dayLong(e.day)}</strong>
                        {e.time && <span>{e.time}</span>}
                        <span className="tag">{t(`journal.kind.${e.kind}`)}</span>
                        {childName(e.child_id) && <span className="hint">{childName(e.child_id)}</span>}
                      </div>
                      <p className="journal-body">{e.body}</p>
                      <div className="hint journal-foot">
                        <span>
                          {timestamp(e.created_at)}
                          {e.edited_at && ` · ${t('journal.edited')}`}
                        </span>
                        <span className="journal-row-actions">
                          <button className="journal-link" onClick={() => setEditing(e)}>
                            {t('journal.edit')}
                          </button>
                          <button className="danger-link" onClick={() => remove(e)}>
                            {t('journal.delete')}
                          </button>
                        </span>
                      </div>
                    </div>
                  </article>
                ),
              )}
            </div>
          </section>
        ))}
      </div>
      {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
      {confirmNode}
    </>
  )
}

function EntryForm({
  household,
  entry,
  onDone,
  onCancel,
}: {
  household: Household
  entry?: JournalEntry
  onDone: () => void
  onCancel?: () => void
}) {
  const { t } = useTranslation()
  const [day, setDay] = useState(entry?.day ?? todayIso())
  const [time, setTime] = useState(entry?.time ?? '')
  const [kind, setKind] = useState<JournalKind>(entry?.kind ?? 'handover')
  const [childId, setChildId] = useState<number | ''>(entry?.child_id ?? '')
  const [body, setBody] = useState(entry?.body ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!body.trim()) {
      setError(t('journal.emptyBodyError'))
      return
    }
    setBusy(true)
    setError(null)
    const data = {
      day,
      time: time || null,
      kind,
      child_id: childId === '' ? null : Number(childId),
      body: body.trim(),
    }
    try {
      if (entry) await api.updateJournalEntry(household.id, entry.id, data)
      else await api.createJournalEntry(household.id, data)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('journal.genericError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={entry ? 'journal-form' : 'card journal-form'}>
      <div className="journal-kinds" role="radiogroup" aria-label={t('journal.kindLabel')}>
        {JOURNAL_KINDS.map(({ kind: k, icon }) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            className={kind === k ? 'journal-kind active' : 'journal-kind'}
            onClick={() => setKind(k)}
          >
            <Icon name={icon} size={14} /> {t(`journal.kind.${k}`)}
          </button>
        ))}
      </div>
      <div className="row">
        <div>
          <label htmlFor="jday">{t('journal.dayLabel')}</label>
          <input id="jday" type="date" value={day} max={todayIso()} onChange={(e) => setDay(e.target.value)} required />
        </div>
        <div>
          <label htmlFor="jtime">{t('journal.timeLabel')}</label>
          <input id="jtime" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </div>
        {household.children.length > 0 && (
          <div>
            <label htmlFor="jchild">{t('journal.childLabel')}</label>
            <select
              id="jchild"
              value={childId}
              onChange={(e) => setChildId(e.target.value === '' ? '' : Number(e.target.value))}
            >
              <option value="">{t('journal.childNone')}</option>
              {household.children.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.first_name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <label htmlFor="jbody">{t('journal.bodyLabel')}</label>
      <textarea
        id="jbody"
        value={body}
        autoFocus={!entry}
        maxLength={2000}
        rows={3}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t('journal.bodyPlaceholder')}
      />
      <p className="hint">{t('journal.tip')}</p>
      {error && <div className="error">{error}</div>}
      <div className="row">
        <button onClick={submit} disabled={busy || !day}>
          {busy ? t('journal.saving') : t('journal.save')}
        </button>
        {onCancel && (
          <button className="secondary" onClick={onCancel}>
            {t('journal.close')}
          </button>
        )}
      </div>
    </div>
  )
}

function ExportDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')

  function open() {
    const params = new URLSearchParams()
    if (start) params.set('start', start)
    if (end) params.set('end', end)
    const qs = params.toString()
    navigate(`/journal/export${qs ? `?${qs}` : ''}`)
  }

  return (
    <Modal title={t('journal.exportTitle')} onClose={onClose}>
      <div className="row">
        <div>
          <label htmlFor="jfrom">{t('journal.exportFrom')}</label>
          <input id="jfrom" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div>
          <label htmlFor="jto">{t('journal.exportTo')}</label>
          <input id="jto" type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      <p className="hint">{t('journal.exportHint')}</p>
      <div className="row" style={{ marginTop: 12 }}>
        <button onClick={open}>{t('journal.exportOpen')}</button>
      </div>
    </Modal>
  )
}
