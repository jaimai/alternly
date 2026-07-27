import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import Icon from '../components/Icon'
import type { IconName } from '../components/Icon'
import Spinner from '../components/Spinner'
import TopBar from '../components/TopBar'
import { useFormat } from '../format'
import type { Household, WallKind, WallPost } from '../types'

const KIND_META: Record<WallKind, { labelKey: string; icon: IconName; tag: string }> = {
  message: { labelKey: 'wall.kindInfo', icon: 'message', tag: 'tag-message' },
  task: { labelKey: 'wall.kindTask', icon: 'task', tag: 'tag-task' },
  question: { labelKey: 'wall.kindQuestion', icon: 'question', tag: 'tag-question' },
}

type Segment = 'todo' | 'questions' | 'infos' | 'all'
const SEGMENTS: { value: Segment; labelKey: string }[] = [
  { value: 'todo', labelKey: 'wall.segTodo' },
  { value: 'questions', labelKey: 'wall.segQuestions' },
  { value: 'infos', labelKey: 'wall.segInfos' },
  { value: 'all', labelKey: 'wall.segAll' },
]

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export default function WallPage() {
  const { t } = useTranslation()
  const { date } = useFormat()
  const navigate = useNavigate()
  const { user, household, householdLoaded } = useAuth()
  const [posts, setPosts] = useState<WallPost[]>([])
  const [error, setError] = useState<string | null>(null)
  const [segment, setSegment] = useState<Segment>('todo')
  const [query, setQuery] = useState('')
  const [showComposer, setShowComposer] = useState(false)
  const [showDone, setShowDone] = useState(false)

  useEffect(() => {
    if (householdLoaded && (!household || !household.custody_rule)) navigate('/onboarding')
  }, [householdLoaded, household, navigate])

  const load = useCallback(() => {
    if (!household) return
    api.listWall(household.id).then(setPosts).catch(() => setError(t('wall.loadError')))
  }, [household])

  useEffect(load, [load])

  const childName = useCallback(
    (id: number | null) =>
      id === null ? null : household?.children.find((c) => c.id === id)?.first_name ?? null,
    [household],
  )

  const q = query.trim().toLowerCase()
  const matches = useCallback(
    (p: WallPost) => {
      if (!q) return true
      const child = childName(p.child_id)?.toLowerCase() ?? ''
      return p.body.toLowerCase().includes(q) || child.includes(q)
    },
    [q, childName],
  )

  const openCounts = useMemo(() => {
    const todo = posts.filter((p) => p.kind === 'task' && !p.completed_at).length
    const questions = posts.filter((p) => p.kind === 'question' && !p.completed_at).length
    return { todo, questions }
  }, [posts])

  if (!household || !user) return <Spinner />

  const name = (id: number | null) =>
    id === null ? null : household.members.find((m) => m.id === id)?.display_name ?? '?'

  // Sélection du segment courant
  const inSegment = (p: WallPost) => {
    if (segment === 'all') return true
    if (segment === 'todo') return p.kind === 'task'
    if (segment === 'questions') return p.kind === 'question'
    return p.kind === 'message'
  }
  const pool = posts.filter(inSegment).filter(matches)

  const closable = segment === 'todo' || segment === 'questions'
  const open = closable ? pool.filter((p) => !p.completed_at) : pool
  const done = closable ? pool.filter((p) => p.completed_at) : []

  // Tri : tâches par échéance (datées d'abord), sinon plus récent en premier
  const sortOpen = (a: WallPost, b: WallPost) => {
    if (segment === 'todo') {
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
      if (a.due_date) return -1
      if (b.due_date) return 1
    }
    return b.created_at.localeCompare(a.created_at)
  }
  const openSorted = [...open].sort(sortOpen)
  const allSorted = segment === 'all' ? [...pool].sort((a, b) => b.created_at.localeCompare(a.created_at)) : openSorted

  const today = todayIso()

  function renderItem(p: WallPost) {
    const meta = KIND_META[p.kind]
    const isDone = p.completed_at !== null
    const actionable = p.kind === 'task' || p.kind === 'question'
    const overdue = p.kind === 'task' && !isDone && p.due_date !== null && p.due_date < today
    return (
      <div key={p.id} className={`card wall-item${isDone ? ' done' : ''}`} style={{ padding: 14 }}>
        <div className="wall-head">
          {actionable && (
            <button
              className={`wall-check${isDone ? ' checked' : ''}`}
              title={isDone ? t('wall.reopen') : p.kind === 'task' ? t('wall.markDone') : t('wall.markResolved')}
              onClick={() =>
                (isDone ? api.reopenPost(household!.id, p.id) : api.completePost(household!.id, p.id)).then(load)
              }
            >
              <Icon name="check" size={14} />
            </button>
          )}
          <span className={`tag ${meta.tag}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name={meta.icon} size={12} /> {t(meta.labelKey)}
          </span>
          {overdue && <span className="tag tag-overdue">{t('wall.overdue')}</span>}
          {childName(p.child_id) && <span className="hint">{childName(p.child_id)}</span>}
          {p.due_date && (
            <span className="hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              <Icon name="calendar" size={12} /> {date(p.due_date)}
            </span>
          )}
          {p.assigned_to && <span className="hint">{t('wall.forWhom', { name: name(p.assigned_to) })}</span>}
          <span className="hint" style={{ marginLeft: 'auto' }}>{name(p.author_id)} · {date(p.created_at.slice(0, 10))}</span>
        </div>
        <p className="wall-body">{p.body}</p>
        <Replies post={p} householdId={household!.id} myId={user!.id} names={name} onChanged={load} />
        {p.author_id === user!.id && (
          <button
            className="danger-link"
            style={{ marginTop: 8 }}
            onClick={() => api.deletePost(household!.id, p.id).then(load)}
          >
            {t('wall.delete')}
          </button>
        )}
      </div>
    )
  }

  const emptyLabel =
    q !== ''
      ? t('wall.emptySearch')
      : segment === 'todo'
        ? t('wall.emptyTodo')
        : segment === 'questions'
          ? t('wall.emptyQuestions')
          : t('wall.emptyDefault')

  return (
    <>
      <TopBar householdName={household.name} />
      <div className="layout" style={{ maxWidth: 720 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ marginRight: 'auto' }}>{t('wall.title')}</h1>
          <button className="wall-fab" onClick={() => setShowComposer((v) => !v)}>
            <Icon name={showComposer ? 'x' : 'plus'} size={16} /> {showComposer ? t('wall.close') : t('wall.new')}
          </button>
        </div>
        {error && <div className="error">{error}</div>}

        {showComposer && (
          <Composer
            household={household}
            onDone={() => {
              setShowComposer(false)
              load()
            }}
          />
        )}

        <div className="wall-toolbar">
          <div className="segbar">
            {SEGMENTS.map((s) => {
              const count = s.value === 'todo' ? openCounts.todo : s.value === 'questions' ? openCounts.questions : 0
              return (
                <button
                  key={s.value}
                  className={`seg${segment === s.value ? ' active' : ''}`}
                  onClick={() => {
                    setSegment(s.value)
                    setShowDone(false)
                  }}
                >
                  {t(s.labelKey)}
                  {count > 0 && <span className="count">{count}</span>}
                </button>
              )
            })}
          </div>
          <div className="wall-search">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('wall.searchPlaceholder')}
              aria-label={t('wall.searchAria')}
            />
          </div>
        </div>

        {allSorted.length === 0 && done.length === 0 && <p className="hint">{emptyLabel}</p>}
        {allSorted.map(renderItem)}

        {closable && done.length > 0 && (
          <>
            <button
              className="expense-group-title"
              style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'block' }}
              onClick={() => setShowDone((v) => !v)}
            >
              {showDone ? '▾' : '▸'} {done.length} {t(segment === 'todo' ? 'wall.doneTask' : 'wall.doneQuestion')}{done.length > 1 ? 's' : ''}
            </button>
            {showDone && done.map(renderItem)}
          </>
        )}
      </div>
    </>
  )
}

function Composer({ household, onDone }: { household: Household; onDone: () => void }) {
  const { t } = useTranslation()
  const [kind, setKind] = useState<WallKind>('message')
  const [body, setBody] = useState('')
  const [childId, setChildId] = useState<number | ''>('')
  const [dueDate, setDueDate] = useState('')
  const [assignedTo, setAssignedTo] = useState<number | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!body.trim()) {
      setError(t('wall.emptyBodyError'))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.createPost(household.id, {
        kind,
        body: body.trim(),
        child_id: childId === '' ? null : Number(childId),
        due_date: kind === 'task' && dueDate ? dueDate : null,
        assigned_to: kind === 'task' && assignedTo !== '' ? Number(assignedTo) : null,
      })
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('wall.genericError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 8 }}>
        {(['message', 'task', 'question'] as WallKind[]).map((k) => (
          <button
            key={k}
            type="button"
            className={kind === k ? '' : 'secondary'}
            onClick={() => setKind(k)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name={KIND_META[k].icon} size={15} /> {t(KIND_META[k].labelKey)}
          </button>
        ))}
      </div>
      <textarea
        value={body}
        autoFocus
        onChange={(e) => setBody(e.target.value)}
        placeholder={kind === 'question' ? t('wall.placeholderQuestion') : kind === 'task' ? t('wall.placeholderTask') : t('wall.placeholderInfo')}
        rows={2}
        style={{ width: '100%', font: 'inherit', padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', background: 'var(--surface)', color: 'var(--ink)', resize: 'vertical' }}
      />
      <div className="row" style={{ marginTop: 8 }}>
        <div>
          <label htmlFor="wch">{t('wall.childLabel')}</label>
          <select id="wch" value={childId} onChange={(e) => setChildId(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">{t('wall.childNone')}</option>
            {household.children.map((c) => (
              <option key={c.id} value={c.id}>{c.first_name}</option>
            ))}
          </select>
        </div>
        {kind === 'task' && (
          <>
            <div>
              <label htmlFor="wdue">{t('wall.dueLabel')}</label>
              <input id="wdue" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div>
              <label htmlFor="wass">{t('wall.assignLabel')}</label>
              <select id="wass" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value === '' ? '' : Number(e.target.value))}>
                <option value="">{t('wall.assignAnyone')}</option>
                {household.members.map((m) => (
                  <option key={m.id} value={m.id}>{m.display_name}</option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      <div style={{ marginTop: 12 }}>
        <button onClick={submit} disabled={busy}>{t('wall.publish')}</button>
      </div>
    </div>
  )
}

function Replies({
  post,
  householdId,
  myId,
  names,
  onChanged,
}: {
  post: WallPost
  householdId: number
  myId: number
  names: (id: number | null) => string | null
  onChanged: () => void
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function send() {
    if (!text.trim()) return
    setBusy(true)
    try {
      await api.addReply(householdId, post.id, text.trim())
      setText('')
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const count = post.replies.length
  if (!open && count === 0) {
    return (
      <button className="danger-link" style={{ marginTop: 8, color: 'var(--ink-soft)' }} onClick={() => setOpen(true)}>
        {t('wall.reply')}
      </button>
    )
  }

  return (
    <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
      {post.replies.map((r) => (
        <div key={r.id} className="hint" style={{ display: 'flex', gap: 6, margin: '4px 0' }}>
          <strong style={{ color: 'var(--ink)' }}>{t('wall.replyAuthor', { name: names(r.author_id) })}</strong>
          <span style={{ marginRight: 'auto' }}>{r.body}</span>
          {r.author_id === myId && (
            <button className="danger-link" style={{ padding: '0 6px' }} onClick={() => api.deleteReply(householdId, r.id).then(onChanged)}>
              <Icon name="x" size={12} />
            </button>
          )}
        </div>
      ))}
      <div className="row" style={{ marginTop: 6 }}>
        <input
          value={text}
          autoFocus={open && count === 0}
          onChange={(e) => setText(e.target.value)}
          placeholder={t('wall.replyPlaceholder')}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              send()
            }
          }}
        />
        <button className="secondary" onClick={send} disabled={busy || !text.trim()} style={{ flex: '0 0 auto' }}>
          {t('wall.send')}
        </button>
      </div>
    </div>
  )
}
