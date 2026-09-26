import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { api, setToken } from '../api'
import { useAuth } from '../auth'
import { todayIso } from '../dates'
import { passwordProblem } from '../password'
import type { User } from '../types'
import Icon from './Icon'
import Modal from './Modal'
import PasswordField from './PasswordField'
import { useConfirm } from './useConfirm'

/** Réglages · Compte : mot de passe, export RGPD, sessions, déconnexion. */
export default function AccountCard({
  user,
  onMessage,
  onError,
}: {
  user: User
  onMessage: (msg: string) => void
  onError: (err: unknown) => void
}) {
  const { t } = useTranslation()
  const { setUser, logout } = useAuth()
  const [changing, setChanging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirm, confirmNode] = useConfirm()

  async function exportData() {
    setBusy(true)
    try {
      const data = await api.exportData()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `alternly-export-${todayIso()}.json`
      a.click()
      URL.revokeObjectURL(url)
      onMessage(t('settings.exportDone'))
    } catch (err) {
      onError(err)
    } finally {
      setBusy(false)
    }
  }

  async function logoutAll() {
    const ok = await confirm({
      title: t('settings.logoutAllTitle'),
      body: t('settings.logoutAllBody'),
      confirmLabel: t('settings.logoutAllConfirm'),
    })
    if (!ok) return
    setBusy(true)
    try {
      await api.logoutAll()
      logout()
    } catch (err) {
      onError(err)
      setBusy(false)
    }
  }

  return (
    <div className="card" id="account">
      <h2>{t('settings.accountTitle')}</h2>
      <p className="hint">{t('settings.signedInAs', { email: user.email })}</p>
      <div className="settings-list">
        <button type="button" className="settings-row" onClick={() => setChanging(true)}>
          <span>
            <strong>{t('settings.changePassword')}</strong>
            <span className="hint">{t('settings.changePasswordHint')}</span>
          </span>
          <Icon name="chevron" size={16} />
        </button>
        <button type="button" className="settings-row" onClick={exportData} disabled={busy}>
          <span>
            <strong>{t('settings.exportData')}</strong>
            <span className="hint">{t('settings.exportDataHint')}</span>
          </span>
          <Icon name="download" size={16} />
        </button>
        <button type="button" className="settings-row" onClick={logoutAll} disabled={busy}>
          <span>
            <strong>{t('settings.logoutAll')}</strong>
            <span className="hint">{t('settings.logoutAllHint')}</span>
          </span>
          <Icon name="chevron" size={16} />
        </button>
        <button type="button" className="settings-row" onClick={logout}>
          <span>
            <strong>{t('common.logout')}</strong>
          </span>
          <Icon name="chevron" size={16} />
        </button>
      </div>

      {changing && (
        <ChangePassword
          onClose={() => setChanging(false)}
          onDone={(u) => {
            setUser(u)
            setChanging(false)
            onMessage(t('settings.passwordChanged'))
          }}
        />
      )}
      {confirmNode}
    </div>
  )
}

function ChangePassword({ onClose, onDone }: { onClose: () => void; onDone: (u: User) => void }) {
  const { t } = useTranslation()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const problem = passwordProblem(next)
    if (problem) {
      setError(t(problem))
      return
    }
    setBusy(true)
    setError(null)
    try {
      // Le serveur révoque les autres sessions et renvoie un nouveau jeton.
      const resp = await api.changePassword(current, next)
      setToken(resp.access_token)
      onDone(resp.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.errorGeneric'))
      setBusy(false)
    }
  }

  return (
    <Modal title={t('settings.changePassword')} onClose={onClose}>
      <PasswordField id="cur-pw" label={t('settings.currentPassword')} value={current} onChange={setCurrent} />
      <PasswordField id="new-pw" label={t('auth.newPasswordLabel')} value={next} onChange={setNext} autoComplete="new-password" />
      <p className="fine-print">{t('auth.otherDevicesSignedOut')}</p>
      {error && <div className="error">{error}</div>}
      <div className="actions" style={{ marginTop: 18 }}>
        <button onClick={submit} disabled={busy || !current || !next}>
          {t('settings.save')}
        </button>
        <button className="secondary" onClick={onClose}>
          {t('common.cancel')}
        </button>
      </div>
    </Modal>
  )
}
