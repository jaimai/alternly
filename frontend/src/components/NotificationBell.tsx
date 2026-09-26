import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import { track } from '../analytics'
import { EV } from '../analyticsEvents'
import { useFormat } from '../format'
import Icon from './Icon'
import type { Notification } from '../types'

/** Où mène un clic sur la notification. */
function target(type: string): string {
  if (type.startsWith('expense_') || type.startsWith('settlement_')) return '/expenses'
  if (type.startsWith('wall_')) return '/wall'
  if (type === 'parent_joined' || type === 'parent_left' || type === 'payment_failed') return '/settings'
  return '/app'
}

export default function NotificationBell() {
  const { t } = useTranslation()
  const { money, range: fmtRange, timestamp } = useFormat()
  const [items, setItems] = useState<Notification[]>([])
  const [open, setOpen] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const navigate = useNavigate()

  function range(p: Record<string, string>): string {
    return p.date_start ? fmtRange(p.date_start, p.date_end) : ''
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
      case 'expense_updated':
        return t('common.notifExpenseUpdated', { label: p.label, amount: money(Number(p.amount_cents)) })
      case 'expense_settled':
        return t('common.notifExpenseSettled', { label: p.label })
      case 'parent_left':
        return t('common.notifParentLeft', { name: p.display_name })
      case 'change_requested':
        return t('common.notifChangeRequested', { summary: p.summary })
      case 'change_accepted':
        return t('common.notifChangeAccepted', { summary: p.summary })
      case 'change_refused':
        return t('common.notifChangeRefused', { summary: p.summary })
      case 'payment_failed':
        return t('common.notifPaymentFailed')
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
      <button className="bell" onClick={toggle} title={t('common.notifications')} aria-label={t('common.notifications')} aria-expanded={open}>
        <Icon name="bell" size={20} />
        {unread.length > 0 && <span className="badge">{unread.length}</span>}
      </button>
      {open && (
        <div className="notif-panel ph-mask ph-sensitive" role="dialog" aria-label={t('common.notifications')}>
          <div className="notif-head">{t('common.notifications')}</div>
          {items.length === 0 && <div className="notif-empty">{t('common.notifEmpty')}</div>}
          {items.map((n) => (
            <button
              key={n.id}
              type="button"
              className={`notif-item ${n.read_at === null ? 'unread' : ''}`}
              onClick={() => {
                setOpen(false)
                track(EV.notificationOpened, { type: n.type, unread: n.read_at === null })
                navigate(target(n.type))
              }}
            >
              {message(n)}
              <span className="date">{timestamp(n.created_at)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
