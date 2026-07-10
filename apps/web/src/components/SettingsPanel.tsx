import { useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { X, DollarSign, Gauge, Palette, Check, Pipette, DatabaseBackup, Download, Upload, AlertTriangle, Scale } from 'lucide-react'
import { LEGAL_CONTACT_EMAIL } from '@chudbox/shared'
import useGarageStore, { exportBackup, importBackup, parseBackupFile } from '../store/useGarageStore'
import type { ParsedBackup } from '../store/useGarageStore'
import AccountSection from './auth/AccountSection'
import ShareIdentitySection from './auth/ShareIdentitySection'
import DeleteAccountSection from './auth/DeleteAccountSection'
import IconButton from './ui/IconButton'
import Button from './ui/Button'
import Modal from './ui/Modal'
import { CURRENCIES, DISTANCE_UNITS } from '../utils/units'
import type { CurrencyCode, DistanceUnitCode } from '../utils/units'
import { THEMES } from '../utils/themes'

interface SettingsPanelProps {
  onClose: () => void
}

// DEC-12 — the manual export/import controls now live here (Settings → Backup &
// data), not in the Garage header. Account sync (AccountSection) is the primary
// backup; this is the local, account-free fallback and works fully logged-out.
function useBackup() {
  const importFile = useRef<HTMLInputElement | null>(null)
  const [importError, setImportError] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [pending, setPending] = useState<ParsedBackup | null>(null)

  const exportData = () => {
    // v2 backup: nested cars reassembled from the tables + ALL settings
    // (currency/distanceUnit included, unlike v1).
    const backup = exportBackup()
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `my-garage-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const readFile = (file: File) => {
    setImportError('')
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const result = e.target?.result
        if (typeof result !== 'string') throw new Error('Invalid format')
        // Accepts v2 AND legacy v1 exports; v1 amounts/mileage get tagged
        // with this device's current settings on import.
        const data = parseBackupFile(JSON.parse(result))
        if (!data) throw new Error('Invalid format')
        setPending(data)
        setShowConfirm(true)
      } catch {
        setImportError('Invalid backup file. Please select a valid Chudbox export.')
      }
    }
    reader.readAsText(file)
  }

  const confirmImport = () => {
    if (!pending) return
    importBackup(pending) // replace; re-seeds the cloud copy when signed in
    setPending(null)
    setShowConfirm(false)
  }

  const cancelImport = () => { setPending(null); setShowConfirm(false) }

  const handleImportChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) { readFile(file); e.target.value = '' }
  }

  return { exportData, importFile, handleImportChange, importError, showConfirm, confirmImport, cancelImport, pending }
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

  const {
    exportData, importFile, handleImportChange, importError,
    showConfirm, confirmImport, cancelImport, pending,
  } = useBackup()

  return (
    <>
      {/* Keep `.modal-backdrop` — it is the backdrop-click close affordance and
          the e2e closeSettings() target (this slide panel has no Esc handler). */}
      <div className="modal-backdrop fixed inset-0 z-40 bg-dark/70" onClick={onClose} />
      <div className="slide-panel fixed right-0 top-0 bottom-0 z-50 flex w-80 flex-col border-l border-border bg-surface shadow-elevation">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-subhead font-semibold text-text-primary">Settings</h2>
          <IconButton aria-label="Close settings" variant="ghost" className="-mr-1" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>

        <div className="flex-1 space-y-7 overflow-y-auto px-5 py-5">
          {/* Currency */}
          <section>
            <div className="mb-1 flex items-center gap-2">
              <DollarSign size={14} className="text-text-tertiary" />
              <h3 className="text-body font-semibold text-text-primary">Currency</h3>
            </div>
            {/* DEC-1 — money is per-currency, store-as-entered. Nothing converts. */}
            <p className="mb-3 text-meta text-text-secondary">
              Sets the currency for new amounts you enter. Existing amounts keep the currency they were saved in — nothing is converted.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(CURRENCIES).map(([code, { symbol, name }]) => {
                const active = currency === code
                return (
                  <button
                    key={code}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setCurrency(code as CurrencyCode)}
                    className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-body transition-[border-color,color,background-color] ${
                      active
                        ? 'border-accent/50 bg-accent/10 text-accent'
                        : 'border-border text-text-secondary hover:border-accent/30 hover:text-text-primary'
                    }`}
                  >
                    <span className="w-7 shrink-0 font-mono font-bold">{symbol}</span>
                    <span className="truncate text-meta">{code} — {name.split(' ')[0]}</span>
                  </button>
                )
              })}
            </div>
          </section>

          {/* Distance */}
          <section>
            <div className="mb-1 flex items-center gap-2">
              <Gauge size={14} className="text-text-tertiary" />
              <h3 className="text-body font-semibold text-text-primary">Distance unit</h3>
            </div>
            {/* Mileage IS canonicalized + reconverted on change (unlike money). */}
            <p className="mb-3 text-meta text-text-secondary">Mileage values are converted to this unit automatically.</p>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(DISTANCE_UNITS).map(([unit, { label }]) => {
                const active = distanceUnit === unit
                return (
                  <button
                    key={unit}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setDistanceUnit(unit as DistanceUnitCode)}
                    className={`rounded-lg border px-3 py-2.5 text-body font-medium transition-[border-color,color,background-color] ${
                      active
                        ? 'border-accent/50 bg-accent/10 text-accent'
                        : 'border-border text-text-secondary hover:border-accent/30 hover:text-text-primary'
                    }`}
                  >
                    {label} <span className="font-mono text-meta opacity-60">({unit})</span>
                  </button>
                )
              })}
            </div>
          </section>

          {/* Theme */}
          <section>
            <div className="mb-1 flex items-center gap-2">
              <Palette size={14} className="text-text-tertiary" />
              <h3 className="text-body font-semibold text-text-primary">Theme</h3>
            </div>
            <p className="mb-3 text-meta text-text-secondary">Choose an accent color for the interface.</p>
            <div className="mb-3 grid grid-cols-2 gap-2">
              {THEMES.map((theme) => {
                const active = themeId === theme.id
                return (
                  <button
                    key={theme.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setTheme(theme.id)}
                    className={`relative flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-[border-color,color,background-color] ${
                      active
                        ? 'border-accent/60 bg-accent/10'
                        : 'border-border hover:border-accent/30 hover:bg-surface-2'
                    }`}
                  >
                    <span
                      className="size-5 shrink-0 rounded-full ring-2 ring-border"
                      style={{ backgroundColor: theme.preview }}
                    />
                    <span className={`text-body font-medium ${active ? 'text-accent' : 'text-text-secondary'}`}>
                      {theme.name}
                    </span>
                    {active && <Check size={13} className="absolute right-2 top-2 text-accent" />}
                  </button>
                )
              })}
            </div>

            {/* Custom accent */}
            <button
              type="button"
              aria-pressed={themeId === 'custom'}
              onClick={() => pickerRef.current?.click()}
              className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 transition-[border-color,background-color] ${
                themeId === 'custom'
                  ? 'border-accent/60 bg-accent/10'
                  : 'border-border hover:border-accent/30 hover:bg-surface-2'
              }`}
            >
              <span
                className="size-8 shrink-0 rounded-lg border border-border"
                style={{ backgroundColor: themeId === 'custom' && customAccent ? customAccent : '#f97316' }}
              />
              <div className="flex-1 text-left">
                <p className={`text-body font-medium ${themeId === 'custom' ? 'text-accent' : 'text-text-secondary'}`}>
                  Custom color
                </p>
                <p className="font-mono text-meta text-text-secondary">
                  {themeId === 'custom' && customAccent ? customAccent : 'Pick a color'}
                </p>
              </div>
              <Pipette size={15} className="text-text-tertiary" />
            </button>
            <input
              ref={pickerRef}
              type="color"
              aria-label="Custom accent color"
              className="sr-only"
              value={themeId === 'custom' && customAccent ? customAccent : '#f97316'}
              onChange={(e) => setCustom(e.target.value)}
            />

            {/* Live preview */}
            <div className="mt-3 space-y-3 rounded-xl border border-border bg-surface-2 p-4">
              <div className="flex gap-2">
                {/* DEC-2: primary action is dark-on-orange (on-accent), not white. */}
                <div className="flex h-8 items-center rounded-lg bg-accent px-3 text-meta font-semibold text-on-accent">Button</div>
                <div className="flex h-8 items-center rounded-lg border border-accent/50 px-3 text-meta font-medium text-accent">Outline</div>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-border">
                <div className="h-full w-3/4 rounded-full bg-accent" />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-meta text-accent">Tag</span>
                <span className="text-meta text-text-secondary">Sample text in dark theme</span>
              </div>
            </div>
          </section>

          {/* Account (optional) */}
          <AccountSection />

          {/* DEC-10 — display name + "show my name on shares" consent. */}
          <ShareIdentitySection />

          {/* DEC-12 — Backup & data: manual export/import, account-free. */}
          <section>
            <div className="mb-1 flex items-center gap-2">
              <DatabaseBackup size={14} className="text-text-tertiary" />
              <h3 className="text-body font-semibold text-text-primary">Backup &amp; data</h3>
            </div>
            <p className="mb-3 text-meta text-text-secondary">
              Save a copy of your garage, or restore from a backup file. Works without an account — everything stays in this browser.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" size="sm" onClick={exportData} className="justify-center">
                <Download size={15} /> Export
              </Button>
              <Button variant="secondary" size="sm" onClick={() => importFile.current?.click()} className="justify-center">
                <Upload size={15} /> Restore
              </Button>
            </div>
            <input
              ref={importFile}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleImportChange}
            />
            {importError && (
              <div
                role="alert"
                className="mt-3 flex items-start gap-2 rounded-lg border border-danger-border bg-danger px-3 py-2 text-meta text-danger-fg"
              >
                <AlertTriangle size={14} className="mt-px shrink-0" />
                <span>{importError}</span>
              </div>
            )}
          </section>

          {/* Legal: the published policies + the Law 25 privacy contact. */}
          <section>
            <div className="mb-1 flex items-center gap-2">
              <Scale size={14} className="text-text-tertiary" />
              <h3 className="text-body font-semibold text-text-primary">About &amp; legal</h3>
            </div>
            <p className="mb-3 text-meta text-text-secondary">
              Chudbox is a personal project. Questions or requests about your data:{' '}
              <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="text-accent underline-offset-2 hover:underline">
                {LEGAL_CONTACT_EMAIL}
              </a>
              .
            </p>
            <div className="flex flex-col gap-1.5 text-meta">
              <Link to="/terms" className="text-text-secondary transition-colors hover:text-accent">
                Terms of Service
              </Link>
              <Link to="/privacy" className="text-text-secondary transition-colors hover:text-accent">
                Privacy Policy
              </Link>
            </div>
          </section>

          {/* G4 / Law-25 — Danger zone: irreversible account deletion. Renders
              only when signed in; placed last by danger-zone convention. */}
          <DeleteAccountSection />
        </div>
      </div>

      {/* Restore confirmation — destructive (replaces all data), so the confirm
          button is the danger variant. Migrated to the <Modal> primitive: focus
          trap, Esc, and outside-press close come free and stack above the panel. */}
      <Modal
        open={showConfirm}
        onOpenChange={(o) => { if (!o) cancelImport() }}
        title="Restore backup?"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={cancelImport}>Cancel</Button>
            <Button variant="danger" onClick={confirmImport}>Restore</Button>
          </>
        }
      >
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="mt-0.5 shrink-0 text-warning-fg" />
          <div>
            <p className="text-body text-text-secondary">
              This replaces all current data with the backup from{' '}
              <span className="font-mono text-meta text-text-primary">
                {pending?.exportedAt ? new Date(pending.exportedAt).toLocaleString() : 'unknown date'}
              </span>
              . This cannot be undone.
            </p>
            {pending?.cars && (
              <p className="mt-2 text-meta text-text-secondary">
                Backup contains {pending.cars.length} car{pending.cars.length !== 1 ? 's' : ''}.
              </p>
            )}
          </div>
        </div>
      </Modal>
    </>
  )
}
