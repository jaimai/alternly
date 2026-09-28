import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { QRCodeSVG } from 'qrcode.react'
import { api } from '../api'
import { track } from '../analytics'
import { EV } from '../analyticsEvents'
import { useFormat } from '../format'
import Icon from './Icon'
import type { IconName } from './Icon'
import type { Household, Invitation, Locale } from '../types'

export type InviteSource = 'settings' | 'onboarding' | 'calendar'
type Channel = 'native' | 'whatsapp' | 'sms' | 'email' | 'copy' | 'qr'

const UA = typeof navigator !== 'undefined' ? navigator.userAgent : ''
const IS_IOS = /iPhone|iPad|iPod/i.test(UA) || (/Macintosh/.test(UA) && typeof document !== 'undefined' && 'ontouchend' in document)
const IS_MOBILE = IS_IOS || /Android|Mobi/i.test(UA)

/** Lien SMS pré-rempli : iOS attend `sms:&body=`, Android `sms:?body=`. */
function smsHref(body: string, ios = IS_IOS): string {
  return `sms:${ios ? '&' : '?'}body=${encodeURIComponent(body)}`
}

/** « Léo, Lina et Tom » selon la langue. */
function listNames(names: string[], lng: string): string {
  try {
    return new Intl.ListFormat(lng.startsWith('en') ? 'en' : 'fr', { type: 'conjunction' }).format(names)
  } catch {
    return names.join(', ')
  }
}

/**
 * Partage de l'invitation du second parent : message pré-rédigé (modifiable),
 * partage natif (mobile), WhatsApp, SMS, e-mail, copie du lien, QR code, et
 * envoi de l'invitation par Alternly à une adresse facultative.
 */
export default function InviteShare({ household, source }: { household: Household; source: InviteSource }) {
  const { t, i18n } = useTranslation()
  const { date } = useFormat()
  const [inv, setInv] = useState<Invitation | null>(null)
  const [expired, setExpired] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [custom, setCustom] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [showQr, setShowQr] = useState(source === 'settings' && !IS_MOBILE)
  const [email, setEmail] = useState('')
  const [emailLang, setEmailLang] = useState<Locale>(i18n.language.startsWith('en') ? 'en' : 'fr')
  const [emailBusy, setEmailBusy] = useState(false)
  const [emailSentTo, setEmailSentTo] = useState<string | null>(null)
  const editedTracked = useRef(false)
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function' && IS_MOBILE

  async function create() {
    setError(null)
    try {
      setInv(await api.createInvitation(household.id))
      setExpired(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('invite.error'))
    }
  }

  useEffect(() => {
    let cancelled = false
    api
      .currentInvitation(household.id)
      .then(async (cur) => {
        if (cancelled) return
        if (cur.invitation) setInv(cur.invitation)
        else if (cur.last_expired) setExpired(true)
        else await create()
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : t('invite.error')))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [household.id])

  // Lien servi par le front courant (même origine que l'app).
  const link = inv ? `${window.location.origin}/join/${inv.token}` : ''
  const kids = household.children.map((c) => c.first_name)
  const defaultMessage = useMemo(
    () =>
      kids.length
        ? t('invite.message', { children: listNames(kids, i18n.language), link })
        : t('invite.messageNoChildren', { link }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [link, kids.join('|'), i18n.language, t],
  )
  const message = custom ?? defaultMessage
  // Le lien est toujours présent, même si le parent l'a effacé du message.
  const outgoing = link && !message.includes(link) ? `${message.trim()}\n${link}` : message

  function shared(channel: Channel) {
    track(EV.inviteShared, { channel, source })
  }

  function showFlash(msg: string) {
    setFlash(msg)
    window.setTimeout(() => setFlash(null), 3000)
  }

  async function nativeShare() {
    try {
      await navigator.share({ title: t('invite.emailSubject'), text: outgoing })
      shared('native')
    } catch {
      /* partage annulé : rien à faire */
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      window.prompt(t('invite.copyFallback'), link)
    }
    shared('copy')
    showFlash(t('invite.copied'))
  }

  async function sendEmail(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setEmailBusy(true)
    setError(null)
    try {
      const updated = await api.emailInvitation(household.id, { email: email.trim(), locale: emailLang })
      setInv(updated)
      setEmailSentTo(updated.invitee_email)
      setEmail('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('invite.error'))
    } finally {
      setEmailBusy(false)
    }
  }

  if (loading) return <p className="hint">{t('invite.loading')}</p>

  if (expired && !inv) {
    return (
      <div className="invite-expired">
        {error && <div className="error">{error}</div>}
        <p>
          <Icon name="clock" size={16} /> {t('invite.expired')}
        </p>
        <button onClick={create}>{t('invite.regenerate')}</button>
      </div>
    )
  }

  if (!inv) return error ? <div className="error">{error}</div> : null

  const wa = `https://wa.me/?text=${encodeURIComponent(outgoing)}`
  const mailto = `mailto:?subject=${encodeURIComponent(t('invite.emailSubject'))}&body=${encodeURIComponent(outgoing)}`
  const actions: { key: Channel; icon: IconName; label: string; href?: string; onClick?: () => void; cls?: string }[] = [
    ...(canNativeShare ? [{ key: 'native' as const, icon: 'share' as const, label: t('invite.native'), onClick: nativeShare }] : []),
    { key: 'whatsapp', icon: 'whatsapp', label: t('invite.whatsapp'), href: wa, cls: 'whatsapp' },
    { key: 'sms', icon: 'sms', label: t('invite.sms'), href: smsHref(outgoing) },
    { key: 'email', icon: 'mail', label: t('invite.email'), href: mailto },
    { key: 'copy', icon: 'link', label: t('invite.copy'), onClick: copyLink },
  ]

  return (
    <div className="invite-box">
      {error && <div className="error">{error}</div>}
      <label htmlFor={`invite-msg-${source}`}>{t('invite.messageLabel')}</label>
      <textarea
        id={`invite-msg-${source}`}
        className="invite-message ph-mask ph-sensitive"
        rows={5}
        value={message}
        onChange={(e) => {
          setCustom(e.target.value)
          if (!editedTracked.current) {
            editedTracked.current = true
            track(EV.inviteMessageEdited, { source })
          }
        }}
      />
      {custom !== null && custom !== defaultMessage && (
        <button type="button" className="link" onClick={() => setCustom(null)}>
          {t('invite.resetMessage')}
        </button>
      )}

      <div className="invite-actions">
        {actions.map((a) =>
          a.href ? (
            <a
              key={a.key}
              className={`invite-action ${a.cls ?? ''} ${a.key === actions[0].key ? 'primary' : ''}`}
              href={a.href}
              target={a.key === 'whatsapp' ? '_blank' : undefined}
              rel="noopener noreferrer"
              onClick={() => shared(a.key)}
            >
              <Icon name={a.icon} size={18} />
              <span>{a.label}</span>
            </a>
          ) : (
            <button
              key={a.key}
              type="button"
              className={`invite-action ${a.key === actions[0].key ? 'primary' : ''}`}
              onClick={a.onClick}
            >
              <Icon name={a.icon} size={18} />
              <span>{a.label}</span>
            </button>
          ),
        )}
      </div>
      {flash && <p className="invite-flash" role="status">{flash}</p>}

      <div className="invite-link-row">
        <input readOnly value={link} aria-label={t('invite.linkAria')} onFocus={(e) => e.target.select()} />
        <button
          type="button"
          className="secondary with-icon"
          aria-expanded={showQr}
          onClick={() => {
            if (!showQr) shared('qr')
            setShowQr(!showQr)
          }}
        >
          <Icon name="qr" size={16} /> {t('invite.qr')}
        </button>
      </div>
      {showQr && (
        <div className="invite-share">
          <div className="invite-qr ph-no-capture">
            <QRCodeSVG value={link} size={148} bgColor="#ffffff" fgColor="#1f4d3f" marginSize={2} />
          </div>
          <p className="hint invite-share-body">{t('invite.qrHint')}</p>
        </div>
      )}
      <p className="hint">{t('invite.validUntil', { date: date(inv.expires_at.slice(0, 10)) })}</p>

      <form className="invite-email" onSubmit={sendEmail}>
        <label htmlFor={`invite-email-${source}`}>{t('invite.emailLabel')}</label>
        <div className="row">
          <input
            id={`invite-email-${source}`}
            type="email"
            className="ph-mask ph-sensitive"
            autoComplete="off"
            placeholder={t('invite.emailPlaceholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select
            aria-label={t('invite.emailLangAria')}
            value={emailLang}
            onChange={(e) => setEmailLang(e.target.value as Locale)}
            className="invite-lang"
          >
            <option value="fr">FR</option>
            <option value="en">EN</option>
          </select>
          <button type="submit" className="secondary" disabled={emailBusy || !email.trim()}>
            {emailBusy ? t('invite.emailBusy') : t('invite.emailSend')}
          </button>
        </div>
        {(emailSentTo ?? inv.invitee_email) && (
          <p className="hint ph-mask ph-sensitive">
            <Icon name="check" size={14} /> {t('invite.emailSent', { email: emailSentTo ?? inv.invitee_email })}
          </p>
        )}
        {!emailSentTo && !inv.invitee_email && <p className="hint">{t('invite.emailHint')}</p>}
      </form>
    </div>
  )
}
