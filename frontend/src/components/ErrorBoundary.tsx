import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import i18n from '../i18n'
import { captureException } from '../analytics'

// Filet de sécurité : un plantage de rendu affiche un écran de secours (au lieu
// d'une page blanche) et part dans le suivi d'erreurs PostHog avec la pile React.
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    captureException(error, { source: 'react_error_boundary', component_stack: info.componentStack?.slice(0, 2000) })
  }

  render() {
    if (!this.state.failed) return this.props.children
    const t = i18n.t.bind(i18n)
    return (
      <div className="auth-page" style={{ textAlign: 'center' }}>
        <div className="brand">
          <div className="wordmark">altern<span>ly</span></div>
        </div>
        <div className="card">
          <h2>{t('errors.crashTitle')}</h2>
          <p className="hint">{t('errors.crashBody')}</p>
          <p>
            <button onClick={() => window.location.reload()}>{t('errors.reload')}</button>
          </p>
          <p>
            <a href="/feedback">{t('errors.report')}</a>
          </p>
        </div>
      </div>
    )
  }
}
