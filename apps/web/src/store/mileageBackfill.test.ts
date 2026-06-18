// DEC-16 backfill (§15.8 Phase 2 / §13.5): sentinel-gated idempotency, the
// deterministic `${carId}::initial` seed, VERBATIM canonical preservation, the
// date rule, and — the review fix #3 headline — DELETE-SAFETY: a cleared sentinel
// after a restore must NOT re-stamp a deleted seed and RESURRECT the reading.
import { describe, expect, it } from 'vitest'
import { createStore } from 'tinybase'
import type { MergeableStore, Row, Store } from 'tinybase'
import { KM_PER_MILE, createGarageStore } from '@chudbox/shared'
import { MILEAGE_BACKFILL_VERSION_VALUE } from './adapter'
import { MILEAGE_BACKFILL_VERSION, runMileageBackfill } from './migrate'

function makeStores(): { store: MergeableStore; localStore: Store } {
  return { store: createGarageStore(), localStore: createStore() }
}

function setCar(store: MergeableStore, id: string, over: Record<string, unknown>): void {
  store.setRow('cars', id, {
    year: '', make: '', model: '', trim: '', color: '',
    mileageRaw: '', nickname: '', purchaseDate: '', saleDate: '',
    status: 'current', salePrice: '', tradeFor: '',
    createdAt: '2019-01-01T00:00:00.000Z',
    ...over,
  } as Row)
}

describe('runMileageBackfill', () => {
  it('seeds a deterministic `${carId}::initial` per car, sets the sentinel, then no-ops', () => {
    const { store, localStore } = makeStores()
    setCar(store, 'car-1', { mileageRaw: '50000', mileageMiles: 50_000, purchaseDate: '2020-05-01' })
    setCar(store, 'car-2', { mileageRaw: '12,000', mileageMiles: 12_000 })

    expect(runMileageBackfill({ store, localStore })).toBe('applied')

    expect(store.hasRow('mileage', 'car-1::initial')).toBe(true)
    expect(store.getCell('mileage', 'car-1::initial', 'valueRaw')).toBe('50000')
    expect(store.getCell('mileage', 'car-1::initial', 'valueMiles')).toBe(50_000)
    expect(store.getCell('mileage', 'car-1::initial', 'source')).toBe('initial')
    expect(store.getCell('mileage', 'car-1::initial', 'unit')).toBe('mi')
    // date = purchaseDate when valid.
    expect(store.getCell('mileage', 'car-1::initial', 'date')).toBe('2020-05-01')
    expect(store.hasRow('mileage', 'car-2::initial')).toBe(true)
    expect(localStore.getValue(MILEAGE_BACKFILL_VERSION_VALUE)).toBe(MILEAGE_BACKFILL_VERSION)

    // Sentinel-gated: a second run changes nothing.
    const content = JSON.parse(JSON.stringify(store.getContent())) as unknown
    expect(runMileageBackfill({ store, localStore })).toBe('noop')
    expect(store.getContent()).toEqual(content)
  })

  it('blank mileage → no check-in (empty timeline)', () => {
    const { store, localStore } = makeStores()
    setCar(store, 'car-1', { mileageRaw: '' })
    setCar(store, 'car-2', { mileageRaw: '   ' }) // whitespace-only is blank too
    runMileageBackfill({ store, localStore })
    expect(store.getRowIds('mileage')).toHaveLength(0)
  })

  it('non-parsing text → a check-in preserved for display, with NO canonical', () => {
    const { store, localStore } = makeStores()
    setCar(store, 'car-1', { mileageRaw: 'unknown' })
    runMileageBackfill({ store, localStore })
    expect(store.getCell('mileage', 'car-1::initial', 'valueRaw')).toBe('unknown')
    expect(store.hasCell('mileage', 'car-1::initial', 'valueMiles')).toBe(false)
  })

  it('preserves the entry-time canonical VERBATIM (never recomputes under the current unit)', () => {
    const { store, localStore } = makeStores()
    // mileageRaw 120000 entered under km → canonical ≈ 74565 mi; device now shows mi.
    setCar(store, 'car-1', { mileageRaw: '120000', mileageMiles: 120_000 / KM_PER_MILE })
    runMileageBackfill({ store, localStore })
    // Verbatim: NOT parseMileageMiles('120000','mi') === 120000.
    expect(store.getCell('mileage', 'car-1::initial', 'valueMiles')).toBeCloseTo(120_000 / KM_PER_MILE, 6)
    expect(store.getCell('mileage', 'car-1::initial', 'valueMiles')).not.toBe(120_000)
  })

  it("date falls back to the car's createdAt when purchaseDate is blank/invalid", () => {
    const { store, localStore } = makeStores()
    setCar(store, 'car-1', { mileageRaw: '1000', purchaseDate: '', createdAt: '2018-02-03T10:00:00.000Z' })
    runMileageBackfill({ store, localStore })
    expect(store.getCell('mileage', 'car-1::initial', 'date')).toBe('2018-02-03T10:00:00.000Z')
  })

  it('never seeds a car that already has a live check-in', () => {
    const { store, localStore } = makeStores()
    setCar(store, 'car-1', { mileageRaw: '50000', mileageMiles: 50_000 })
    // A pre-existing manual check-in (random id, NOT the deterministic seed).
    store.setRow('mileage', 'manual-1', {
      carId: 'car-1', valueRaw: '50000', valueMiles: 50_000, unit: 'mi',
      date: '2026-01-01', source: 'manual', createdAt: '2026-01-01T00:00:00.000Z',
    } as Row)

    runMileageBackfill({ store, localStore })
    expect(store.hasRow('mileage', 'car-1::initial')).toBe(false) // no redundant seed
    expect(store.getRowIds('mileage')).toEqual(['manual-1'])
  })

  // ── DELETE-SAFETY (review fix #3) ──────────────────────────
  it('a cleared sentinel after a restore does NOT resurrect a deleted seed', () => {
    const { store, localStore } = makeStores()
    setCar(store, 'car-1', { mileageRaw: '50000', mileageMiles: 50_000 })
    runMileageBackfill({ store, localStore })
    expect(store.hasRow('mileage', 'car-1::initial')).toBe(true)

    // The user deletes the seeded reading (tombstone at HLC T1).
    store.delRow('mileage', 'car-1::initial')
    expect(store.hasRow('mileage', 'car-1::initial')).toBe(false)

    // A restore / needsReseed-style path clears the local sentinel…
    localStore.delValue(MILEAGE_BACKFILL_VERSION_VALUE)

    // …and the backfill re-runs. The deterministic id still carries a TOMBSTONE
    // stamp, so the gate skips it — the deleted reading is NOT resurrected.
    expect(runMileageBackfill({ store, localStore })).toBe('applied')
    expect(store.hasRow('mileage', 'car-1::initial')).toBe(false)
  })

  it('re-running with a still-live seed is a per-cell no-op (deterministic id collapses)', () => {
    const { store, localStore } = makeStores()
    setCar(store, 'car-1', { mileageRaw: '50000', mileageMiles: 50_000 })
    runMileageBackfill({ store, localStore })
    localStore.delValue(MILEAGE_BACKFILL_VERSION_VALUE) // force re-run
    runMileageBackfill({ store, localStore })
    // No duplicate row; the single deterministic seed remains.
    expect(store.getRowIds('mileage')).toEqual(['car-1::initial'])
  })
})
