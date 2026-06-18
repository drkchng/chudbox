// createGarageStore(): the schema-applied MergeableStore every platform
// shares. Persisters and synchronizers are injected per platform by callers —
// web: persister-indexed-db + synchronizer-ws-client; Durable Object:
// persister-durable-object-sql-storage in FRAGMENTED mode; RN (M5):
// persister-expo-sqlite. Nothing platform-specific may live here (RN-safe).
import { createIndexes, createMergeableStore } from 'tinybase'
import type { Id, Indexes, MergeableStore, Store } from 'tinybase'
import { CHILD_TABLE_IDS, GARAGE_TABLES_SCHEMA, GARAGE_VALUES_SCHEMA } from './schema'
import type { ChildTableId } from './schema'

/**
 * Create the shared garage MergeableStore with the source-of-truth schema
 * applied. `uniqueId` seeds the store's HLC client id — pass a stable id per
 * device/DO when you need deterministic provenance; omit for a random one.
 *
 * PERSISTENCE + SYNC ARE CALLER-INJECTED. This function wires NEITHER a
 * persister NOR a synchronizer — both are platform-specific and imported by the
 * consumer, so nothing here breaks RN/Metro (see docs/MOBILE.md). Each platform
 * attaches its own after creation:
 *
 * @example
 * // Web (apps/web): IndexedDB persistence + WebSocket sync.
 * import { createIndexedDbPersister } from 'tinybase/persisters/persister-indexed-db'
 * import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client'
 * const store = createGarageStore()
 * await createIndexedDbPersister(store, 'chudbox').startAutoLoad()
 * await createWsSynchronizer(store, new WebSocket(SYNC_URL)).startSync()
 *
 * @example
 * // React Native / Expo (future apps/mobile): expo-sqlite persistence + the
 * // SAME ws synchronizer. @chudbox/shared imports none of these — the RN app
 * // owns them, so this core stays platform-agnostic.
 * import { createExpoSqlitePersister } from 'tinybase/persisters/persister-expo-sqlite'
 * import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client'
 * import * as SQLite from 'expo-sqlite'
 * const store = createGarageStore()
 * await createExpoSqlitePersister(store, SQLite.openDatabaseSync('chudbox.db')).startAutoLoad()
 * await createWsSynchronizer(store, new WebSocket(SYNC_URL)).startSync()
 */
export function createGarageStore(uniqueId?: Id): MergeableStore {
  return createMergeableStore(uniqueId)
    .setTablesSchema(GARAGE_TABLES_SCHEMA)
    .setValuesSchema(GARAGE_VALUES_SCHEMA)
}

/** Index id for a child table's carId index (e.g. 'photosByCarId'). */
export function carIdIndexId(childTableId: ChildTableId): string {
  return `${childTableId}ByCarId`
}

/**
 * Client-only index id (DEC-6 §15.2): photos keyed by their `sourceId`, so the
 * inline per-item gallery slice + count badge are O(1)
 * (`getSliceRowIds(PHOTOS_BY_SOURCE_ID, modId)`). General photos carry no
 * `sourceId` and fall into the empty-string slice — never queried by a real
 * item id. The DO builds no indexes (its one-shot snapshot reads scan); this is
 * a CLIENT read-model index only, adding one entry per photo that HAS a
 * sourceId (General photos cost nothing).
 */
export const PHOTOS_BY_SOURCE_ID = 'photosBySourceId'

/** Apply the DEC-6 photosBySourceId index to an existing Indexes object. */
export function definePhotoSourceIndex(indexes: Indexes): Indexes {
  indexes.setIndexDefinition(PHOTOS_BY_SOURCE_ID, 'photos', 'sourceId')
  return indexes
}

/**
 * Apply the plan's carId Index definitions (one per child table) to an
 * existing Indexes object, so getCarSnapshot(carId) / the useCar(id) join are
 * O(rows-for-this-car), not O(whole garage). Callers that build Indexes
 * themselves (e.g. ui-react's useCreateIndexes) apply this; others can use
 * createGarageIndexes.
 */
export function defineCarIdIndexes(indexes: Indexes): Indexes {
  for (const tableId of CHILD_TABLE_IDS) {
    indexes.setIndexDefinition(carIdIndexId(tableId), tableId, 'carId')
  }
  return indexes
}

/** Convenience: create an Indexes object on `store` with the carId indexes AND
 * the DEC-6 photosBySourceId index defined. */
export function createGarageIndexes(store: Store): Indexes {
  return definePhotoSourceIndex(defineCarIdIndexes(createIndexes(store)))
}
