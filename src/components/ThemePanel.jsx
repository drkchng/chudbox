import { useRef } from 'react'
import { X, Check, Pipette } from 'lucide-react'
import useGarageStore from '../store/useGarageStore'
import { THEMES } from '../utils/themes'

export default function ThemePanel({ onClose }) {
  const themeId      = useGarageStore((s) => s.themeId)
  const customAccent = useGarageStore((s) => s.customAccent)
  const setTheme     = useGarageStore((s) => s.setTheme)
  const setCustom    = useGarageStore((s) => s.setCustomAccent)
  const pickerRef    = useRef()

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="fixed top-0 right-0 bottom-0 z-50 w-72 bg-surface border-l border-border shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="font-semibold text-white">Theme</h2>
          <button onClick={onClose} className="btn-ghost"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {/* Preset themes */}
          <div>
            <p className="label mb-3">Preset Themes</p>
            <div className="grid grid-cols-2 gap-2">
              {THEMES.map((theme) => {
                const active = themeId === theme.id
                return (
                  <button
                    key={theme.id}
                    onClick={() => setTheme(theme.id)}
                    className={`relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-all text-left ${
                      active
                        ? 'border-accent/60 bg-accent/10'
                        : 'border-border hover:border-accent/30 hover:bg-surface-2'
                    }`}
                  >
                    <span
                      className="w-5 h-5 rounded-full shrink-0 ring-2 ring-black/30"
                      style={{ backgroundColor: theme.preview }}
                    />
                    <span className={`text-sm font-medium ${active ? 'text-accent' : 'text-gray-300'}`}>
                      {theme.name}
                    </span>
                    {active && (
                      <Check size={13} className="absolute top-2 right-2 text-accent" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Custom accent */}
          <div>
            <p className="label mb-3">Custom Accent Color</p>
            <button
              onClick={() => pickerRef.current.click()}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl border transition-all ${
                themeId === 'custom'
                  ? 'border-accent/60 bg-accent/10'
                  : 'border-border hover:border-accent/30 hover:bg-surface-2'
              }`}
            >
              <span
                className="w-8 h-8 rounded-lg border border-white/10 shrink-0"
                style={{ backgroundColor: themeId === 'custom' && customAccent ? customAccent : '#f97316' }}
              />
              <div className="flex-1 text-left">
                <p className={`text-sm font-medium ${themeId === 'custom' ? 'text-accent' : 'text-gray-300'}`}>
                  Custom Color
                </p>
                <p className="text-xs text-gray-600 font-mono">
                  {themeId === 'custom' && customAccent ? customAccent : 'Pick a color'}
                </p>
              </div>
              <Pipette size={15} className="text-gray-500" />
            </button>
            <input
              ref={pickerRef}
              type="color"
              className="sr-only"
              value={themeId === 'custom' && customAccent ? customAccent : '#f97316'}
              onChange={(e) => setCustom(e.target.value)}
            />
          </div>

          {/* Live preview swatch */}
          <div>
            <p className="label mb-3">Preview</p>
            <div className="rounded-xl border border-border bg-surface-2 p-4 space-y-3">
              <div className="flex gap-2">
                <div className="h-8 px-3 flex items-center rounded-lg bg-accent text-white text-xs font-semibold">Button</div>
                <div className="h-8 px-3 flex items-center rounded-lg border border-accent/50 text-accent text-xs font-medium">Outline</div>
              </div>
              <div className="h-1.5 rounded-full bg-border overflow-hidden">
                <div className="h-full w-3/4 rounded-full bg-accent" />
              </div>
              <div className="flex gap-1.5">
                <span className="text-xs px-2 py-0.5 rounded-full border border-accent/30 bg-accent/10 text-accent">Tag</span>
                <span className="text-xs text-gray-400">Sample text in dark theme</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
