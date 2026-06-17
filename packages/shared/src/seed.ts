// Chunked, stamped seeding of a MergeableStore — the M2 plumbing that lets a
// client populate (or clear) an empty Durable Object via BOUNDED RPCs BEFORE
// the WS synchronizer attaches, so attach exchanges only genuine deltas and
// never performs the un-chunkable full-store reconcile of TinyBase #268.
//
// ── Verified against the INSTALLED tinybase@8.4.2 source (not memory) ──
// (mergeable-store/index.js, synchronizers/synchronizer-ws-server-durable-object/index.js)
//
// 1. Shapes. `MergeableContent = [TablesStamp<true>, ValuesStamp<true>]` with
//    every stamp fully hashed (`[thing, hlc, hash]`). `MergeableChanges` is the
//    same tree with OPTIONAL hlc / no hash (`[thing, hlc?]`) plus a trailing
//    `1` discriminant: `[tablesStamp, valuesStamp, 1]`.
//
// 2. `applyMergeableChanges(changes)` routes to
//    `mergeContentOrChanges(changes, isContent = 0)`. With `isContent = 0`
//    every incoming hash is IGNORED: cell/value hashes are recomputed locally
//    as `getValueHash(value, hlc)` and rolled up with the XOR helpers
//    (`addOrRemoveHash` / `getValueInValuesHash` / `replaceHlcHash`). XOR
//    rollups are order-independent and telescope across overwrites, so a
//    store assembled from PARTIAL slices ends up with hashes identical to the
//    source — this is why chunks use the CHANGES form (trailing `1`) and need
//    not carry hashes at all. (`setMergeableContent` is unusable for chunking:
//    it calls `delTables().delValues()` and resets the stamp map on EVERY
//    call, so only the last chunk would survive, and its
//    `validateMergeableContent` demands fully-hashed stamps.)
//
// 3. LWW + idempotency. A cell is applied iff `!oldHlc || hlc > oldHlc`, with
//    the ORIGINAL hlc stored verbatim (never re-stamped) and the receiver's
//    HLC clock advanced via `seenHlc(latest)` — so later receiver-side writes
//    (e.g. clear tombstones) always out-stamp the seeded content. Re-applying
//    a chunk finds `hlc == oldHlc` and is a complete no-op (no changes, no
//    hash perturbation).
//
// 4. Parent stamps. Tables/table/row/values stamps carry their own hlc, which
//    is `''` in organically-written stores (only the cell/value level gets
//    `getNextHlc()`); non-`''` parent hlcs perturb the parent hash via
//    `replaceHlcHash(old, new)`, which only fires when `new > old` and
//    telescopes — so chunks carry the source's parent hlcs verbatim and may
//    repeat them across chunks without double-counting.
//
// 5. Tombstones. A deleted cell/value persists as a stamp whose value slot is
//    `undefined` — DISTINCT from `null`, which is a legal cell value (v8
//    `allowNull`). Plain JSON drops/nullifies `undefined`, so the transport
//    encodes it as `'￼'` — the exact sentinel tinybase's own synchronizer
//    payloads use (`jsonStringWithUndefined` / its reviver). Like upstream, a
//    user string equal to the sentinel cannot be represented.
//
// 6. JSON-typed cells. Object/array cells are stored ENCODED (`'�' +
//    JSON`) and their stamps/hashes are computed over the encoded string, but
//    `getMergeableContent()` returns them DECODED. The chunker re-encodes
//    them (mirroring the store's `encodeIfJson`) so receiver-side hashes match
//    the source even for JSON cells. (The garage schema has none; this is
//    forward-proofing.)
//
// 7. The DO-side fragmented persister (`mode: 'fragmented'`) auto-saves once
//    per finished transaction with ONLY that transaction's changes, one SQL
//    row per changed cell — and `applyChanges` (inside
//    `applyMergeableChanges`) wraps each chunk in exactly ONE transaction. So
//    one chunk == one bounded storage write, which is the whole point.
//
// RN-safe: JSON + Object/Array only; no DOM/Node imports.
import type {
  CellOrUndefined,
  CellStamp,
  Hlc,
  MergeableChanges,
  MergeableContent,
  Stamp,
  TableStamp,
  ValueStamp,
} from 'tinybase'

/**
 * One bounded slice of a store's mergeable content, in the MergeableChanges
 * (trailing-`1`) form: independently valid input for `applyMergeableChanges`
 * on a receiving MergeableStore, carrying the ORIGINAL per-cell HLC stamps.
 */
export type SeedChunk = MergeableChanges

export interface ChunkMergeableContentOptions {
  /**
   * Soft budget of cell+value stamps per chunk. Row-level granularity: a
   * row's cells always travel together, so a single row larger than the
   * budget still ships whole (as its own chunk).
   */
  maxCellsPerChunk: number
}

/**
 * Sentinel encoding `undefined` (tombstones) inside JSON transport — the same
 * code point tinybase's own synchronizer payloads use.
 */
export const SEED_UNDEFINED_SENTINEL = '\uFFFC'

/** The store's internal prefix marking an object/array cell encoded as JSON. */
const JSON_CELL_PREFIX = '\uFFFD'

/** Mirror of the store's `encodeIfJson` — see module header, point 6. */
function encodeJsonCell(cellOrValue: CellOrUndefined): CellOrUndefined {
  return cellOrValue !== null && typeof cellOrValue === 'object'
    ? JSON_CELL_PREFIX + JSON.stringify(cellOrValue)
    : cellOrValue
}

/** Build a changes-form stamp: hlc kept iff non-empty (mirrors `stampNew`). */
function stamp<Thing>(thing: Thing, hlc: Hlc | undefined): Stamp<Thing> {
  return hlc ? [thing, hlc] : [thing]
}

/**
 * Slice a MergeableStore's `getMergeableContent()` output into an ordered
 * list of chunks. Each chunk is independently valid input for
 * `applyMergeableChanges` on a receiving store; each carries the ORIGINAL
 * per-cell HLC stamps (never re-stamped, never converted to plain values).
 * Values travel in their own, final chunk. A fully empty content yields `[]`.
 */
export function chunkMergeableContent(
  content: MergeableContent,
  options: ChunkMergeableContentOptions,
): SeedChunk[] {
  const { maxCellsPerChunk } = options
  if (!Number.isInteger(maxCellsPerChunk) || maxCellsPerChunk < 1) {
    throw new RangeError(
      `maxCellsPerChunk must be a positive integer, got ${String(maxCellsPerChunk)}`,
    )
  }
  const [[tableStamps, tablesHlc], [valueStamps, valuesHlc]] = content

  const chunks: SeedChunk[] = []
  let pendingTables: { [tableId: string]: TableStamp } = {}
  let pendingCells = 0

  const flush = (): void => {
    if (pendingCells > 0) {
      chunks.push([stamp(pendingTables, tablesHlc), stamp({}, undefined), 1])
      pendingTables = {}
      pendingCells = 0
    }
  }

  for (const [tableId, [rowStamps, tableHlc]] of Object.entries(tableStamps)) {
    for (const [rowId, [cellStamps, rowHlc]] of Object.entries(rowStamps)) {
      const cells: { [cellId: string]: CellStamp } = {}
      let rowCells = 0
      for (const [cellId, [cell, cellHlc]] of Object.entries(cellStamps)) {
        cells[cellId] = stamp(encodeJsonCell(cell), cellHlc)
        rowCells += 1
      }
      const cost = Math.max(rowCells, 1)
      if (pendingCells > 0 && pendingCells + cost > maxCellsPerChunk) {
        flush()
      }
      const tableStamp = (pendingTables[tableId] ??= stamp(
        {},
        tableHlc,
      ) as TableStamp)
      tableStamp[0][rowId] = stamp(cells, rowHlc)
      pendingCells += cost
    }
  }
  flush()

  if (Object.keys(valueStamps).length > 0 || valuesHlc) {
    const values: { [valueId: string]: ValueStamp } = {}
    for (const [valueId, [value, valueHlc]] of Object.entries(valueStamps)) {
      values[valueId] = stamp(encodeJsonCell(value), valueHlc)
    }
    chunks.push([stamp({}, tablesHlc), stamp(values, valuesHlc), 1])
  }

  return chunks
}

/** Number of cell + value stamps a chunk carries (tombstones included). */
export function countSeedChunkCells(chunk: SeedChunk): number {
  const [[tableStamps], [valueStamps]] = chunk
  let count = Object.keys(valueStamps).length
  for (const [rowStamps] of Object.values(tableStamps)) {
    for (const [cellStamps] of Object.values(rowStamps)) {
      count += Object.keys(cellStamps).length
    }
  }
  return count
}

/**
 * JSON-encode a chunk for HTTP/RPC transport, preserving `undefined`
 * tombstones via the sentinel (see module header, point 5).
 */
export function encodeSeedChunk(chunk: SeedChunk): string {
  return JSON.stringify(chunk, (_key, value: unknown) =>
    value === undefined ? SEED_UNDEFINED_SENTINEL : value,
  )
}

function reviveUndefined(value: unknown): unknown {
  if (value === SEED_UNDEFINED_SENTINEL) {
    return undefined
  }
  if (Array.isArray(value)) {
    return value.map(reviveUndefined)
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      out[key] = reviveUndefined(child)
    }
    return out
  }
  return value
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isCellValue = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value))

/** Changes-form stamp: `[thing]` | `[thing, hlc]` | `[thing, hlc, hash]`. */
function isStamp(
  value: unknown,
  validateThing: (thing: unknown) => boolean,
): boolean {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    return false
  }
  if (value.length >= 2 && typeof value[1] !== 'string') {
    return false
  }
  if (
    value.length === 3 &&
    !(typeof value[2] === 'number' && Number.isFinite(value[2]))
  ) {
    return false
  }
  return validateThing(value[0])
}

const everyStampIn = (
  thing: unknown,
  validateChild: (child: unknown) => boolean,
): boolean =>
  isPlainObject(thing) &&
  Object.values(thing).every((child) => isStamp(child, validateChild))

/**
 * Structural validation for an untrusted decoded chunk. Mirrors the source's
 * `validateMergeableContent` but accepts the changes form (optional hlc, no
 * hash required) — `applyMergeableChanges` itself does NOT validate, so the
 * receiving side (the DO) must gate on this before applying.
 */
export function isSeedChunk(value: unknown): value is SeedChunk {
  if (!Array.isArray(value) || value.length !== 3 || value[2] !== 1) {
    return false
  }
  return (
    isStamp(value[0], (tables) =>
      everyStampIn(tables, (rows) =>
        everyStampIn(rows, (cells) => everyStampIn(cells, isCellValue)),
      ),
    ) && isStamp(value[1], (values) => everyStampIn(values, isCellValue))
  )
}

/**
 * Decode + structurally validate a transported chunk. Throws on invalid JSON
 * or a non-MergeableChanges shape.
 */
export function decodeSeedChunk(encoded: string): SeedChunk {
  let parsed: unknown
  try {
    parsed = JSON.parse(encoded)
  } catch {
    throw new Error('seed chunk is not valid JSON')
  }
  const revived = reviveUndefined(parsed)
  if (!isSeedChunk(revived)) {
    throw new Error('seed chunk does not have the MergeableChanges shape')
  }
  return revived
}
