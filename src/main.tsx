import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Capture } from './views/Capture'
import './styles.css'

const isCapture = location.hash === '#capture'
createRoot(document.getElementById('root')!).render(<StrictMode>{isCapture ? <Capture /> : <App />}</StrictMode>)
