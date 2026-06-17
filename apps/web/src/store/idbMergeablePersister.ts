/**
 * IndexedDB persister for the synced MergeableStore — custom, because the
 * stock `tinybase/persisters/persister-indexed-db` is Persists.StoreOnly
 * (verified against the installed 8.4.2 d.ts: "An IndexedDbPersister only
 * supports regular Store objects, and cannot be used to persist the metadata
 * of a MergeableStore", and its source passes persist mode `1`).
 *
 * Why that matters here (#268): a StoreOnly persister would save/load only
 * the PLAIN content of the MergeableStore. Every page reload would then
 * `setContent(...)` the data back in, minting FRESH per-cell HLC stamps — so
 * the first attach after every reload would see the whole store as divergent
 * and push it to the Durable Object as one giant `applyMergeableChanges`
 * (one transaction → one un-chunkable fragmented save). That is exactly the
 * TinyBase #268 bulk write the whole M2 design exists to prevent.
 *
 * This persister instead stores the full MERGEABLE content (stamps + hashes,
 * via the persister core's mergeable `getContent`) as one structured-clone
 * value in IndexedDB. Structured clone preserves `undefined` tombstone slots
 * inside stamp arrays, which JSON would destroy. On load, the persister core
 * routes a content-shaped (non-changes) array to `setMergeableContent`,
 * which adopts the persisted stamps verbatim — so stamps survive reloads and
 * attach only ever exchanges genuine deltas.
 *
 * No autoLoad polling is implemented (addPersisterListener is a no-op):
 * IndexedDB has no change events, the legacy Zustand store never polled
 * either, and re-running `setMergeableContent` once per second would reset
 * the store's stamp map needlessly. `startAutoLoad` therefore degrades to a
 * one-shot load.
 */
import { createCustomPersister } from 'tinybase/persisters'
import type { Persister, Persists } from 'tinybase/persisters'
import type { MergeableContent, MergeableStore } from 'tinybase'

const OBJECT_STORE = 'm'
const CONTENT_KEY = 'content'

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function openDatabase(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(OBJECT_STORE)) {
        request.result.createObjectStore(OBJECT_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('indexedDB.open failed'))
  })
}

export function createIdbMergeablePersister(
  store: MergeableStore,
  dbName: string,
  onIgnoredError?: (error: unknown) => void,
): Persister<Persists.MergeableStoreOnly> {
  const getPersisted = async (): Promise<MergeableContent | undefined> => {
    const db = await openDatabase(dbName)
    try {
      const stored = await requestToPromise(
        db.transaction(OBJECT_STORE, 'readonly').objectStore(OBJECT_STORE).get(CONTENT_KEY),
      )
      return stored as MergeableContent | undefined
    } finally {
      db.close()
    }
  }

  const setPersisted = async (getContent: () => MergeableContent): Promise<void> => {
    const db = await openDatabase(dbName)
    try {
      await requestToPromise(
        db
          .transaction(OBJECT_STORE, 'readwrite')
          .objectStore(OBJECT_STORE)
          .put(getContent(), CONTENT_KEY),
      )
    } finally {
      db.close()
    }
  }

  return createCustomPersister(
    store,
    getPersisted,
    setPersisted,
    // No reactive IndexedDB change events exist; see module docblock.
    () => 0,
    () => undefined,
    onIgnoredError,
    2 as Persists.MergeableStoreOnly,
  )
}
