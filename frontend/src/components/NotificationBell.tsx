import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { useFormat } from '../format'
import type { Notification } from '../types'

export default function NotificationBell() {
  const { t, i18n } = useTranslation()
  const { money, date } = useFormat()
  const [items, setItems] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  function range(p: Record<string, string>): string {
    return p.date_start === p.date_end
      ? date(p.date_start)
      : `${date(p.date_start)} → ${date(p.date_end)}`
  }

  function message(n: Notification): string {
    const p = n.payload
    switch (n.type) {
      case 'exchange_proposed':
        return p.note
          ? t('common.notifExchangeProposedNote', { range: range(p), note: p.note })
          : t('common.notifExchangeProposed', { range: range(p) })
      case 'exchange_accepted':
        return t('common.notifExchangeAccepted', { range: range(p) })
      case 'exchange_refused':
        return t('common.notifExchangeRefused', { range: range(p) })
      case 'exchange_withdrawn':
        return t('common.notifExchangeWithdrawn', { range: range(p) })
      case 'exception_deleted':
        return t('common.notifExceptionDeleted', { range: range(p) })
      case 'rule_changed':
        return t('common.notifRuleChanged')
      case 'parent_joined':
        return t('common.notifParentJoined', { name: p.display_name })
      case 'expense_added':
        return t('common.notifExpenseAdded', { label: p.label, amount: money(Number(p.amount_cents)) })
      case 'expense_disputed':
        return t('common.notifExpenseDisputed', { label: p.label })
      case 'expense_resolved':
        return t('common.notifExpenseResolved', { label: p.label })
      case 'settlement_recorded':
        return t('common.notifSettlementRecorded', { amount: money(Number(p.amount_cents)) })
      case 'wall_post_added':
        return t('common.notifWallPostAdded', { body: p.body })
      case 'wall_reply_added':
        return t('common.notifWallReplyAdded', { body: p.body })
      case 'wall_task_assigned':
        return t('common.notifWallTaskAssigned', { body: p.body })
      default:
        return n.type
    }
  }

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

  // Fermeture au clic en dehors + touche Échap.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
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
    <div className="notif-wrap" ref={wrapRef}>
      <button className="bell" onClick={toggle} title={t('common.notifications')} aria-label={t('common.notifications')}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread.length > 0 && <span className="badge">{unread.length}</span>}
      </button>
      {open && (
        <div className="notif-panel">
          {items.length === 0 && <div className="notif-empty">{t('common.notifEmpty')}</div>}
          {items.map((n) => (
            <div key={n.id} className={`notif-item ${n.read_at === null ? 'unread' : ''}`}>
              {message(n)}
              <div className="date">
                {new Date(n.created_at + 'Z').toLocaleString(i18n.language)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
