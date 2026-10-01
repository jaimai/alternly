import { useTranslation } from 'react-i18next'
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
}: {
  user: User
  source: string
  onClose: () => void
  onSubscribed: () => void
}) {
  const { t } = useTranslation()
  return (
    <Modal title={t('paywall.title')} onClose={onClose}>
      <p className="hint" style={{ marginTop: 0 }}>{t('paywall.subtitle')}</p>
      <ul className="perk-list">
        {PERK_KEYS.map((k) => (
          <li key={k}>{t(k)}</li>
        ))}
      </ul>
      <PlanCheckout user={user} source={source} onSubscribed={onSubscribed} />
    </Modal>
  )
}
