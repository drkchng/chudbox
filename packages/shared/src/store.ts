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

/** Convenience: create an Indexes object on `store` with all carId indexes defined. */
export function createGarageIndexes(store: Store): Indexes {
  return defineCarIdIndexes(createIndexes(store))
}
