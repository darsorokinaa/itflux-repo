import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/home.css'
import './styles/styles.css'
import '@cyntler/react-doc-viewer/dist/index.css'
import './styles/digital-flow-override.css'
import './styles/teachers.css'
import './styles/cabinet.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary'
import { ensureSiteFavicon } from './utils/ensureSiteFavicon'
import { bindPushNavigation, registerServiceWorker } from './cabinet/pwa/pwaHelpers'
import { migrateClientDataSchema } from './utils/appVersion'
import { startAppUpdateMonitor } from './utils/appUpdate'
import { startClientTelemetry } from './utils/clientTelemetry'
import { BOOT_STAGES, markAppReady, markBootStage, resetTransientSessionState } from './utils/appBoot'

ensureSiteFavicon()
resetTransientSessionState()
migrateClientDataSchema()
registerServiceWorker()
bindPushNavigation()
startAppUpdateMonitor()
startClientTelemetry()
markBootStage(BOOT_STAGES.AUTH_LOADING)

// Метрика — только если согласие уже было дано ранее (не до баннера).
import('./utils/analytics.js').then((m) => {
  if (m.hasCookieConsent()) m.initYandexMetrika()
}).catch(() => {})

const rootEl = document.getElementById('root')
markBootStage(BOOT_STAGES.ROUTE_LOADING)
try {
  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary kind="app">
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
  const paint = () => {
    if (markAppReady()) return
    window.setTimeout(() => {
      if (!markAppReady()) {
        markBootStage(BOOT_STAGES.BOOTSTRAP_FAILED)
      }
    }, 50)
  }
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => requestAnimationFrame(paint))
  } else {
    window.setTimeout(paint, 0)
  }
} catch (err) {
  markBootStage(BOOT_STAGES.BOOTSTRAP_FAILED, { message: String(err?.message || err) })
  throw err
}
