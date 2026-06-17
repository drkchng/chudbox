import { describe, expect, it } from 'vitest'
import {
  CAR_STORED_STATUSES,
  carCreateSchema,
  carUpdateSchema,
  garageValuesSchema,
} from './zod'
import type { CarDetails } from './types'

const details: CarDetails = {
  year: '1991',
  make: 'Nissan',
  model: '180SX',
  trim: '',
  color: '',
  mileage: '12,000',
  nickname: '',
  purchaseDate: '',
  saleDate: '',
  status: 'current',
  salePrice: '',
  tradeFor: '',
}

describe('carCreateSchema', () => {
  it('accepts a full CarDetails payload (and infers the same shape)', () => {
    // assignment doubles as a compile-time check that z.infer matches CarDetails
    const parsed: CarDetails = carCreateSchema.parse(details)
    expect(parsed).toEqual(details)
  })

  it('accepts every storable status', () => {
    for (const status of CAR_STORED_STATUSES) {
      expect(carCreateSchema.parse({ ...details, status }).status).toBe(status)
    }
  })

  it('rejects unknown statuses, missing fields and extra keys', () => {
    expect(carCreateSchema.safeParse({ ...details, status: 'crashed' }).success).toBe(false)
    const missing: Partial<CarDetails> = { ...details }
    delete missing.year
    expect(carCreateSchema.safeParse(missing).success).toBe(false)
    expect(carCreateSchema.safeParse({ ...details, dataUrl: 'x' }).success).toBe(false)
    expect(carCreateSchema.safeParse({ ...details, year: 1991 }).success).toBe(false)
  })
})

describe('carUpdateSchema', () => {
  it('accepts any subset', () => {
    expect(carUpdateSchema.parse({})).toEqual({})
    expect(carUpdateSchema.parse({ nickname: 'hatch' })).toEqual({ nickname: 'hatch' })
  })

  it('still rejects bad values and extra keys', () => {
    expect(carUpdateSchema.safeParse({ status: 'crashed' }).success).toBe(false)
    expect(carUpdateSchema.safeParse({ unknownKey: true }).success).toBe(false)
  })
})

describe('garageValuesSchema', () => {
  it('accepts the settings shape with a nullable accent', () => {
    expect(
      garageValuesSchema.parse({
        themeId: 'custom',
        customAccent: '#ff0044',
        currency: 'USD',
        distanceUnit: 'mi',
      }).customAccent,
    ).toBe('#ff0044')
    expect(
      garageValuesSchema.parse({
        themeId: 'garage',
        customAccent: null,
        currency: 'JPY',
        distanceUnit: 'km',
      }).customAccent,
    ).toBeNull()
  })

  it('rejects non-ISO currency codes and unknown units', () => {
    expect(
      garageValuesSchema.safeParse({
        themeId: 'garage',
        customAccent: null,
        currency: 'usd',
        distanceUnit: 'mi',
      }).success,
    ).toBe(false)
    expect(
      garageValuesSchema.safeParse({
        themeId: 'garage',
        customAccent: null,
        currency: 'USD',
        distanceUnit: 'leagues',
      }).success,
    ).toBe(false)
  })
})
