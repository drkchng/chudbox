import { useState } from 'react'
import { Plus, Car, Palette } from 'lucide-react'
import useGarageStore from '../store/useGarageStore'
import CarCard from '../components/CarCard'
import AddCarModal from '../components/AddCarModal'
import ThemePanel from '../components/ThemePanel'

export default function Garage() {
  const cars = useGarageStore((s) => s.cars)
  const [showAdd, setShowAdd] = useState(false)
  const [showTheme, setShowTheme] = useState(false)

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
            <button onClick={() => setShowTheme(true)} className="btn-outline" title="Change theme">
              <Palette size={16} />
            </button>
            <button onClick={() => setShowAdd(true)} className="btn-primary">
              <Plus size={16} /> Add Car
            </button>
          </div>
        </div>
      </header>

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

      {showAdd  && <AddCarModal   onClose={() => setShowAdd(false)} />}
      {showTheme && <ThemePanel   onClose={() => setShowTheme(false)} />}
    </div>
  )
}
