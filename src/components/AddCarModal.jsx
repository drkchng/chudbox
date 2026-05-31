import { useState } from 'react'
import { X } from 'lucide-react'
import useGarageStore from '../store/useGarageStore'

export default function AddCarModal({ onClose }) {
  const addCar = useGarageStore((s) => s.addCar)
  const [form, setForm] = useState({ year: '', make: '', model: '', trim: '', color: '', mileage: '', nickname: '' })

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!form.year || !form.make || !form.model) return
    addCar(form)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="text-lg font-semibold text-white">Add Car</h2>
          <button onClick={onClose} className="btn-ghost"><X size={18} /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Year *</label>
              <input className="input" placeholder="2020" value={form.year} onChange={set('year')} required />
            </div>
            <div>
              <label className="label">Make *</label>
              <input className="input" placeholder="Toyota" value={form.make} onChange={set('make')} required />
            </div>
          </div>
          <div>
            <label className="label">Model *</label>
            <input className="input" placeholder="Supra" value={form.model} onChange={set('model')} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Trim</label>
              <input className="input" placeholder="GR" value={form.trim} onChange={set('trim')} />
            </div>
            <div>
              <label className="label">Color</label>
              <input className="input" placeholder="Matte Black" value={form.color} onChange={set('color')} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Mileage</label>
              <input className="input" type="number" placeholder="45000" value={form.mileage} onChange={set('mileage')} />
            </div>
            <div>
              <label className="label">Nickname</label>
              <input className="input" placeholder="Project S" value={form.nickname} onChange={set('nickname')} />
            </div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-outline flex-1 justify-center">Cancel</button>
            <button type="submit" className="btn-primary flex-1 justify-center">Add Car</button>
          </div>
        </form>
      </div>
    </div>
  )
}
