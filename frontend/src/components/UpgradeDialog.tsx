import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { track } from '../analytics'
import { EV } from '../analyticsEvents'
import { api } from '../api'
import type { User } from '../types'
import Modal from './Modal'
import PlanCheckout from './PlanCheckout'

const PERK_KEYS = ['paywall.perkExpenses', 'paywall.perkMessageBoard', 'paywall.perkEmailReminders', 'paywall.perkCalendarSync']

/** Choix de l'offre en fenêtre (bouton « Premium », réglages) : annuel ou mensuel. */
export default function UpgradeDialog({
  user,
  source,
  onClose,
  onSubscribed,
  discountCode,
}: {
  user: User
  source: string
  onClose: () => void
  onSubscribed: () => void
  discountCode?: string
}) {
  const { t } = useTranslation()
  useEffect(() => {
    track(EV.paywallViewed, { feature: source })
    api.markPaywallSeen().catch(() => {})
  }, [source])
  return (
    <Modal title={t('paywall.title')} onClose={onClose}>
      <p className="hint" style={{ marginTop: 0 }}>{t('paywall.subtitle')}</p>
      <ul className="perk-list">
        {PERK_KEYS.map((k) => (
          <li key={k}>{t(k)}</li>
        ))}
      </ul>
      <PlanCheckout user={user} source={source} onSubscribed={onSubscribed} discountCode={discountCode} />
    </Modal>
  )
}
