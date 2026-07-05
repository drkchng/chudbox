// Backup contract (M2 verification (f) support): v2 round-trip through the
// shared flatten/join seam, v1 current-device-settings tagging (plan F2), and
// replace semantics with a wholesale stamp reset (no tombstones).
import { describe, expect, it } from 'vitest'
import { createStore } from 'tinybase'
import type { MergeableStore, Store } from 'tinybase'
import { createGarageStore } from '@chudbox/shared'
import { PHOTO_PAYLOADS_TABLE, createGarageAdapter } from './adapter'
import { applyBackupImport, buildBackupV2, parseBackup } from './backup'
import { writeNestedCars } from './migrate'
import { plainCar, richCar } from './testFixtures'

function makeStores(): { store: MergeableStore; localStore: Store } {
  return { store: createGarageStore(), localStore: createStore() }
}

describe('parseBackup', () => {
  it('recognizes v2 with its settings', () => {
    const parsed = parseBackup({
      version: 2,
      exportedAt: '2026-06-12T00:00:00.000Z',
      cars: [],
      themeId: 'sunset',
      customAccent: '#123456',
      currency: 'EUR',
      distanceUnit: 'km',
    })
    expect(parsed?.version).toBe(2)
    expect(parsed?.currency).toBe('EUR')
    expect(parsed?.distanceUnit).toBe('km')
  })

  it('treats anything else with a cars array as v1 (legacy leniency)', () => {
    expect(parseBackup({ cars: [] })?.version).toBe(1)
    expect(parseBackup({ version: 1, cars: [] })?.version).toBe(1)
    expect(parseBackup({ version: 1, cars: [], currency: 'EUR' })?.currency).toBeNull()
  })

  it('rejects non-backups', () => {
    expect(parseBackup(null)).toBeNull()
    expect(parseBackup({})).toBeNull()
    expect(parseBackup({ cars: 'nope' })).toBeNull()
  })
})

describe('v2 round trip', () => {
  it('export → JSON → import reproduces the garage exactly (incl. photos and settings)', () => {
    const source = makeStores()
    const cars = [richCar('car-a', 0), plainCar('car-b', 100)]
    writeNestedCars(source.store, source.localStore, cars, {
      currency: 'EUR',
      distanceUnit: 'km',
    })
    source.store.setValue('themeId', 'sunset')
    source.store.setValue('customAccent', '#ff8800')
    source.store.setValue('currency', 'EUR')
    source.store.setValue('distanceUnit', 'km')
    const sourceAdapter = createGarageAdapter(source.store, source.localStore)
    const sourceState = sourceAdapter.getState()

    const backup = buildBackupV2({
      cars: sourceState.cars,
      themeId: sourceState.themeId,
      customAccent: sourceState.customAccent,
      currency: sourceState.currency,
      distanceUnit: sourceState.distanceUnit,
    })
    const parsed = parseBackup(JSON.parse(JSON.stringify(backup)))
    expect(parsed).not.toBeNull()

    const target = makeStores()
    applyBackupImport({ store: target.store, localStore: target.localStore, backup: parsed! })
    const targetAdapter = createGarageAdapter(target.store, target.localStore)
    const targetState = targetAdapter.getState()

    expect(targetState.cars).toEqual(sourceState.cars)
    expect(targetState.themeId).toBe('sunset')
    expect(targetState.customAccent).toBe('#ff8800')
    expect(targetState.currency).toBe('EUR')
    expect(targetState.distanceUnit).toBe('km')
    // Tags came from the BACKUP's settings.
    expect(target.store.getCell('mods', 'car-a-m1', 'costCurrency')).toBe('EUR')
    // Photo payload round-tripped into the side store.
    expect(target.store.hasCell('photos', 'car-a-p1', 'dataUrl' as never)).toBe(false)
    expect(target.localStore.getCell(PHOTO_PAYLOADS_TABLE, 'car-a-p1', 'dataUrl')).toBe(
      'data:image/png;base64,AAAA',
    )
  })
})

describe('v1 import', () => {
  it("tags amounts/mileage with the importing device's CURRENT settings and keeps them", () => {
    const target = makeStores()
    target.store.setValue('currency', 'CAD')
    target.store.setValue('distanceUnit', 'km')
    const parsed = parseBackup({
      version: 1,
      exportedAt: '2025-01-01T00:00:00.000Z',
      cars: [richCar('v1-car', 0)],
      themeId: 'midnight',
      customAccent: null,
    })
    applyBackupImport({ store: target.store, localStore: target.localStore, backup: parsed! })

    expect(target.store.getCell('mods', 'v1-car-m1', 'costCurrency')).toBe('CAD')
    // 12,000 entered under the device's km setting → canonical miles.
    expect(target.store.getCell('maintenance', 'v1-car-r1', 'mileageMiles')).toBe(
      12000 / 1.609344,
    )
    // v1 has no currency/distanceUnit → device settings preserved.
    expect(target.store.getValue('currency')).toBe('CAD')
    expect(target.store.getValue('distanceUnit')).toBe('km')
    expect(target.store.getValue('themeId')).toBe('midnight')
  })
})

describe('replace semantics', () => {
  it('drops pre-existing data AND its stamp history (no tombstones to fight sync later)', () => {
    const target = makeStores()
    writeNestedCars(target.store, target.localStore, [richCar('old-car', 0)], {
      currency: 'USD',
      distanceUnit: 'mi',
    })
    expect(target.localStore.getRowIds(PHOTO_PAYLOADS_TABLE)).toHaveLength(1)

    const parsed = parseBackup({ cars: [plainCar('new-car', 50)] })
    applyBackupImport({ store: target.store, localStore: target.localStore, backup: parsed! })

    expect(target.store.getRowIds('cars')).toEqual(['new-car'])
    expect(target.localStore.getRowIds(PHOTO_PAYLOADS_TABLE)).toHaveLength(0)
    // Stamp map was RESET: no tombstone stamps survive for the old rows
    // (delRow-style clearing would leave them and they would out-stamp cloud
    // rows on a later attach).
    const [tablesStamp] = target.store.getMergeableContent()
    const carsRowStamps = tablesStamp[0]['cars'][0]
    expect(Object.keys(carsRowStamps)).toEqual(['new-car'])
  })

  it('normalizes user-supplied cars with missing child arrays instead of crashing', () => {
    const target = makeStores()
    const partial = { ...plainCar('sparse-car', 0) } as Record<string, unknown>
    delete partial.photos
    delete partial.todos
    const parsed = parseBackup({ cars: [partial] })
    expect(parsed).not.toBeNull()
    applyBackupImport({ store: target.store, localStore: target.localStore, backup: parsed! })
    expect(target.store.getRowIds('cars')).toEqual(['sparse-car'])
  })
})

// M3 regression: after upload, a photo's local payload is dropped ('' payload,
// r2Key cell instead), but flattenCar has no r2Key concept — without the
// writeNestedCars enrichment a backup round-trip restored uploaded photos with
// NEITHER bytes NOR an R2 pointer (permanent blanks, propagated to the cloud
// by the post-import reseed).
describe('R2-uploaded photo round trip', () => {
  it('export → import preserves r2Key/width/height and writes no empty payload row', () => {
    const source = makeStores()
    writeNestedCars(source.store, source.localStore, [richCar('car-a', 0)], {
      currency: 'USD',
      distanceUnit: 'mi',
    })
    // Simulate applyPhotoUpload: r2Key/width/height cells land, payload drops.
    source.store.setCell('photos', 'car-a-p1', 'r2Key', 'u/user/car-a/car-a-p1.webp')
    source.store.setCell('photos', 'car-a-p1', 'width', 1600)
    source.store.setCell('photos', 'car-a-p1', 'height', 1200)
    source.localStore.delRow(PHOTO_PAYLOADS_TABLE, 'car-a-p1')

    const sourceState = createGarageAdapter(source.store, source.localStore).getState()
    const backup = buildBackupV2({
      cars: sourceState.cars,
      themeId: sourceState.themeId,
      customAccent: sourceState.customAccent,
      currency: sourceState.currency,
      distanceUnit: sourceState.distanceUnit,
    })
    const parsed = parseBackup(JSON.parse(JSON.stringify(backup)))
    expect(parsed).not.toBeNull()

    const target = makeStores()
    applyBackupImport({ store: target.store, localStore: target.localStore, backup: parsed! })

    expect(target.store.getCell('photos', 'car-a-p1', 'r2Key')).toBe('u/user/car-a/car-a-p1.webp')
    expect(target.store.getCell('photos', 'car-a-p1', 'width')).toBe(1600)
    expect(target.store.getCell('photos', 'car-a-p1', 'height')).toBe(1200)
    // No dead '' payload row for the uploaded photo.
    expect(target.localStore.hasRow(PHOTO_PAYLOADS_TABLE, 'car-a-p1')).toBe(false)
    // The joined read model matches the source exactly (incl. the enrichment).
    const targetState = createGarageAdapter(target.store, target.localStore).getState()
    expect(targetState.cars).toEqual(sourceState.cars)
  })
})

// DEC-11 regression: savedBuilds is a TOP-LEVEL table, so it does not ride
// inside the nested cars — before this coverage existed, a backup round-trip
// silently erased the entire Watching list (and a signed-in keep-local reseed
// propagated the erasure to the cloud).
describe('savedBuilds (Watching list) round trip', () => {
  const ROW_ID = 'a'.repeat(64) // sha256-hex-shaped rowId
  const SAVED_ROW = {
    token: 'RAWTOKEN123',
    savedAt: '2026-07-01T00:00:00.000Z',
    sortOrder: 1,
    cachedMake: 'Toyota',
    cachedModel: 'Supra',
  }

  it('export carries the table and import restores it after the wholesale reset', () => {
    const source = makeStores()
    source.store.setRow('savedBuilds', ROW_ID, SAVED_ROW)

    const backup = buildBackupV2({
      cars: [],
      themeId: 'garage',
      customAccent: null,
      currency: 'USD',
      distanceUnit: 'mi',
      savedBuilds: source.store.getTable('savedBuilds') as Record<
        string,
        Record<string, string | number>
      >,
    })
    const parsed = parseBackup(JSON.parse(JSON.stringify(backup)))
    expect(parsed?.savedBuilds).not.toBeNull()

    // The target already watches something ELSE: replace semantics must swap it
    // for the backup's list, not merge or wipe-and-lose.
    const target = makeStores()
    target.store.setRow('savedBuilds', 'b'.repeat(64), { ...SAVED_ROW, token: 'OTHER' })
    applyBackupImport({ store: target.store, localStore: target.localStore, backup: parsed! })

    expect(target.store.getRowIds('savedBuilds')).toEqual([ROW_ID])
    expect(target.store.getRow('savedBuilds', ROW_ID)).toEqual(SAVED_ROW)
  })

  it('tolerates backups without savedBuilds and drops token-less junk rows', () => {
    expect(parseBackup({ version: 2, cars: [] })?.savedBuilds).toBeNull()
    const parsed = parseBackup({
      version: 2,
      cars: [],
      savedBuilds: {
        good: { token: 'T', savedAt: 'now' },
        junk: { savedAt: 'no token' },
        nested: { token: 'T2', bad: { deep: true } },
        notARow: 'nope',
      },
    })
    expect(Object.keys(parsed?.savedBuilds ?? {})).toEqual(['good', 'nested'])
    expect(parsed?.savedBuilds?.nested).toEqual({ token: 'T2' })
  })
})
