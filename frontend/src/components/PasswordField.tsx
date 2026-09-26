import { useState } from 'react'

/** Mêmes règles que le backend : 8 caractères minimum, 72 octets maximum (bcrypt). */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'Le mot de passe doit faire au moins 8 caractères'
  if (new TextEncoder().encode(pw).length > 72) return 'Le mot de passe est trop long (72 octets maximum)'
  return null
}

export default function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete = 'current-password',
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  autoComplete?: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <>
      <label htmlFor={id}>{label}</label>
      <div className="password-field">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          minLength={autoComplete === 'new-password' ? 8 : undefined}
        />
        <button
          type="button"
          className="link"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
        >
          {visible ? 'Masquer' : 'Afficher'}
        </button>
      </div>
    </>
  )
}
