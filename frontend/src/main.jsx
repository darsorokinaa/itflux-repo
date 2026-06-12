import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/home.css'
import './styles/styles.css'
import './styles/digital-flow-override.css'
import './styles/teachers.css'
import App from './App.jsx'
import { ensureSiteFavicon } from './utils/ensureSiteFavicon'

ensureSiteFavicon()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
