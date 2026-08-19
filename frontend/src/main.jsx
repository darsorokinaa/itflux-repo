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
import { ensureSiteFavicon } from './utils/ensureSiteFavicon'
import { bindPushNavigation, registerServiceWorker } from './cabinet/pwa/pwaHelpers'
import { migrateClientDataSchema } from './utils/appVersion'
import { startAppUpdateMonitor } from './utils/appUpdate'

ensureSiteFavicon()
migrateClientDataSchema()
registerServiceWorker()
bindPushNavigation()
startAppUpdateMonitor()

// Метрика — только если согласие уже было дано ранее (не до баннера).
import('./utils/analytics.js').then((m) => {
  if (m.hasCookieConsent()) m.initYandexMetrika()
}).catch(() => {})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

window.__ITFLUX_BOOTED = true
document.getElementById("itflux-boot-recover")?.remove()
