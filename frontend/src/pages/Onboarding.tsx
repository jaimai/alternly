import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useAuth } from '../auth'
import RuleForm from '../components/RuleForm'
import type { RuleFormValue } from '../components/RuleForm'
import type { Household } from '../types'

export default function OnboardingPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [household, setHousehold] = useState<Household | null>(null)
  const [name, setName] = useState('')
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
          setError(err instanceof Error ? err.message : 'Erreur')
        }
      })
      .finally(() => setLoading(false))
  }, [navigate])

  async function createHousehold() {
    setBusy(true)
    setError(null)
    try {
      const h = await api.createHousehold({ name: name || `Foyer de ${user?.display_name}`, school_zone: zone })
      setHousehold(h)
      setStep(1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
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
      setError(err instanceof Error ? err.message : 'Erreur')
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
      navigate('/app')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="page-loading">Chargement…</div>

  return (
    <div className="auth-page" style={{ maxWidth: 520 }}>
      <div className="brand">
        <div className="wordmark small">altern<span>ly</span></div>
        <h1>Bienvenue !</h1>
        <p>Configurons votre calendrier en trois étapes.</p>
      </div>
      <div className="step-dots">
        {[0, 1, 2].map((i) => (
          <span key={i} className={i <= step ? 'active' : ''} />
        ))}
      </div>
      {error && <div className="error">{error}</div>}

      {step === 0 && (
        <div className="card">
          <h2>Votre foyer</h2>
          <label htmlFor="hname">Nom du foyer (ex. « Famille de Léo »)</label>
          <input id="hname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Famille de…" />
          <label htmlFor="zone">Zone scolaire</label>
          <select id="zone" value={zone} onChange={(e) => setZone(e.target.value as 'A' | 'B' | 'C')}>
            <option value="A">Zone A (Besançon, Bordeaux, Clermont, Dijon, Grenoble, Limoges, Lyon, Poitiers)</option>
            <option value="B">Zone B (Aix-Marseille, Amiens, Lille, Nancy-Metz, Nantes, Nice, Normandie, Orléans-Tours, Reims, Rennes, Strasbourg)</option>
            <option value="C">Zone C (Créteil, Montpellier, Paris, Toulouse, Versailles)</option>
          </select>
          <p style={{ marginTop: 16 }}>
            <button onClick={createHousehold} disabled={busy} style={{ width: '100%' }}>
              Continuer
            </button>
          </p>
        </div>
      )}

      {step === 1 && (
        <div className="card">
          <h2>Vos enfants</h2>
          <label htmlFor="child">Prénom</label>
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
              Ajouter
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
              Continuer
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
            submitLabel="Générer mon calendrier"
            busy={busy}
            onSubmit={saveRules}
          />
        </div>
      )}
    </div>
  )
}
