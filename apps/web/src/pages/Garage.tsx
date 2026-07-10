import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Car, Eye, Settings } from 'lucide-react'
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
    <div className="flex min-h-screen flex-col bg-dark">
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
            {/* DEC-11: the follower's saved-builds "Watching" list. */}
            <Link
              to="/watching"
              aria-label="Watching"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border px-3 text-meta font-medium text-text-primary outline-hidden transition-colors hover:border-accent/50 hover:text-accent focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              <Eye size={16} aria-hidden /> Watching
            </Link>
            <IconButton aria-label="Settings" variant="ghost" onClick={() => setShowSettings(true)}>
              <Settings size={18} />
            </IconButton>
            <Button size="sm" onClick={() => setShowAdd(true)}>
              <Plus size={16} /> Add Car
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-10">
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

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-6 py-5 text-meta text-text-tertiary">
          <span>Chudbox · a personal project</span>
          <Link to="/terms" className="transition-colors hover:text-accent">Terms of Service</Link>
          <Link to="/privacy" className="transition-colors hover:text-accent">Privacy Policy</Link>
        </div>
      </footer>

      {showAdd      && <AddCarModal   onClose={() => setShowAdd(false)} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  )
}
