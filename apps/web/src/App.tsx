import { useEffect } from 'react'
import { HashRouter, Routes, Route } from 'react-router-dom'
import Garage from './pages/Garage'
import CarProfile from './pages/CarProfile'
import AuthReset from './pages/AuthReset'
import AuthVerified from './pages/AuthVerified'
import SyncGate from './components/SyncGate'
import useGarageStore from './store/useGarageStore'
import { THEMES, applyTheme, hexToRgbChannels, darkenChannels } from './utils/themes'
import './index.css'

export default function App() {
  const themeId      = useGarageStore((s) => s.themeId)
  const customAccent = useGarageStore((s) => s.customAccent)

  useEffect(() => {
    if (themeId === 'custom' && customAccent) {
      const accent    = hexToRgbChannels(customAccent)
      const accentDim = darkenChannels(accent, 25)
      applyTheme({
        accent, accentDim,
        dark:     '15 15 15',
        surface:  '26 26 26',
        surface2: '36 36 36',
        border:   '45 45 45',
      })
    } else {
      const theme = THEMES.find((t) => t.id === themeId) ?? THEMES[0]
      applyTheme(theme)
    }
  }, [themeId, customAccent])

  return (
    <HashRouter>
      <SyncGate />
      <Routes>
        <Route path="/"        element={<Garage />} />
        <Route path="/car/:id" element={<CarProfile />} />
        {/* Email landing routes: password reset + post-verification notice */}
        <Route path="/auth/reset"    element={<AuthReset />} />
        <Route path="/auth/verified" element={<AuthVerified />} />
      </Routes>
    </HashRouter>
  )
}
