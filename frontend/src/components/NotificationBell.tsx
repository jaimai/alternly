import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { Notification } from '../types'

const LABELS: Record<string, (p: Record<string, string>) => string> = {
  exception_created: (p) => `Échange de garde ajouté du ${p.date_start} au ${p.date_end}${p.note ? ` — « ${p.note} »` : ''}`,
  exception_deleted: (p) => `Échange de garde annulé (${p.date_start} → ${p.date_end})`,
  rule_changed: () => 'Les règles de garde ont été modifiées',
  parent_joined: (p) => `${p.display_name} a rejoint le foyer 🎉`,
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
      <button className="bell" onClick={toggle} title="Notifications">
        🔔
        {unread.length > 0 && <span className="badge">{unread.length}</span>}
      </button>
      {open && (
        <div className="notif-panel">
          {items.length === 0 && <div className="notif-empty">Aucune notification</div>}
          {items.map((n) => (
            <div key={n.id} className={`notif-item ${n.read_at === null ? 'unread' : ''}`}>
              {(LABELS[n.type] ?? (() => n.type))(n.payload)}
              <div style={{ fontSize: '0.75rem', color: 'var(--text-soft)' }}>
                {new Date(n.created_at + 'Z').toLocaleString('fr-FR')}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
