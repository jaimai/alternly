import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

// Fenêtre modale : centrée sur ordinateur, « bottom sheet » sur mobile.
export default function Modal({
  title,
  eyebrow,
  onClose,
  children,
}: {
  title: string
  eyebrow?: string
  onClose: () => void
  children: ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  // Fermeture à Échap ; focus sur le premier champ à l'ouverture.
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    document.addEventListener('keydown', onKey)
    box.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={box}
        className="modal sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}
