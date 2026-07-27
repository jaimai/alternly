export default function Spinner({ inline = false }: { inline?: boolean }) {
  if (inline) return <span className="spinner spinner-inline" aria-label="Chargement" />
  return (
    <div className="page-loading">
      <span className="spinner" aria-label="Chargement" />
    </div>
  )
}
