/**
 * The data-layer seam (M2): same default-export hook + selector/action
 * surface the components have always used, now backed by the shared TinyBase
 * MergeableStore instead of Zustand.
 *
 * - `useGarageStore(selector)` — selector-style hook, identical call sites.
 * - `useGarageStore.getState()` — non-hook state access (legacy parity).
 * - Persistence: the synced store goes to IndexedDB through a
 *   mergeable-content persister (stamps survive reloads — see
 *   idbMergeablePersister.ts); photo payloads + per-device sentinels live in
 *   a separate LOCAL-ONLY plain store with its own IndexedDB persister and
 *   never sync.
 * - First-run: the legacy Zustand blob (localforage 'garage-store') is
 *   imported once, sentinel-gated, chunked car-by-car; the blob is kept for
 *   rollback (see migrate.ts).
 * - Sync: `syncController` negotiates seed/merge/clear via chunked RPCs
 *   BEFORE attaching the WS synchronizer (see sync.ts).
 */
import { useSyncExternalStore } from 'react'
import localforage from 'localforage'
import { createGarageStore } from '@chudbox/shared'
import { createStore } from 'tinybase'
import { createIndexedDbPersister } from 'tinybase/persisters/persister-indexed-db'
import { createGarageAdapter } from './adapter'
import type { GarageState } from './adapter'
import { createIdbMergeablePersister } from './idbMergeablePersister'
import {
  LEGACY_BLOB_KEY,
  runFirstRunImport,
  runMileageBackfill,
  runUnitsBackfill,
} from './migrate'
import { applyBackupImport, buildBackupV2, parseBackup } from './backup'
import type { BackupV2, ParsedBackup } from './backup'
import { createSyncController } from './sync'
import type { SyncStatus } from './sync'
import { createPhotoSyncController } from './photoUpload'
import { createSavedBuildsController } from './savedBuilds'
import type { SavedBuild } from '@chudbox/shared'

export type { GarageState }
export type { ParsedBackup }

/** IndexedDB database names (new in M2; the legacy 'localforage' db is kept). */
const GARAGE_DB_NAME = 'chudbox-garage'
const LOCAL_DB_NAME = 'chudbox-local'

const store = createGarageStore()
const localStore = createStore()

/**
 * R2 photo side-effects (M3). The controller learns about the session through
 * SyncGate (photoSync.setUser) and gates every network call on signed-in +
 * online, so the logged-out app stays purely local. The adapter fires the
 * hooks but owns no upload logic.
 */
export const photoSync = createPhotoSyncController({ store, localStore })
const adapter = createGarageAdapter(store, localStore, {
  onPhotoAdded: photoSync.handleNewPhoto,
  onPhotosDeleted: photoSync.handleDeletedPhotos,
})

export const syncController = createSyncController({
  store,
  localStore,
  // Negotiation must never read a half-loaded store (see sync.ts).
  ready: () => initGarageStore(),
})

/**
 * DEC-11 follow/save controller — the durable Watching state + offline caches,
 * over the SAME two stores. It rides the existing local-first + CRDT-sync stack
 * (the `savedBuilds` table is in GARAGE_TABLE_IDS, so it seeds/merges to the DO
 * with the garage on sign-in) with zero new infra. TanStack Query owns ONLY the
 * network refetch lifecycle for the share/follow read surface — never this state.
 */
export const savedBuildsController = createSavedBuildsController({ store, localStore })

// ── Bootstrap (browser only; tests inject their own stores) ─
let initPromise: Promise<void> | null = null

/** Start persistence + the one-time legacy import. Idempotent. */
export function initGarageStore(): Promise<void> {
  initPromise ??= (async () => {
    if (typeof indexedDB === 'undefined') return
    // Side store first: the migration sentinels must be loaded before the
    // import decision; the main store before any import writes land.
    const sidePersister = createIndexedDbPersister(localStore, LOCAL_DB_NAME)
    await sidePersister.load()
    await sidePersister.startAutoSave()
    const mainPersister = createIdbMergeablePersister(store, GARAGE_DB_NAME)
    await mainPersister.load()
    await mainPersister.startAutoSave()
    await runFirstRunImport({
      store,
      localStore,
      readLegacyBlob: () => localforage.getItem<string>(LEGACY_BLOB_KEY),
    })
    runUnitsBackfill({ store, localStore })
    // DEC-16 (§15.8 Phase 2): seed the first mileage check-in per car. Runs in
    // the same pre-attach window as the import/units backfills (before the WS
    // synchronizer attaches) — and AFTER runUnitsBackfill so a freshly-tagged
    // cars.mileageMiles is preserved verbatim into the seeded check-in.
    runMileageBackfill({ store, localStore })
  })()
  return initPromise
}

// ── Hook (exact legacy call shape) ──────────────────────────
function useGarageStoreImpl<T>(selector: (state: GarageState) => T): T {
  return useSyncExternalStore(adapter.subscribe, () => selector(adapter.getState()))
}

const useGarageStore = Object.assign(useGarageStoreImpl, {
  getState: (): GarageState => adapter.getState(),
})

export default useGarageStore

// ── Sync status (Settings indicator + merge modal) ──────────
export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(syncController.subscribe, syncController.getStatus)
}

// ── Backup (Garage.tsx useBackup) ───────────────────────────
export function exportBackup(): BackupV2 {
  const state = adapter.getState()
  return buildBackupV2({
    cars: state.cars,
    themeId: state.themeId,
    customAccent: state.customAccent,
    currency: state.currency,
    distanceUnit: state.distanceUnit,
    // DEC-11: the Watching list is a top-level table (not inside any car), so
    // it must be carried explicitly or a backup round-trip erases it.
    savedBuilds: store.getTable('savedBuilds') as BackupV2['savedBuilds'],
  })
}

/** Parse an untrusted backup file's JSON (v1 or v2); null when invalid. */
export function parseBackupFile(data: unknown): ParsedBackup | null {
  return parseBackup(data)
}

/**
 * Replace the local garage with a backup (the confirmed import). Runs through
 * the sync controller so a live synchronizer is detached first and the cloud
 * copy is re-seeded afterwards (keep-local semantics).
 */
export function importBackup(backup: ParsedBackup): void {
  syncController.replaceLocalData(() => {
    applyBackupImport({ store, localStore, backup })
  })
}

// ── DEC-11 Watching (follow/save) hooks ─────────────────────
/** The whole Watching list (joined + sorted). Reactive via TinyBase listeners. */
export function useSavedBuilds(): SavedBuild[] {
  return useSyncExternalStore(savedBuildsController.subscribe, savedBuildsController.list)
}

/** The SavedBuild for a token (or null), for the share-view Save toggle. */
export function useSavedBuild(token: string | undefined): SavedBuild | null {
  return useSyncExternalStore(savedBuildsController.subscribe, () =>
    token ? savedBuildsController.getByToken(token) : null,
  )
}
