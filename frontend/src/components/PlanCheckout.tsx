import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { loadPlans, openCheckout, paddleConfigured } from '../billing'
import type { Plan, Plans } from '../billing'
import type { User } from '../types'

/** Choix de l'offre (annuel / mensuel) + bouton de paiement. Partagé par le
 *  paywall, le bouton « Premium » de la barre du haut et les réglages. */
export default function PlanCheckout({
  user,
  source,
  onSubscribed,
  discountCode,
}: {
  user: User
  source: string
  onSubscribed: () => void
  /** Code de l'offre de bienvenue (−X % la première année, offre annuelle). */
  discountCode?: string
}) {
  const { t } = useTranslation()
  const [plans, setPlans] = useState<Plans | null>(null)
  const [plan, setPlan] = useState<Plan>('annual')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    loadPlans().then(setPlans)
  }, [])

  const monthlyAvailable = Boolean(plans?.monthly.price_id)
  const trialDays = plans?.[plan].trial_days ?? 0

  async function subscribe() {
    setBusy(true)
    await openCheckout(
      user,
      () => {
        setDone(true)
        onSubscribed()
        window.setTimeout(onSubscribed, 4000)
      },
      plan,
      source,
      plan === 'annual' ? discountCode : undefined,
    )
    setBusy(false)
  }

  return (
    <>
      <div className="plan-toggle" role="radiogroup" aria-label={t('paywall.planLabel')}>
        <button
          type="button"
          role="radio"
          aria-checked={plan === 'annual'}
          className={plan === 'annual' ? 'active' : ''}
          onClick={() => setPlan('annual')}
        >
          {t('paywall.planAnnual')} <strong>69&nbsp;€</strong>
          <span>{t('paywall.planAnnualSuffix')}</span>
          {(plans?.annual.trial_days ?? 0) > 0 && (
            <em className="plan-trial">{t('paywall.trialBadge', { count: plans?.annual.trial_days })}</em>
          )}
        </button>
        {monthlyAvailable && (
          <button
            type="button"
            role="radio"
            aria-checked={plan === 'monthly'}
            className={plan === 'monthly' ? 'active' : ''}
            onClick={() => setPlan('monthly')}
          >
            {t('paywall.planMonthly')} <strong>8,99&nbsp;€</strong>
            <span>{t('paywall.planMonthlySuffix')}</span>
          </button>
        )}
      </div>
      <p className="hint" style={{ marginTop: 4 }}>
        {trialDays > 0
          ? t('paywall.trialThen', { count: trialDays, price: plan === 'annual' ? '69 €/an' : '8,99 €/mois' })
          : t('paywall.oneParentPays')}
      </p>
      {discountCode && (
        <div className={`offer-banner${plan === 'annual' ? '' : ' muted'}`}>
          {plan === 'annual'
            ? t('paywall.offerApplied', { code: discountCode })
            : t('paywall.offerAnnualOnly', { code: discountCode })}
        </div>
      )}
      {done && <div className="info-banner">{t('paywall.activating')}</div>}
      <button onClick={subscribe} disabled={busy || !plans} style={{ width: '100%' }}>
        {busy
          ? t('paywall.opening')
          : trialDays > 0
            ? t('paywall.startTrial', { count: trialDays })
            : t('paywall.subscribe')}
      </button>
      {!paddleConfigured && <p className="hint" style={{ marginTop: 10 }}>{t('paywall.paymentSoon')}</p>}
    </>
  )
}
