import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { Notification } from '../types'

function range(p: Record<string, string>): string {
  return p.date_start === p.date_end ? p.date_start : `${p.date_start} → ${p.date_end}`
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
}

function euros(cents: string): string {
  return (Number(cents) / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })
}

export default function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const timer = useRef<number | undefined>(undefined)

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
    <>
      <button className="bell" onClick={toggle} title="Notifications" aria-label="Notifications">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread.length > 0 && <span className="badge">{unread.length}</span>}
      </button>
      {open && (
        <div className="notif-panel">
          {items.length === 0 && <div className="notif-empty">Aucune notification</div>}
          {items.map((n) => (
            <div key={n.id} className={`notif-item ${n.read_at === null ? 'unread' : ''}`}>
              {(LABELS[n.type] ?? (() => n.type))(n.payload)}
              <div className="date">
                {new Date(n.created_at + 'Z').toLocaleString('fr-FR')}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
