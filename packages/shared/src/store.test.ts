import { describe, expect, it } from 'vitest'
import {
  CHILD_TABLE_IDS,
  GARAGE_TABLE_IDS,
  GARAGE_TABLES_SCHEMA,
  GARAGE_VALUES_SCHEMA,
} from './schema'
import { carIdIndexId, createGarageIndexes, createGarageStore } from './store'
import { newId } from './id'

// The explicit nullable inventory from the plan: these cells must declare a
// type but NO default (a default would resurrect a value the user blanked).
const NULLABLE_CELLS: Record<string, string[]> = {
  cars: ['mileageMiles', 'salePriceCurrency', 'coverPhoto'],
  photos: ['r2Key', 'width', 'height'],
  wishlist: ['price', 'priceCurrency'],
  mods: ['cost', 'costCurrency'],
  maintenance: ['mileageRaw', 'mileageMiles', 'cost', 'costCurrency', 'nextDueMileageMiles'],
  todos: [],
  issues: ['resolvedAt'],
}

describe('schema', () => {
  it('declares exactly the planned tables', () => {
    expect(Object.keys(GARAGE_TABLES_SCHEMA).sort()).toEqual([...GARAGE_TABLE_IDS].sort())
  })

  it('declares the planned Values', () => {
    expect(Object.keys(GARAGE_VALUES_SCHEMA).sort()).toEqual(
      ['themeId', 'customAccent', 'currency', 'distanceUnit'].sort(),
    )
  })

  it('nullable cells declare a type but no default', () => {
    for (const [tableId, cellIds] of Object.entries(NULLABLE_CELLS)) {
      const table: Record<string, { type: string; default?: unknown }> =
        GARAGE_TABLES_SCHEMA[tableId as keyof typeof GARAGE_TABLES_SCHEMA]
      for (const cellId of cellIds) {
        expect(table[cellId], `${tableId}.${cellId}`).toBeDefined()
        expect('default' in table[cellId]!, `${tableId}.${cellId} must not default`).toBe(false)
      }
    }
    expect('default' in GARAGE_VALUES_SCHEMA.customAccent).toBe(false)
  })

  it('photos rows are metadata-only: no dataUrl cell exists in the schema', () => {
    expect('dataUrl' in GARAGE_TABLES_SCHEMA.photos).toBe(false)
  })
})

describe('createGarageStore', () => {
  it('returns a MergeableStore with both schemas applied', () => {
    const store = createGarageStore()
    expect(typeof store.getMergeableContent).toBe('function')
    expect(JSON.parse(store.getTablesSchemaJson())).toEqual(GARAGE_TABLES_SCHEMA)
    expect(JSON.parse(store.getValuesSchemaJson())).toEqual(GARAGE_VALUES_SCHEMA)
  })

  it('materializes the Values defaults (and no customAccent)', () => {
    expect(createGarageStore().getValues()).toEqual({
      themeId: 'garage',
      currency: 'USD',
      distanceUnit: 'mi',
    })
  })

  it('rejects off-schema cells — a dataUrl can never land in a photos row', () => {
    const store = createGarageStore()
    store.setRow('photos', 'p1', {
      carId: 'c1',
      caption: 'cap',
      uploadedAt: 'now',
      dataUrl: 'data:image/webp;base64,AAAA',
    })
    expect(store.getRow('photos', 'p1')).toEqual({
      carId: 'c1',
      caption: 'cap',
      uploadedAt: 'now',
    })
  })

  it('rejects wrongly-typed cells', () => {
    const store = createGarageStore()
    store.setRow('cars', 'c1', { year: '1991' })
    store.setCell('cars', 'c1', 'year', 123) // number into a string cell
    expect(store.getCell('cars', 'c1', 'year')).toBe('1991')
  })

  it('accepts a stable uniqueId for HLC provenance', () => {
    const store = createGarageStore('device-a')
    store.setCell('cars', 'c1', 'make', 'Nissan')
    expect(store.getCell('cars', 'c1', 'make')).toBe('Nissan')
  })
})

describe('carId indexes', () => {
  it('defines one carId index per child table', () => {
    const store = createGarageStore()
    const indexes = createGarageIndexes(store)
    expect(new Set(indexes.getIndexIds())).toEqual(
      new Set(CHILD_TABLE_IDS.map((t) => carIdIndexId(t))),
    )
  })

  it('slices child rows by carId', () => {
    const store = createGarageStore()
    store.setRow('photos', 'p1', { carId: 'c1', caption: '', uploadedAt: '' })
    store.setRow('photos', 'p2', { carId: 'c2', caption: '', uploadedAt: '' })
    store.setRow('todos', 't1', { carId: 'c1', text: 'x', priority: 'low', done: false, createdAt: '' })
    const indexes = createGarageIndexes(store)
    expect(indexes.getSliceRowIds('photosByCarId', 'c1')).toEqual(['p1'])
    expect(indexes.getSliceRowIds('photosByCarId', 'c2')).toEqual(['p2'])
    expect(indexes.getSliceRowIds('todosByCarId', 'c1')).toEqual(['t1'])
    expect(indexes.getSliceRowIds('todosByCarId', 'c2')).toEqual([])
  })
})

describe('newId', () => {
  it('returns distinct UUIDs', () => {
    const a = newId()
    const b = newId()
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(a).not.toBe(b)
  })
})
