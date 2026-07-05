// M3 upload wiring: the multipart HTTP shape, the auth/online gating of the
// photo-sync controller (logged-out makes NO network call), the optimistic
// add-path swap to r2Key, offline backlog handling, and best-effort delete.
import { describe, expect, it, vi } from 'vitest'
import { createStore } from 'tinybase'
import { UPLOAD_DELETE_PATH, UPLOAD_PATH, createGarageStore } from '@chudbox/shared'
import type { MergeableStore, Store } from 'tinybase'
import { PHOTOS_MIGRATED_VALUE, PHOTO_PAYLOADS_TABLE } from './adapter'
import type { EncodeResult } from '../utils/image'
import {
  createPhotoSyncController,
  dataUrlToBlob,
  deletePhotoObjects,
  uploadEncodedPhoto,
} from './photoUpload'
import type { FetchLike } from './photoUpload'

const DATA_URL = 'data:image/png;base64,AAAA'

const fakeEncode = (): Promise<EncodeResult> =>
  Promise.resolve({
    blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' }),
    contentType: 'image/webp',
    width: 1600,
    height: 1200,
  })

function okFetch(body: unknown): {
  fetchImpl: ReturnType<typeof vi.fn<FetchLike>>
  calls: { url: string; init?: RequestInit }[]
} {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
    calls.push({ url, init })
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  return { fetchImpl, calls }
}

function makeStores(): { store: MergeableStore; localStore: Store } {
  return { store: createGarageStore(), localStore: createStore() }
}

function seedPhotoRow(store: MergeableStore, localStore: Store, carId: string, photoId: string): void {
  store.setRow('cars', carId, {
    year: '', make: '', model: '', trim: '', color: '', mileageRaw: '',
    nickname: '', purchaseDate: '', saleDate: '', status: 'current',
    salePrice: '', tradeFor: '', createdAt: '',
  })
  store.setRow('photos', photoId, { carId, caption: '', uploadedAt: '' })
  localStore.setRow(PHOTO_PAYLOADS_TABLE, photoId, { dataUrl: DATA_URL })
}

const UPLOAD_RESPONSE = {
  r2Key: 'u/user/car1/p1.webp',
  width: 1600,
  height: 1200,
  contentType: 'image/webp' as const,
}

describe('dataUrlToBlob', () => {
  it('decodes a base64 data URL into a typed Blob', async () => {
    const blob = dataUrlToBlob('data:image/png;base64,AAAA')
    expect(blob.type).toBe('image/png')
    expect(blob.size).toBe(3) // atob('AAAA') → 3 bytes
  })

  it('rejects a non-data URL', () => {
    expect(() => dataUrlToBlob('https://example.com/x.png')).toThrow()
  })
})

describe('uploadEncodedPhoto', () => {
  it('encodes then POSTs multipart fields to UPLOAD_PATH and parses the response', async () => {
    const { fetchImpl, calls } = okFetch(UPLOAD_RESPONSE)
    const result = await uploadEncodedPhoto(
      { carId: 'car1', photoId: 'p1', dataUrl: DATA_URL, caption: 'hello' },
      { encode: fakeEncode, fetchImpl },
    )

    expect(result).toEqual(UPLOAD_RESPONSE)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(UPLOAD_PATH)
    expect(calls[0].init?.method).toBe('POST')
    const form = calls[0].init?.body as FormData
    expect(form.get('carId')).toBe('car1')
    expect(form.get('photoId')).toBe('p1')
    expect(form.get('width')).toBe('1600')
    expect(form.get('height')).toBe('1200')
    expect(form.get('caption')).toBe('hello')
    const file = form.get('file') as File
    expect(file.type).toBe('image/webp')
    expect(file.name).toBe('p1.webp') // ext reflects the produced format
  })

  it('omits an empty caption and throws on a non-2xx response', async () => {
    const { fetchImpl, calls } = okFetch(UPLOAD_RESPONSE)
    await uploadEncodedPhoto({ carId: 'c', photoId: 'p', dataUrl: DATA_URL, caption: '' }, { encode: fakeEncode, fetchImpl })
    expect((calls[0].init?.body as FormData).has('caption')).toBe(false)

    const failing = vi.fn<FetchLike>(async () => new Response('nope', { status: 500 }))
    await expect(
      uploadEncodedPhoto({ carId: 'c', photoId: 'p', dataUrl: DATA_URL, caption: '' }, { encode: fakeEncode, fetchImpl: failing }),
    ).rejects.toThrow(/500/)
  })
})

describe('createPhotoSyncController — add path gating', () => {
  it('logged out: handleNewPhoto makes NO network call and leaves the base64 in place', async () => {
    const { store, localStore } = makeStores()
    seedPhotoRow(store, localStore, 'car1', 'p1')
    const { fetchImpl } = okFetch(UPLOAD_RESPONSE)
    const controller = createPhotoSyncController({ store, localStore, encode: fakeEncode, fetchImpl, isOnline: () => true })
    // setUser never called → userId is null (logged out).

    controller.handleNewPhoto('car1', 'p1', DATA_URL, '')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(store.hasCell('photos', 'p1', 'r2Key')).toBe(false)
    expect(localStore.getCell(PHOTO_PAYLOADS_TABLE, 'p1', 'dataUrl')).toBe(DATA_URL)
  })

  it('signed-in + online: uploads, writes r2Key, and drops the local payload', async () => {
    const { store, localStore } = makeStores()
    seedPhotoRow(store, localStore, 'car1', 'p1')
    const { fetchImpl } = okFetch(UPLOAD_RESPONSE)
    const controller = createPhotoSyncController({ store, localStore, encode: fakeEncode, fetchImpl, isOnline: () => true })
    controller.setUser('user')

    controller.handleNewPhoto('car1', 'p1', DATA_URL, '')
    await vi.waitFor(() => expect(store.getCell('photos', 'p1', 'r2Key')).toBe('u/user/car1/p1.webp'))

    expect(store.getCell('photos', 'p1', 'width')).toBe(1600)
    expect(localStore.hasRow(PHOTO_PAYLOADS_TABLE, 'p1')).toBe(false)
  })

  it('signed-in + offline: no network call, and the migration sentinel is cleared for retry', async () => {
    const { store, localStore } = makeStores()
    seedPhotoRow(store, localStore, 'car1', 'p1')
    localStore.setValue(PHOTOS_MIGRATED_VALUE, true)
    const { fetchImpl } = okFetch(UPLOAD_RESPONSE)
    const controller = createPhotoSyncController({ store, localStore, encode: fakeEncode, fetchImpl, isOnline: () => false })
    controller.setUser('user')

    controller.handleNewPhoto('car1', 'p1', DATA_URL, '')
    await new Promise((r) => setTimeout(r, 0))

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(localStore.getValue(PHOTOS_MIGRATED_VALUE)).toBeUndefined()
    expect(store.hasCell('photos', 'p1', 'r2Key')).toBe(false)
  })

  it('clears the sentinel when a signed-in upload fails', async () => {
    const { store, localStore } = makeStores()
    seedPhotoRow(store, localStore, 'car1', 'p1')
    localStore.setValue(PHOTOS_MIGRATED_VALUE, true)
    const failing = vi.fn<FetchLike>(async () => new Response('x', { status: 500 }))
    const controller = createPhotoSyncController({ store, localStore, encode: fakeEncode, fetchImpl: failing, isOnline: () => true })
    controller.setUser('user')

    controller.handleNewPhoto('car1', 'p1', DATA_URL, '')
    await vi.waitFor(() => expect(localStore.getValue(PHOTOS_MIGRATED_VALUE)).toBeUndefined())
    expect(store.hasCell('photos', 'p1', 'r2Key')).toBe(false)
  })
})

describe('createPhotoSyncController — delete + migrate', () => {
  it('handleDeletedPhotos POSTs the batched UPLOAD_DELETE_PATH contract only when signed-in + online', async () => {
    const { store, localStore } = makeStores()
    const { fetchImpl, calls } = okFetch({})
    const controller = createPhotoSyncController({ store, localStore, fetchImpl, isOnline: () => true })

    controller.handleDeletedPhotos(['u/user/car1/p1.webp']) // logged out → ignored
    expect(fetchImpl).not.toHaveBeenCalled()

    controller.setUser('user')
    controller.handleDeletedPhotos(['u/user/car1/p1.webp', 'u/user/car1/p2.jpg'])
    await new Promise((r) => setTimeout(r, 0))
    // ONE batched call to the real (shared-constant) endpoint — the original
    // client hit a nonexistent `DELETE /img/<key>` route, so every "deleted"
    // photo's bytes survived in R2. This pins the actual server contract.
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(UPLOAD_DELETE_PATH)
    expect(calls[0].init?.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      r2Keys: ['u/user/car1/p1.webp', 'u/user/car1/p2.jpg'],
    })
  })

  it('migrate is a no-op when logged out, sweeps + sets the sentinel when active', async () => {
    const { store, localStore } = makeStores()
    seedPhotoRow(store, localStore, 'car1', 'p1')
    const { fetchImpl } = okFetch(UPLOAD_RESPONSE)
    const controller = createPhotoSyncController({ store, localStore, encode: fakeEncode, fetchImpl, isOnline: () => true })

    await controller.migrate() // logged out → no-op
    expect(fetchImpl).not.toHaveBeenCalled()

    controller.setUser('user')
    await controller.migrate()
    expect(store.getCell('photos', 'p1', 'r2Key')).toBe('u/user/car1/p1.webp')
    expect(localStore.getValue(PHOTOS_MIGRATED_VALUE)).toBe(true)

    // Sentinel set → a second migrate uploads nothing more.
    fetchImpl.mockClear()
    await controller.migrate()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('deletePhotoObjects', () => {
  it('issues one same-origin JSON POST to UPLOAD_DELETE_PATH', async () => {
    const { fetchImpl, calls } = okFetch({})
    await deletePhotoObjects(['u/user/car1/p1.jpg'], fetchImpl)
    expect(calls[0].url).toBe(UPLOAD_DELETE_PATH)
    expect(calls[0].init?.method).toBe('POST')
    expect(calls[0].init?.credentials).toBe('same-origin')
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ r2Keys: ['u/user/car1/p1.jpg'] })
  })

  it('no-ops on an empty key list and throws on a non-2xx response', async () => {
    const { fetchImpl } = okFetch({})
    await deletePhotoObjects([], fetchImpl)
    expect(fetchImpl).not.toHaveBeenCalled()

    const failing = vi.fn<FetchLike>(async () => new Response('x', { status: 403 }))
    await expect(deletePhotoObjects(['u/other/car1/p1.jpg'], failing)).rejects.toThrow('403')
  })
})
