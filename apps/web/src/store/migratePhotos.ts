/**
 * base64 → R2 photo migration (M3). When a device is signed-in + online, the
 * photos added before sign-in (or while offline) still live as local base64 in
 * the side store with no `r2Key`. This sweep uploads each one through the same
 * upload primitive the live add-path uses, writes `r2Key`/`width`/`height` onto
 * the synced photos row, and drops the local payload — ONLY after the upload
 * succeeds.
 *
 * Properties (BACKEND_PLAN.md M3 row, Risk #8):
 * - Idempotent: only photos with NO r2Key AND a present side-store payload are
 *   eligible, so a second run after a complete sweep is a no-op.
 * - Partial-progress-safe: each photo is committed independently; a failure
 *   (offline mid-sweep, a 5xx) is counted and the already-migrated photos stay
 *   migrated. The post-sweep `remaining`/`failed` counts let the controller
 *   decide whether to mark the migration sentinel done.
 * - Non-blocking: a pure async function over injected stores + uploader, so the
 *   controller can fire it without awaiting and it is unit-testable without a
 *   network or IndexedDB.
 *
 * applyPhotoUpload is the single store-write seam shared by this sweep and the
 * live add-path: strict-null cell writes on the photos row, then the local
 * payload is removed so the read path resolves the photo from r2Key (→ /img).
 */
import type { UploadResponse } from '@chudbox/shared'
import type { MergeableStore, Store } from 'tinybase'
import { PHOTO_PAYLOADS_TABLE } from './adapter'

/**
 * Write an upload's result onto the synced photos row and drop the local
 * base64 payload. Guarded: if the row was deleted or re-parented mid-upload
 * (user deleted the photo/car), the result is discarded — never resurrect a
 * tombstoned row. Strict-null rule: r2Key/width/height are concrete values
 * from the server response, written explicitly.
 */
export function applyPhotoUpload(
  store: MergeableStore,
  localStore: Store,
  carId: string,
  photoId: string,
  result: UploadResponse,
): void {
  if (!store.hasRow('photos', photoId)) return
  if (store.getCell('photos', photoId, 'carId') !== carId) return
  store.transaction(() => {
    store.setCell('photos', photoId, 'r2Key', result.r2Key)
    store.setCell('photos', photoId, 'width', result.width)
    store.setCell('photos', photoId, 'height', result.height)
  })
  // The bytes now live in R2; the local payload is no longer the source.
  localStore.delRow(PHOTO_PAYLOADS_TABLE, photoId)
}

/** Uploads one photo's bytes; resolves with the row cells to write, or throws. */
export type UploadOnePhoto = (
  carId: string,
  photoId: string,
  dataUrl: string,
  caption: string,
) => Promise<UploadResponse>

export interface MigratePhotosDeps {
  store: MergeableStore
  localStore: Store
  uploadOne: UploadOnePhoto
}

export interface MigratePhotosResult {
  /** Photos uploaded + committed this sweep. */
  migrated: number
  /** Photos whose upload threw (kept as local base64 for a later retry). */
  failed: number
  /** Eligible (no r2Key, payload present) photos still un-migrated afterward. */
  remaining: number
}

interface Eligible {
  photoId: string
  carId: string
  dataUrl: string
  caption: string
}

function collectEligible(store: MergeableStore, localStore: Store): Eligible[] {
  const out: Eligible[] = []
  for (const photoId of store.getRowIds('photos')) {
    if (store.hasCell('photos', photoId, 'r2Key')) continue
    const dataUrl = localStore.getCell(PHOTO_PAYLOADS_TABLE, photoId, 'dataUrl') as
      | string
      | undefined
    if (!dataUrl) continue
    const carId = store.getCell('photos', photoId, 'carId') as string | undefined
    if (carId === undefined) continue
    const caption = (store.getCell('photos', photoId, 'caption') as string | undefined) ?? ''
    out.push({ photoId, carId, dataUrl, caption })
  }
  return out
}

/**
 * Sweep every eligible local-base64 photo up to R2. Returns counts so the
 * caller can mark the migration complete only when nothing is left and nothing
 * failed.
 */
export async function migratePhotosToR2(deps: MigratePhotosDeps): Promise<MigratePhotosResult> {
  const { store, localStore, uploadOne } = deps
  let migrated = 0
  let failed = 0
  for (const item of collectEligible(store, localStore)) {
    // Re-check: the row may have been deleted or already migrated since the scan.
    if (!store.hasRow('photos', item.photoId)) continue
    if (store.hasCell('photos', item.photoId, 'r2Key')) continue
    try {
      const result = await uploadOne(item.carId, item.photoId, item.dataUrl, item.caption)
      applyPhotoUpload(store, localStore, item.carId, item.photoId, result)
      migrated += 1
    } catch {
      failed += 1
    }
  }
  return { migrated, failed, remaining: collectEligible(store, localStore).length }
}
