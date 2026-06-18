// First-run import + units backfill (M2 verification (d)): import-once
// idempotency, blob-settings tagging, sentinel placement in the LOCAL store,
// and backfill no-×100 / no-double-apply.
import { describe, expect, it } from 'vitest'
import { createStore } from 'tinybase'
import type { MergeableStore, Store } from 'tinybase'
import { KM_PER_MILE, createGarageStore } from '@chudbox/shared'
import {
  IDB_MIGRATED_VALUE,
  PHOTO_PAYLOADS_TABLE,
  UNITS_SCHEMA_VERSION_VALUE,
  createGarageAdapter,
} from './adapter'
import {
  UNITS_SCHEMA_VERSION,
  parseLegacyBlob,
  runFirstRunImport,
  runUnitsBackfill,
} from './migrate'
import { richCar } from './testFixtures'

function makeStores(): { store: MergeableStore; localStore: Store } {
  return { store: createGarageStore(), localStore: createStore() }
}

function legacyBlob(): string {
  return JSON.stringify({
    state: {
      cars: [richCar('legacy-1', 0), richCar('legacy-2', 100)],
      themeId: 'sunset',
      customAccent: null,
      currency: 'EUR',
      distanceUnit: 'km',
    },
    version: 0, // implicit zustand persist default
  })
}

describe('parseLegacyBlob', () => {
  it('parses the zustand persist wrapper and defaults missing settings', () => {
    const parsed = parseLegacyBlob(JSON.stringify({ state: { cars: [] }, version: 0 }))
    expect(parsed).toEqual({
      cars: [],
      themeId: 'garage',
      customAccent: null,
      currency: 'USD',
      distanceUnit: 'mi',
    })
  })

  it('rejects garbage', () => {
    expect(parseLegacyBlob(null)).toBeNull()
    expect(parseLegacyBlob('not json')).toBeNull()
    expect(parseLegacyBlob(JSON.stringify({ version: 0 }))).toBeNull()
    expect(parseLegacyBlob(JSON.stringify({ state: { cars: 'nope' } }))).toBeNull()
  })
})

describe('runFirstRunImport', () => {
  it("imports once, tagging amounts/mileage with the blob's OWN settings", async () => {
    const { store, localStore } = makeStores()
    const result = await runFirstRunImport({
      store,
      localStore,
      readLegacyBlob: async () => legacyBlob(),
    })
    expect(result).toBe('imported')

    // Values come from the blob.
    expect(store.getValue('themeId')).toBe('sunset')
    expect(store.getValue('currency')).toBe('EUR')
    expect(store.getValue('distanceUnit')).toBe('km')

    // Amounts tagged with the blob's currency, not the schema default.
    expect(store.getCell('mods', 'legacy-1-m1', 'costCurrency')).toBe('EUR')
    expect(store.getCell('wishlist', 'legacy-1-w1', 'price')).toBe(0)
    expect(store.getCell('wishlist', 'legacy-1-w1', 'priceCurrency')).toBe('EUR')

    // Mileage canonicalized FROM km (blob's unit): 12,000 km → miles.
    expect(store.getCell('maintenance', 'legacy-1-r1', 'mileageMiles')).toBe(
      12000 / KM_PER_MILE,
    )
    // '' mileage is a real cell with no canonical miles.
    expect(store.getCell('maintenance', 'legacy-1-r2', 'mileageRaw')).toBe('')
    expect(store.hasCell('maintenance', 'legacy-1-r2', 'mileageMiles')).toBe(false)
    // null mileage means NO cell.
    expect(store.hasCell('maintenance', 'legacy-1-r3', 'mileageRaw')).toBe(false)

    // Photo payloads parked in the side store, never in a synced cell.
    expect(localStore.getCell(PHOTO_PAYLOADS_TABLE, 'legacy-1-p1', 'dataUrl')).toBe(
      'data:image/png;base64,AAAA',
    )
    expect(store.hasCell('photos', 'legacy-1-p1', 'dataUrl' as never)).toBe(false)

    // Sentinels live in the LOCAL store.
    expect(localStore.getValue(IDB_MIGRATED_VALUE)).toBe(true)
    expect(localStore.getValue(UNITS_SCHEMA_VERSION_VALUE)).toBe(UNITS_SCHEMA_VERSION)
    expect(store.getValueIds()).not.toContain(IDB_MIGRATED_VALUE)
    expect(store.getValueIds()).not.toContain(UNITS_SCHEMA_VERSION_VALUE)
  })

  it('round-trips the nested cars exactly through the adapter read path', async () => {
    const { store, localStore } = makeStores()
    await runFirstRunImport({ store, localStore, readLegacyBlob: async () => legacyBlob() })
    const adapter = createGarageAdapter(store, localStore)
    // The read model additionally surfaces the canonical miles that joinCar
    // drops (mileageMiles / nextDueMileageMiles) so the UI can convert to the
    // active unit — derived display fields, not part of the user-facing nested
    // round trip. Strip them before the deep compare (their correctness lives
    // in adapter.test.ts / MileageText.test.ts).
    const stripDerived = adapter.getState().cars.map((car) => {
      const clone = structuredClone(car)
      delete clone.mileageMiles
      for (const rec of clone.maintenance) {
        delete rec.mileageMiles
        delete rec.nextDueMileageMiles
      }
      return clone
    })
    expect(stripDerived).toEqual([richCar('legacy-1', 0), richCar('legacy-2', 100)])
  })

  it('is idempotent: a second run changes nothing', async () => {
    const { store, localStore } = makeStores()
    await runFirstRunImport({ store, localStore, readLegacyBlob: async () => legacyBlob() })
    const contentAfterFirst = JSON.parse(JSON.stringify(store.getContent())) as unknown
    const payloadsAfterFirst = localStore.getTable(PHOTO_PAYLOADS_TABLE)

    const second = await runFirstRunImport({
      store,
      localStore,
      readLegacyBlob: async () => legacyBlob(),
    })
    expect(second).toBe('already-imported')
    expect(store.getContent()).toEqual(contentAfterFirst)
    expect(localStore.getTable(PHOTO_PAYLOADS_TABLE)).toEqual(payloadsAfterFirst)
    expect(store.getRowIds('cars')).toHaveLength(2) // no duplicate garage
  })

  it('sets the sentinel even when no blob exists, so a late blob never imports', async () => {
    const { store, localStore } = makeStores()
    const first = await runFirstRunImport({
      store,
      localStore,
      readLegacyBlob: async () => null,
    })
    expect(first).toBe('no-legacy-data')
    expect(localStore.getValue(IDB_MIGRATED_VALUE)).toBe(true)

    const second = await runFirstRunImport({
      store,
      localStore,
      readLegacyBlob: async () => legacyBlob(), // appears later
    })
    expect(second).toBe('already-imported')
    expect(store.getRowIds('cars')).toHaveLength(0)
  })
})

describe('runUnitsBackfill', () => {
  it('is purely additive, then a sentinel-gated no-op forever', () => {
    const { store, localStore } = makeStores()
    // Simulate pre-backfill rows: amounts without tags, raw without miles.
    store.setValue('currency', 'GBP')
    store.setValue('distanceUnit', 'km')
    store.setRow('cars', 'c1', {
      year: '',
      make: 'm',
      model: 'm',
      trim: '',
      color: '',
      mileageRaw: '2,000',
      nickname: '',
      purchaseDate: '',
      saleDate: '',
      status: 'current',
      salePrice: '100',
      tradeFor: '',
      createdAt: '',
    })
    store.setRow('mods', 'm1', {
      carId: 'c1',
      name: 'n',
      category: '',
      description: '',
      cost: 50,
      installedDate: '',
      shop: '',
      link: '',
      addedAt: '',
    })

    expect(runUnitsBackfill({ store, localStore })).toBe('applied')
    expect(store.getCell('cars', 'c1', 'salePriceCurrency')).toBe('GBP')
    expect(store.getCell('cars', 'c1', 'mileageMiles')).toBe(2000 / KM_PER_MILE)
    expect(store.getCell('mods', 'm1', 'costCurrency')).toBe('GBP')
    // Amounts and raw strings are NEVER rewritten.
    expect(store.getCell('cars', 'c1', 'salePrice')).toBe('100')
    expect(store.getCell('cars', 'c1', 'mileageRaw')).toBe('2,000')
    expect(store.getCell('mods', 'm1', 'cost')).toBe(50)

    const contentAfterFirst = JSON.parse(JSON.stringify(store.getContent())) as unknown
    expect(runUnitsBackfill({ store, localStore })).toBe('noop')
    expect(store.getContent()).toEqual(contentAfterFirst) // no ×100, no re-tag
  })

  it("never tags an empty salePrice and never overwrites an existing tag", () => {
    const { store, localStore } = makeStores()
    store.setRow('cars', 'c1', {
      year: '',
      make: 'm',
      model: 'm',
      trim: '',
      color: '',
      mileageRaw: '',
      nickname: '',
      purchaseDate: '',
      saleDate: '',
      status: 'current',
      salePrice: '',
      tradeFor: '',
      createdAt: '',
    })
    store.setRow('wishlist', 'w1', {
      carId: 'c1',
      name: 'n',
      link: '',
      price: 5,
      priceCurrency: 'JPY', // pre-existing tag must survive
      category: '',
      notes: '',
      status: 'wanted',
      addedAt: '',
    })
    expect(runUnitsBackfill({ store, localStore })).toBe('applied')
    expect(store.hasCell('cars', 'c1', 'salePriceCurrency')).toBe(false)
    expect(store.hasCell('cars', 'c1', 'mileageMiles')).toBe(false)
    expect(store.getCell('wishlist', 'w1', 'priceCurrency')).toBe('JPY')
  })
})
