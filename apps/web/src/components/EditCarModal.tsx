import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { X } from 'lucide-react'
import useGarageStore from '../store/useGarageStore'
import { DISTANCE_UNITS, mileagePrefill } from '../utils/units'
import { useModalDismiss } from '../hooks/useModalDismiss'
import DateInput from './DateInput'
import type { CarDetails, CarStoredStatus, StoredCar, FieldChangeEvent } from '../types'

const today = new Date().toISOString().slice(0, 10)

interface EditCarModalProps {
  car: StoredCar
  onClose: () => void
}

export default function EditCarModal({ car, onClose }: EditCarModalProps) {
  const updateCar = useGarageStore((s) => s.updateCar)
  const distanceUnit = useGarageStore((s) => s.distanceUnit)
  const distShort = DISTANCE_UNITS[distanceUnit]?.short ?? 'mi'
  const [form, setForm] = useState<CarDetails>({
    // Mileage prefills from the canonical miles converted to the ACTIVE unit
    // (not the raw string) so editing under a different unit shows the right
    // number and saving re-canonicalizes correctly — never 1.6×-corrupting it.
    year: car.year || '', make: car.make || '', model: car.model || '',
    trim: car.trim || '', color: car.color || '',
    mileage: mileagePrefill(car.mileage, car.mileageMiles, distanceUnit), nickname: car.nickname || '',
    purchaseDate: car.purchaseDate || '', saleDate: car.saleDate || '',
    status: car.status || 'current', salePrice: car.salePrice || '', tradeFor: car.tradeFor || '',
  })
  const onBackdropClick = useModalDismiss(onClose)

  const set =
    <K extends keyof CarDetails>(key: K) =>
    (eOrVal: string | FieldChangeEvent): void => {
      const value = typeof eOrVal === 'string' ? eOrVal : eOrVal.target.value
      setForm((f) => ({ ...f, [key]: value as CarDetails[K] }))
    }

  const setStatus = (e: ChangeEvent<HTMLSelectElement>) => {
    const newStatus = e.target.value as CarStoredStatus
    setForm((f) => ({
      ...f,
      status: newStatus,
      saleDate: newStatus === 'sold' ? f.saleDate : '',
    }))
  }

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    updateCar(car.id, form)
    onClose()
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80" onClick={onBackdropClick}>
      <div className="modal-content bg-surface border border-border rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-lg font-semibold text-white">Edit car</h2>
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
            <div><label className="label">Mileage ({distShort})</label><input className="input" type="number" value={form.mileage} onChange={set('mileage')} /></div>
            <div><label className="label">Nickname</label><input className="input" value={form.nickname} onChange={set('nickname')} /></div>
          </div>

          {/* Ownership */}
          <div className="border-t border-border pt-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Ownership</p>

            <div>
              <label className="label">Purchase date</label>
              <DateInput value={form.purchaseDate} onChange={set('purchaseDate')} />
            </div>

            <div>
              <label className="label">Status</label>
              <select className="input" value={form.status} onChange={setStatus}>
                <option value="current">Current</option>
                <option value="for-sale">For Sale</option>
                <option value="for-trade">For Trade</option>
                <option value="sold">Sold (Archive)</option>
                <option value="totaled">Totaled</option>
              </select>
            </div>

            {form.status === 'sold' && (
              <>
                <div>
                  <label className="label">Sale date <span className="text-gray-600">(optional)</span></label>
                  <div onFocus={() => { if (!form.saleDate) set('saleDate')(today) }}>
                    <DateInput value={form.saleDate} onChange={set('saleDate')} />
                  </div>
                </div>
                <div>
                  <label className="label">Final sale price <span className="text-gray-600">(optional)</span></label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">$</span>
                    <input className="input pl-7" type="number" step="0.01" placeholder="25000" value={form.salePrice} onChange={set('salePrice')} />
                  </div>
                </div>
              </>
            )}

            {form.status === 'for-sale' && (
              <div>
                <label className="label">Asking price <span className="text-gray-600">(optional)</span></label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">$</span>
                  <input className="input pl-7" type="number" step="0.01" placeholder="25000" value={form.salePrice} onChange={set('salePrice')} />
                </div>
              </div>
            )}

            {form.status === 'for-trade' && (
              <div>
                <label className="label">Will trade for</label>
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
            <button type="submit" className="btn-primary flex-1 justify-center">Save changes</button>
          </div>
        </form>
      </div>
    </div>
  )
}
