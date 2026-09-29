import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { track } from '../analytics'
import { EV } from '../analyticsEvents'
import type { FeedbackSource } from '../api'
import FeedbackForm from './FeedbackForm'
import Icon from './Icon'
import Modal from './Modal'

/** Fenêtre de signalement, ouverte depuis la pastille ou les réglages. */
export function FeedbackDialog({ source, onClose }: { source: FeedbackSource; onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <Modal title={t('feedback.title')} eyebrow={t('feedback.eyebrow')} onClose={onClose}>
      <FeedbackForm source={source} onDone={onClose} />
    </Modal>
  )
}

/** Pastille flottante « Signaler un problème / Une idée », présente dans toute l'app. */
export default function FeedbackButton() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)

  function close() {
    setOpen(false)
    button.current?.focus() // le focus revient sur la pastille
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        className="feedback-fab"
        aria-label={t('feedback.fabLabel')}
        title={t('feedback.fabLabel')}
        onClick={() => {
          track(EV.feedbackOpened, { source: 'fab' })
          setOpen(true)
        }}
      >
        <Icon name="message" size={20} />
      </button>
      {open && <FeedbackDialog source="fab" onClose={close} />}
    </>
  )
}
