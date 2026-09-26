import { useTranslation } from 'react-i18next'

export default function Spinner({ inline = false }: { inline?: boolean }) {
  const { t } = useTranslation()
  if (inline) return <span className="spinner spinner-inline" aria-label={t('common.loading')} />
  return (
    <div className="page-loading">
      <span className="spinner" aria-label={t('common.loading')} />
    </div>
  )
}
