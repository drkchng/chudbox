import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import useGarageStore from '../store/useGarageStore'
import { DISTANCE_UNITS } from '../utils/units'
import DateInput from './DateInput'
import Modal from './ui/Modal'
import Button from './ui/Button'
import type { CarDetails, CarStoredStatus, FieldChangeEvent } from '../types'

const today = new Date().toISOString().slice(0, 10)

const empty: CarDetails = {
  year: '', make: '', model: '', trim: '', color: '', mileage: '', nickname: '',
  purchaseDate: '', saleDate: '', status: 'current', salePrice: '', tradeFor: '',
}

// The form lives in the Modal body; the action buttons live in the Modal footer.
// A shared id wires the footer's submit <Button> to this form (HTML form
// association is document-wide, so it works across the Base UI portal).
const FORM_ID = 'add-car-form'

interface AddCarModalProps {
  onClose: () => void
}

export default function AddCarModal({ onClose }: AddCarModalProps) {
  const navigate     = useNavigate()
  const addCar       = useGarageStore((s) => s.addCar)
  const distanceUnit = useGarageStore((s) => s.distanceUnit)
  const distShort    = DISTANCE_UNITS[distanceUnit]?.short ?? 'mi'
  const [form, setForm] = useState<CarDetails>(empty)

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
    if (!form.year || !form.make || !form.model) return
    // DEC-4 (U1) log-first: create, then land straight on the new car's profile
    // (which defaults to the Mods tab) with the add-mod form focused, ready to
    // log the first mod. `addCar` returns the freshly-minted id.
    const id = addCar(form)
    navigate(`/car/${id}`, { state: { focusLog: true } })
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Add car"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form={FORM_ID}>Add car</Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        {/* Basic info */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="add-car-year" className="label">Year *</label>
            <input id="add-car-year" className="input" placeholder="2020" value={form.year} onChange={set('year')} required />
          </div>
          <div>
            <label htmlFor="add-car-make" className="label">Make *</label>
            <input id="add-car-make" className="input" placeholder="Toyota" value={form.make} onChange={set('make')} required />
          </div>
        </div>
        <div>
          <label htmlFor="add-car-model" className="label">Model *</label>
          <input id="add-car-model" className="input" placeholder="Supra" value={form.model} onChange={set('model')} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="add-car-trim" className="label">Trim</label>
            <input id="add-car-trim" className="input" placeholder="GR" value={form.trim} onChange={set('trim')} />
          </div>
          <div>
            <label htmlFor="add-car-color" className="label">Color</label>
            <input id="add-car-color" className="input" placeholder="Matte Black" value={form.color} onChange={set('color')} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="add-car-mileage" className="label">Mileage ({distShort})</label>
            <input id="add-car-mileage" className="input" type="number" placeholder="45000" value={form.mileage} onChange={set('mileage')} />
          </div>
          <div>
            <label htmlFor="add-car-nickname" className="label">Nickname</label>
            <input id="add-car-nickname" className="input" placeholder="Project S" value={form.nickname} onChange={set('nickname')} />
          </div>
        </div>

        {/* Ownership */}
        <div className="border-t border-border pt-4 space-y-3">
          <p className="text-xs font-semibold text-text-tertiary uppercase tracking-widest">Ownership</p>

          {/* DateInput is a composite (3 segments) → group it under its label. */}
          <div role="group" aria-labelledby="add-car-purchase-label">
            <span id="add-car-purchase-label" className="label">Purchase date</span>
            <DateInput value={form.purchaseDate} onChange={set('purchaseDate')} />
          </div>

          <div>
            <label htmlFor="add-car-status" className="label">Status</label>
            <select id="add-car-status" className="input" value={form.status} onChange={setStatus}>
              <option value="current">Current</option>
              <option value="for-sale">For Sale</option>
              <option value="for-trade">For Trade</option>
              <option value="sold">Sold (Archive)</option>
              <option value="totaled">Totaled</option>
            </select>
          </div>

          {form.status === 'sold' && (
            <>
              <div role="group" aria-labelledby="add-car-saledate-label">
                <span id="add-car-saledate-label" className="label">Sale date <span className="text-text-disabled">(optional)</span></span>
                <div onFocus={() => { if (!form.saleDate) set('saleDate')(today) }}>
                  <DateInput value={form.saleDate} onChange={set('saleDate')} />
                </div>
              </div>
              <div>
                <label htmlFor="add-car-saleprice" className="label">Final sale price <span className="text-text-disabled">(optional)</span></label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary text-sm pointer-events-none">$</span>
                  <input id="add-car-saleprice" className="input pl-7" type="number" step="0.01" placeholder="25000" value={form.salePrice} onChange={set('salePrice')} />
                </div>
              </div>
            </>
          )}

          {form.status === 'for-sale' && (
            <div>
              <label htmlFor="add-car-askingprice" className="label">Asking price <span className="text-text-disabled">(optional)</span></label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary text-sm pointer-events-none">$</span>
                <input id="add-car-askingprice" className="input pl-7" type="number" step="0.01" placeholder="25000" value={form.salePrice} onChange={set('salePrice')} />
              </div>
            </div>
          )}

          {form.status === 'for-trade' && (
            <div>
              <label htmlFor="add-car-tradefor" className="label">Will trade for</label>
              <textarea
                id="add-car-tradefor"
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
