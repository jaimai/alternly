import { useState } from 'react'
import { api } from '../api'
import { useAuth } from '../auth'
import Icon from './Icon'
import type { IconName } from './Icon'

interface Slide {
  icon: IconName
  title: string
  body: string
}

const SLIDES: Slide[] = [
  {
    icon: 'calendar',
    title: 'Votre calendrier de garde',
    body: "Votre rythme est posé : chaque jour est coloré selon le parent. Vacances scolaires, fériés et fêtes sont déjà là, des années à l'avance. Cliquez sur un jour pour agir dessus.",
  },
  {
    icon: 'swap',
    title: 'Proposez un échange',
    body: "Besoin d'un mercredi ? Cliquez sur le jour et proposez un échange. L'autre parent l'accepte, le refuse ou contre-propose — le calendrier se met à jour tout seul.",
  },
  {
    icon: 'wallet',
    title: 'Partagez les dépenses',
    body: "Onglet Dépenses : notez qui a payé quoi (cantine, santé, activités). Alternly calcule le solde entre vous et gère les remboursements. Fini les calculs de coin de table.",
  },
  {
    icon: 'message',
    title: 'Le mur de communication',
    body: "Onglet Mur : partagez une info, une tâche à cocher (avec échéance sur le calendrier) ou une question. Un fil clair, à tête reposée, plutôt que des SMS qui s'égarent.",
  },
]

export default function WelcomeTour() {
  const { user, setUser } = useAuth()
  const [i, setI] = useState(0)
  const [closing, setClosing] = useState(false)

  async function finish() {
    setClosing(true)
    try {
      const updated = await api.updateMe({ onboarding_seen: true })
      setUser(updated)
    } catch {
      // même si l'appel échoue, on masque le tour pour cette session
      if (user) setUser({ ...user, onboarding_seen: true })
    }
  }

  if (closing) return null
  const slide = SLIDES[i]
  const last = i === SLIDES.length - 1

  return (
    <div className="modal-backdrop">
      <div className="modal tour">
        <div className="tour-icon"><Icon name={slide.icon} size={30} /></div>
        <h2>{slide.title}</h2>
        <p>{slide.body}</p>
        <div className="tour-dots">
          {SLIDES.map((_, j) => (
            <span key={j} className={j === i ? 'active' : ''} />
          ))}
        </div>
        <div className="row" style={{ marginTop: 16, alignItems: 'center' }}>
          <button className="danger-link" onClick={finish} style={{ marginRight: 'auto' }}>
            Passer
          </button>
          {i > 0 && (
            <button className="secondary" onClick={() => setI(i - 1)}>
              Précédent
            </button>
          )}
          {last ? (
            <button onClick={finish}>C'est parti !</button>
          ) : (
            <button onClick={() => setI(i + 1)}>Suivant</button>
          )}
        </div>
      </div>
    </div>
  )
}
