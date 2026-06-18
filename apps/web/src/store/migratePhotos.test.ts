// M3 base64 → R2 migration sweep: idempotency, partial-failure safety,
// eligibility (only photos with a local payload and no r2Key), and the
// applyPhotoUpload store-write guard. Pure logic over injected stores + a
// stub uploader — no network, no IndexedDB.
import { describe, expect, it, vi } from 'vitest'
import { createStore } from 'tinybase'
import { createGarageStore } from '@chudbox/shared'
import type { UploadResponse } from '@chudbox/shared'
import type { MergeableStore, Store } from 'tinybase'
import { PHOTO_PAYLOADS_TABLE } from './adapter'
import { applyPhotoUpload, migratePhotosToR2 } from './migratePhotos'

function makeStores(): { store: MergeableStore; localStore: Store } {
  return { store: createGarageStore(), localStore: createStore() }
}

/** Seed a car + a base64 photo (synced metadata row + local payload). */
function seedPhoto(
  store: MergeableStore,
  localStore: Store,
  carId: string,
  photoId: string,
): void {
  if (!store.hasRow('cars', carId)) {
    store.setRow('cars', carId, {
      year: '', make: '', model: '', trim: '', color: '', mileageRaw: '',
      nickname: '', purchaseDate: '', saleDate: '', status: 'current',
      salePrice: '', tradeFor: '', createdAt: '2026-01-01T00:00:00.000Z',
    })
  }
  store.setRow('photos', photoId, { carId, caption: photoId, uploadedAt: '2026-01-01T00:00:00.000Z' })
  localStore.setRow(PHOTO_PAYLOADS_TABLE, photoId, { dataUrl: `data:image/png;base64,${photoId}` })
}

function response(photoId: string): UploadResponse {
  return { r2Key: `u/user/car/${photoId}.webp`, width: 1600, height: 1200, contentType: 'image/webp' }
}

describe('migratePhotosToR2', () => {
  it('uploads every eligible photo, writes r2Key/width/height, drops the payload', async () => {
    const { store, localStore } = makeStores()
    seedPhoto(store, localStore, 'car1', 'p1')
    seedPhoto(store, localStore, 'car1', 'p2')
    const uploadOne = vi.fn((_c: string, photoId: string) => Promise.resolve(response(photoId)))

    const result = await migratePhotosToR2({ store, localStore, uploadOne })

    expect(result).toEqual({ migrated: 2, failed: 0, remaining: 0 })
    expect(store.getCell('photos', 'p1', 'r2Key')).toBe('u/user/car/p1.webp')
    expect(store.getCell('photos', 'p1', 'width')).toBe(1600)
    expect(store.getCell('photos', 'p1', 'height')).toBe(1200)
    expect(localStore.hasRow(PHOTO_PAYLOADS_TABLE, 'p1')).toBe(false)
    expect(localStore.hasRow(PHOTO_PAYLOADS_TABLE, 'p2')).toBe(false)
  })

  it('is idempotent — a second sweep does nothing and re-uploads nothing', async () => {
    const { store, localStore } = makeStores()
    seedPhoto(store, localStore, 'car1', 'p1')
    const uploadOne = vi.fn((_c: string, photoId: string) => Promise.resolve(response(photoId)))

    await migratePhotosToR2({ store, localStore, uploadOne })
    const second = await migratePhotosToR2({ store, localStore, uploadOne })

    expect(second).toEqual({ migrated: 0, failed: 0, remaining: 0 })
    expect(uploadOne).toHaveBeenCalledTimes(1)
  })

  it('is partial-failure safe — successes commit, failures stay local and retry', async () => {
    const { store, localStore } = makeStores()
    seedPhoto(store, localStore, 'car1', 'ok')
    seedPhoto(store, localStore, 'car1', 'bad')
    const flaky = vi.fn((_c: string, photoId: string) =>
      photoId === 'bad' ? Promise.reject(new Error('offline')) : Promise.resolve(response(photoId)),
    )

    const first = await migratePhotosToR2({ store, localStore, uploadOne: flaky })
    expect(first).toEqual({ migrated: 1, failed: 1, remaining: 1 })
    expect(store.getCell('photos', 'ok', 'r2Key')).toBe('u/user/car/ok.webp')
    expect(store.hasCell('photos', 'bad', 'r2Key')).toBe(false)
    expect(localStore.hasRow(PHOTO_PAYLOADS_TABLE, 'bad')).toBe(true)

    // Retry once the upload works: the remaining photo migrates.
    const retry = await migratePhotosToR2({
      store,
      localStore,
      uploadOne: (_c, photoId) => Promise.resolve(response(photoId)),
    })
    expect(retry).toEqual({ migrated: 1, failed: 0, remaining: 0 })
    expect(store.getCell('photos', 'bad', 'r2Key')).toBe('u/user/car/bad.webp')
  })

  it('skips photos already on R2 and photos without a local payload', async () => {
    const { store, localStore } = makeStores()
    // Already uploaded (r2Key + no payload).
    store.setRow('cars', 'car1', {
      year: '', make: '', model: '', trim: '', color: '', mileageRaw: '',
      nickname: '', purchaseDate: '', saleDate: '', status: 'current',
      salePrice: '', tradeFor: '', createdAt: '',
    })
    store.setRow('photos', 'cloud', { carId: 'car1', r2Key: 'u/x/y/cloud.jpg', caption: '', uploadedAt: '' })
    // Metadata-only (another device's photo, no local payload, no r2Key).
    store.setRow('photos', 'remote', { carId: 'car1', caption: '', uploadedAt: '' })
    // Genuinely eligible.
    seedPhoto(store, localStore, 'car1', 'local')
    const uploadOne = vi.fn((_c: string, photoId: string) => Promise.resolve(response(photoId)))

    const result = await migratePhotosToR2({ store, localStore, uploadOne })

    expect(result).toEqual({ migrated: 1, failed: 0, remaining: 0 })
    expect(uploadOne).toHaveBeenCalledTimes(1)
    expect(uploadOne).toHaveBeenCalledWith('car1', 'local', expect.any(String), 'local')
  })
})

describe('applyPhotoUpload guard', () => {
  it('discards the result when the photo row was deleted mid-upload', () => {
    const { store, localStore } = makeStores()
    applyPhotoUpload(store, localStore, 'car1', 'gone', response('gone'))
    expect(store.hasRow('photos', 'gone')).toBe(false) // never resurrected
  })

  it('discards the result when the photo was re-parented to another car', () => {
    const { store, localStore } = makeStores()
    seedPhoto(store, localStore, 'car1', 'p1')
    applyPhotoUpload(store, localStore, 'OTHER_CAR', 'p1', response('p1'))
    expect(store.hasCell('photos', 'p1', 'r2Key')).toBe(false)
    expect(localStore.hasRow(PHOTO_PAYLOADS_TABLE, 'p1')).toBe(true) // payload kept
  })
})
