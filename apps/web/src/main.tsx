import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Self-hosted fonts (replaces the Google Fonts CDN): bundled @font-face with
// font-display: swap. Weights match what the CDN loaded — Inter 300–700 and
// JetBrains Mono 400/500. Families registered: 'Inter' and 'JetBrains Mono'.
import '@fontsource/inter/300.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/inter/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './index.css'
import App from './App.tsx'
import { initGarageStore } from './store/useGarageStore.ts'
import { legacyHashToCleanUrl } from './router/legacyHash.ts'

// Backward-compat: rewrite any legacy HashRouter URL (`/#/<path>`, incl. old
// `/#/share/<token>` and bookmarked auth links) to its clean equivalent BEFORE
// React renders, so BrowserRouter reads the corrected location on its first
// pass. `replaceState` fires no navigation event, so this MUST run pre-render.
const cleanUrl = legacyHashToCleanUrl(window.location.hash, window.location.search)
if (cleanUrl) window.history.replaceState(null, '', cleanUrl)

// Start IndexedDB persistence + the one-time legacy-blob import. Render does
// not wait: the UI shows the empty state for a beat and fills in when the
// load lands (same behavior the async Zustand hydration had).
void initGarageStore()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
