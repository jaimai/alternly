import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useAuth } from '../auth'
import TopBar from '../components/TopBar'
import type { Household, WallKind, WallPost } from '../types'

const KIND_META: Record<WallKind, { label: string; icon: string }> = {
  message: { label: 'Info', icon: '💬' },
  task: { label: 'Tâche', icon: '✅' },
  question: { label: 'Question', icon: '❓' },
}

export default function WallPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [household, setHousehold] = useState<Household | null>(null)
  const [posts, setPosts] = useState<WallPost[]>([])
  const [error, setError] = useState<string | null>(null)

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
    api.listWall(household.id).then(setPosts).catch(() => {})
  }, [household])

  useEffect(load, [load])

  if (!household || !user) return <div className="page-loading">Chargement…</div>

  const name = (id: number | null) =>
    id === null ? null : household.members.find((m) => m.id === id)?.display_name ?? '?'
  const childName = (id: number | null) =>
    id === null ? null : household.children.find((c) => c.id === id)?.first_name ?? null

  return (
    <>
      <TopBar householdName={household.name} />
      <div className="layout" style={{ maxWidth: 720 }}>
        <h1>Mur de communication</h1>
        {error && <div className="error">{error}</div>}

        <Composer household={household} onDone={load} />

        {posts.length === 0 && <p className="hint">Rien sur le mur pour l'instant.</p>}
        {posts.map((p) => {
          const meta = KIND_META[p.kind]
          const done = p.completed_at !== null
          return (
            <div key={p.id} className="card" style={{ padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span className="tag tag-accepted">{meta.icon} {meta.label}</span>
                <span className="hint">{name(p.author_id)}</span>
                {childName(p.child_id) && <span className="hint">· {childName(p.child_id)}</span>}
                {p.due_date && <span className="hint">· 📅 {p.due_date}</span>}
                {p.assigned_to && <span className="hint">· pour {name(p.assigned_to)}</span>}
                <span className="hint" style={{ marginLeft: 'auto' }}>{p.created_at.slice(0, 10)}</span>
              </div>
              <p style={{ margin: '8px 0 0', textDecoration: done ? 'line-through' : 'none', opacity: done ? 0.6 : 1 }}>
                {p.body}
              </p>

              <div className="row" style={{ gap: 8, marginTop: 10, alignItems: 'center' }}>
                {(p.kind === 'task' || p.kind === 'question') &&
                  (done ? (
                    <button className="secondary" onClick={() => api.reopenPost(household.id, p.id).then(load)}>
                      Rouvrir
                    </button>
                  ) : (
                    <button onClick={() => api.completePost(household.id, p.id).then(load)}>
                      {p.kind === 'task' ? 'Marquer fait' : 'Marquer résolu'}
                    </button>
                  ))}
                {p.author_id === user.id && (
                  <button className="danger-link" onClick={() => api.deletePost(household.id, p.id).then(load)}>
                    Supprimer
                  </button>
                )}
              </div>

              <Replies post={p} householdId={household.id} myId={user.id} names={name} onChanged={load} />
            </div>
          )
        })}
      </div>
    </>
  )
}

function Composer({ household, onDone }: { household: Household; onDone: () => void }) {
  const [kind, setKind] = useState<WallKind>('message')
  const [body, setBody] = useState('')
  const [childId, setChildId] = useState<number | ''>('')
  const [dueDate, setDueDate] = useState('')
  const [assignedTo, setAssignedTo] = useState<number | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!body.trim()) {
      setError('Le message ne peut pas être vide')
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
      setBody('')
      setDueDate('')
      setAssignedTo('')
      setChildId('')
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
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
          >
            {KIND_META[k].icon} {KIND_META[k].label}
          </button>
        ))}
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={kind === 'question' ? 'Ta question à l’autre parent…' : kind === 'task' ? 'Ce qu’il y a à faire…' : 'Une info à partager…'}
        rows={2}
        style={{ width: '100%', font: 'inherit', padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', background: 'var(--surface)', color: 'var(--ink)', resize: 'vertical' }}
      />
      <div className="row" style={{ marginTop: 8 }}>
        <div>
          <label htmlFor="wch">Enfant concerné</label>
          <select id="wch" value={childId} onChange={(e) => setChildId(e.target.value === '' ? '' : Number(e.target.value))}>
            <option value="">Aucun</option>
            {household.children.map((c) => (
              <option key={c.id} value={c.id}>{c.first_name}</option>
            ))}
          </select>
        </div>
        {kind === 'task' && (
          <>
            <div>
              <label htmlFor="wdue">Échéance</label>
              <input id="wdue" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
            <div>
              <label htmlFor="wass">Pour</label>
              <select id="wass" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value === '' ? '' : Number(e.target.value))}>
                <option value="">L'un ou l'autre</option>
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
        <button onClick={submit} disabled={busy}>Publier</button>
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
  const [text, setText] = useState('')
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

  return (
    <div style={{ marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 8 }}>
      {post.replies.map((r) => (
        <div key={r.id} className="hint" style={{ display: 'flex', gap: 6, margin: '4px 0' }}>
          <strong style={{ color: 'var(--ink)' }}>{names(r.author_id)} :</strong>
          <span style={{ marginRight: 'auto' }}>{r.body}</span>
          {r.author_id === myId && (
            <button className="danger-link" style={{ padding: '0 6px' }} onClick={() => api.deleteReply(householdId, r.id).then(onChanged)}>
              ✕
            </button>
          )}
        </div>
      ))}
      <div className="row" style={{ marginTop: 6 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Répondre…"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              send()
            }
          }}
        />
        <button className="secondary" onClick={send} disabled={busy || !text.trim()} style={{ flex: '0 0 auto' }}>
          Répondre
        </button>
      </div>
    </div>
  )
}
