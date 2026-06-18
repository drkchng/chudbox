import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import useGarageStore from '../store/useGarageStore'
import DateInput from './DateInput'
import Modal from './ui/Modal'
import Button from './ui/Button'
import type { CarDetails, CarStoredStatus, StoredCar, FieldChangeEvent } from '../types'

// DEC-16: mileage is NOT a fixed car attribute — it is a time series of dated
// check-ins, edited via the "Log mileage" action / Mileage tab, never here. So
// the edit form drops the mileage field entirely (and never writes `mileage`,
// leaving the dual-written scalar mirror untouched).
type EditCarForm = Omit<CarDetails, 'mileage'>

const today = new Date().toISOString().slice(0, 10)

// The form lives in the Modal body; the action buttons live in the Modal footer.
// A shared id wires the footer's submit <Button> to this form (HTML form
// association is document-wide, so it works across the Base UI portal) — the
// twin of AddCarModal so add/edit stay visually and structurally identical.
const FORM_ID = 'edit-car-form'

interface EditCarModalProps {
  car: StoredCar
  onClose: () => void
}

export default function EditCarModal({ car, onClose }: EditCarModalProps) {
  const updateCar = useGarageStore((s) => s.updateCar)
  const [form, setForm] = useState<EditCarForm>({
    year: car.year || '', make: car.make || '', model: car.model || '',
    trim: car.trim || '', color: car.color || '', nickname: car.nickname || '',
    purchaseDate: car.purchaseDate || '', saleDate: car.saleDate || '',
    status: car.status || 'current', salePrice: car.salePrice || '', tradeFor: car.tradeFor || '',
  })

  const set =
    <K extends keyof EditCarForm>(key: K) =>
    (eOrVal: string | FieldChangeEvent): void => {
      const value = typeof eOrVal === 'string' ? eOrVal : eOrVal.target.value
      setForm((f) => ({ ...f, [key]: value as EditCarForm[K] }))
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
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Edit car"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form={FORM_ID}>Save changes</Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        {/* Basic info */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="edit-car-year" className="label">Year *</label>
            <input id="edit-car-year" className="input" value={form.year} onChange={set('year')} required />
          </div>
          <div>
            <label htmlFor="edit-car-make" className="label">Make *</label>
            <input id="edit-car-make" className="input" value={form.make} onChange={set('make')} required />
          </div>
        </div>
        <div>
          <label htmlFor="edit-car-model" className="label">Model *</label>
          <input id="edit-car-model" className="input" value={form.model} onChange={set('model')} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="edit-car-trim" className="label">Trim</label>
            <input id="edit-car-trim" className="input" value={form.trim} onChange={set('trim')} />
          </div>
          <div>
            <label htmlFor="edit-car-color" className="label">Color</label>
            <input id="edit-car-color" className="input" value={form.color} onChange={set('color')} />
          </div>
        </div>
        <div>
          <label htmlFor="edit-car-nickname" className="label">Nickname</label>
          <input id="edit-car-nickname" className="input" value={form.nickname} onChange={set('nickname')} />
        </div>

        {/* Ownership */}
        <div className="border-t border-border pt-4 space-y-3">
          <p className="text-xs font-semibold text-text-tertiary uppercase tracking-widest">Ownership</p>

          {/* DateInput is a composite (3 segments) → group it under its label. */}
          <div role="group" aria-labelledby="edit-car-purchase-label">
            <span id="edit-car-purchase-label" className="label">Purchase date</span>
            <DateInput value={form.purchaseDate} onChange={set('purchaseDate')} />
          </div>

          <div>
            <label htmlFor="edit-car-status" className="label">Status</label>
            <select id="edit-car-status" className="input" value={form.status} onChange={setStatus}>
              <option value="current">Current</option>
              <option value="for-sale">For Sale</option>
              <option value="for-trade">For Trade</option>
              <option value="sold">Sold (Archive)</option>
              <option value="totaled">Totaled</option>
            </select>
          </div>

          {form.status === 'sold' && (
            <>
              <div role="group" aria-labelledby="edit-car-saledate-label">
                <span id="edit-car-saledate-label" className="label">Sale date <span className="text-text-disabled">(optional)</span></span>
                <div onFocus={() => { if (!form.saleDate) set('saleDate')(today) }}>
                  <DateInput value={form.saleDate} onChange={set('saleDate')} />
                </div>
              </div>
              <div>
                <label htmlFor="edit-car-saleprice" className="label">Final sale price <span className="text-text-disabled">(optional)</span></label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary text-sm pointer-events-none">$</span>
                  <input id="edit-car-saleprice" className="input pl-7" type="number" step="0.01" placeholder="25000" value={form.salePrice} onChange={set('salePrice')} />
                </div>
              </div>
            </>
          )}

          {form.status === 'for-sale' && (
            <div>
              <label htmlFor="edit-car-askingprice" className="label">Asking price <span className="text-text-disabled">(optional)</span></label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary text-sm pointer-events-none">$</span>
                <input id="edit-car-askingprice" className="input pl-7" type="number" step="0.01" placeholder="25000" value={form.salePrice} onChange={set('salePrice')} />
              </div>
            </div>
          )}

          {form.status === 'for-trade' && (
            <div>
              <label htmlFor="edit-car-tradefor" className="label">Will trade for</label>
              <textarea
                id="edit-car-tradefor"
                className="input resize-none"
                rows={3}
                placeholder={"e.g.\n2022 Subaru WRX\n1999 Mazda MX-5 Miata"}
                value={form.tradeFor}
                onChange={set('tradeFor')}
              />
            </div>
          )}
        </div>
      </form>
    </Modal>
  )
}
