import { useNavigate } from 'react-router-dom'
import { Car, AlertTriangle, CheckSquare, Wrench } from 'lucide-react'
import { getCarStatus, STATUS_CONFIG } from '../utils/carStatus'
import useGarageStore from '../store/useGarageStore'
import { CURRENCIES, DISTANCE_UNITS } from '../utils/units'

export default function CarCard({ car }) {
  const navigate     = useNavigate()
  const currency     = useGarageStore((s) => s.currency)
  const distanceUnit = useGarageStore((s) => s.distanceUnit)
  const sym          = CURRENCIES[currency]?.symbol ?? '$'
  const distShort    = DISTANCE_UNITS[distanceUnit]?.short ?? 'mi'
  const coverPhoto   = car.photos.find((p) => p.id === car.coverPhoto) || car.photos[0]
  const openIssues   = car.issues.filter((i) => i.status !== 'resolved').length
  const pendingTodos = car.todos.filter((t) => !t.done).length
  const status       = getCarStatus(car)
  const statusCfg    = STATUS_CONFIG[status]

  return (
    <div
      onClick={() => navigate(`/car/${car.id}`)}
      className="card p-0 overflow-hidden cursor-pointer group"
    >
      {/* Image section */}
      <div className="h-48 bg-surface overflow-hidden relative">
        {coverPhoto ? (
          <>
            {/*
              The transform lives on this wrapper, NOT on the img.
              Putting image + gradient in the same scaled element means they share
              one compositor layer — no inter-layer seam is possible mid-animation.
              Previously the img was on its own GPU layer (promoted by transform)
              while the gradient lived on the parent layer; they composited at
              different times per frame, revealing a 1px gap at the clip edge.
            */}
            <div className="absolute inset-0">
              <img
                src={coverPhoto.dataUrl}
                alt={`${car.year} ${car.make} ${car.model}`}
                className="w-full h-full object-cover"
              />
              {/*
                Solid stop at 12px before the fade begins.
                At 1.05× scale the clip boundary falls ~4.6px from the wrapper's
                logical bottom — safely inside the 12px solid zone at every
                intermediate scale during both zoom-in and zoom-out.
              */}
              <div
                className="absolute inset-x-0 bottom-0 pointer-events-none"
                style={{
                  height: '80px',
                  background: 'linear-gradient(to top, rgb(var(--surface)) 12px, rgb(var(--surface) / 0) 80px)',
                }}
              />
            </div>

            {/* Badges sit outside the scaled wrapper so they don't zoom */}
            <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between">
              <span className={`badge border text-xs ${statusCfg.class}`}>
                {statusCfg.label}
                {status === 'for-sale' && car.salePrice ? ` · ${sym}${Number(car.salePrice).toLocaleString()}` : ''}
              </span>
              {openIssues > 0 && (
                <span className="badge bg-red-900/80 text-red-300 border border-red-700/40 gap-1">
                  <AlertTriangle size={10} /> {openIssues}
                </span>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-surface to-surface-2">
              <Car size={40} className="text-gray-700" />
            </div>
            <div className="absolute top-2.5 left-2.5 right-2.5 flex items-center justify-between">
              <span className={`badge border text-xs ${statusCfg.class}`}>
                {statusCfg.label}
                {status === 'for-sale' && car.salePrice ? ` · ${sym}${Number(car.salePrice).toLocaleString()}` : ''}
              </span>
              {openIssues > 0 && (
                <span className="badge bg-red-900/80 text-red-300 border border-red-700/40 gap-1">
                  <AlertTriangle size={10} /> {openIssues}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Info */}
      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="min-w-0">
            <p className="text-xs text-gray-500 font-mono mb-0.5">{car.year}</p>
            <h3 className="font-semibold text-white group-hover:text-accent transition-colors truncate">
              {car.make} {car.model}
            </h3>
            {car.nickname && (
              <p className="text-xs text-accent/80 italic mt-0.5 truncate">"{car.nickname}"</p>
            )}
          </div>
          {car.color && (
            <span className="text-xs text-gray-500 border border-border rounded px-2 py-0.5 shrink-0 mt-0.5">
              {car.color}
            </span>
          )}
        </div>

        {status === 'for-trade' && car.tradeFor && (
          <p className="text-xs text-blue-400 mb-3 leading-relaxed line-clamp-2">
            Trade for: {car.tradeFor.split('\n').filter(Boolean).join(', ')}
          </p>
        )}

        <div className="flex items-center gap-3 pt-3 border-t border-border text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <Wrench size={11} className="text-gray-600" />
            {car.mods.length} mods
          </span>
          {pendingTodos > 0 && (
            <span className="flex items-center gap-1.5 text-accent/70">
              <CheckSquare size={11} />
              {pendingTodos} to-do
            </span>
          )}
          {car.mileage && (
            <span className="ml-auto font-mono text-gray-600">
              {Number(car.mileage).toLocaleString()} {distShort}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
