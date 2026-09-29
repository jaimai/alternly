import { useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { api } from '../api'
import type { FeedbackKind, FeedbackSource } from '../api'
import { useAuth } from '../auth'

const KINDS: FeedbackKind[] = ['problem', 'idea', 'question']
const MAX = 2000

/** Formulaire « Problème / Idée / Question » : envoyé à l'équipe par e-mail. */
export default function FeedbackForm({ source, onDone }: { source: FeedbackSource; onDone?: () => void }) {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const location = useLocation()
  const [kind, setKind] = useState<FeedbackKind>('problem')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('') // champ piège anti-robots
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.sendFeedback({
        kind,
        message: message.trim(),
        email: user ? undefined : email.trim(),
        source,
        page: location.pathname,
        locale: i18n.language.startsWith('en') ? 'en' : 'fr',
        website,
      })
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('feedback.error'))
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <div className="feedback-done" role="status">
        <p>
          <strong>{t('feedback.thanksTitle')}</strong> {t('feedback.thanksBody')}
        </p>
        {onDone && (
          <button type="button" onClick={onDone}>
            {t('feedback.close')}
          </button>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="feedback-form">
      {error && <div className="error">{error}</div>}
      <p id="fb-kind-label" className="sr-only">{t('feedback.kindLabel')}</p>
      <div className="segmented" role="radiogroup" aria-labelledby="fb-kind-label">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            className={kind === k ? 'on' : undefined}
            onClick={() => setKind(k)}
          >
            {t(`feedback.kind_${k}`)}
          </button>
        ))}
      </div>
      <label htmlFor="fb-message">{t(`feedback.messageLabel_${kind}`)}</label>
      <textarea
        id="fb-message"
        value={message}
        onChange={(e) => setMessage(e.target.value.slice(0, MAX))}
        rows={5}
        required
        minLength={3}
        maxLength={MAX}
        placeholder={t(`feedback.placeholder_${kind}`)}
      />
      <p className="hint feedback-count">{message.length} / {MAX}</p>
      {user ? (
        <p className="hint">{t('feedback.replyToAccount', { email: user.email })}</p>
      ) : (
        <>
          <label htmlFor="fb-email">{t('feedback.emailLabel')}</label>
          <input id="fb-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </>
      )}
      <div className="feedback-trap" aria-hidden="true">
        <label htmlFor="fb-website">Website</label>
        <input id="fb-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
      </div>
      <p className="hint">{t('feedback.contextNote')}</p>
      <button type="submit" disabled={busy || message.trim().length < 3} style={{ width: '100%' }}>
        {busy ? t('feedback.sending') : t('feedback.send')}
      </button>
    </form>
  )
}
