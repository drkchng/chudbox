// Action/selector parity for the TinyBase-backed adapter (M2 verification
// (a)/(d) support): strict-null cell writes, currency-tagging rules, the
// no-rewrite settings semantics, delete cascades, and read-model caching.
import { describe, expect, it, vi } from 'vitest'
import { createStore } from 'tinybase'
import { createGarageStore, KM_PER_MILE } from '@chudbox/shared'
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
