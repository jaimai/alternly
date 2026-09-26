import { Link, NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../auth'
import { openCheckout } from '../billing'
import Icon from './Icon'
import type { IconName } from './Icon'
import NotificationBell from './NotificationBell'

const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : undefined)

const TABS: { to: string; labelKey: string; icon: IconName; end: boolean; premium: boolean }[] = [
  { to: '/app', labelKey: 'common.navCalendar', icon: 'calendar', end: true, premium: false },
  { to: '/expenses', labelKey: 'common.navExpenses', icon: 'wallet', end: false, premium: true },
  { to: '/wall', labelKey: 'common.navWall', icon: 'message', end: false, premium: true },
]

export default function TopBar({ householdName }: { householdName?: string }) {
  const { t } = useTranslation()
  const { user, billing, refreshBilling } = useAuth()
  const premium = billing?.access === true
  const locked = billing !== null && !premium
  return (
    <>
      <header className="topbar">
        <Link to="/app" className="wordmark small" style={{ textDecoration: 'none' }} title={householdName}>
          altern<span>ly</span>
        </Link>
        <nav className="topnav" aria-label={t('common.mainNav')}>
          {TABS.map((tab) => (
            <NavLink key={tab.to} to={tab.to} end={tab.end} className={navClass}>
              {t(tab.labelKey)}
              {locked && tab.premium && <Icon name="lock" size={12} style={{ marginLeft: 5, verticalAlign: -1 }} />}
            </NavLink>
          ))}
        </nav>
        <div className="topbar-actions">
          {locked && user && (
            <button
              className="trial-chip"
              onClick={() => openCheckout(user, refreshBilling)}
              title={t('common.upgradeTitle')}
              aria-label={t('common.upgradeTitle')}
            >
              <Icon name="star" size={13} />
              <span className="chip-long">{t('common.freemiumChip')}</span>
              <span className="chip-short">{t('common.freemiumChipShort')}</span>
            </button>
          )}
          <NotificationBell />
          <NavLink
            to="/settings"
            title={t('common.settings')}
            className={({ isActive }) => `icon-link${isActive ? ' active' : ''}`}
            aria-label={t('common.settings')}
          >
            <Icon name="settings" size={20} />
          </NavLink>
        </div>
      </header>
      {/* Mobile : barre d'onglets en bas, à portée de pouce */}
      <nav className="tabbar" aria-label={t('common.mainNav')}>
        {TABS.map((tab) => (
          <NavLink key={tab.to} to={tab.to} end={tab.end} className={navClass}>
            <Icon name={tab.icon} size={22} />
            <span>
              {t(tab.labelKey)}
              {locked && tab.premium && <Icon name="lock" size={10} style={{ marginLeft: 3, verticalAlign: -1 }} />}
            </span>
          </NavLink>
        ))}
        <NavLink to="/settings" className={navClass}>
          <Icon name="settings" size={22} />
          <span>{t('common.settings')}</span>
        </NavLink>
      </nav>
    </>
  )
}
