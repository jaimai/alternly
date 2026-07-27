import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, ApiError } from '../api'
import { useAuth } from '../auth'
import Paywall from '../components/Paywall'
import Spinner from '../components/Spinner'
import RuleForm from '../components/RuleForm'
import type { RuleFormValue } from '../components/RuleForm'
import type { Country, Household } from '../types'

export default function OnboardingPage() {
  const { t, i18n } = useTranslation()
  const { user, billing, refreshHousehold, refreshBilling } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [household, setHousehold] = useState<Household | null>(null)
  const [name, setName] = useState('')
  const [country, setCountry] = useState<Country>(i18n.language.startsWith('en') ? 'US' : 'FR')
  const [zone, setZone] = useState<'A' | 'B' | 'C'>('A')
  const [childName, setChildName] = useState('')
  const [childNames, setChildNames] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .myHousehold()
      .then((h) => {
        setHousehold(h)
        if (h.custody_rule) navigate('/app')
        else setStep(2) // foyer déjà créé : reste la règle de garde
      })
      .catch((err) => {
        if (!(err instanceof ApiError && err.status === 404)) {
          setError(err instanceof Error ? err.message : t('onboarding.errorGeneric'))
        }
      })
      .finally(() => setLoading(false))
  }, [navigate])

  async function createHousehold() {
    setBusy(true)
    setError(null)
    try {
      const h = await api.createHousehold({
        name: name || t('onboarding.defaultHouseholdName', { name: user?.display_name }),
        country,
        school_zone: zone,
      })
      setHousehold(h)
      setStep(1)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('onboarding.errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  async function saveChildren() {
    if (!household) return
    setBusy(true)
    setError(null)
    try {
      for (const first_name of childNames) {
        await api.addChild(household.id, { first_name })
      }
      const fresh = await api.myHousehold()
      setHousehold(fresh)
      setStep(2)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('onboarding.errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  async function saveRules(value: RuleFormValue) {
    if (!household) return
    setBusy(true)
    setError(null)
    try {
      await api.setCustodyRule(household.id, value.custody)
      await api.setVacationRule(household.id, value.vacation)
      await refreshHousehold()  // met à jour le cache avant d'entrer dans l'app
      // Freemium : on propose l'abonnement (skippable) à la fin de l'inscription.
      if (billing && !billing.access) setStep(3)
      else navigate('/app')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('onboarding.errorGeneric'))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Spinner />

  if (step === 3 && user) {
    return (
      <Paywall
        user={user}
        onSubscribed={() => {
          refreshBilling()
          navigate('/app')
        }}
        onSkip={() => navigate('/app')}
        title={t('onboarding.paywallTitle')}
        subtitle={t('onboarding.paywallSubtitle')}
      />
    )
  }

  return (
    <div className="auth-page" style={{ maxWidth: 520 }}>
      <div className="brand">
        <div className="wordmark small">altern<span>ly</span></div>
        <h1>{t('onboarding.welcomeTitle')}</h1>
        <p>{t('onboarding.welcomeSubtitle')}</p>
      </div>
      <div className="step-dots">
        {[0, 1, 2].map((i) => (
          <span key={i} className={i <= step ? 'active' : ''} />
        ))}
      </div>
      {error && <div className="error">{error}</div>}

      {step === 0 && (
        <div className="card">
          <h2>{t('onboarding.householdHeading')}</h2>
          <label htmlFor="hname">{t('onboarding.householdNameLabel')}</label>
          <input id="hname" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('onboarding.householdNamePlaceholder')} />
          <label htmlFor="country">{t('onboarding.countryLabel')}</label>
          <select id="country" value={country} onChange={(e) => setCountry(e.target.value as Country)}>
            <option value="FR">{t('onboarding.countryFR')}</option>
            <option value="US">{t('onboarding.countryUS')}</option>
          </select>
          {country === 'FR' ? (
            <>
              <label htmlFor="zone">{t('onboarding.schoolZoneLabel')}</label>
              <select id="zone" value={zone} onChange={(e) => setZone(e.target.value as 'A' | 'B' | 'C')}>
                <option value="A">{t('onboarding.zoneA')}</option>
                <option value="B">{t('onboarding.zoneB')}</option>
                <option value="C">{t('onboarding.zoneC')}</option>
              </select>
            </>
          ) : (
            <p className="hint" style={{ marginTop: 8 }}>{t('onboarding.usSchoolBreaksHint')}</p>
          )}
          <p style={{ marginTop: 16 }}>
            <button onClick={createHousehold} disabled={busy} style={{ width: '100%' }}>
              {t('onboarding.continue')}
            </button>
          </p>
        </div>
      )}

      {step === 1 && (
        <div className="card">
          <h2>{t('onboarding.childrenHeading')}</h2>
          <label htmlFor="child">{t('onboarding.firstNameLabel')}</label>
          <div className="row">
            <input
              id="child"
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (childName.trim()) {
                    setChildNames([...childNames, childName.trim()])
                    setChildName('')
                  }
                }
              }}
            />
            <button
              type="button"
              className="secondary"
              onClick={() => {
                if (childName.trim()) {
                  setChildNames([...childNames, childName.trim()])
                  setChildName('')
                }
              }}
            >
              {t('onboarding.add')}
            </button>
          </div>
          <div className="chip-list">
            {childNames.map((n, i) => (
              <span key={i} className="chip">
                {n}{' '}
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault()
                    setChildNames(childNames.filter((_, j) => j !== i))
                  }}
                >
                  ✕
                </a>
              </span>
            ))}
          </div>
          <p style={{ marginTop: 16 }}>
            <button onClick={saveChildren} disabled={busy || childNames.length === 0} style={{ width: '100%' }}>
              {t('onboarding.continue')}
            </button>
          </p>
        </div>
      )}

      {step === 2 && household && user && (
        <div className="card">
          <RuleForm
            members={household.members}
            myId={user.id}
            initialCustody={household.custody_rule}
            initialVacation={household.vacation_rule}
            submitLabel={t('onboarding.generateCalendar')}
            busy={busy}
            onSubmit={saveRules}
          />
        </div>
      )}
    </div>
  )
}
