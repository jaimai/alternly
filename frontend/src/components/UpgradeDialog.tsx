import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { track } from '../analytics'
import { EV } from '../analyticsEvents'
import { api } from '../api'
import type { User } from '../types'
import Modal from './Modal'
import PlanCheckout from './PlanCheckout'
import { usePremiumPerks } from '../premiumPerks'

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
  const { perks, subtitleKey, solo } = usePremiumPerks()
  useEffect(() => {
    track(EV.paywallViewed, { feature: source, solo })
    api.markPaywallSeen().catch(() => {})
  }, [source, solo])
  return (
    <Modal title={t('paywall.title')} onClose={onClose}>
      <p className="hint" style={{ marginTop: 0 }}>{t(subtitleKey)}</p>
      <ul className="perk-list">
        {perks.map((k) => (
          <li key={k}>{t(k)}</li>
        ))}
      </ul>
      <PlanCheckout user={user} source={source} onSubscribed={onSubscribed} discountCode={discountCode} />
    </Modal>
  )
}
