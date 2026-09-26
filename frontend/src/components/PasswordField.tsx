import { useState } from 'react'
import { useTranslation } from 'react-i18next'

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
  autoComplete?: 'current-password' | 'new-password'
}) {
  const { t } = useTranslation()
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
          aria-label={visible ? t('auth.hidePasswordAria') : t('auth.showPasswordAria')}
          aria-pressed={visible}
        >
          {visible ? t('auth.hidePassword') : t('auth.showPassword')}
        </button>
      </div>
    </>
  )
}
