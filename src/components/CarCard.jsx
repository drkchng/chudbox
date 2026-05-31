import { useNavigate } from 'react-router-dom'
import { Car, AlertTriangle, CheckSquare, Wrench } from 'lucide-react'

export default function CarCard({ car }) {
  const navigate = useNavigate()
  const coverPhoto = car.photos.find((p) => p.id === car.coverPhoto) || car.photos[0]
  const openIssues = car.issues.filter((i) => i.status !== 'resolved').length
  const pendingTodos = car.todos.filter((t) => !t.done).length

  return (
    <div
      onClick={() => navigate(`/car/${car.id}`)}
      className="card p-0 overflow-hidden cursor-pointer hover:border-accent/40 hover:shadow-lg hover:shadow-accent/5 hover:-translate-y-0.5 group"
    >
      {/* Cover image */}
      <div className="h-44 bg-surface-2 overflow-hidden relative">
        {coverPhoto ? (
          <img src={coverPhoto.dataUrl} alt={car.model} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Car size={40} className="text-gray-700" />
          </div>
        )}
        {openIssues > 0 && (
          <span className="absolute top-2 right-2 badge bg-red-900/80 text-red-300 border border-red-700/40 backdrop-blur-sm">
            <AlertTriangle size={10} className="mr-1" /> {openIssues}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs text-gray-500">{car.year}</p>
            <h3 className="font-semibold text-white group-hover:text-accent transition-colors">
              {car.make} {car.model}
            </h3>
            {car.nickname && <p className="text-xs text-accent mt-0.5">"{car.nickname}"</p>}
          </div>
          {car.color && (
            <span className="text-xs text-gray-500 border border-border rounded px-2 py-0.5 mt-1 shrink-0">{car.color}</span>
          )}
        </div>

        {/* Quick stats */}
        <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <Wrench size={11} /> {car.mods.length} mods
          </span>
          <span className="flex items-center gap-1">
            <CheckSquare size={11} /> {pendingTodos} todos
          </span>
          {car.mileage && (
            <span className="ml-auto">{Number(car.mileage).toLocaleString()} mi</span>
          )}
        </div>
      </div>
    </div>
  )
}
