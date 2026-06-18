import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom'
import Garage from './pages/Garage'
import CarProfile from './pages/CarProfile'
import AuthReset from './pages/AuthReset'
import AuthVerified from './pages/AuthVerified'
import SharePage from './pages/SharePage'
import SyncGate from './components/SyncGate'
import useGarageStore from './store/useGarageStore'
import { applyThemeFromSettings } from './utils/themes'
import { ROUTES } from './router/routes'
import './index.css'

// Remount SharePage when :token changes so all state (loading, fetched snapshot,
// applied theme) resets cleanly on in-app share→share navigation instead of the
// previous car lingering until the new fetch resolves.
function SharePageRoute() {
  const { token } = useParams<{ token: string }>()
  return <SharePage key={token} />
}

export default function App() {
  const themeId      = useGarageStore((s) => s.themeId)
  const customAccent = useGarageStore((s) => s.customAccent)

  useEffect(() => {
    applyThemeFromSettings(themeId, customAccent)
  }, [themeId, customAccent])

  // Clean path URLs (BrowserRouter, M5): no more `/#/`. Every pattern below is
  // served by the Worker's SPA asset fallback (not_found_handling:
  // single-page-application) — index.html for any non-asset path — except
  // /share/:token, which the Worker intercepts to inject Open Graph meta before
  // serving that same index.html (see apps/api). Legacy `/#/…` links are
  // rewritten to these clean paths in main.tsx before this renders.
  return (
    <BrowserRouter>
      <SyncGate />
      <Routes>
        <Route path={ROUTES.garage} element={<Garage />} />
        <Route path={ROUTES.car}    element={<CarProfile />} />
        {/* Public, read-only shared build (no account required). */}
        <Route path={ROUTES.share} element={<SharePageRoute />} />
        {/* Email landing routes: password reset + post-verification notice */}
        <Route path={ROUTES.authReset}    element={<AuthReset />} />
        <Route path={ROUTES.authVerified} element={<AuthVerified />} />
      </Routes>
    </BrowserRouter>
  )
}
