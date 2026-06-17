import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import { getCarStatus, STATUS_CONFIG } from './carStatus'
import type { Car, CarStoredStatus } from '../types'

// Minimal Car factory: only the fields getCarStatus reads need to be real.
function makeCar(overrides: Partial<Car>): Car {
  return {
    id: 'c1',
    year: '',
    make: '',
    model: '',
    trim: '',
    color: '',
    mileage: '',
    nickname: '',
    purchaseDate: '',
    saleDate: '',
    status: 'current',
    salePrice: '',
    tradeFor: '',
    createdAt: '',
    photos: [],
    wishlist: [],
    mods: [],
    maintenance: [],
    todos: [],
    issues: [],
    ...overrides,
  }
}

const STORED_STATUSES: CarStoredStatus[] = [
  'current',
  'for-sale',
  'for-trade',
  'totaled',
  'sold',
]

describe('getCarStatus', () => {
  it('returns "sold" when status is explicitly sold', () => {
    expect(getCarStatus(makeCar({ status: 'sold' }))).toBe('sold')
  })

  it('derives "sold" from a past sale date', () => {
    expect(getCarStatus(makeCar({ status: 'current', saleDate: '2000-01-01' }))).toBe('sold')
  })

  it('does not mark sold for a future sale date', () => {
    expect(getCarStatus(makeCar({ status: 'current', saleDate: '2999-01-01' }))).toBe('current')
  })

  it('falls back to "current" when status is empty', () => {
    expect(getCarStatus(makeCar({ status: '' as CarStoredStatus }))).toBe('current')
  })

  it('passes the stored status through when not sold and no past sale date', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...STORED_STATUSES.filter((s) => s !== 'sold')),
        (status) => {
          const result = getCarStatus(makeCar({ status }))
          expect(result).toBe(status)
          expect(STATUS_CONFIG[result]).toBeDefined()
        },
      ),
    )
  })
})
