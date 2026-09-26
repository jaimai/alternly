import { useCallback, useEffect, useRef, useState } from 'react'
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    box.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

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

type ConfirmOptions = { title: string; body?: string; confirmLabel?: string; danger?: boolean }

/** Confirmation avant une action destructrice : `if (await confirm({...})) …` */
export function useConfirm(): [(opts: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null)

  const confirm = useCallback(
    (opts: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...opts, resolve })),
    [],
  )

  const close = (ok: boolean) => {
    state?.resolve(ok)
    setState(null)
  }

  const node = state ? (
    <Modal title={state.title} onClose={() => close(false)}>
      {state.body && <p className="hint">{state.body}</p>}
      <div className="actions" style={{ marginTop: 18 }}>
        <button className={state.danger ? 'danger' : ''} onClick={() => close(true)}>
          {state.confirmLabel ?? 'Confirmer'}
        </button>
        <button className="secondary" onClick={() => close(false)}>
          Annuler
        </button>
      </div>
    </Modal>
  ) : null

  return [confirm, node]
}
