import { useState } from 'react'
import { X } from 'lucide-react'
import useGarageStore from '../store/useGarageStore'
import DateInput from './DateInput'

export default function EditCarModal({ car, onClose }) {
  const updateCar = useGarageStore((s) => s.updateCar)
  const [form, setForm] = useState({
    year: car.year || '', make: car.make || '', model: car.model || '',
    trim: car.trim || '', color: car.color || '', mileage: car.mileage || '', nickname: car.nickname || '',
    purchaseDate: car.purchaseDate || '', saleDate: car.saleDate || '',
    status: car.status || 'current', salePrice: car.salePrice || '', tradeFor: car.tradeFor || '',
  })

  const set    = (k) => (eOrVal) => setForm((f) => ({ ...f, [k]: typeof eOrVal === 'string' ? eOrVal : eOrVal.target.value }))
  const isSold = form.saleDate && new Date(form.saleDate + 'T12:00:00') <= new Date()

  const handleSubmit = (e) => {
    e.preventDefault()
    updateCar(car.id, form)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold text-white">Edit Car</h2>
          <button onClick={onClose} className="btn-ghost"><X size={18} /></button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto px-5 py-4 space-y-4">
          {/* Basic info */}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Year *</label><input className="input" value={form.year} onChange={set('year')} required /></div>
            <div><label className="label">Make *</label><input className="input" value={form.make} onChange={set('make')} required /></div>
          </div>
          <div><label className="label">Model *</label><input className="input" value={form.model} onChange={set('model')} required /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Trim</label><input className="input" value={form.trim} onChange={set('trim')} /></div>
            <div><label className="label">Color</label><input className="input" value={form.color} onChange={set('color')} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Mileage</label><input className="input" type="number" value={form.mileage} onChange={set('mileage')} /></div>
            <div><label className="label">Nickname</label><input className="input" value={form.nickname} onChange={set('nickname')} /></div>
          </div>

          {/* Ownership */}
          <div className="border-t border-border pt-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">Ownership</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Purchase Date</label>
                <DateInput value={form.purchaseDate} onChange={set('purchaseDate')} />
              </div>
              <div>
                <label className="label">Sale Date</label>
                <DateInput value={form.saleDate} onChange={set('saleDate')} />
              </div>
            </div>

            <div className="mt-3">
              <label className="label">Status</label>
              {isSold ? (
                <div className="input flex items-center gap-2 text-red-400 cursor-not-allowed opacity-70">
                  <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
                  Sold — sale date is in the past
                </div>
              ) : (
                <select className="input" value={form.status} onChange={set('status')}>
                  <option value="current">Current</option>
                  <option value="for-sale">For Sale</option>
                  <option value="for-trade">For Trade</option>
                </select>
              )}
            </div>

            {!isSold && form.status === 'for-sale' && (
              <div className="mt-3">
                <label className="label">Asking Price ($)</label>
                <input className="input" type="number" step="0.01" placeholder="25000" value={form.salePrice} onChange={set('salePrice')} />
              </div>
            )}

            {!isSold && form.status === 'for-trade' && (
              <div className="mt-3">
                <label className="label">Will Trade For</label>
                <textarea
                  className="input resize-none"
                  rows={3}
                  placeholder={"e.g.\n2022 Subaru WRX\n1999 Mazda MX-5 Miata"}
                  value={form.tradeFor}
                  onChange={set('tradeFor')}
                />
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-1 pb-1">
            <button type="button" onClick={onClose} className="btn-outline flex-1 justify-center">Cancel</button>
            <button type="submit" className="btn-primary flex-1 justify-center">Save Changes</button>
          </div>
        </form>
      </div>
    </div>
  )
}
