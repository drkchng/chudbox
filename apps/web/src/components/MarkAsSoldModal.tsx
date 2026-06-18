import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import useGarageStore from '../store/useGarageStore'
import { CURRENCIES, formatMoney } from '../utils/units'
import DateInput from './DateInput'
import Modal from './ui/Modal'
import Button from './ui/Button'
import type { Car } from '../types'

const today = new Date().toISOString().slice(0, 10)

// Footer's submit <Button> reaches the body form via this shared id (document-
// wide form association works across the Base UI portal).
const FORM_ID = 'mark-as-sold-form'

interface MarkAsSoldModalProps {
  car: Car
  onClose: () => void
}

export default function MarkAsSoldModal({ car, onClose }: MarkAsSoldModalProps) {
  const updateCar = useGarageStore((s) => s.updateCar)
  const currency = useGarageStore((s) => s.currency)
  const sym = CURRENCIES[currency]?.symbol ?? '$'
  const [saleDate, setSaleDate] = useState(today)
  const [salePrice, setSalePrice] = useState(car.salePrice || '')

  // Display-only echo of the entered amount in the owner's display currency, so
  // the recorded figure is unambiguous (CA$ vs $ vs €). Never feeds storage.
  const priceNum = Number(salePrice)
  const pricePreview =
    salePrice.trim() !== '' && Number.isFinite(priceNum) ? formatMoney(priceNum, currency) : ''

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    updateCar(car.id, { status: 'sold', saleDate, salePrice })
    onClose()
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Mark as sold"
      description={
        <>
          {car.year} {car.make} {car.model}
          {/* V5: nickname = identity, not action → italic (not orange). */}
          {car.nickname && <span className="italic"> &ldquo;{car.nickname}&rdquo;</span>}
        </>
      }
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form={FORM_ID}>Confirm sale</Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        {/* DateInput is a composite (3 segments) → group it under its label. */}
        <div role="group" aria-labelledby="mark-sold-date-label">
          <span id="mark-sold-date-label" className="label">Sale date <span className="text-text-disabled">(optional)</span></span>
          <DateInput value={saleDate} onChange={setSaleDate} />
        </div>

        <div>
          <label htmlFor="mark-sold-price" className="label">Final sale price <span className="text-text-disabled">(optional)</span></label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary text-sm pointer-events-none">{sym}</span>
            <input
              id="mark-sold-price"
              className="input pl-7"
              type="number"
              step="0.01"
              placeholder="25000"
              value={salePrice}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setSalePrice(e.target.value)}
            />
          </div>
          {pricePreview && (
            <p className="mt-1.5 text-meta text-text-secondary">
              Recorded as <span className="font-semibold text-text-primary">{pricePreview}</span>
            </p>
          )}
        </div>
      </form>
    </Modal>
  )
}
