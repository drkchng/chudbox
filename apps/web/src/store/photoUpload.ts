/**
 * Photo upload wiring (M3, client side). Bytes are uploaded SAME-ORIGIN and
 * proxied through the Worker's R2 binding (multipart POST to UPLOAD_PATH) — no
 * presigned PUT, no S3 token, no bucket CORS (the few-hundred-KB downscaled
 * files sit far under the 100 MB body cap). The server derives the r2Key prefix
 * from the validated session, so the client never trusts/sends a key.
 *
 * createPhotoSyncController is the single integration point the rest of the app
 * talks to:
 * - `setUser(userId | null)` — driven by the auth session (SyncGate), exactly
 *   like syncController.start/stop. userId === null ⇒ logged-out ⇒ the upload
 *   paths are pure no-ops and make NO network call (logged-out behavior stays
 *   byte-identical to today: photos remain local base64).
 * - `handleNewPhoto` — the adapter's addPhoto fires this AFTER the optimistic
 *   local write, so a freshly added photo shows instantly as base64 and is
 *   swapped to its r2Key in the background when signed-in + online. Offline or
 *   on failure it stays base64 and the migration sentinel is cleared so the
 *   next online sweep retries it.
 * - `handleDeletedPhotos` — best-effort R2 delete-on-delete (swallowed when
 *   offline/logged-out); the synced row tombstone already removed the metadata.
 * - `migrate` — the post-sign-in backlog sweep (see migratePhotos.ts), gated by
 *   the local-only PHOTOS_MIGRATED_VALUE sentinel and an in-flight guard.
 *
 * The encoder and fetch are injectable so the HTTP shape + auth/online gating
 * are unit-testable without a DOM or a network.
 */
import {
  FREE_IMAGE_POLICY,
  UPLOAD_DELETE_PATH,
  UPLOAD_FILE_FIELD,
  UPLOAD_PATH,
  extForContentType,
  parsePhotoKey,
} from '@chudbox/shared'
import type { DeleteUploadsRequest, ImagePolicy, UploadResponse } from '@chudbox/shared'
import type { MergeableStore, Store } from 'tinybase'
import { PHOTOS_MIGRATED_VALUE } from './adapter'
import { applyPhotoUpload, migratePhotosToR2 } from './migratePhotos'
import { encodeForUpload } from '../utils/image'
import type { EncodeResult } from '../utils/image'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>
type EncodeLike = (source: Blob, policy: ImagePolicy) => Promise<EncodeResult>

/** Decode a base64 (or percent-encoded) data URL into a Blob for re-encoding. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',')
  if (!dataUrl.startsWith('data:') || comma === -1) throw new Error('invalid data URL')
  const header = dataUrl.slice('data:'.length, comma)
  const isBase64 = /;base64$/i.test(header)
  const mime = header.replace(/;base64$/i, '') || 'application/octet-stream'
  const payload = dataUrl.slice(comma + 1)
  if (isBase64) {
    const binary = atob(payload)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return new Blob([bytes], { type: mime })
  }
  return new Blob([decodeURIComponent(payload)], { type: mime })
}

export interface UploadDeps {
  encode?: EncodeLike
  fetchImpl?: FetchLike
  policy?: ImagePolicy
}

/**
 * Encode + multipart-POST one photo. Resolves with the cells to write
 * (server-authoritative r2Key/width/height/contentType); throws on any
 * non-2xx or transport failure (the caller keeps the local base64 for retry).
 */
export async function uploadEncodedPhoto(
  input: { carId: string; photoId: string; dataUrl: string; caption: string },
  deps: UploadDeps = {},
): Promise<UploadResponse> {
  const encode = deps.encode ?? encodeForUpload
  const fetchImpl = deps.fetchImpl ?? fetch
  const policy = deps.policy ?? FREE_IMAGE_POLICY

  const { blob, contentType, width, height } = await encode(dataUrlToBlob(input.dataUrl), policy)
  const form = new FormData()
  form.append(UPLOAD_FILE_FIELD, blob, `${input.photoId}.${extForContentType(contentType)}`)
  form.append('carId', input.carId)
  form.append('photoId', input.photoId)
  form.append('width', String(width))
  form.append('height', String(height))
  if (input.caption) form.append('caption', input.caption)

  // No content-type header: the browser sets the multipart boundary itself.
  const response = await fetchImpl(UPLOAD_PATH, {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
  })
  if (!response.ok) throw new Error(`upload failed with status ${response.status}`)
  return (await response.json()) as UploadResponse
}

/**
 * Best-effort delete of uploaded objects' bytes (delete-on-delete; the row
 * tombstone already propagated the metadata removal). ONE batched JSON POST to
 * the shared UPLOAD_DELETE_PATH contract — the server authorizes every key
 * against the session prefix and batch-deletes (max 1000 keys per call, far
 * above any single deletePhoto/deleteCar). NOTE: the original client shipped
 * calling `DELETE /img/<key>`, a route that never existed (GET-only), so no
 * delete ever landed — this function must always target the shared constant.
 * Throws on non-2xx so the caller can decide whether to swallow.
 */
export async function deletePhotoObjects(
  r2Keys: string[],
  fetchImpl: FetchLike = fetch,
): Promise<void> {
  if (r2Keys.length === 0) return
  const body: DeleteUploadsRequest = { r2Keys }
  const response = await fetchImpl(UPLOAD_DELETE_PATH, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`delete failed with status ${response.status}`)
}

export interface PhotoSyncDeps {
  store: MergeableStore
  localStore: Store
  encode?: EncodeLike
  fetchImpl?: FetchLike
  policy?: ImagePolicy
  /** Online probe (default: navigator.onLine, true when navigator is absent). */
  isOnline?: () => boolean
}

export interface PhotoSyncController {
  setUser: (userId: string | null) => void
  /** Fired by the adapter after addPhoto's optimistic local write. */
  handleNewPhoto: (carId: string, photoId: string, dataUrl: string, caption: string) => void
  /** Fired by the adapter on deletePhoto/deleteCar with the affected keys. */
  handleDeletedPhotos: (r2Keys: string[]) => void
  /** Post-sign-in backlog sweep (idempotent, sentinel-gated, non-blocking). */
  migrate: () => Promise<void>
}

export function createPhotoSyncController(deps: PhotoSyncDeps): PhotoSyncController {
  const { store, localStore } = deps
  const fetchImpl = deps.fetchImpl ?? fetch
  const isOnline =
    deps.isOnline ?? (() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const uploadDeps: UploadDeps = { encode: deps.encode, fetchImpl: deps.fetchImpl, policy: deps.policy }

  let userId: string | null = null
  let migrating = false

  const uploadOne = (carId: string, photoId: string, dataUrl: string, caption: string) =>
    uploadEncodedPhoto({ carId, photoId, dataUrl, caption }, uploadDeps)

  /** Flag a backlog so the next online sweep retries (a deferred/failed upload). */
  const markBacklog = (): void => {
    if (localStore.getValue(PHOTOS_MIGRATED_VALUE) === true) {
      localStore.delValue(PHOTOS_MIGRATED_VALUE)
    }
  }

  const handleNewPhoto = (
    carId: string,
    photoId: string,
    dataUrl: string,
    caption: string,
  ): void => {
    if (userId === null) return // logged out: pure local, no network
    if (!isOnline()) {
      markBacklog() // signed-in but offline: retry on reconnect
      return
    }
    void (async () => {
      try {
        const result = await uploadOne(carId, photoId, dataUrl, caption)
        applyPhotoUpload(store, localStore, carId, photoId, result)
      } catch {
        markBacklog()
      }
    })()
  }

  const handleDeletedPhotos = (r2Keys: string[]): void => {
    if (userId === null || !isOnline()) return
    // Only THIS session's keys: the server 403s the whole batch if any key
    // falls outside `u/<userId>/`, so one foreign key (possible after a
    // cross-account backup restore) must not block deleting our own objects.
    const currentUserId = userId
    const own = r2Keys.filter((key) => parsePhotoKey(key)?.userId === currentUserId)
    // Best-effort: a failed delete (offline blip, 5xx) is swallowed — the row
    // tombstone already removed the metadata; the bytes become a server-side
    // orphan awaiting the deferred reconciliation sweep (uploads.ts docblock).
    void deletePhotoObjects(own, fetchImpl).catch(() => {})
  }

  const migrate = async (): Promise<void> => {
    if (userId === null || !isOnline() || migrating) return
    if (localStore.getValue(PHOTOS_MIGRATED_VALUE) === true) return
    migrating = true
    try {
      const result = await migratePhotosToR2({ store, localStore, uploadOne })
      if (result.remaining === 0 && result.failed === 0) {
        localStore.setValue(PHOTOS_MIGRATED_VALUE, true)
      }
    } finally {
      migrating = false
    }
  }

  // Auto-retry the backlog when connectivity returns (browser only).
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('online', () => {
      void migrate()
    })
  }

  return {
    setUser: (id) => {
      userId = id
    },
    handleNewPhoto,
    handleDeletedPhotos,
    migrate,
  }
}
