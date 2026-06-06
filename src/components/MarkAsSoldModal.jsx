import { useState } from 'react'
import { X } from 'lucide-react'
import useGarageStore from '../store/useGarageStore'
import DateInput from './DateInput'

const today = new Date().toISOString().slice(0, 10)

export default function MarkAsSoldModal({ car, onClose }) {
  const updateCar = useGarageStore((s) => s.updateCar)
  const [saleDate, setSaleDate] = useState(today)
  const [salePrice, setSalePrice] = useState(car.salePrice || '')

  const handleConfirm = () => {
    updateCar(car.id, { status: 'sold', saleDate, salePrice })
    onClose()
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="modal-content bg-surface border border-border rounded-2xl w-full max-w-sm shadow-2xl p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-white">Mark as sold</h3>
          <button onClick={onClose} className="btn-ghost"><X size={16} /></button>
        </div>

        <p className="text-sm text-gray-400 -mt-1">
          {car.year} {car.make} {car.model}
          {car.nickname && <span className="text-accent"> &quot;{car.nickname}&quot;</span>}
        </p>

        <div className="space-y-3">
          <div>
            <label className="label">Sale date <span className="text-gray-600">(optional)</span></label>
            <DateInput value={saleDate} onChange={setSaleDate} />
          </div>
          <div>
            <label className="label">Final sale price <span className="text-gray-600">(optional)</span></label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">$</span>
              <input
                className="input pl-7"
                type="number"
                step="0.01"
                placeholder="25000"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="btn-outline flex-1 justify-center">Cancel</button>
          <button onClick={handleConfirm} className="btn-primary flex-1 justify-center">Confirm sale</button>
        </div>
      </div>
    </div>
  )
}
