// Snapshot persister + legacy-storage migration, exercised against REAL
// GarageDO storage (vitest-pool-workers). The load-bearing claims: (1) a
// snapshot round-trip preserves every stamp and hash WITHOUT resurrecting
// tombstones as live null cells (the fragmented persister's documented
// artifact), and (2) migrateFragmentedStorage carries legacy fragmented
// storage into a snapshot byte-faithfully, reverses the artifact for data
// that already passed through a legacy load, and is idempotent.
import { env, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { createMergeableStore } from 'tinybase'
import { createDurableObjectSqlStoragePersister } from 'tinybase/persisters/persister-durable-object-sql-storage'
import {
  SNAPSHOT_KEY,
  createSnapshotPersister,
  migrateFragmentedStorage,
} from '../src/durable/snapshotPersister'

const LEGACY_TABLES_SQL =
  "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('tinybase_tables', 'tinybase_values')"

function withGarageStorage<R>(
  name: string,
  test: (storage: DurableObjectStorage) => Promise<R>,
): Promise<R> {
  const stub = env.GARAGE_DO.get(env.GARAGE_DO.idFromName(name))
  return runInDurableObject(stub, (_instance, state) => test(state.storage))
}

describe('createSnapshotPersister', () => {
  it('round-trips data, stamps, and hashes without resurrecting tombstones', async () => {
    await withGarageStorage('round-trip', async (storage) => {
      const src = createMergeableStore()
      src.setCell('cars', 'car-1', 'make', 'Honda')
      src.setCell('cars', 'car-1', 'model', 'Civic')
      src.setValue('themeId', 'garage')
      src.setValue('distanceUnit', 'km')
      // Tombstone one cell and one value — the JSON-hostile stamps.
      src.delCell('cars', 'car-1', 'model')
      src.delValue('distanceUnit')

      const srcPersister = createSnapshotPersister(src, storage)
      await srcPersister.save()
      await srcPersister.destroy()
      expect(await storage.get(SNAPSHOT_KEY)).toBeDefined()

      const dst = createMergeableStore()
      const dstPersister = createSnapshotPersister(dst, storage)
      await dstPersister.load()
      await dstPersister.destroy()

      // Raw store: tombstoned cell/value absent, NOT live nulls.
      expect(dst.getRow('cars', 'car-1')).toStrictEqual({ make: 'Honda' })
      expect(dst.getValues()).toStrictEqual({ themeId: 'garage' })

      // Stamp map: tombstones present with undefined payloads and their
      // original hlc/hash intact.
      const content = dst.getMergeableContent()
      const modelStamp = content[0][0]['cars']![0]['car-1']![0]['model']!
      const srcModelStamp = src.getMergeableContent()[0][0]['cars']![0]['car-1']![0]['model']!
      expect(modelStamp[0]).toBeUndefined()
      expect(modelStamp[1]).toBe(srcModelStamp[1])
      expect(modelStamp[2]).toBe(srcModelStamp[2])
      const unitStamp = content[1][0]['distanceUnit']!
      expect(unitStamp[0]).toBeUndefined()

      // Whole-store hash equality = byte-faithful CRDT state.
      expect(dst.getMergeableContentHashes()).toStrictEqual(src.getMergeableContentHashes())
    })
  })
})

describe('migrateFragmentedStorage', () => {
  it('is a no-op without legacy tables', async () => {
    await withGarageStorage('fresh', async (storage) => {
      // The GarageDO instance already constructed on this fresh storage, and
      // startAutoSave()'s initial save writes an (empty) snapshot — capture
      // whatever exists and assert the migration touches none of it.
      const before = await storage.get<Uint8Array>(SNAPSHOT_KEY)
      await migrateFragmentedStorage(storage)
      expect(await storage.get<Uint8Array>(SNAPSHOT_KEY)).toStrictEqual(before)
      expect(storage.sql.exec(LEGACY_TABLES_SQL).toArray()).toHaveLength(0)
    })
  })

  it('carries legacy fragmented storage into a snapshot and drops the tables', async () => {
    await withGarageStorage('migrate', async (storage) => {
      // Build real legacy storage: a garage with a tombstoned cell, saved
      // through the actual fragmented persister.
      const legacySrc = createMergeableStore()
      legacySrc.setCell('cars', 'car-1', 'make', 'Honda')
      legacySrc.setCell('cars', 'car-1', 'trim', 'Type R')
      legacySrc.setValue('themeId', 'garage')
      legacySrc.delCell('cars', 'car-1', 'trim')
      const legacyPersister = createDurableObjectSqlStoragePersister(legacySrc, storage.sql, {
        mode: 'fragmented',
      })
      await legacyPersister.save()
      await legacyPersister.destroy()
      expect(storage.sql.exec(LEGACY_TABLES_SQL).toArray()).toHaveLength(2)
      // Simulate a real legacy DO: no snapshot exists there (the legacy code
      // never wrote one, and in production the migration runs before the
      // persister is ever created). This test's DO instance constructed on
      // fresh storage first, so its initial autosave wrote an empty snapshot
      // — remove it to model the true pre-migration state.
      await storage.delete(SNAPSHOT_KEY)

      await migrateFragmentedStorage(storage)

      expect(await storage.get(SNAPSHOT_KEY)).toBeDefined()
      expect(storage.sql.exec(LEGACY_TABLES_SQL).toArray()).toHaveLength(0)

      const dst = createMergeableStore()
      const dstPersister = createSnapshotPersister(dst, storage)
      await dstPersister.load()
      await dstPersister.destroy()

      // Data intact; the legacy load's null-resurrection reversed.
      expect(dst.getRow('cars', 'car-1')).toStrictEqual({ make: 'Honda' })
      expect(dst.getValues()).toStrictEqual({ themeId: 'garage' })
      const trimStamp = dst.getMergeableContent()[0][0]['cars']![0]['car-1']![0]['trim']!
      expect(trimStamp[0]).toBeUndefined()

      // Every stamp and hash survived the format change.
      expect(dst.getMergeableContentHashes()).toStrictEqual(legacySrc.getMergeableContentHashes())
    })
  })

  it('is idempotent, and never overwrites an existing snapshot', async () => {
    await withGarageStorage('idempotent', async (storage) => {
      // Existing snapshot (the post-migration state of some garage).
      const src = createMergeableStore()
      src.setCell('cars', 'car-1', 'make', 'Mazda')
      const persister = createSnapshotPersister(src, storage)
      await persister.save()
      await persister.destroy()
      const snapshotBefore = await storage.get<Uint8Array>(SNAPSHOT_KEY)

      // Leftover legacy tables (e.g. a crash after the snapshot write but
      // before the drop): constructing the legacy persister creates them.
      const leftover = createDurableObjectSqlStoragePersister(
        createMergeableStore(),
        storage.sql,
        { mode: 'fragmented' },
      )
      await leftover.save()
      await leftover.destroy()
      expect(storage.sql.exec(LEGACY_TABLES_SQL).toArray()).toHaveLength(2)

      await migrateFragmentedStorage(storage)
      expect(storage.sql.exec(LEGACY_TABLES_SQL).toArray()).toHaveLength(0)
      // Snapshot untouched — the migration only builds one when absent.
      expect(await storage.get<Uint8Array>(SNAPSHOT_KEY)).toStrictEqual(snapshotBefore)

      // Second run: pure no-op.
      await migrateFragmentedStorage(storage)
      expect(await storage.get<Uint8Array>(SNAPSHOT_KEY)).toStrictEqual(snapshotBefore)
    })
  })
})
