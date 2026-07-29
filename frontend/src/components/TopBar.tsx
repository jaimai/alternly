import { Link, NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth'
import { openCheckout } from '../billing'
import Icon from './Icon'
import NotificationBell from './NotificationBell'

const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : undefined)

export default function TopBar({ householdName }: { householdName?: string }) {
  const { t } = useTranslation()
  const { logout, user, billing, refreshBilling } = useAuth()
  const premium = billing?.access === true
  const locked = billing !== null && !premium
  const lock = locked ? <Icon name="lock" size={12} style={{ marginLeft: 5, verticalAlign: -1 }} /> : null
  return (
    <div className="topbar">
      <Link to="/app" className="wordmark small" style={{ textDecoration: 'none' }} title={householdName}>
        altern<span>ly</span>
      </Link>
      <nav className="topnav" style={{ marginRight: 'auto' }}>
        <NavLink to="/app" end className={navClass}>
          {t('common.navCalendar')}
        </NavLink>
        <NavLink to="/expenses" className={navClass}>
          {t('common.navExpenses')}{lock}
        </NavLink>
        <NavLink to="/wall" className={navClass}>
          {t('common.navWall')}{lock}
        </NavLink>
      </nav>
      {billing !== null && !premium && user && (
        <button
          className="trial-chip"
          onClick={() => openCheckout(user, refreshBilling)}
          title={t('common.upgradeTitle')}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
        >
          <Icon name="star" size={13} />
          {t('common.freemiumChip')}
        </button>
      )}
      <NotificationBell />
      <Link to="/settings" title={t('common.settings')} className="icon-link" aria-label={t('common.settings')}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
      </Link>
      <button className="secondary" onClick={logout}>
        {t('common.logout')}
      </button>
    </div>
  )
}
