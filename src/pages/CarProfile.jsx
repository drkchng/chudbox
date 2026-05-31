import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Car, Pencil, Trash2, Camera, ShoppingCart, Wrench, ClipboardList, CheckSquare, AlertTriangle, Palette, DollarSign, RefreshCw } from 'lucide-react'
import useGarageStore from '../store/useGarageStore'
import { getCarStatus, STATUS_CONFIG } from '../utils/carStatus'
import PhotosTab from '../components/tabs/PhotosTab'
import WishlistTab from '../components/tabs/WishlistTab'
import ModsTab from '../components/tabs/ModsTab'
import MaintenanceTab from '../components/tabs/MaintenanceTab'
import TodoTab from '../components/tabs/TodoTab'
import IssuesTab from '../components/tabs/IssuesTab'
import EditCarModal from '../components/EditCarModal'
import ThemePanel from '../components/ThemePanel'

const TABS = [
  { id: 'photos',      label: 'Photos',       icon: Camera },
  { id: 'wishlist',    label: 'Wishlist',      icon: ShoppingCart },
  { id: 'mods',        label: 'Mods',          icon: Wrench },
  { id: 'maintenance', label: 'Maintenance',   icon: ClipboardList },
  { id: 'todos',       label: 'To-Do',         icon: CheckSquare },
  { id: 'issues',      label: 'Issues',        icon: AlertTriangle },
]

export default function CarProfile() {
  const { id } = useParams()
  const navigate = useNavigate()
  const car = useGarageStore((s) => s.cars.find((c) => c.id === id))
  const deleteCar = useGarageStore((s) => s.deleteCar)
  const [tab, setTab] = useState('photos')
  const [editing, setEditing] = useState(false)
  const [showTheme, setShowTheme] = useState(false)

  if (!car) {
    return (
      <div className="min-h-screen bg-dark flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-400 mb-4">Car not found.</p>
          <button onClick={() => navigate('/')} className="btn-outline"><ArrowLeft size={14} /> Back to Garage</button>
        </div>
      </div>
    )
  }

  const coverPhoto  = car.photos.find((p) => p.id === car.coverPhoto) || car.photos[0]
  const openIssues  = car.issues.filter((i) => i.status !== 'resolved').length
  const pendingTodos = car.todos.filter((t) => !t.done).length
  const status      = getCarStatus(car)
  const statusCfg   = STATUS_CONFIG[status]

  const handleDelete = () => {
    if (confirm(`Delete ${car.year} ${car.make} ${car.model}? This cannot be undone.`)) {
      deleteCar(id)
      navigate('/')
    }
  }

  return (
    <div className="min-h-screen bg-dark">
      {/* Hero banner */}
      <div className="relative h-56 bg-surface-2 overflow-hidden">
        {coverPhoto ? (
          <img src={coverPhoto.dataUrl} alt="cover" className="w-full h-full object-cover opacity-60" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Car size={64} className="text-gray-700" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-dark via-dark/40 to-transparent" />

        {/* Back button */}
        <button
          onClick={() => navigate('/')}
          className="absolute top-4 left-4 btn-outline bg-dark/60 backdrop-blur-sm border-white/10 text-white hover:text-accent"
        >
          <ArrowLeft size={14} /> Garage
        </button>

        {/* Actions */}
        <div className="absolute top-4 right-4 flex gap-2">
          <button onClick={() => setShowTheme(true)} className="btn-outline bg-dark/60 backdrop-blur-sm border-white/10 text-white hover:text-accent" title="Change theme">
            <Palette size={14} />
          </button>
          <button onClick={() => setEditing(true)} className="btn-outline bg-dark/60 backdrop-blur-sm border-white/10 text-white hover:text-accent">
            <Pencil size={14} /> Edit
          </button>
          <button onClick={handleDelete} className="btn-outline bg-dark/60 backdrop-blur-sm border-red-900/40 text-red-400 hover:text-red-300 hover:border-red-500/50">
            <Trash2 size={14} />
          </button>
        </div>

        {/* Car info */}
        <div className="absolute bottom-5 left-6">
          <div className="flex items-center gap-2 mb-1.5">
            <span className={`badge border text-xs ${statusCfg.class}`}>
              {statusCfg.label}
              {status === 'for-sale' && car.salePrice ? ` · $${Number(car.salePrice).toLocaleString()}` : ''}
            </span>
            {car.purchaseDate && (
              <span className="text-xs text-gray-500">
                Owned since {new Date(car.purchaseDate + 'T12:00:00').toLocaleDateString()}
              </span>
            )}
            {status === 'sold' && car.saleDate && (
              <span className="text-xs text-gray-500">
                Sold {new Date(car.saleDate + 'T12:00:00').toLocaleDateString()}
              </span>
            )}
          </div>
          <h1 className="text-3xl font-bold text-white leading-tight">
            {car.year} {car.make} {car.model}
          </h1>
          <div className="flex items-center gap-3 mt-1 flex-wrap">
            {car.trim && <span className="text-sm text-gray-300">{car.trim}</span>}
            {car.color && <span className="text-sm text-gray-400">· {car.color}</span>}
            {car.mileage && <span className="text-sm text-gray-400">· {Number(car.mileage).toLocaleString()} mi</span>}
            {car.nickname && <span className="text-sm text-accent font-medium">· "{car.nickname}"</span>}
          </div>
          {status === 'for-trade' && car.tradeFor && (
            <p className="text-xs text-blue-400 mt-1.5 max-w-xs">
              Trade for: {car.tradeFor.split('\n').filter(Boolean).join(', ')}
            </p>
          )}
        </div>

        {/* Quick stats badges */}
        <div className="absolute bottom-5 right-6 flex gap-2 flex-wrap justify-end">
          {openIssues > 0 && (
            <span className="badge bg-red-900/60 text-red-300 border border-red-700/40">
              {openIssues} issue{openIssues > 1 ? 's' : ''}
            </span>
          )}
          {pendingTodos > 0 && (
            <span className="badge bg-orange-900/60 text-orange-300 border border-orange-700/40">
              {pendingTodos} todo{pendingTodos > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="border-b border-border bg-surface/30 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex gap-1 py-2 overflow-x-auto no-scrollbar">
            {TABS.map(({ id: tid, label, icon: Icon }) => (
              <button
                key={tid}
                onClick={() => setTab(tid)}
                className={`tab-btn flex items-center gap-1.5 ${tab === tid ? 'tab-active' : 'tab-inactive'}`}
              >
                <Icon size={14} />
                {label}
                {tid === 'issues' && openIssues > 0 && (
                  <span className="ml-1 bg-red-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">
                    {openIssues}
                  </span>
                )}
                {tid === 'todos' && pendingTodos > 0 && (
                  <span className="ml-1 bg-accent text-white text-xs rounded-full w-4 h-4 flex items-center justify-center leading-none">
                    {pendingTodos}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Tab content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {tab === 'photos'      && <PhotosTab car={car} />}
        {tab === 'wishlist'    && <WishlistTab car={car} />}
        {tab === 'mods'        && <ModsTab car={car} />}
        {tab === 'maintenance' && <MaintenanceTab car={car} />}
        {tab === 'todos'       && <TodoTab car={car} />}
        {tab === 'issues'      && <IssuesTab car={car} />}
      </div>

      {editing    && <EditCarModal car={car} onClose={() => setEditing(false)} />}
      {showTheme  && <ThemePanel onClose={() => setShowTheme(false)} />}
    </div>
  )
}
