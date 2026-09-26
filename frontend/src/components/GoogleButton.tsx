import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api, setToken } from '../api'
import { useAuth } from '../auth'

// « Continuer avec Google » (Google Identity Services). Affiché seulement si
// VITE_GOOGLE_CLIENT_ID est défini au build. Le jeton d'identité est vérifié
// côté serveur (POST /auth/google) qui connecte, relie ou crée le compte.
const GOOGLE_CLIENT_ID: string = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

const GSI_SRC = 'https://accounts.google.com/gsi/client'

interface GoogleId {
  initialize(opts: {
    client_id: string
    callback: (resp: { credential: string }) => void
    ux_mode?: 'popup' | 'redirect'
    auto_select?: boolean
    cancel_on_tap_outside?: boolean
  }): void
  renderButton(el: HTMLElement, opts: Record<string, unknown>): void
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleId } }
  }
}

let loading: Promise<void> | null = null

function loadGsi(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve()
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = GSI_SRC
      s.async = true
      s.defer = true
      s.onload = () => resolve()
      s.onerror = () => {
        loading = null
        reject(new Error('gsi'))
      }
      document.head.appendChild(s)
    })
  }
  return loading
}

export default function GoogleButton({
  text = 'continue_with',
  consent = false,
}: {
  text?: 'continue_with' | 'signin_with' | 'signup_with'
  /** Rappel des CGU sous le bouton (création de compte possible). */
  consent?: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  // Script Google bloqué (bloqueur, réseau) : on masque le bloc, le formulaire suffit.
  const [unavailable, setUnavailable] = useState(false)
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return
    let alive = true
    loadGsi()
      .then(() => {
        if (!alive || !box.current || !window.google) return
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          ux_mode: 'popup',
          callback: async ({ credential }) => {
            setError(null)
            try {
              const locale = i18n.language.startsWith('en') ? 'en' : 'fr'
              const resp = await api.googleLogin(credential, locale)
              setToken(resp.access_token)
              setUser(resp.user)
              const pending = localStorage.getItem('pending_invite')
              navigate(pending ? `/join/${pending}` : '/app')
            } catch (err) {
              setError(err instanceof Error ? err.message : t('auth.googleError'))
            }
          },
        })
        box.current.innerHTML = ''
        window.google.accounts.id.renderButton(box.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          shape: 'pill',
          text,
          logo_alignment: 'center',
          width: Math.min(box.current.offsetWidth || 320, 400),
          locale: i18n.language.startsWith('en') ? 'en' : 'fr',
        })
      })
      .catch(() => alive && setUnavailable(true))
    return () => {
      alive = false
    }
  }, [i18n.language, navigate, setUser, t, text])

  if (!GOOGLE_CLIENT_ID || unavailable) return null
  const legal = (page: 'terms' | 'privacy') => (i18n.language.startsWith('en') ? `/en/${page}` : `/${page}`)

  return (
    <div className="google-signin">
      <div ref={box} className="google-button" />
      {consent && (
        <p className="fine-print google-consent">
          {t('auth.googleConsentLead')}{' '}
          <a href={legal('terms')} target="_blank" rel="noreferrer">{t('auth.consentTerms')}</a>{' '}
          {t('auth.consentAnd')}{' '}
          <a href={legal('privacy')} target="_blank" rel="noreferrer">{t('auth.consentPrivacy')}</a>
          {t('auth.consentTail')}
        </p>
      )}
      {error && <div className="error">{error}</div>}
      <div className="or-sep" aria-hidden="true">
        <span>{t('auth.or')}</span>
      </div>
    </div>
  )
}
