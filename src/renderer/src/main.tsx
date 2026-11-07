import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './styles.css'
import { App } from './App'
import { Widget } from './Widget'

// The floating widget reuses this bundle, mounted at #widget (see DesktopIntegration).
const isWidget = window.location.hash === '#widget'
if (isWidget) document.documentElement.classList.add('is-widget')

createRoot(document.getElementById('root')!).render(<StrictMode>{isWidget ? <Widget /> : <App />}</StrictMode>)
