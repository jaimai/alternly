import { useCallback, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Modal from './Modal'

export type ConfirmOptions = { title: string; body?: string; confirmLabel?: string; danger?: boolean }

/** Confirmation avant une action destructrice :
 *  const [confirm, confirmNode] = useConfirm() … if (await confirm({...})) …
 *  (penser à rendre `confirmNode`). */
export function useConfirm(): [(opts: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const { t } = useTranslation()
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
          {state.confirmLabel ?? t('common.confirm')}
        </button>
        <button className="secondary" onClick={() => close(false)}>
          {t('common.cancel')}
        </button>
      </div>
    </Modal>
  ) : null

  return [confirm, node]
}
