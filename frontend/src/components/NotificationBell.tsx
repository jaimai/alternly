import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { fmtRange, fmtTimestamp } from '../dates'
import type { Notification } from '../types'

function range(p: Record<string, string>): string {
  return p.date_start ? fmtRange(p.date_start, p.date_end ?? p.date_start) : ''
}

// Où mène un clic sur la notification.
function target(type: string): string {
  if (type.startsWith('expense_') || type.startsWith('settlement_')) return '/expenses'
  if (type.startsWith('wall_')) return '/wall'
  if (type === 'parent_joined') return '/settings'
  return '/'
}

const LABELS: Record<string, (p: Record<string, string>) => string> = {
  exchange_proposed: (p) => `Nouvel échange proposé (${range(p)})${p.note ? ` — « ${p.note} »` : ''} — à accepter ou refuser`,
  exchange_accepted: (p) => `Votre proposition d'échange a été acceptée ✅ (${range(p)})`,
  exchange_refused: (p) => `Votre proposition d'échange a été refusée (${range(p)})`,
  exchange_withdrawn: (p) => `Une proposition d'échange a été retirée (${range(p)})`,
  exception_deleted: (p) => `Échange de garde annulé (${range(p)})`,
  rule_changed: () => 'Les règles de garde ont été modifiées',
  parent_joined: (p) => `${p.display_name} a rejoint le foyer 🎉`,
  expense_added: (p) => `Nouvelle dépense « ${p.label} » (${euros(p.amount_cents)})`,
  expense_disputed: (p) => `Votre dépense « ${p.label} » a été contestée`,
  expense_resolved: (p) => `La contestation sur « ${p.label} » a été levée`,
  settlement_recorded: (p) => `Remboursement enregistré (${euros(p.amount_cents)})`,
  wall_post_added: (p) => `Nouveau sur le mur : « ${p.body} »`,
  wall_reply_added: (p) => `Nouvelle réponse : « ${p.body} »`,
  wall_task_assigned: (p) => `Une tâche vous a été assignée : « ${p.body} »`,
}

function euros(cents: string): string {
  return (Number(cents) / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
}

export default function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const root = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  async function refresh() {
    try {
      setItems(await api.notifications())
    } catch {
      /* silencieux : la cloche ne doit jamais casser la page */
    }
  }

  useEffect(() => {
    refresh()
    timer.current = window.setInterval(refresh, 60_000)
    return () => window.clearInterval(timer.current)
  }, [])

  // Fermeture : Échap ou clic en dehors du panneau.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    const onClick = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  const unread = items.filter((n) => n.read_at === null)

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && unread.length) {
      await api.markRead(unread.map((n) => n.id))
      refresh()
    }
  }

  return (
    <div ref={root} className="bell-wrap">
      <button className="bell" onClick={toggle} title="Notifications" aria-label="Notifications" aria-expanded={open}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread.length > 0 && <span className="badge">{unread.length}</span>}
      </button>
      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-head">Notifications</div>
          {items.length === 0 && (
            <div className="notif-empty">
              <span aria-hidden="true">🔔</span>
              Rien de neuf. Les échanges, dépenses et messages de l'autre parent apparaîtront ici.
            </div>
          )}
          {items.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`notif-item ${n.read_at === null ? 'unread' : ''}`}
              onClick={() => {
                setOpen(false)
                navigate(target(n.type))
              }}
            >
              {(LABELS[n.type] ?? (() => n.type))(n.payload)}
              <span className="date">{fmtTimestamp(n.created_at)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
