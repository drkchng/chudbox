// Action/selector parity for the TinyBase-backed adapter (M2 verification
// (a)/(d) support): strict-null cell writes, currency-tagging rules, the
// no-rewrite settings semantics, delete cascades, and read-model caching.
import { describe, expect, it, vi } from 'vitest'
import { createMergeableStore, createStore } from 'tinybase'
import {
  PHOTOS_BY_SOURCE_ID,
  createGarageStore,
  currentCheckIn,
  KM_PER_MILE,
  mileagePrefill,
} from '@chudbox/shared'
import { PHOTO_PAYLOADS_TABLE, createGarageAdapter } from './adapter'
import type { GarageAdapter, PhotoHooks } from './adapter'

const CAR_DETAILS = {
  year: '1999',
  make: 'Mazda',
  model: 'Miata',
  trim: '',
  color: '',
  mileage: '',
  nickname: '',
  purchaseDate: '',
  saleDate: '',
  status: 'current',
  salePrice: '',
  tradeFor: '',
} as const

function makeAdapter(): GarageAdapter {
  return createGarageAdapter(createGarageStore(), createStore())
}

function addOneCar(adapter: GarageAdapter): string {
  adapter.getState().addCar({ ...CAR_DETAILS })
  return adapter.store.getRowIds('cars')[0]
}

describe('strict null rule through actions', () => {
  it('addCar writes "" cells explicitly and omits nullable cells', () => {
    const adapter = makeAdapter()
    const carId = addOneCar(adapter)
    const { store } = adapter
    expect(store.getCell('cars', carId, 'salePrice')).toBe('')
    expect(store.getCell('cars', carId, 'mileageRaw')).toBe('')
    expect(store.hasCell('cars', carId, 'salePriceCurrency')).toBe(false)
    expect(store.hasCell('cars', carId, 'mileageMiles')).toBe(false)
    expect(store.hasCell('cars', carId, 'coverPhoto')).toBe(false)
    expect(adapter.getState().cars[0].coverPhoto).toBeNull()
  })

  it('addMod writes cost 0 explicitly (with tag) and omits null cost', () => {
    const adapter = makeAdapter()
    const carId = addOneCar(adapter)
    const state = adapter.getState()
    state.addMod(carId, {
      name: 'sticker',
      category: '',
      description: '',
      cost: 0,
      installedDate: '',
      shop: '',
      link: '',
    })
    state.addMod(carId, {
      name: 'gifted part',
      category: '',
      description: '',
      cost: null,
      installedDate: '',
      shop: '',
      link: '',
    })
    const rows = adapter.store.getRowIds('mods').map((id) => ({
      cost: adapter.store.getCell('mods', id, 'cost'),
      hasCost: adapter.store.hasCell('mods', id, 'cost'),
      hasTag: adapter.store.hasCell('mods', id, 'costCurrency'),
      name: adapter.store.getCell('mods', id, 'name'),
    }))
    const zeroCost = rows.find((r) => r.name === 'sticker')
    const nullCost = rows.find((r) => r.name === 'gifted part')
    expect(zeroCost?.cost).toBe(0)
    expect(zeroCost?.hasTag).toBe(true)
    expect(nullCost?.hasCost).toBe(false)
    expect(nullCost?.hasTag).toBe(false)
    const joined = adapter.getState().cars[0].mods
    expect(joined.find((m) => m.name === 'sticker')?.cost).toBe(0)
    expect(joined.find((m) => m.name === 'gifted part')?.cost).toBeNull()
  })

  it('addTodo writes done: false explicitly; toggleTodo flips it', () => {
    const adapter = makeAdapter()
    const carId = addOneCar(adapter)
    adapter.getState().addTodo(carId, 'wash it')
    const todoId = adapter.store.getRowIds('todos')[0]
    expect(adapter.store.getCell('todos', todoId, 'done')).toBe(false)
    expect(adapter.store.getCell('todos', todoId, 'priority')).toBe('medium')
    adapter.getState().toggleTodo(carId, todoId)
    expect(adapter.store.getCell('todos', todoId, 'done')).toBe(true)
    expect(adapter.getState().cars[0].todos[0].done).toBe(true)
  })

  it("maintenance mileage keeps null and '' as distinct states", () => {
    const adapter = makeAdapter()
    const carId = addOneCar(adapter)
    const base = {
      service: 'oil',
      date: '',
      cost: null,
      shop: '',
      notes: '',
      nextDueDate: '',
      nextDueMileage: '',
    }
    adapter.getState().addMaintenance(carId, { ...base, mileage: null })
    const recId = adapter.store.getRowIds('maintenance')[0]
    expect(adapter.store.hasCell('maintenance', recId, 'mileageRaw')).toBe(false)
    expect(adapter.getState().cars[0].maintenance[0].mileage).toBeNull()

    adapter.getState().updateMaintenance(carId, recId, { mileage: '' })
    expect(adapter.store.getCell('maintenance', recId, 'mileageRaw')).toBe('')
    expect(adapter.store.hasCell('maintenance', recId, 'mileageMiles')).toBe(false)
    expect(adapter.getState().cars[0].maintenance[0].mileage).toBe('')

    adapter.getState().updateMaintenance(carId, recId, { mileage: null })
    expect(adapter.store.hasCell('maintenance', recId, 'mileageRaw')).toBe(false)
    expect(adapter.getState().cars[0].maintenance[0].mileage).toBeNull()
  })

  it('updateIssue resolvedAt: null deletes the cell; string sets it', () => {
    const adapter = makeAdapter()
    const carId = addOneCar(adapter)
    adapter.getState().addIssue(carId, { title: 'leak', description: '', severity: 'minor' })
    const issueId = adapter.store.getRowIds('issues')[0]
    expect(adapter.store.hasCell('issues', issueId, 'resolvedAt')).toBe(false)
    adapter
      .getState()
      .updateIssue(carId, issueId, { status: 'resolved', resolvedAt: '2026-06-12T00:00:00.000Z' })
    expect(adapter.store.getCell('issues', issueId, 'resolvedAt')).toBe('2026-06-12T00:00:00.000Z')
    adapter.getState().updateIssue(carId, issueId, { status: 'open', resolvedAt: null })
    expect(adapter.store.hasCell('issues', issueId, 'resolvedAt')).toBe(false)
    expect(adapter.getState().cars[0].issues[0].resolvedAt).toBeNull()
  })
})

describe('settings are Values writes only (the units fix)', () => {
  it('setCurrency never rewrites stored amounts', () => {
    const adapter = makeAdapter()
    const carId = addOneCar(adapter)
    adapter.getState().addMod(carId, {
      name: 'exhaust',
      category: '',
      description: '',
      cost: 100,
      installedDate: '',
      shop: '',
      link: '',
    })
    const modId = adapter.store.getRowIds('mods')[0]
    adapter.getState().setCurrency('EUR')
    expect(adapter.getState().currency).toBe('EUR')
    expect(adapter.store.getCell('mods', modId, 'cost')).toBe(100) // NOT converted
    expect(adapter.store.getCell('mods', modId, 'costCurrency')).toBe('USD') // entry tag kept
  })

  it('setDistanceUnit never rewrites mileage; new entries canonicalize from the new unit', () => {
    const adapter = makeAdapter()
    const carId = addOneCar(adapter)
    adapter.getState().updateCar(carId, { mileage: '1,000' })
    expect(adapter.store.getCell('cars', carId, 'mileageMiles')).toBe(1000)
    adapter.getState().setDistanceUnit('km')
    expect(adapter.store.getCell('cars', carId, 'mileageRaw')).toBe('1,000') // untouched
    expect(adapter.store.getCell('cars', carId, 'mileageMiles')).toBe(1000) // untouched
    adapter.getState().updateCar(carId, { mileage: '1,000' }) // re-entered under km
    expect(adapter.store.getCell('cars', carId, 'mileageMiles')).toBe(1000 / KM_PER_MILE)
  })

  it('partial updates never re-tag amounts that were not in the patch', () => {
    const adapter = makeAdapter()
    const carId = addOneCar(adapter)
    adapter.getState().updateCar(carId, { salePrice: '5000' })
    expect(adapter.store.getCell('cars', carId, 'salePriceCurrency')).toBe('USD')
    adapter.getState().setCurrency('EUR')
    adapter.getState().updateCar(carId, { nickname: 'Bessie' }) // unrelated field
    expect(adapter.store.getCell('cars', carId, 'salePriceCurrency')).toBe('USD') // NOT re-tagged
    adapter.getState().updateCar(carId, { salePrice: '6000' }) // amount itself re-entered
    expect(adapter.store.getCell('cars', carId, 'salePriceCurrency')).toBe('EUR')
    adapter.getState().updateCar(carId, { salePrice: '' }) // blanked → tag dropped
    expect(adapter.store.hasCell('cars', carId, 'salePriceCurrency')).toBe(false)
  })
})

describe('photos and cascades', () => {
  it('addPhoto parks the dataUrl in the side store only; read path joins it back', () => {
    const adapter = makeAdapter()
    const carId = addOneCar(adapter)
    adapter.getState().addPhoto(carId, { dataUrl: 'data:image/png;base64,AAAA', caption: 'hi' })
    const photoId = adapter.store.getRowIds('photos')[0]
    expect(adapter.store.hasCell('photos', photoId, 'dataUrl' as never)).toBe(false)
    expect(adapter.localStore.getCell(PHOTO_PAYLOADS_TABLE, photoId, 'dataUrl')).toBe(
      'data:image/png;base64,AAAA',
    )
    expect(adapter.getState().cars[0].photos[0].dataUrl).toBe('data:image/png;base64,AAAA')
  })

  it('deletePhoto clears a matching coverPhoto and the parked payload', () => {
    const adapter = makeAdapter()
    const carId = addOneCar(adapter)
    adapter.getState().addPhoto(carId, { dataUrl: 'data:x', caption: '' })
    const photoId = adapter.store.getRowIds('photos')[0]
    adapter.getState().setCoverPhoto(carId, photoId)
    expect(adapter.store.getCell('cars', carId, 'coverPhoto')).toBe(photoId)
    adapter.getState().deletePhoto(carId, photoId)
    expect(adapter.store.hasRow('photos', photoId)).toBe(false)
    expect(adapter.store.hasCell('cars', carId, 'coverPhoto')).toBe(false)
    expect(adapter.localStore.hasRow(PHOTO_PAYLOADS_TABLE, photoId)).toBe(false)
    expect(adapter.getState().cars[0].coverPhoto).toBeNull()
  })

  it('deleteCar cascades every child table and the photo payloads', () => {
    const adapter = makeAdapter()
    const carId = addOneCar(adapter)
    const state = adapter.getState()
    state.addPhoto(carId, { dataUrl: 'data:x', caption: '' })
    state.addWishlistItem(carId, { name: 'w', link: '', price: 1, category: '', notes: '' })
    state.addMod(carId, { name: 'm', category: '', description: '', cost: null, installedDate: '', shop: '', link: '' })
    state.addMaintenance(carId, { service: 's', date: '', mileage: '1', cost: 2, shop: '', notes: '', nextDueDate: '', nextDueMileage: '' })
    state.addTodo(carId, 't')
    state.addIssue(carId, { title: 'i', description: '', severity: 'minor' })

    // A second car must survive the cascade untouched.
    adapter.getState().addCar({ ...CAR_DETAILS, make: 'Honda' })
    const otherId = adapter.store.getRowIds('cars').find((id) => id !== carId) as string
    adapter.getState().addTodo(otherId, 'keep me')

    adapter.getState().deleteCar(carId)
    expect(adapter.store.hasRow('cars', carId)).toBe(false)
    for (const tableId of ['photos', 'wishlist', 'mods', 'maintenance', 'issues'] as const) {
      expect(adapter.store.getRowIds(tableId)).toHaveLength(0)
    }
    expect(adapter.store.getRowIds('todos')).toHaveLength(1) // the other car's
    expect(adapter.localStore.getRowIds(PHOTO_PAYLOADS_TABLE)).toHaveLength(0)
    expect(adapter.getState().cars.map((c) => c.make)).toEqual(['Honda'])
  })
})

describe('R2 photo hooks (M3)', () => {
  function makeAdapterWithHooks(hooks: PhotoHooks): GarageAdapter {
    return createGarageAdapter(createGarageStore(), createStore(), hooks)
  }

  it('addPhoto fires onPhotoAdded after the optimistic local write', () => {
    const onPhotoAdded = vi.fn()
    const adapter = makeAdapterWithHooks({ onPhotoAdded })
    const carId = addOneCar(adapter)
    adapter.getState().addPhoto(carId, { dataUrl: 'data:image/png;base64,AAAA', caption: 'hi' })
    const photoId = adapter.store.getRowIds('photos')[0]
    // Local write happened first (base64 parked, metadata row present)...
    expect(adapter.localStore.getCell(PHOTO_PAYLOADS_TABLE, photoId, 'dataUrl')).toBe(
      'data:image/png;base64,AAAA',
    )
    // ...then the hook fired with the new photo's identity + payload.
    expect(onPhotoAdded).toHaveBeenCalledWith(carId, photoId, 'data:image/png;base64,AAAA', 'hi')
  })

  it('resolvePhotoSrc reads the r2Key the join copies off the row', () => {
    const adapter = makeAdapterWithHooks({})
    const carId = addOneCar(adapter)
    adapter.getState().addPhoto(carId, { dataUrl: 'data:x', caption: '' })
    const photoId = adapter.store.getRowIds('photos')[0]
    adapter.store.setCell('photos', photoId, 'r2Key', 'u/user/car/p.webp')
    adapter.store.setCell('photos', photoId, 'width', 1600)
    const photo = adapter.getState().cars[0].photos[0] as { r2Key?: string; width?: number }
    expect(photo.r2Key).toBe('u/user/car/p.webp')
    expect(photo.width).toBe(1600)
  })

  it('deletePhoto / deleteCar report the deleted r2Keys (and only uploaded ones)', () => {
    const onPhotosDeleted = vi.fn()
    const adapter = makeAdapterWithHooks({ onPhotosDeleted })
    const carId = addOneCar(adapter)
    const state = adapter.getState()
    state.addPhoto(carId, { dataUrl: 'data:a', caption: '' })
    state.addPhoto(carId, { dataUrl: 'data:b', caption: '' })
    const [uploaded, localOnly] = adapter.store.getRowIds('photos')
    adapter.store.setCell('photos', uploaded, 'r2Key', 'u/user/car/uploaded.webp')

    adapter.getState().deletePhoto(carId, localOnly) // no r2Key → no hook
    expect(onPhotosDeleted).not.toHaveBeenCalled()

    adapter.getState().deletePhoto(carId, uploaded)
    expect(onPhotosDeleted).toHaveBeenCalledWith(['u/user/car/uploaded.webp'])

    // deleteCar reports any remaining uploaded photos.
    onPhotosDeleted.mockClear()
    const carId2 = (() => {
      adapter.getState().addCar({ ...CAR_DETAILS, make: 'Honda' })
      return adapter.store.getRowIds('cars').find((id) => id !== carId) as string
    })()
    adapter.getState().addPhoto(carId2, { dataUrl: 'data:c', caption: '' })
    const p = adapter.store.getRowIds('photos').find(
      (id) => adapter.store.getCell('photos', id, 'carId') === carId2,
    ) as string
    adapter.store.setCell('photos', p, 'r2Key', 'u/user/car2/c.jpg')
    adapter.getState().deleteCar(carId2)
    expect(onPhotosDeleted).toHaveBeenCalledWith(['u/user/car2/c.jpg'])
  })
})

describe('DEC-6 delete cascade (§15.10)', () => {
  function makeAdapterWithHooks(hooks: PhotoHooks): GarageAdapter {
    return createGarageAdapter(createGarageStore(), createStore(), hooks)
  }

  it('deleting a mod RE-PARENTS its photos to General (delCell sourceId + source=car), never R2-deleting', () => {
    const onPhotosDeleted = vi.fn()
    const adapter = makeAdapterWithHooks({ onPhotosDeleted })
    const carId = addOneCar(adapter)
    const state = adapter.getState()
    state.addMod(carId, { name: 'coilovers', category: '', description: '', cost: null, installedDate: '', shop: '', link: '' })
    const modId = adapter.store.getRowIds('mods')[0]
    state.addPhoto(carId, { dataUrl: 'data:x', caption: '' })
    const photoId = adapter.store.getRowIds('photos')[0]
    // No attach UI in Phase 1 → wire the attachment + R2 bytes directly.
    adapter.store.setCell('photos', photoId, 'sourceId', modId)
    adapter.store.setCell('photos', photoId, 'source', 'mod')
    adapter.store.setCell('photos', photoId, 'r2Key', 'u/user/car/p.webp')

    adapter.getState().deleteMod(carId, modId)

    // The mod is gone…
    expect(adapter.store.hasRow('mods', modId)).toBe(false)
    // …but the photo SURVIVES, re-parented to General: sourceId cleared (the
    // authoritative move), source hint reset to 'car'.
    expect(adapter.store.hasRow('photos', photoId)).toBe(true)
    expect(adapter.store.hasCell('photos', photoId, 'sourceId')).toBe(false)
    expect(adapter.store.getCell('photos', photoId, 'source')).toBe('car')
    // R2 bytes are NEVER destroyed for a re-tag (must NOT route through onPhotosDeleted).
    expect(onPhotosDeleted).not.toHaveBeenCalled()
  })

  it('re-parents only the deleted items photos, leaving other items attachments intact', () => {
    const adapter = makeAdapterWithHooks({})
    const carId = addOneCar(adapter)
    const state = adapter.getState()
    state.addMaintenance(carId, { service: 'oil', date: '', mileage: null, cost: null, shop: '', notes: '', nextDueDate: '', nextDueMileage: '' })
    state.addIssue(carId, { title: 'rattle', description: '', severity: 'minor' })
    const recId = adapter.store.getRowIds('maintenance')[0]
    const issueId = adapter.store.getRowIds('issues')[0]
    state.addPhoto(carId, { dataUrl: 'a', caption: '' })
    state.addPhoto(carId, { dataUrl: 'b', caption: '' })
    const [pMaint, pIssue] = adapter.store.getRowIds('photos')
    adapter.store.setCell('photos', pMaint, 'sourceId', recId)
    adapter.store.setCell('photos', pIssue, 'sourceId', issueId)

    adapter.getState().deleteMaintenance(carId, recId)

    expect(adapter.store.hasCell('photos', pMaint, 'sourceId')).toBe(false) // re-parented
    expect(adapter.store.getCell('photos', pIssue, 'sourceId')).toBe(issueId) // untouched
  })

  it('deletePhoto clears BOTH bannerPhoto and coverPhoto when they point at it', () => {
    const adapter = makeAdapterWithHooks({})
    const carId = addOneCar(adapter)
    adapter.getState().addPhoto(carId, { dataUrl: 'x', caption: '' })
    const photoId = adapter.store.getRowIds('photos')[0]
    adapter.getState().setCoverPhoto(carId, photoId)
    adapter.store.setCell('cars', carId, 'bannerPhoto', photoId)

    adapter.getState().deletePhoto(carId, photoId)
    expect(adapter.store.hasCell('cars', carId, 'coverPhoto')).toBe(false)
    expect(adapter.store.hasCell('cars', carId, 'bannerPhoto')).toBe(false)
  })
})

describe('DEC-6 attach (addPhoto source/sourceId) + cover/banner pickers', () => {
  it('addPhoto with source/sourceId writes the attach cells, joins them back, and indexes by sourceId', () => {
    const adapter = makeAdapter()
    const carId = addOneCar(adapter)
    const state = adapter.getState()
    state.addMod(carId, { name: 'coilovers', category: '', description: '', cost: null, installedDate: '', shop: '', link: '' })
    const modId = adapter.store.getRowIds('mods')[0]

    state.addPhoto(carId, { dataUrl: 'data:x', caption: 'install', source: 'mod', sourceId: modId })
    const photoId = adapter.store.getRowIds('photos')[0]

    // source is written (it is NOT 'car') and sourceId is the source of truth.
    expect(adapter.store.getCell('photos', photoId, 'source')).toBe('mod')
    expect(adapter.store.getCell('photos', photoId, 'sourceId')).toBe(modId)
    // The joined Car photo carries the attach metadata.
    const photo = adapter.getState().cars[0].photos[0]
    expect(photo.source).toBe('mod')
    expect(photo.sourceId).toBe(modId)
    // O(1) inline slice: photosBySourceId lists it under the mod id.
    expect(adapter.indexes.getSliceRowIds(PHOTOS_BY_SOURCE_ID, modId)).toEqual([photoId])
  })

  it('addPhoto for General omits source/sourceId and never enters a real item slice', () => {
    const adapter = makeAdapter()
    const carId = addOneCar(adapter)
    adapter.getState().addPhoto(carId, { dataUrl: 'data:x', caption: '' })
    const photoId = adapter.store.getRowIds('photos')[0]
    expect(adapter.store.hasCell('photos', photoId, 'source')).toBe(false)
    expect(adapter.store.hasCell('photos', photoId, 'sourceId')).toBe(false)
    expect(adapter.indexes.getSliceRowIds(PHOTOS_BY_SOURCE_ID, 'any-item')).toEqual([])
  })

  it('addPhoto with a source but no sourceId stays General (sourceId is the source of truth)', () => {
    const adapter = makeAdapter()
    const carId = addOneCar(adapter)
    adapter.getState().addPhoto(carId, { dataUrl: 'data:x', caption: '', source: 'issue' })
    const photoId = adapter.store.getRowIds('photos')[0]
    expect(adapter.store.hasCell('photos', photoId, 'sourceId')).toBe(false)
    expect(adapter.store.hasCell('photos', photoId, 'source')).toBe(false)
  })

  it('setBannerPhoto sets the banner pointer independently of the cover (mirrors setCoverPhoto)', () => {
    const adapter = makeAdapter()
    const carId = addOneCar(adapter)
    const state = adapter.getState()
    state.addPhoto(carId, { dataUrl: 'a', caption: '' })
    state.addPhoto(carId, { dataUrl: 'b', caption: '' })
    const [p1, p2] = adapter.store.getRowIds('photos')

    adapter.getState().setCoverPhoto(carId, p1)
    adapter.getState().setBannerPhoto(carId, p2)
    expect(adapter.store.getCell('cars', carId, 'coverPhoto')).toBe(p1)
    expect(adapter.store.getCell('cars', carId, 'bannerPhoto')).toBe(p2)
    expect(adapter.getState().cars[0].bannerPhoto).toBe(p2)
  })

  it('setBannerPhoto ignores a photo that does not belong to the car', () => {
    const adapter = makeAdapter()
    const carId = addOneCar(adapter)
    adapter.getState().setBannerPhoto(carId, 'not-a-photo')
    expect(adapter.store.hasCell('cars', carId, 'bannerPhoto')).toBe(false)
  })
})

describe('read model caching', () => {
  it('keeps state and car identities stable until their data changes', () => {
    const adapter = makeAdapter()
    adapter.getState().addCar({ ...CAR_DETAILS })
    adapter.getState().addCar({ ...CAR_DETAILS, make: 'Honda' })
    const before = adapter.getState()
    expect(adapter.getState()).toBe(before) // no change → same snapshot

    const [mazda, honda] = before.cars
    before.updateCar(mazda.id, { nickname: 'Bess' })
    const after = adapter.getState()
    expect(after).not.toBe(before)
    expect(after.cars.find((c) => c.id === honda.id)).toBe(honda) // untouched car: same ref
    expect(after.cars.find((c) => c.id === mazda.id)).not.toBe(mazda)
    expect(after.cars.find((c) => c.id === mazda.id)?.nickname).toBe('Bess')
  })

  it('theme changes do not invalidate the cars array identity', () => {
    const adapter = makeAdapter()
    adapter.getState().addCar({ ...CAR_DETAILS })
    const carsBefore = adapter.getState().cars
    adapter.getState().setTheme('sunset')
    const state = adapter.getState()
    expect(state.themeId).toBe('sunset')
    expect(state.customAccent).toBeNull()
    expect(state.cars).toBe(carsBefore)
  })

  it('getCar returns the joined nested car', () => {
    const adapter = makeAdapter()
    const carId = addOneCar(adapter)
    expect(adapter.getState().getCar(carId)?.id).toBe(carId)
    expect(adapter.getState().getCar('nope')).toBeUndefined()
  })
})

describe('mileage edit round-trip survives a units toggle', () => {
  it('the read model re-attaches the canonical miles joinCar drops', () => {
    const adapter = makeAdapter()
    const carId = addOneCar(adapter)
    adapter.getState().updateCar(carId, { mileage: '12,000' }) // default unit mi
    expect(adapter.getState().cars[0].mileageMiles).toBe(12_000)
    // Non-numeric raw → no canonical; display falls back to verbatim raw.
    adapter.getState().updateCar(carId, { mileage: 'unknown' })
    expect(adapter.getState().cars[0].mileageMiles).toBeUndefined()
    expect(adapter.getState().cars[0].mileage).toBe('unknown')
  })

  it('editing a km-entered car while the app shows mi does NOT 1.6×-corrupt mileageMiles', () => {
    const adapter = makeAdapter()
    const carId = addOneCar(adapter)

    // Entered as 120000 under km → canonical ≈ 74565 mi.
    adapter.getState().setDistanceUnit('km')
    adapter.getState().updateCar(carId, { mileage: '120000' })
    const entered = adapter.store.getCell('cars', carId, 'mileageMiles') as number
    expect(entered).toBeCloseTo(120_000 / KM_PER_MILE, 6)

    // Toggle to mi — the adapter never rewrites; raw + canonical stay put.
    adapter.getState().setDistanceUnit('mi')
    expect(adapter.store.getCell('cars', carId, 'mileageRaw')).toBe('120000')
    expect(adapter.store.getCell('cars', carId, 'mileageMiles')).toBe(entered)

    // The edit form prefills from the canonical converted to the ACTIVE unit…
    const car = adapter.getState().cars[0]
    const prefill = mileagePrefill(car.mileage, car.mileageMiles, 'mi')
    expect(prefill).toBe('74565')

    // …and a no-op save re-canonicalizes under mi. BEFORE the fix the form
    // prefilled raw '120000' and saved 120000 MILES (the 1.6× corruption);
    // now it stays ≈74565, never 120000.
    adapter.getState().updateCar(carId, { mileage: prefill })
    expect(adapter.store.getCell('cars', carId, 'mileageMiles')).toBe(74_565)
    expect(adapter.store.getCell('cars', carId, 'mileageMiles')).not.toBe(120_000)
  })

  it('a no-op edit in the SAME unit preserves the canonical exactly', () => {
    const adapter = makeAdapter()
    const carId = addOneCar(adapter)
    adapter.getState().updateCar(carId, { mileage: '50000' }) // default unit mi
    const car = adapter.getState().cars[0]
    const prefill = mileagePrefill(car.mileage, car.mileageMiles, 'mi')
    expect(prefill).toBe('50000')
    adapter.getState().updateCar(carId, { mileage: prefill })
    expect(adapter.store.getCell('cars', carId, 'mileageMiles')).toBe(50_000)
  })
})

describe('DEC-16 mileage check-ins (logMileage / current = latest / dual-write)', () => {
  it('logMileage adds a dated check-in and dual-writes the latest into the scalar', () => {
    const adapter = makeAdapter()
    const carId = addOneCar(adapter)
    adapter.getState().logMileage(carId, { value: '50000', date: '2026-01-01' })

    const ckId = adapter.store.getRowIds('mileage')[0]
    expect(adapter.store.getCell('mileage', ckId, 'valueRaw')).toBe('50000')
    expect(adapter.store.getCell('mileage', ckId, 'valueMiles')).toBe(50_000)
    expect(adapter.store.getCell('mileage', ckId, 'unit')).toBe('mi')
    expect(adapter.store.getCell('mileage', ckId, 'source')).toBe('manual')
    expect(adapter.store.getCell('mileage', ckId, 'date')).toBe('2026-01-01')
    // DUAL-WRITE: the scalar mirror tracks the latest check-in (§15.8 Phase 3).
    expect(adapter.store.getCell('cars', carId, 'mileageRaw')).toBe('50000')
    expect(adapter.store.getCell('cars', carId, 'mileageMiles')).toBe(50_000)

    const car = adapter.getState().cars[0]
    expect(car.mileageLog).toHaveLength(1)
    expect(currentCheckIn(car.mileageLog)?.value).toBe('50000')
  })

  it('the dual-write mirrors the latest BY DATE, not the last entered', () => {
    const adapter = makeAdapter()
    const carId = addOneCar(adapter)
    adapter.getState().logMileage(carId, { value: '50000', date: '2026-01-01' })
    adapter.getState().logMileage(carId, { value: '52000', date: '2026-03-01' })
    adapter.getState().logMileage(carId, { value: '48000', date: '2025-12-01' }) // historical, entered last

    // Current odometer = greatest-date check-in (52000), not the just-entered 48000.
    expect(adapter.store.getCell('cars', carId, 'mileageRaw')).toBe('52000')
    expect(adapter.store.getCell('cars', carId, 'mileageMiles')).toBe(52_000)
    expect(currentCheckIn(adapter.getState().cars[0].mileageLog)?.value).toBe('52000')
  })

  it('freezes the entry unit; canonical derives from THAT unit and survives a toggle', () => {
    const adapter = makeAdapter()
    const carId = addOneCar(adapter)
    adapter.getState().setDistanceUnit('km')
    adapter.getState().logMileage(carId, { value: '120000', date: '2026-01-01' })
    const ckId = adapter.store.getRowIds('mileage')[0]
    expect(adapter.store.getCell('mileage', ckId, 'unit')).toBe('km')
    expect(adapter.store.getCell('mileage', ckId, 'valueMiles')).toBeCloseTo(120_000 / KM_PER_MILE, 6)

    adapter.getState().setDistanceUnit('mi') // never rewrites
    expect(adapter.store.getCell('mileage', ckId, 'valueRaw')).toBe('120000')
    expect(adapter.store.getCell('mileage', ckId, 'unit')).toBe('km')
  })

  it('a non-numeric reading is kept for display but has no canonical', () => {
    const adapter = makeAdapter()
    const carId = addOneCar(adapter)
    adapter.getState().logMileage(carId, { value: 'unknown', date: '2026-01-01' })
    const ckId = adapter.store.getRowIds('mileage')[0]
    expect(adapter.store.getCell('mileage', ckId, 'valueRaw')).toBe('unknown')
    expect(adapter.store.hasCell('mileage', ckId, 'valueMiles')).toBe(false)
    expect(adapter.store.getCell('cars', carId, 'mileageRaw')).toBe('unknown')
    expect(adapter.store.hasCell('cars', carId, 'mileageMiles')).toBe(false)
  })

  it('deleteMileage re-mirrors the new latest, and clears the scalar when none remain', () => {
    const adapter = makeAdapter()
    const carId = addOneCar(adapter)
    adapter.getState().logMileage(carId, { value: '50000', date: '2026-01-01' })
    adapter.getState().logMileage(carId, { value: '52000', date: '2026-03-01' })
    const byDate = (raw: string) =>
      adapter.store.getRowIds('mileage').find((id) => adapter.store.getCell('mileage', id, 'valueRaw') === raw) as string

    // Delete the latest → scalar falls back to the remaining (earlier) reading.
    adapter.getState().deleteMileage(carId, byDate('52000'))
    expect(adapter.store.getCell('cars', carId, 'mileageRaw')).toBe('50000')
    expect(adapter.store.getCell('cars', carId, 'mileageMiles')).toBe(50_000)

    // Delete the last one → timeline empty → scalar cleared to '' (no mileage).
    adapter.getState().deleteMileage(carId, byDate('50000'))
    expect(adapter.store.getRowIds('mileage')).toHaveLength(0)
    expect(adapter.store.getCell('cars', carId, 'mileageRaw')).toBe('')
    expect(adapter.store.hasCell('cars', carId, 'mileageMiles')).toBe(false)
  })

  it('addCar seeds the FIRST check-in (source initial) from an entered odometer', () => {
    const adapter = makeAdapter()
    adapter.getState().addCar({ ...CAR_DETAILS, mileage: '45000', purchaseDate: '2020-05-01' })
    const carId = adapter.store.getRowIds('cars')[0]
    const ckId = adapter.store.getRowIds('mileage')[0]
    expect(adapter.store.getCell('mileage', ckId, 'carId')).toBe(carId)
    expect(adapter.store.getCell('mileage', ckId, 'source')).toBe('initial')
    expect(adapter.store.getCell('mileage', ckId, 'valueRaw')).toBe('45000')
    expect(adapter.store.getCell('mileage', ckId, 'valueMiles')).toBe(45_000)
    // date = purchaseDate when valid (else the car's createdAt).
    expect(adapter.store.getCell('mileage', ckId, 'date')).toBe('2020-05-01')
    // The scalar mirror stays correct from creation.
    expect(adapter.store.getCell('cars', carId, 'mileageRaw')).toBe('45000')
  })

  it('addCar with a blank odometer seeds NO check-in (empty timeline)', () => {
    const adapter = makeAdapter()
    addOneCar(adapter) // CAR_DETAILS.mileage === ''
    expect(adapter.store.getRowIds('mileage')).toHaveLength(0)
    expect(adapter.getState().cars[0].mileageLog).toBeUndefined()
  })
})

// ── Local-first migration-load guard (Phase-2 EXPAND) ──────────────────────
// EXPAND is a PURELY ADDITIVE superset (DATA_MODEL.md §2/§15.8): it adds the
// `mileage`/`savedBuilds` tables and the cars.vin/bannerPhoto + photos.source/
// sourceId cells. A device whose IndexedDB was written under the OLD schema
// therefore holds a STRICT SUBSET of the current content. On boot the persister
// does `store.setMergeableContent(<old content>)` into the CURRENT-schema store
// (useGarageStore.ts initGarageStore → mainPersister.load()).
//
// This guard pins that the additive load tolerates absent tables/cells: absent
// ⇔ empty/default, with the pre-existing cars/children preserved byte-for-byte.
// `setMergeableContent` is exactly what the custom mergeable persister's load()
// routes content into (idbMergeablePersister.ts → tinybase persister core:
// getContent = getMergeableContent, and a non-changes content array dispatches
// to setMergeableContent), so this exercises the real migration-load path
// without needing an IndexedDB shim.
describe('migration-load: OLD-schema content into the CURRENT-schema store', () => {
  // Strict subset of GARAGE_TABLES_SCHEMA: 6 pre-DEC child tables (NO mileage /
  // savedBuilds) and NONE of the new cells (vin, bannerPhoto, source, sourceId).
  const OLD_TABLES_SCHEMA = {
    cars: {
      year: { type: 'string' }, make: { type: 'string' }, model: { type: 'string' },
      trim: { type: 'string' }, color: { type: 'string' }, mileageRaw: { type: 'string' },
      mileageMiles: { type: 'number' }, nickname: { type: 'string' }, purchaseDate: { type: 'string' },
      saleDate: { type: 'string' }, status: { type: 'string' }, salePrice: { type: 'string' },
      salePriceCurrency: { type: 'string' }, tradeFor: { type: 'string' }, coverPhoto: { type: 'string' },
      createdAt: { type: 'string' },
    },
    photos: { carId: { type: 'string' }, r2Key: { type: 'string' }, caption: { type: 'string' }, uploadedAt: { type: 'string' } },
    mods: { carId: { type: 'string' }, name: { type: 'string' }, category: { type: 'string' },
      description: { type: 'string' }, cost: { type: 'number' }, costCurrency: { type: 'string' },
      installedDate: { type: 'string' }, shop: { type: 'string' }, link: { type: 'string' }, addedAt: { type: 'string' } },
    todos: { carId: { type: 'string' }, text: { type: 'string' }, priority: { type: 'string' },
      done: { type: 'boolean' }, createdAt: { type: 'string' } },
  } as const

  function oldSchemaContent() {
    const old = createMergeableStore('old-device')
      .setTablesSchema(OLD_TABLES_SCHEMA as never)
      .setValuesSchema({ themeId: { type: 'string', default: 'garage' }, currency: { type: 'string', default: 'USD' },
        distanceUnit: { type: 'string', default: 'mi' }, customAccent: { type: 'string' } } as never)
    old.setRow('cars', 'car-1', { year: '1999', make: 'Mazda', model: 'Miata', trim: '', color: '',
      mileageRaw: '50000', mileageMiles: 50_000, nickname: 'Bess', purchaseDate: '', saleDate: '',
      status: 'current', salePrice: '', tradeFor: '', coverPhoto: 'photo-1', createdAt: '2020-01-01' })
    old.setRow('photos', 'photo-1', { carId: 'car-1', caption: 'front', uploadedAt: '2020-01-02', r2Key: 'u/x/photo-1.webp' })
    old.setRow('mods', 'mod-1', { carId: 'car-1', name: 'exhaust', category: '', description: '',
      cost: 500, costCurrency: 'USD', installedDate: '', shop: '', link: '', addedAt: '2020-01-03' })
    old.setRow('todos', 'todo-1', { carId: 'car-1', text: 'wash it', priority: 'medium', done: false, createdAt: '2020-01-04' })
    old.setValue('currency', 'EUR')
    return old.getMergeableContent()
  }

  it('loads without throwing and preserves the pre-existing cars/children', () => {
    const store = createGarageStore('this-device')
    const adapter = createGarageAdapter(store, createStore())

    // The exact operation mainPersister.load() performs on a device with
    // OLD-schema IndexedDB content. MUST NOT throw "can't convert undefined to
    // object" on the absent mileage/savedBuilds tables or absent new cells.
    expect(() => store.setMergeableContent(oldSchemaContent())).not.toThrow()

    const cars = adapter.getState().cars
    expect(cars).toHaveLength(1)
    const car = cars[0]
    // Pre-existing data is intact (round-trip preserved).
    expect(car.id).toBe('car-1')
    expect(car.make).toBe('Mazda')
    expect(car.nickname).toBe('Bess')
    expect(car.mileage).toBe('50000')
    expect(car.coverPhoto).toBe('photo-1')
    expect(car.photos.map((p) => p.id)).toEqual(['photo-1'])
    expect((car.photos[0] as { r2Key?: string }).r2Key).toBe('u/x/photo-1.webp')
    expect(car.mods.map((m) => m.name)).toEqual(['exhaust'])
    expect(car.mods[0].cost).toBe(500)
    expect(car.todos.map((t) => t.text)).toEqual(['wash it'])
    expect(adapter.getState().currency).toBe('EUR')

    // Absent new cells default per the documented contract.
    expect(car.vin).toBeUndefined() // vin: absent ⇔ ''
    expect(car.bannerPhoto).toBeUndefined() // bannerPhoto: absent ⇔ null
    expect(car.photos[0].source).toBeUndefined() // source: absent ⇔ 'car' (General)
    expect(car.photos[0].sourceId).toBeUndefined()
    // Absent additive tables ⇔ empty.
    expect(car.mileageLog).toBeUndefined()
    expect(store.getRowIds('mileage')).toHaveLength(0)
    expect(store.getRowIds('savedBuilds')).toHaveLength(0)
  })
})
