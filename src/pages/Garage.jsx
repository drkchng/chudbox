import { useState, useRef } from 'react'
import { Plus, Car, Palette, Download, Upload, AlertTriangle } from 'lucide-react'
import useGarageStore from '../store/useGarageStore'
import CarCard from '../components/CarCard'
import AddCarModal from '../components/AddCarModal'
import ThemePanel from '../components/ThemePanel'

function useBackup() {
  const state      = useGarageStore
  const importFile = useRef()
  const [importError, setImportError] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [pending, setPending] = useState(null)

  const exportData = () => {
    const { cars, themeId, customAccent } = state.getState()
    const backup = {
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

  const readFile = (file) => {
    setImportError('')
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result)
        if (!data.cars || !Array.isArray(data.cars)) throw new Error('Invalid format')
        setPending(data)
        setShowConfirm(true)
      } catch {
        setImportError('Invalid backup file. Please select a valid My Garage export.')
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
  const [showAdd,   setShowAdd]   = useState(false)
  const [showTheme, setShowTheme] = useState(false)

  const {
    exportData, readFile, importFile, importError,
    showConfirm, confirmImport, cancelImport, pending,
  } = useBackup()

  return (
    <div className="min-h-screen bg-dark">
      {/* Header */}
      <header className="border-b border-border bg-surface/50 backdrop-blur sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Car size={22} className="text-accent" />
            <span className="font-bold text-white text-lg">My Garage</span>
          </div>
          <div className="flex gap-2">
            <button onClick={exportData} className="btn-outline" title="Download backup">
              <Download size={16} />
            </button>
            <button onClick={() => importFile.current.click()} className="btn-outline" title="Restore backup">
              <Upload size={16} />
            </button>
            <input
              ref={importFile}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => { if (e.target.files[0]) { readFile(e.target.files[0]); e.target.value = '' } }}
            />
            <button onClick={() => setShowTheme(true)} className="btn-outline" title="Change theme">
              <Palette size={16} />
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
            <div className="w-20 h-20 rounded-full bg-surface flex items-center justify-center mb-5">
              <Car size={36} className="text-gray-600" />
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">Your garage is empty</h2>
            <p className="text-gray-500 mb-6 text-sm">Add your first car to get started.</p>
            <button onClick={() => setShowAdd(true)} className="btn-primary">
              <Plus size={16} /> Add Your First Car
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-surface border border-border rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-4">
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

      {showAdd   && <AddCarModal onClose={() => setShowAdd(false)} />}
      {showTheme && <ThemePanel  onClose={() => setShowTheme(false)} />}
    </div>
  )
}
