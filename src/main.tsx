import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/im-fell-english-sc/400.css'
import '@fontsource/cutive-mono/400.css'
import App from './App.tsx'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('root missing')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
