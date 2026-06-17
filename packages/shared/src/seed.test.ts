// Chunked-stamped-seeding tests (M2). The CRITICAL assertion: after applying
// chunks to a fresh store, a synchronizer attach would exchange NO changes —
// proving the original HLC stamps (and recomputed hashes) survived intact.
import { describe, expect, it } from 'vitest'
import { createMergeableStore } from 'tinybase'
import type { MergeableStore, TablesStamp, ValuesStamp } from 'tinybase'
import { flattenCar } from './flatten'
import { createGarageStore } from './store'
import {
  SEED_UNDEFINED_SENTINEL,
  chunkMergeableContent,
  countSeedChunkCells,
  decodeSeedChunk,
  encodeSeedChunk,
  isSeedChunk,
} from './seed'
import type { SeedChunk } from './seed'
import type { Car } from './types'

// ── Synthetic garage ────────────────────────────────────────

function makeCar(i: number): Car {
  const id = `car-${i}`
  const pad = (n: number) => String(n + 1).padStart(2, '0')
  const photos = Array.from({ length: 6 }, (_, p) => ({
    id: `${id}-photo-${p}`,
    dataUrl: `data:image/webp;base64,${'A'.repeat(24)}`,
    caption: p === 0 ? '' : `Photo ${p}`, // '' is a real value
    uploadedAt: `2025-03-${pad(p)}`,
  }))
  return {
    id,
    year: String(1990 + i),
    make: `Make ${i}`,
    model: `Model ${i}`,
    trim: i % 3 === 0 ? '' : `Trim ${i}`,
    color: 'blue',
    // '' / free text / numeric+separator — exercises mileageMiles presence
    mileage: i % 3 === 0 ? '' : i % 3 === 1 ? 'unknown' : `1${i},000`,
    nickname: `Nick ${i}`,
    purchaseDate: '2020-01-01',
    saleDate: '',
    status: i % 2 === 0 ? 'current' : 'for-sale',
    salePrice: i % 4 === 0 ? '' : String(1000 * i), // '' must NOT gain a currency tag
    tradeFor: '',
    coverPhoto: i % 5 === 0 ? 'dangling-photo-id' : photos[0]!.id,
    createdAt: `2020-01-${pad(i % 28)}`,
    photos,
    wishlist: Array.from({ length: 8 }, (_, w) => ({
      id: `${id}-wish-${w}`,
      name: `Part ${w}`,
      link: '',
      price: w % 3 === 0 ? null : w % 3 === 1 ? 0 : 19.99 * w, // 0 is real
      category: 'performance',
      notes: '',
      status: 'wanted' as const,
      addedAt: `2024-06-${pad(w)}`,
    })),
    mods: Array.from({ length: 6 }, (_, m) => ({
      id: `${id}-mod-${m}`,
      name: `Mod ${m}`,
      category: 'exterior',
      description: '',
      cost: m % 2 === 0 ? null : 250 * m,
      installedDate: `2023-02-${pad(m)}`,
      shop: 'DIY',
      link: '',
      addedAt: `2023-02-${pad(m)}`,
    })),
    maintenance: Array.from({ length: 10 }, (_, r) => ({
      id: `${id}-rec-${r}`,
      service: `Service ${r}`,
      date: `2022-08-${pad(r)}`,
      mileage: r % 3 === 0 ? null : r % 3 === 1 ? '' : `${50_000 + r}`, // null vs '' distinct
      cost: r % 2 === 0 ? 0 : 89.5,
      shop: '',
      notes: '',
      nextDueDate: '',
      nextDueMileage: r % 2 === 0 ? '' : `${60_000 + r}`,
      createdAt: `2022-08-${pad(r)}`,
    })),
    todos: Array.from({ length: 6 }, (_, t) => ({
      id: `${id}-todo-${t}`,
      text: `Todo ${t}`,
      priority: 'low' as const,
      done: t % 2 === 0, // false is a real value
      createdAt: `2026-01-${pad(t)}`,
    })),
    issues: Array.from({ length: 5 }, (_, s) => ({
      id: `${id}-issue-${s}`,
      title: `Issue ${s}`,
      description: '',
      severity: 'minor' as const,
      status: 'open' as const,
      createdAt: `2026-02-${pad(s)}`,
      resolvedAt: s % 2 === 0 ? null : `2026-03-${pad(s)}`,
    })),
  }
}

/**
 * Build a populated source garage (~7k cells for 20 cars) via flattenCar,
 * including tombstones (a deleted row, cell and value) so the chunk transport
 * is exercised against `undefined` stamps.
 */
function makeSourceStore(carCount: number): MergeableStore {
  const store = createGarageStore('seed-src')
  const settings = { currency: 'USD', distanceUnit: 'mi' as const }
  for (let i = 0; i < carCount; i++) {
    const flat = flattenCar(makeCar(i), settings)
    store.setRow('cars', flat.carId, flat.car)
    const children = [
      ['photos', flat.photos],
      ['wishlist', flat.wishlist],
      ['mods', flat.mods],
      ['maintenance', flat.maintenance],
      ['todos', flat.todos],
      ['issues', flat.issues],
    ] as const
    for (const [tableId, rows] of children) {
      for (const [rowId, row] of Object.entries(rows)) {
        store.setRow(tableId, rowId, row)
      }
    }
  }
  store.setValues({
    themeId: 'midnight',
    customAccent: '#ff0000',
    currency: 'USD',
    distanceUnit: 'mi',
  })
  // Tombstones: these persist as `undefined`-valued stamps in the mergeable
  // content and must survive chunking + JSON transport.
  store.delRow('todos', 'car-0-todo-0')
  store.delCell('issues', 'car-0-issue-0', 'resolvedAt')
  store.delValue('customAccent')
  return store
}

/** chunk → encode → decode → apply: the full transport path, like the DO sees. */
function seedThroughTransport(
  src: MergeableStore,
  dst: MergeableStore,
  maxCellsPerChunk: number,
): SeedChunk[] {
  const chunks = chunkMergeableContent(src.getMergeableContent(), {
    maxCellsPerChunk,
  })
  for (const chunk of chunks) {
    dst.applyMergeableChanges(decodeSeedChunk(encodeSeedChunk(chunk)))
  }
  return chunks
}

/**
 * Mirror of createCustomSynchronizer.getChangesFromOtherStore in the installed
 * tinybase@8.4.2 (messages GetContentHashes → GetTableDiff → GetRowDiff →
 * GetCellDiff → GetValueDiff): computes exactly what `receiver` would pull
 * from `sender` on synchronizer attach, and counts the cell/value stamps that
 * would travel.
 */
function attachExchangeCells(
  receiver: MergeableStore,
  sender: MergeableStore,
): number {
  const countStamps = (tables: TablesStamp, values: ValuesStamp): number =>
    countSeedChunkCells([tables, values, 1])
  const [senderTablesHash, senderValuesHash] =
    sender.getMergeableContentHashes()
  const [receiverTablesHash, receiverValuesHash] =
    receiver.getMergeableContentHashes()
  let cells = 0
  if (receiverTablesHash !== senderTablesHash) {
    const [newTables, differingTableHashes] = sender.getMergeableTableDiff(
      receiver.getMergeableTableHashes(),
    )
    cells += countStamps(newTables, [{}])
    if (Object.keys(differingTableHashes).length > 0) {
      const [newRows, differingRowHashes] = sender.getMergeableRowDiff(
        receiver.getMergeableRowHashes(differingTableHashes),
      )
      cells += countStamps(newRows, [{}])
      if (Object.keys(differingRowHashes).length > 0) {
        const newCells = sender.getMergeableCellDiff(
          receiver.getMergeableCellHashes(differingRowHashes),
        )
        cells += countStamps(newCells, [{}])
      }
    }
  }
  if (receiverValuesHash !== senderValuesHash) {
    cells += countStamps([{}], sender.getMergeableValueDiff(
      receiver.getMergeableValueHashes(),
    ))
  }
  return cells
}

const CARS = 20
const BUDGET = 400

describe('chunkMergeableContent', () => {
  it('rejects a non-positive or non-integer cell budget', () => {
    const content = createMergeableStore('x').getMergeableContent()
    expect(() => chunkMergeableContent(content, { maxCellsPerChunk: 0 })).toThrow(RangeError)
    expect(() => chunkMergeableContent(content, { maxCellsPerChunk: -5 })).toThrow(RangeError)
    expect(() => chunkMergeableContent(content, { maxCellsPerChunk: 1.5 })).toThrow(RangeError)
  })

  it('yields no chunks for a fully empty store', () => {
    expect(
      chunkMergeableContent(createMergeableStore('x').getMergeableContent(), {
        maxCellsPerChunk: 100,
      }),
    ).toStrictEqual([])
  })

  it('respects the cell budget; Values travel only in the final chunk', () => {
    const src = makeSourceStore(CARS)
    const chunks = chunkMergeableContent(src.getMergeableContent(), {
      maxCellsPerChunk: BUDGET,
    })
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      // No garage row exceeds the budget, so the bound is strict here.
      expect(countSeedChunkCells(chunk)).toBeLessThanOrEqual(BUDGET)
      expect(isSeedChunk(chunk)).toBe(true)
    }
    const last = chunks[chunks.length - 1]!
    expect(Object.keys(last[1][0]).length).toBeGreaterThan(0) // values present
    expect(last[0][0]).toStrictEqual({}) // no tables in the values chunk
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk[1][0]).toStrictEqual({}) // no values before the final chunk
    }
  })

  it('keeps a row whole even when it alone exceeds the budget', () => {
    const src = createMergeableStore('wide')
    const wide: Record<string, string> = {}
    for (let i = 0; i < 10; i++) wide[`cell-${i}`] = `v${i}`
    src.setRow('t', 'wide-row', wide)
    src.setRow('t', 'small-row', { a: '1' })
    const chunks = chunkMergeableContent(src.getMergeableContent(), {
      maxCellsPerChunk: 3,
    })
    const counts = chunks.map(countSeedChunkCells)
    expect(counts).toContain(10) // the oversized row ships whole
    const dst = createMergeableStore('wide-dst')
    for (const chunk of chunks) dst.applyMergeableChanges(chunk)
    expect(dst.getTables()).toStrictEqual(src.getTables())
  })
})

describe('seeding a fresh store from chunks', () => {
  it('(1) content AND stamps deep-equal the source after the full transport path', () => {
    const src = makeSourceStore(CARS)
    const dst = createMergeableStore('seed-dst') // schema-less, like the DO
    seedThroughTransport(src, dst, BUDGET)
    expect(dst.getContent()).toStrictEqual(src.getContent())
    // The strong claim: per-cell HLCs and the recomputed hashes are identical.
    expect(dst.getMergeableContent()).toStrictEqual(src.getMergeableContent())
    expect(dst.getMergeableContentHashes()).toStrictEqual(
      src.getMergeableContentHashes(),
    )
  })

  it('(2) CRITICAL: a synchronizer attach after seeding exchanges zero changes', () => {
    const src = makeSourceStore(CARS)
    const dst = createMergeableStore('seed-dst')
    seedThroughTransport(src, dst, BUDGET)
    // Both directions of the (source-mirrored) sync handshake are empty.
    expect(attachExchangeCells(dst, src)).toBe(0)
    expect(attachExchangeCells(src, dst)).toBe(0)

    // ...and a genuine post-seed delta is the ONLY thing that would travel.
    src.setCell('cars', 'car-1', 'nickname', 'updated after seed')
    expect(attachExchangeCells(dst, src)).toBe(1)
  })

  it('(4) applying every chunk twice is a complete no-op', () => {
    const src = makeSourceStore(CARS)
    const dst = createMergeableStore('seed-dst')
    const chunks = seedThroughTransport(src, dst, BUDGET)
    const before = dst.getMergeableContent()
    let listenerFired = 0
    dst.addCellListener(null, null, null, () => listenerFired++)
    dst.addValueListener(null, () => listenerFired++)
    for (const chunk of chunks) {
      dst.applyMergeableChanges(decodeSeedChunk(encodeSeedChunk(chunk)))
    }
    expect(listenerFired).toBe(0)
    expect(dst.getMergeableContent()).toStrictEqual(before)
  })

  it('transports tombstones: deleted row/cell/value stay deleted, stamps intact', () => {
    const src = makeSourceStore(CARS)
    const dst = createMergeableStore('seed-dst')
    seedThroughTransport(src, dst, BUDGET)
    expect(dst.hasRow('todos', 'car-0-todo-0')).toBe(false)
    expect(dst.getCell('issues', 'car-0-issue-0', 'resolvedAt')).toBeUndefined()
    expect(dst.getValue('customAccent')).toBeUndefined()
    // The tombstone exists as an undefined-valued stamp with a real HLC.
    const tablesStamp = dst.getMergeableContent()[0][0]
    const cellStamp =
      tablesStamp['todos']![0]['car-0-todo-0']![0]['text']!
    expect(cellStamp[0]).toBeUndefined()
    expect(cellStamp[1]).not.toBe('')
  })

  it('re-encodes JSON (object/array) cells so hashes still match', () => {
    const src = createMergeableStore('json-src')
    src.setCell('t', 'r', 'obj', { nested: [1, 2, 3] })
    src.setCell('t', 'r', 'arr', [true, null, 'x'])
    const dst = createMergeableStore('json-dst')
    seedThroughTransport(src, dst, 10)
    expect(dst.getCell('t', 'r', 'obj')).toStrictEqual({ nested: [1, 2, 3] })
    expect(dst.getCell('t', 'r', 'arr')).toStrictEqual([true, null, 'x'])
    expect(dst.getMergeableContentHashes()).toStrictEqual(
      src.getMergeableContentHashes(),
    )
    expect(attachExchangeCells(dst, src)).toBe(0)
  })
})

describe('encodeSeedChunk / decodeSeedChunk', () => {
  it('round-trips undefined tombstones via the sentinel', () => {
    const chunk: SeedChunk = [
      [{ t: [{ r: [{ gone: [undefined, 'Nn1JUF-----FnHIC'] }] }] }],
      [{ v: [undefined, 'Nn1JUF----0FnHIC'] }],
      1,
    ]
    const encoded = encodeSeedChunk(chunk)
    expect(encoded).toContain(SEED_UNDEFINED_SENTINEL)
    expect(decodeSeedChunk(encoded)).toStrictEqual(chunk)
  })

  it('rejects invalid JSON and non-MergeableChanges shapes', () => {
    expect(() => decodeSeedChunk('{nope')).toThrow(/not valid JSON/)
    expect(() => decodeSeedChunk('{}')).toThrow(/MergeableChanges/)
    expect(() => decodeSeedChunk('[[{}],[{}]]')).toThrow(/MergeableChanges/) // missing trailing 1
    expect(() => decodeSeedChunk('[[{}],[{}],2]')).toThrow(/MergeableChanges/)
    expect(() =>
      decodeSeedChunk('[[{"t":[{"r":[{"c":["v",42]}]}]}],[{}],1]'),
    ).toThrow(/MergeableChanges/) // hlc must be a string
    expect(() =>
      decodeSeedChunk('[[{"t":[{"r":[{"c":[{"obj":1}]}]}]}],[{}],1]'),
    ).toThrow(/MergeableChanges/) // raw objects are not scalar cells
  })

  it('isSeedChunk accepts hashed stamps too (3-element form)', () => {
    expect(
      isSeedChunk([[{ t: [{ r: [{ c: ['v', 'hlc', 123] }, 'hlc', 9] }, '', 1] }, '', 2], [{}], 1]),
    ).toBe(true)
  })
})
