import { useState } from 'react'
import { Plus, Car, Settings } from 'lucide-react'
import useGarageStore from '../store/useGarageStore'
import CarCard from '../components/CarCard'
import AddCarModal from '../components/AddCarModal'
import SettingsPanel from '../components/SettingsPanel'
import Button from '../components/ui/Button'
import IconButton from '../components/ui/IconButton'

export default function Garage() {
  const cars = useGarageStore((s) => s.cars)
  const [showAdd,      setShowAdd]      = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  return (
    <div className="min-h-screen bg-dark">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-surface">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg border border-accent/30 bg-accent/15">
              <Car size={16} className="text-accent" />
            </div>
            <span className="text-subhead font-bold tracking-tight text-text-primary">Chudbox</span>
          </div>
          {/* Backup/import moved to Settings → Backup & data (DEC-12). */}
          <div className="flex items-center gap-2">
            <IconButton aria-label="Settings" variant="ghost" onClick={() => setShowSettings(true)}>
              <Settings size={18} />
            </IconButton>
            <Button size="sm" onClick={() => setShowAdd(true)}>
              <Plus size={16} /> Add Car
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-10">
        {cars.length === 0 ? (
          /* M4 — empty state */
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <div className="relative mb-8">
              <div className="flex size-24 items-center justify-center rounded-xl border border-border bg-surface-2">
                <Car size={40} className="text-text-disabled" />
              </div>
              {/* Accent hint pointing at the primary action (add). */}
              <div className="absolute -right-1.5 -top-1.5 flex size-7 items-center justify-center rounded-full border border-accent/30 bg-accent/20">
                <Plus size={13} className="text-accent" />
              </div>
            </div>
            <h1 className="mb-2 text-title font-bold text-text-primary">Nothing here yet</h1>
            <p className="mb-8 max-w-sm text-body leading-relaxed text-text-secondary">
              Add a car to start logging mods, maintenance records, and parts.
              Your garage lives in this browser — no account required.
            </p>
            <Button onClick={() => setShowAdd(true)}>
              <Plus size={16} /> Add your first car
            </Button>
          </div>
        ) : (
          <>
            <div className="mb-6 flex items-center justify-between">
              <h1 className="text-title font-bold text-text-primary">
                {cars.length} {cars.length === 1 ? 'Car' : 'Cars'}
              </h1>
            </div>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {cars.map((car) => <CarCard key={car.id} car={car} />)}
            </div>
          </>
        )}
      </main>

      {showAdd      && <AddCarModal   onClose={() => setShowAdd(false)} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  )
}
