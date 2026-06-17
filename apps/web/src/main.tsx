import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initGarageStore } from './store/useGarageStore.ts'

// Start IndexedDB persistence + the one-time legacy-blob import. Render does
// not wait: the UI shows the empty state for a beat and fills in when the
// load lands (same behavior the async Zustand hydration had).
void initGarageStore()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
