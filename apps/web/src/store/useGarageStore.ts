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
import { LEGACY_BLOB_KEY, runFirstRunImport, runUnitsBackfill } from './migrate'
import { applyBackupImport, buildBackupV2, parseBackup } from './backup'
import type { BackupV2, ParsedBackup } from './backup'
import { createSyncController } from './sync'
import type { SyncStatus } from './sync'

export type { GarageState }
export type { ParsedBackup }

/** IndexedDB database names (new in M2; the legacy 'localforage' db is kept). */
const GARAGE_DB_NAME = 'chudbox-garage'
const LOCAL_DB_NAME = 'chudbox-local'

const store = createGarageStore()
const localStore = createStore()
const adapter = createGarageAdapter(store, localStore)

export const syncController = createSyncController({
  store,
  localStore,
  // Negotiation must never read a half-loaded store (see sync.ts).
  ready: () => initGarageStore(),
})

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
