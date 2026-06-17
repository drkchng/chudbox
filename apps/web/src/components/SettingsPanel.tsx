import { useRef } from 'react'
import { X, DollarSign, Gauge, Palette, Check, Pipette } from 'lucide-react'
import useGarageStore from '../store/useGarageStore'
import AccountSection from './auth/AccountSection'
import { CURRENCIES, DISTANCE_UNITS } from '../utils/units'
import type { CurrencyCode, DistanceUnitCode } from '../utils/units'
import { THEMES } from '../utils/themes'

interface SettingsPanelProps {
  onClose: () => void
}

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const currency        = useGarageStore((s) => s.currency)
  const distanceUnit    = useGarageStore((s) => s.distanceUnit)
  const themeId         = useGarageStore((s) => s.themeId)
  const customAccent    = useGarageStore((s) => s.customAccent)
  const setCurrency     = useGarageStore((s) => s.setCurrency)
  const setDistanceUnit = useGarageStore((s) => s.setDistanceUnit)
  const setTheme        = useGarageStore((s) => s.setTheme)
  const setCustom       = useGarageStore((s) => s.setCustomAccent)
  const pickerRef       = useRef<HTMLInputElement | null>(null)

  return (
    <>
      <div className="modal-backdrop fixed inset-0 z-40 bg-black/70" onClick={onClose} />
      <div className="slide-panel fixed right-0 top-0 bottom-0 z-50 w-80 bg-surface border-l border-border shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="font-semibold text-white">Settings</h2>
          <button onClick={onClose} className="btn-ghost"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-7">
          {/* Currency */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <DollarSign size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-white">Currency</h3>
            </div>
            <p className="text-xs text-gray-500 mb-3">All prices will be converted automatically.</p>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(CURRENCIES).map(([code, { symbol, name }]) => (
                <button
                  key={code}
                  onClick={() => setCurrency(code as CurrencyCode)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm transition-[border-color,color,background-color] text-left ${
                    currency === code
                      ? 'bg-accent/10 border-accent/50 text-accent'
                      : 'border-border text-gray-400 hover:border-accent/30 hover:text-gray-200'
                  }`}
                >
                  <span className="font-mono font-bold w-7 shrink-0">{symbol}</span>
                  <span className="truncate text-xs">{code} — {name.split(' ')[0]}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Distance */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Gauge size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-white">Distance unit</h3>
            </div>
            <p className="text-xs text-gray-500 mb-3">All mileage values will be converted automatically.</p>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(DISTANCE_UNITS).map(([unit, { label }]) => (
                <button
                  key={unit}
                  onClick={() => setDistanceUnit(unit as DistanceUnitCode)}
                  className={`px-3 py-2.5 rounded-lg border text-sm font-medium transition-[border-color,color,background-color] ${
                    distanceUnit === unit
                      ? 'bg-accent/10 border-accent/50 text-accent'
                      : 'border-border text-gray-400 hover:border-accent/30 hover:text-gray-200'
                  }`}
                >
                  {label} <span className="font-mono text-xs opacity-60">({unit})</span>
                </button>
              ))}
            </div>
          </div>

          {/* Theme */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Palette size={14} className="text-accent" />
              <h3 className="text-sm font-semibold text-white">Theme</h3>
            </div>
            <p className="text-xs text-gray-500 mb-3">Choose an accent color for the interface.</p>
            <div className="grid grid-cols-2 gap-2 mb-3">
              {THEMES.map((theme) => {
                const active = themeId === theme.id
                return (
                  <button
                    key={theme.id}
                    onClick={() => setTheme(theme.id)}
                    className={`relative flex items-center gap-2.5 px-3 py-2.5 rounded-xl border transition-[border-color,color,background-color] text-left ${
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
                    {active && <Check size={13} className="absolute top-2 right-2 text-accent" />}
                  </button>
                )
              })}
            </div>

            {/* Custom accent */}
            <button
              onClick={() => pickerRef.current?.click()}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl border transition-[border-color,background-color] ${
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

            {/* Live preview */}
            <div className="mt-3 rounded-xl border border-border bg-surface-2 p-4 space-y-3">
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

          {/* Account (optional) */}
          <AccountSection />
        </div>
      </div>
    </>
  )
}
