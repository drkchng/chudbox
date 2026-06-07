import { useState, useRef } from 'react'
import type { ChangeEvent } from 'react'
import { Plus, Car, Download, Upload, AlertTriangle, Settings } from 'lucide-react'
import useGarageStore from '../store/useGarageStore'
import CarCard from '../components/CarCard'
import AddCarModal from '../components/AddCarModal'
import SettingsPanel from '../components/SettingsPanel'
import type { Car as CarType } from '../types'

interface BackupData {
  version?: number
  exportedAt?: string
  cars: CarType[]
  themeId?: string
  customAccent?: string | null
}

function isBackupData(value: unknown): value is BackupData {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as Record<string, unknown>).cars)
  )
}

function useBackup() {
  const state      = useGarageStore
  const importFile = useRef<HTMLInputElement | null>(null)
  const [importError, setImportError] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [pending, setPending] = useState<BackupData | null>(null)

  const exportData = () => {
    const { cars, themeId, customAccent } = state.getState()
    const backup: BackupData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      cars,
      themeId,
      customAccent,
    }
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
        const data: unknown = JSON.parse(result)
        if (!isBackupData(data)) throw new Error('Invalid format')
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
    state.setState({
      cars:         pending.cars         ?? [],
      themeId:      pending.themeId      ?? 'garage',
      customAccent: pending.customAccent ?? null,
    })
    setPending(null)
    setShowConfirm(false)
  }

  const cancelImport = () => { setPending(null); setShowConfirm(false) }

  return { exportData, readFile, importFile, importError, showConfirm, confirmImport, cancelImport, pending }
}

export default function Garage() {
  const cars     = useGarageStore((s) => s.cars)
  const [showAdd,      setShowAdd]      = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  const {
    exportData, readFile, importFile, importError,
    showConfirm, confirmImport, cancelImport, pending,
  } = useBackup()

  const handleImportChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) { readFile(file); e.target.value = '' }
  }

  return (
    <div className="min-h-screen bg-dark">
      {/* Header */}
      <header className="border-b border-border bg-surface sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center">
              <Car size={16} className="text-accent" />
            </div>
            <span className="font-bold text-white text-lg tracking-tight">Chudbox</span>
          </div>
          <div className="flex gap-2">
            <button onClick={exportData} className="btn-outline" title="Download backup">
              <Download size={16} />
            </button>
            <button onClick={() => importFile.current?.click()} className="btn-outline" title="Restore backup">
              <Upload size={16} />
            </button>
            <input
              ref={importFile}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleImportChange}
            />
            <button onClick={() => setShowSettings(true)} className="btn-outline" title="Settings">
              <Settings size={16} />
            </button>
            <button onClick={() => setShowAdd(true)} className="btn-primary">
              <Plus size={16} /> Add Car
            </button>
          </div>
        </div>
      </header>

      {/* Import error toast */}
      {importError && (
        <div className="max-w-7xl mx-auto px-6 pt-4">
          <div className="flex items-center gap-2 bg-red-900/40 border border-red-700/50 text-red-300 text-sm rounded-lg px-4 py-2.5">
            <AlertTriangle size={15} className="shrink-0" />
            {importError}
          </div>
        </div>
      )}

      <main className="max-w-7xl mx-auto px-6 py-10">
        {cars.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <div className="relative mb-8">
              <div className="w-24 h-24 rounded-2xl bg-surface-2 border border-border flex items-center justify-center">
                <Car size={40} className="text-gray-600" />
              </div>
              <div className="absolute -top-1.5 -right-1.5 w-7 h-7 rounded-full bg-accent/20 border border-accent/30 flex items-center justify-center">
                <Plus size={13} className="text-accent" />
              </div>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Nothing here yet</h2>
            <p className="text-gray-500 mb-8 max-w-sm text-sm leading-relaxed">
              Add a car and start logging mods, maintenance records, and parts.
              Everything stays in your browser — no account, no sync, no cloud.
            </p>
            <button onClick={() => setShowAdd(true)} className="btn-primary">
              <Plus size={16} /> Add your first car
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-2xl font-bold text-white">
                {cars.length} {cars.length === 1 ? 'Car' : 'Cars'}
              </h1>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
              {cars.map((car) => <CarCard key={car.id} car={car} />)}
            </div>
          </>
        )}
      </main>

      {/* Import confirmation modal */}
      {showConfirm && (
        <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
          <div className="modal-content bg-surface border border-border rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle size={20} className="text-yellow-400 mt-0.5 shrink-0" />
              <div>
                <h3 className="font-semibold text-white">Restore backup?</h3>
                <p className="text-sm text-gray-400 mt-1">
                  This will replace all current data with the backup from{' '}
                  <span className="text-white font-mono text-xs">
                    {pending?.exportedAt ? new Date(pending.exportedAt).toLocaleString() : 'unknown date'}
                  </span>
                  . This cannot be undone.
                </p>
                {pending?.cars && (
                  <p className="text-xs text-gray-500 mt-2">
                    Backup contains {pending.cars.length} car{pending.cars.length !== 1 ? 's' : ''}.
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={cancelImport} className="btn-outline flex-1 justify-center">Cancel</button>
              <button onClick={confirmImport} className="btn-primary flex-1 justify-center">Restore</button>
            </div>
          </div>
        </div>
      )}

      {showAdd      && <AddCarModal   onClose={() => setShowAdd(false)} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  )
}
