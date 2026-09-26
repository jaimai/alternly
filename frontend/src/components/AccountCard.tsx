import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, setToken, SITE_URL } from '../api'
import { useAuth } from '../auth'
import type { User } from '../types'
import Modal from './Modal'
import PasswordField, { passwordProblem } from './PasswordField'

type Dialog = 'password' | 'delete' | null

export default function AccountCard({
  user,
  hasCoparent,
  onMessage,
  onError,
}: {
  user: User
  hasCoparent: boolean
  onMessage: (msg: string) => void
  onError: (err: unknown) => void
}) {
  const { setUser, logout } = useAuth()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  async function exportData() {
    setBusy(true)
    try {
      const data = await api.exportData()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `alternly-export-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      onMessage('Export téléchargé ✓')
    } catch (err) {
      onError(err)
    } finally {
      setBusy(false)
    }
  }

  async function logoutAll() {
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
    <div className="card" id="compte">
      <h2>Compte</h2>
      <p className="hint">Connecté·e en tant que {user.email}</p>
      <div className="settings-list">
        <button type="button" className="settings-row" onClick={() => navigate('/billing')}>
          <span>
            <strong>Abonnement</strong>
            <span className="hint">Essai, paiement et factures.</span>
          </span>
          <span aria-hidden="true">›</span>
        </button>
        <button type="button" className="settings-row" onClick={() => setDialog('password')}>
          <span>
            <strong>Changer mon mot de passe</strong>
            <span className="hint">Vos autres appareils seront déconnectés.</span>
          </span>
          <span aria-hidden="true">›</span>
        </button>
        <button type="button" className="settings-row" onClick={exportData} disabled={busy}>
          <span>
            <strong>Exporter mes données</strong>
            <span className="hint">Un fichier JSON avec votre profil, le calendrier, les dépenses et le mur.</span>
          </span>
          <span aria-hidden="true">↓</span>
        </button>
        <button type="button" className="settings-row" onClick={logoutAll} disabled={busy}>
          <span>
            <strong>Me déconnecter de tous les appareils</strong>
            <span className="hint">Utile après avoir utilisé un téléphone ou un ordinateur partagé.</span>
          </span>
          <span aria-hidden="true">›</span>
        </button>
        <button type="button" className="settings-row" onClick={logout}>
          <span>
            <strong>Se déconnecter</strong>
          </span>
          <span aria-hidden="true">›</span>
        </button>
        <button type="button" className="settings-row danger-row" onClick={() => setDialog('delete')}>
          <span>
            <strong>Supprimer mon compte</strong>
            <span className="hint">Définitif.</span>
          </span>
          <span aria-hidden="true">›</span>
        </button>
      </div>
      <p className="fine-print">
        <a href={`${SITE_URL}/confidentialite`} target="_blank" rel="noreferrer">Confidentialité</a> ·{' '}
        <a href={`${SITE_URL}/cgu`} target="_blank" rel="noreferrer">CGU</a> ·{' '}
        <a href={`${SITE_URL}/mentions-legales`} target="_blank" rel="noreferrer">Mentions légales</a>
      </p>

      {dialog === 'password' && (
        <ChangePassword
          onClose={() => setDialog(null)}
          onDone={(u) => {
            setUser(u)
            setDialog(null)
            onMessage('Mot de passe modifié ✓')
          }}
        />
      )}
      {dialog === 'delete' && <DeleteAccount hasCoparent={hasCoparent} onClose={() => setDialog(null)} />}
    </div>
  )
}

function ChangePassword({ onClose, onDone }: { onClose: () => void; onDone: (u: User) => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    const problem = passwordProblem(next)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const resp = await api.changePassword(current, next)
      setToken(resp.access_token)
      onDone(resp.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
      setBusy(false)
    }
  }

  return (
    <Modal title="Changer mon mot de passe" onClose={onClose}>
      <PasswordField id="cur-pw" label="Mot de passe actuel" value={current} onChange={setCurrent} />
      <PasswordField id="new-pw" label="Nouveau mot de passe" value={next} onChange={setNext} autoComplete="new-password" />
      {error && <div className="error">{error}</div>}
      <div className="actions" style={{ marginTop: 18 }}>
        <button onClick={submit} disabled={busy || !current || !next}>
          Enregistrer
        </button>
        <button className="secondary" onClick={onClose}>
          Annuler
        </button>
      </div>
    </Modal>
  )
}

function DeleteAccount({ hasCoparent, onClose }: { hasCoparent: boolean; onClose: () => void }) {
  const { logout } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await api.deleteAccount(password)
      logout()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur')
      setBusy(false)
    }
  }

  return (
    <Modal title="Supprimer mon compte" onClose={onClose}>
      {hasCoparent ? (
        <p className="hint">
          Votre compte et vos données personnelles seront supprimés et vous serez déconnecté·e. L'autre parent garde
          l'accès au calendrier et à l'historique partagé (dépenses, échanges, mur), où vous apparaîtrez comme « Ancien
          parent ».
        </p>
      ) : (
        <p className="hint">
          Votre compte et tout le foyer seront supprimés définitivement : calendrier, enfants, dépenses, mur. Pensez à
          exporter vos données avant.
        </p>
      )}
      <PasswordField id="del-pw" label="Mot de passe" value={password} onChange={setPassword} />
      <label htmlFor="del-confirm">Tapez SUPPRIMER pour confirmer</label>
      <input id="del-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
      {error && <div className="error">{error}</div>}
      <div className="actions" style={{ marginTop: 18 }}>
        <button className="danger" onClick={submit} disabled={busy || !password || confirmText.trim().toUpperCase() !== 'SUPPRIMER'}>
          Supprimer définitivement
        </button>
        <button className="secondary" onClick={onClose}>
          Annuler
        </button>
      </div>
    </Modal>
  )
}
