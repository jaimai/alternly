import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useAuth } from '../auth'
import { useConfirm } from '../components/Modal'
import TopBar from '../components/TopBar'
import { daysBetween, fmtDay, fmtTimestamp, todayIso } from '../dates'
import type { Household, Member, WallKind, WallPost } from '../types'

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
    api
      .listWall(household.id)
      .then(setPosts)
      .catch((err) => setError(err instanceof Error ? err.message : 'Chargement impossible'))
  }, [household])

  useEffect(load, [load])

  if (!household || !user) return <div className="page-loading">Chargement…</div>

  const member = (id: number | null) => household.members.find((m) => m.id === id)
  const name = (id: number | null) =>
    id === null ? null : id === user.id ? 'vous' : member(id)?.display_name ?? '?'
  const today = todayIso()
  const childName = (id: number | null) =>
    id === null ? null : household.children.find((c) => c.id === id)?.first_name ?? null

  return (
    <>
      <TopBar householdName={household.name} />
      <div className="layout narrow">
        <h1>Mur</h1>
        <p className="hint" style={{ marginTop: 0 }}>Infos, tâches et questions entre parents, au même endroit.</p>
        {error && <div className="error">{error}</div>}

        <Composer household={household} myId={user.id} onDone={load} />

        {posts.length === 0 && (
          <div className="empty-state">
            <span className="empty-icon" aria-hidden="true">💬</span>
            <h2>Le mur est vide</h2>
            <p>
              Réunion parents-profs, carnet à signer, doudou oublié… Publiez une info ou une tâche : l'autre parent est
              prévenu, et les tâches datées apparaissent sur le calendrier.
            </p>
          </div>
        )}
        {posts.map((p) => {
          const meta = KIND_META[p.kind]
          const done = p.completed_at !== null
          const author = member(p.author_id)
          const checkable = p.kind === 'task' || p.kind === 'question'
          const overdue = !done && p.due_date !== null && p.due_date < today
          return (
            <article key={p.id} className={`post${done ? ' done' : ''}`}>
              <Avatar member={author} />
              <div className="post-body">
                <div className="post-meta">
                  <strong>{author ? (author.id === user.id ? 'Vous' : author.display_name) : '?'}</strong>
                  <span className={`kind kind-${p.kind}`}>{meta.label}</span>
                  <span className="hint">{fmtTimestamp(p.created_at)}</span>
                </div>
                <div className="post-content">
                  {checkable && (
                    <input
                      type="checkbox"
                      className="check"
                      checked={done}
                      aria-label={done ? 'Rouvrir' : p.kind === 'task' ? 'Marquer comme fait' : 'Marquer comme résolue'}
                      onChange={() =>
                        (done ? api.reopenPost(household.id, p.id) : api.completePost(household.id, p.id)).then(load)
                      }
                    />
                  )}
                  <p>{p.body}</p>
                </div>
                {(childName(p.child_id) || p.due_date || p.assigned_to) && (
                  <div className="post-tags">
                    {childName(p.child_id) && <span className="chip small">{childName(p.child_id)}</span>}
                    {p.due_date && (
                      <span className={`chip small${overdue ? ' warn' : ''}`}>
                        📅 {fmtDay(p.due_date)}
                        {!done && daysBetween(today, p.due_date) === 0 ? " · aujourd'hui" : ''}
                        {overdue ? ' · en retard' : ''}
                      </span>
                    )}
                    {p.assigned_to && <span className="chip small">pour {name(p.assigned_to)}</span>}
                  </div>
                )}
                {p.author_id === user.id && (
                  <div className="row-actions">
                    <button
                      className="link danger-text"
                      onClick={async () => {
                        if (
                          await confirm({
                            title: 'Supprimer ce message ?',
                            body: 'Il disparaîtra aussi pour l’autre parent, avec ses réponses.',
                            confirmLabel: 'Supprimer',
                            danger: true,
                          })
                        )
                          api.deletePost(household.id, p.id).then(load)
                      }}
                    >
                      Supprimer
                    </button>
                  </div>
                )}
                <Replies post={p} householdId={household.id} myId={user.id} names={name} onChanged={load} />
              </div>
            </article>
          )
        })}
      </div>
      {confirmNode}
    </>
  )
}

function Avatar({ member }: { member?: Member }) {
  return (
    <span className="avatar" style={{ background: member?.color ?? 'var(--line)' }} aria-hidden="true">
      {member?.display_name.charAt(0).toUpperCase() ?? '?'}
    </span>
  )
}

function Composer({ household, myId, onDone }: { household: Household; myId: number; onDone: () => void }) {
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
    <div className="card composer">
      <div className="segmented" role="radiogroup" aria-label="Type de message">
        {(['message', 'task', 'question'] as WallKind[]).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            className={kind === k ? 'on' : ''}
            onClick={() => setKind(k)}
          >
            <span aria-hidden="true">{KIND_META[k].icon}</span> {KIND_META[k].label}
          </button>
        ))}
      </div>
      <label htmlFor="wbody" className="sr-only">Message</label>
      <textarea
        id="wbody"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={kind === 'question' ? 'Votre question à l’autre parent…' : kind === 'task' ? 'Ce qu’il y a à faire…' : 'Une info à partager…'}
        rows={2}
        maxLength={2000}
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
                  <option key={m.id} value={m.id}>{m.id === myId ? `${m.display_name} (vous)` : m.display_name}</option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>
      {error && <div className="error">{error}</div>}
      <div className="actions end" style={{ marginTop: 12 }}>
        <button onClick={submit} disabled={busy || !body.trim()}>Publier</button>
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
    <div className="replies">
      {post.replies.map((r) => (
        <div key={r.id} className="reply">
          <strong>{r.author_id === myId ? 'Vous' : names(r.author_id)}</strong>
          <span className="reply-text">{r.body}</span>
          {r.author_id === myId && (
            <button
              className="link danger-text"
              aria-label="Supprimer ma réponse"
              title="Supprimer ma réponse"
              onClick={() => api.deleteReply(householdId, r.id).then(onChanged)}
            >
              ✕
            </button>
          )}
        </div>
      ))}
      <div className="reply-form">
        <input
          aria-label="Répondre"
          maxLength={2000}
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
        {text.trim() && (
          <button className="secondary" onClick={send} disabled={busy}>
            Envoyer
          </button>
        )}
      </div>
    </div>
  )
}
