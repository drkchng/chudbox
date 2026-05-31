import { useState } from 'react'
import { X } from 'lucide-react'
import useGarageStore from '../store/useGarageStore'

export default function EditCarModal({ car, onClose }) {
  const updateCar = useGarageStore((s) => s.updateCar)
  const [form, setForm] = useState({
    year: car.year || '', make: car.make || '', model: car.model || '',
    trim: car.trim || '', color: car.color || '', mileage: car.mileage || '', nickname: car.nickname || '',
  })

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const handleSubmit = (e) => {
    e.preventDefault()
    updateCar(car.id, form)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-semibold text-white">Edit Car</h2>
          <button onClick={onClose} className="btn-ghost"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Year *</label>
              <input className="input" value={form.year} onChange={set('year')} required />
            </div>
            <div>
              <label className="label">Make *</label>
              <input className="input" value={form.make} onChange={set('make')} required />
            </div>
          </div>
          <div>
            <label className="label">Model *</label>
            <input className="input" value={form.model} onChange={set('model')} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Trim</label>
              <input className="input" value={form.trim} onChange={set('trim')} />
            </div>
            <div>
              <label className="label">Color</label>
              <input className="input" value={form.color} onChange={set('color')} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Mileage</label>
              <input className="input" type="number" value={form.mileage} onChange={set('mileage')} />
            </div>
            <div>
              <label className="label">Nickname</label>
              <input className="input" value={form.nickname} onChange={set('nickname')} />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-outline flex-1 justify-center">Cancel</button>
            <button type="submit" className="btn-primary flex-1 justify-center">Save Changes</button>
          </div>
        </form>
      </div>
    </div>
  )
}
