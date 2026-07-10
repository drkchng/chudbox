/**
 * Snapshot persister for the GarageDO — the whole MergeableStore (data +
 * stamps + hashes) as ONE gzipped JSON blob in the DO's key-value storage.
 * The server-side twin of the client's idbMergeablePersister, which has
 * always persisted the same way (one structured-clone value per store).
 *
 * Why a single blob: the DO never queries SQL — it hydrates fully into
 * memory on wake and serves every read from the store, so persistence is a
 * document workload. Cloudflare bills DO storage per SQLite row touched
 * (indexes and REPLACE conflicts included), which made the per-cell
 * fragmented layout cost ~27 billed rows per transaction; its stamp rows
 * also carried NULLs inside the composite PK (NULL never conflicts in
 * SQLite uniqueness), so every save APPENDED bookkeeping rows and wake-time
 * `SELECT *` hydration grew with lifetime transaction count. One KV put
 * bills O(1) rows regardless of garage size, and one KV get hydrates.
 *
 * Why gzip: the KV API caps key+value at 2 MB (SQLite-backed classes). A
 * realistic garage is ~250 KB of mergeable JSON and gzips 5-10x, so the
 * ceiling sits ~40x out. Saves warn at 1.5 MB compressed so growth is
 * visible long before a put could fail; a failed save routes through the
 * persister core's onIgnoredError and the in-memory store stays correct
 * (clients are local-first and re-converge on the next attach handshake).
 *
 * Tombstone fidelity: a deleted cell/value is the stamp [undefined, hlc,
 * hash], and JSON has no undefined — a naive round-trip would load it as a
 * LIVE null cell (the resurrection artifact the fragmented persister
 * suffered). No garage cell or value may legitimately be null (the client
 * adapter omits null/undefined cells; settings Values are typed strings),
 * so a null in a stamp's value slot can only encode a tombstone:
 * reviveTombstones() restores those slots to undefined on every load. Stamp
 * hashes are unaffected — TinyBase hashes `value ?? null`, identical both
 * ways.
 *
 * Durability: the persister core's autosave still runs once per store
 * transaction, serialized on the persister's queue; each save serializes the
 * full store (a snapshot has no meaningful delta form) for 1-2 billed rows.
 * The save awaits a CompressionStream, so a crash inside that brief window
 * can lose the tail transaction server-side — the local-first client retains
 * it and the next attach re-exchanges it.
 */
import { createMergeableStore } from 'tinybase'
import type { MergeableContent, MergeableStore } from 'tinybase'
import { createCustomPersister } from 'tinybase/persisters'
import type { Persister, Persists } from 'tinybase/persisters'
import { createDurableObjectSqlStoragePersister } from 'tinybase/persisters/persister-durable-object-sql-storage'

export const SNAPSHOT_KEY = 'snap'

/** Compressed-size warning threshold — 75% of the 2 MB KV value cap. */
const SIZE_WARN_BYTES = 1_500_000

/** Legacy fragmented-persister tables (default, unprefixed names). */
const LEGACY_TABLES = ['tinybase_tables', 'tinybase_values'] as const

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).text()
}

/** Loose structural view of MergeableContent for the in-place revive walk. */
type Stamp = [unknown, string, number]
type StampMap = [Record<string, Stamp>, string, number]
type LooseContent = [
  [Record<string, [Record<string, [Record<string, Stamp>, string, number]>, string, number]>, string, number],
  StampMap,
]

/**
 * Restore JSON-mangled tombstones: any cell/value stamp whose value slot is
 * null becomes [undefined, hlc, hash] again (see module docblock for why
 * null is unambiguous here). Mutates and returns `content`.
 */
export function reviveTombstones(content: MergeableContent): MergeableContent {
  const [[tables], [values]] = content as unknown as LooseContent
  for (const [rows] of Object.values(tables)) {
    for (const [cells] of Object.values(rows)) {
      for (const stamp of Object.values(cells)) {
        if (stamp[0] === null) stamp[0] = undefined
      }
    }
  }
  for (const stamp of Object.values(values)) {
    if (stamp[0] === null) stamp[0] = undefined
  }
  return content
}

/**
 * Read + revive the persisted snapshot (undefined when none exists).
 *
 * A blob that fails to decode is quarantined, not lost: the persister core
 * swallows load errors and hydrates an empty store, whose unconditional
 * initial autosave would then OVERWRITE the still-recoverable bytes. Moving
 * the corrupt blob to a side key first keeps it inspectable while the store
 * heals from the local-first clients on their next attach.
 */
export async function loadSnapshotContent(
  storage: DurableObjectStorage,
): Promise<MergeableContent | undefined> {
  const bytes = await storage.get<Uint8Array>(SNAPSHOT_KEY)
  if (bytes === undefined) return undefined
  try {
    return reviveTombstones(JSON.parse(await gunzip(bytes)) as MergeableContent)
  } catch (error) {
    console.error('garage snapshot failed to decode — quarantining blob:', error)
    await storage.put(`${SNAPSHOT_KEY}:corrupt`, bytes)
    return undefined
  }
}

export function createSnapshotPersister(
  store: MergeableStore,
  storage: DurableObjectStorage,
  onIgnoredError?: (error: unknown) => void,
): Persister<Persists.MergeableStoreOnly> {
  const getPersisted = (): Promise<MergeableContent | undefined> => loadSnapshotContent(storage)

  const setPersisted = async (getContent: () => MergeableContent): Promise<void> => {
    // Full store every save, ignoring any per-transaction changes argument —
    // a snapshot has no delta form, and the put is O(1) rows either way.
    const bytes = await gzip(JSON.stringify(getContent()))
    if (bytes.byteLength > SIZE_WARN_BYTES) {
      console.warn(
        `garage snapshot is ${bytes.byteLength} bytes compressed — approaching the 2 MB KV value cap`,
      )
    }
    await storage.put(SNAPSHOT_KEY, bytes)
  }

  return createCustomPersister(
    store,
    getPersisted,
    setPersisted,
    // DO storage has no external change events — nothing to auto-load from.
    () => 0,
    () => undefined,
    onIgnoredError,
    2 as Persists.MergeableStoreOnly,
  )
}

/**
 * One-time, self-executing, idempotent migration from the legacy fragmented
 * SQLite layout. Runs on every wake before the persister is created:
 * - No legacy tables → nothing to do (fresh user, or already migrated).
 * - Legacy tables + no snapshot → hydrate a throwaway store through the
 *   legacy persister (preserving every stamp byte), revive the tombstones
 *   its load resurrects as live null cells, write the snapshot, then drop
 *   the legacy tables.
 * - Legacy tables + snapshot (a prior run dropped nothing after a failure
 *   mid-drop) → just drop the tables.
 * The snapshot is written BEFORE the drops, so a crash between the two
 * leaves a correct snapshot and re-droppable tables, never data loss.
 */
export async function migrateFragmentedStorage(storage: DurableObjectStorage): Promise<void> {
  const names = LEGACY_TABLES.map((name) => `'${name}'`).join(', ')
  const legacy = storage.sql
    .exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${names})`)
    .toArray()
  if (legacy.length === 0) return
  if ((await storage.get(SNAPSHOT_KEY)) === undefined) {
    const temp = createMergeableStore()
    const legacyPersister = createDurableObjectSqlStoragePersister(
      temp,
      storage.sql,
      { mode: 'fragmented' },
      (error) => console.error('legacy persister during migration:', error),
    )
    await legacyPersister.load()
    await legacyPersister.destroy()
    // The persister core swallows load errors into an empty store. Snapshotting
    // that emptiness and then dropping the tables would DESTROY the garage, so
    // an empty hydration from non-empty tables fails the wake loudly instead.
    const legacyCellRows = Number(
      storage.sql
        .exec("SELECT COUNT(*) AS n FROM tinybase_tables WHERE cell_id IS NOT NULL")
        .one().n,
    )
    if (legacyCellRows > 0 && !temp.hasTables()) {
      throw new Error(
        `legacy migration hydrated an empty store from ${legacyCellRows} cell rows — refusing to migrate`,
      )
    }
    const content = reviveTombstones(temp.getMergeableContent())
    await storage.put(SNAPSHOT_KEY, await gzip(JSON.stringify(content)))
  }
  for (const name of LEGACY_TABLES) {
    storage.sql.exec(`DROP TABLE IF EXISTS ${name}`)
  }
}
