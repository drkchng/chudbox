import { useEffect } from 'react'
import { HashRouter, Routes, Route, useParams } from 'react-router-dom'
import Garage from './pages/Garage'
import CarProfile from './pages/CarProfile'
import AuthReset from './pages/AuthReset'
import AuthVerified from './pages/AuthVerified'
import SharePage from './pages/SharePage'
import SyncGate from './components/SyncGate'
import useGarageStore from './store/useGarageStore'
import { applyThemeFromSettings } from './utils/themes'
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

  return (
    <HashRouter>
      <SyncGate />
      <Routes>
        <Route path="/"        element={<Garage />} />
        <Route path="/car/:id" element={<CarProfile />} />
        {/* Public, read-only shared build (no account required). */}
        <Route path="/share/:token" element={<SharePageRoute />} />
        {/* Email landing routes: password reset + post-verification notice */}
        <Route path="/auth/reset"    element={<AuthReset />} />
        <Route path="/auth/verified" element={<AuthVerified />} />
      </Routes>
    </HashRouter>
  )
}
