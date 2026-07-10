// M2 seed/clear/meta protocol tests, exercised against the REAL GarageDO and
// its fragmented SQLite storage (vitest-pool-workers).
import { SELF, env, runInDurableObject } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  SYNC_CLEAR_PATH,
  SYNC_META_PATH,
  SYNC_SEED_PATH,
  chunkMergeableContent,
  createGarageStore,
  encodeSeedChunk,
  flattenCar,
} from '@chudbox/shared'
import type {
  Car,
  ClearGarageResponse,
  SeedChunk,
  SeedChunkResponse,
  SyncMetaResponse,
} from '@chudbox/shared'
import type { MergeableStore } from 'tinybase'
import type { GarageDO } from '../src/durable/GarageDO'

const BASE = 'https://example.com'
const BUDGET = 120

// ── Auth helper ─────────────────────────────────────────────
// ONE session for the whole file, created in beforeAll: writes made in
// beforeAll land on the file-level isolated-storage frame and persist across
// this file's tests, and Better Auth's built-in per-endpoint rate limit on
// sign-up/sign-in would trip if every test signed up its own user. Each
// test's DO storage still rolls back per test (fresh, empty garage).

let session: { cookie: string; userId: string }

beforeAll(async () => {
  const email = 'seed-user@example.com'
  const password = 'correct-horse-battery'
  const signUp = await SELF.fetch(`${BASE}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name: 'Seed Tester' }),
  })
  expect(signUp.ok).toBe(true)
  const { user } = (await signUp.json()) as { user: { id: string } }
  await env.DB.prepare('UPDATE user SET email_verified = 1 WHERE email = ?')
    .bind(email)
    .run()
  const signIn = await SELF.fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  expect(signIn.ok).toBe(true)
  const cookie = (signIn.headers.get('set-cookie') ?? '')
    .match(/(?:__Secure-)?better-auth\.session_token=[^;]+/)?.[0]
  if (!cookie) throw new Error('no session cookie after sign-in')
  session = { cookie, userId: user.id }
})

// ── Synthetic garage ────────────────────────────────────────

function makeCar(i: number): Car {
  const id = `car-${i}`
  return {
    id,
    year: String(2000 + i),
    make: `Make ${i}`,
    model: `Model ${i}`,
    trim: '',
    color: 'red',
    mileage: i % 2 === 0 ? '' : `${i}2,000`,
    nickname: `Nick ${i}`,
    purchaseDate: '2021-01-01',
    saleDate: '',
    status: 'current',
    salePrice: '',
    tradeFor: '',
    coverPhoto: null,
    createdAt: '2021-01-01',
    photos: Array.from({ length: 3 }, (_, p) => ({
      id: `${id}-photo-${p}`,
      dataUrl: 'data:image/webp;base64,AAAA',
      caption: `P${p}`,
      uploadedAt: '2025-01-01',
    })),
    wishlist: Array.from({ length: 5 }, (_, w) => ({
      id: `${id}-wish-${w}`,
      name: `Part ${w}`,
      link: '',
      price: w % 2 === 0 ? null : 10 * w, // null and 0-adjacent coverage
      category: 'misc',
      notes: '',
      status: 'wanted' as const,
      addedAt: '2024-01-01',
    })),
    mods: [],
    maintenance: Array.from({ length: 6 }, (_, r) => ({
      id: `${id}-rec-${r}`,
      service: `Service ${r}`,
      date: '2023-01-01',
      mileage: r % 2 === 0 ? null : `${40_000 + r}`,
      cost: r % 2 === 0 ? 0 : 120,
      shop: '',
      notes: '',
      nextDueDate: '',
      nextDueMileage: '',
      createdAt: '2023-01-01',
    })),
    todos: Array.from({ length: 4 }, (_, t) => ({
      id: `${id}-todo-${t}`,
      text: `Todo ${t}`,
      priority: 'high' as const,
      done: t % 2 === 0,
      createdAt: '2026-01-01',
    })),
    issues: [],
  }
}

/** ~6 cars ≈ 700 cells, so BUDGET=120 forces a genuinely multi-chunk seed. */
function makeSourceStore(): MergeableStore {
  const store = createGarageStore('client-a')
  const settings = { currency: 'USD', distanceUnit: 'mi' as const }
  for (let i = 0; i < 6; i++) {
    const flat = flattenCar(makeCar(i), settings)
    store.setRow('cars', flat.carId, flat.car)
    const children = [
      ['photos', flat.photos],
      ['wishlist', flat.wishlist],
      ['maintenance', flat.maintenance],
      ['todos', flat.todos],
    ] as const
    for (const [tableId, rows] of children) {
      for (const [rowId, row] of Object.entries(rows)) {
        store.setRow(tableId, rowId, row)
      }
    }
  }
  store.setValues({
    themeId: 'midnight',
    currency: 'USD',
    distanceUnit: 'mi',
  })
  // A tombstone, so undefined survives the HTTP transport end to end.
  store.delRow('todos', 'car-0-todo-0')
  return store
}

// ── Protocol helpers ────────────────────────────────────────

async function postSeedChunk(
  cookie: string,
  chunk: SeedChunk,
  index: number,
  total: number,
): Promise<Response> {
  return SELF.fetch(`${BASE}${SYNC_SEED_PATH}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ chunk: encodeSeedChunk(chunk), index, total }),
  })
}

async function seedGarage(
  cookie: string,
  store: MergeableStore,
): Promise<SeedChunk[]> {
  const chunks = chunkMergeableContent(store.getMergeableContent(), {
    maxCellsPerChunk: BUDGET,
  })
  for (const [index, chunk] of chunks.entries()) {
    const res = await postSeedChunk(cookie, chunk, index, chunks.length)
    expect(res.status).toBe(200)
    const body = (await res.json()) as SeedChunkResponse
    expect(body.applied).toBe(true)
  }
  return chunks
}

async function getMeta(cookie: string): Promise<SyncMetaResponse> {
  const res = await SELF.fetch(`${BASE}${SYNC_META_PATH}`, {
    headers: { cookie },
  })
  expect(res.status).toBe(200)
  return (await res.json()) as SyncMetaResponse
}

function garageStub(userId: string) {
  return env.GARAGE_DO.get(env.GARAGE_DO.idFromName(userId))
}

/** Sentinel-encoded snapshot of the DO store's full mergeable content. */
async function captureDoContent(userId: string): Promise<string> {
  return runInDurableObject(garageStub(userId), (instance) =>
    JSON.stringify(
      (instance as GarageDO).store!.getMergeableContent(),
      (_k, v: unknown) => (v === undefined ? '￼' : v),
    ),
  )
}

/** Cell stamps in a store's mergeable tables content (tombstones included). */
function countContentCells(
  store: MergeableStore,
  { liveOnly = false } = {},
): number {
  let cells = 0
  for (const [rowStamps] of Object.values(store.getMergeableContent()[0][0])) {
    for (const [cellStamps] of Object.values(rowStamps)) {
      for (const [cell] of Object.values(cellStamps)) {
        if (!liveOnly || cell !== undefined) cells += 1
      }
    }
  }
  return cells
}

// ── Tests ───────────────────────────────────────────────────

describe('auth gating', () => {
  it('rejects all /api/sync/* requests without a session, before touching the DO', async () => {
    const seed = await SELF.fetch(`${BASE}${SYNC_SEED_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chunk: '[[{}],[{}],1]', index: 0, total: 1 }),
    })
    expect(seed.status).toBe(401)
    const clear = await SELF.fetch(`${BASE}${SYNC_CLEAR_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(clear.status).toBe(401)
    const meta = await SELF.fetch(`${BASE}${SYNC_META_PATH}`)
    expect(meta.status).toBe(401)
  })
})

describe('seeding', () => {
  it('lands a multi-chunk garage in the DO: meta matches, storage is per-cell, stamps intact', async () => {
    const { cookie, userId } = session
    expect((await getMeta(cookie)).isEmpty).toBe(true)

    const src = makeSourceStore()
    const chunks = await seedGarage(cookie, src)
    expect(chunks.length).toBeGreaterThan(1)

    const meta = await getMeta(cookie)
    expect(meta.isEmpty).toBe(false)
    expect(meta.hasValues).toBe(true)
    for (const tableId of src.getTableIds()) {
      expect(meta.rowCounts[tableId], tableId).toBe(src.getRowCount(tableId))
    }

    // The persisted cell rows are the LIVE cells: a tombstone seeded into a
    // store that never held the cell does not change the raw store, so the
    // per-transaction auto-save has nothing to persist for it. It still lives
    // in the in-memory stamp map (the contentHashes assertion below covers
    // it); after a DO restart the next attach re-exchanges just those cells
    // from the client, which always retains them — bounded and convergent.
    const srcLiveCells = countContentCells(src, { liveOnly: true })
    const srcValues = Object.keys(src.getMergeableContent()[1][0]).length
    const probe = await runInDurableObject(
      garageStub(userId),
      (instance, state) => {
        // Per-cell storage behavior (fragmented mode): one SQL row per cell
        // stamp — not one JSON blob. Parent stamp rows have NULL cell_id and
        // are excluded.
        const cellRows = Number(
          state.storage.sql
            .exec(
              'SELECT COUNT(*) AS n FROM tinybase_tables WHERE cell_id IS NOT NULL',
            )
            .one().n,
        )
        const valueRows = Number(
          state.storage.sql
            .exec(
              'SELECT COUNT(*) AS n FROM tinybase_values WHERE value_id IS NOT NULL',
            )
            .one().n,
        )
        return {
          cellRows,
          valueRows,
          contentHashes: (instance as GarageDO).store!.getMergeableContentHashes(),
        }
      },
    )
    expect(probe.cellRows).toBe(srcLiveCells)
    expect(probe.valueRows).toBe(srcValues)
    // Stamps + hashes identical to the client store ⇒ a synchronizer attach
    // would exchange only genuine deltas — the #268 mitigation works against
    // the real DO storage.
    expect(probe.contentHashes).toStrictEqual(src.getMergeableContentHashes())
  })

  it('re-seeding the same chunks is a no-op: stamps unchanged', async () => {
    const { cookie, userId } = session
    const src = makeSourceStore()
    const chunks = await seedGarage(cookie, src)
    const before = await captureDoContent(userId)
    for (const [index, chunk] of chunks.entries()) {
      const res = await postSeedChunk(cookie, chunk, index, chunks.length)
      expect(res.status).toBe(200)
    }
    expect(await captureDoContent(userId)).toBe(before)
  })

  it('rejects malformed envelopes, malformed chunks and oversized bodies', async () => {
    const { cookie } = session
    const post = (body: string) =>
      SELF.fetch(`${BASE}${SYNC_SEED_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', cookie },
        body,
      })

    expect((await post('{nope')).status).toBe(400) // not JSON
    expect((await post('{}')).status).toBe(400) // missing fields
    expect(
      (await post(JSON.stringify({ chunk: '[[{}],[{}],1]', index: 1, total: 1 })))
        .status,
    ).toBe(400) // index >= total
    expect(
      (await post(JSON.stringify({ chunk: 'not a chunk', index: 0, total: 1 })))
        .status,
    ).toBe(400) // DO-side decode rejects, mapped to 400
    expect(
      (await post(JSON.stringify({ chunk: '[[{}],[{}]]', index: 0, total: 1 })))
        .status,
    ).toBe(400) // missing trailing 1 (content form, not changes form)
    const oversized = JSON.stringify({
      chunk: 'x'.repeat(1_100_000),
      index: 0,
      total: 1,
    })
    expect((await post(oversized)).status).toBe(413)
  })
})

describe('clearing', () => {
  it('tombstones everything in bounded batches: empty-with-tombstones that win under LWW', async () => {
    const { cookie, userId } = session
    const src = makeSourceStore()
    await seedGarage(cookie, src)

    // A pre-clear stamp to compare tombstone HLCs against.
    const seededStamp =
      src.getMergeableContent()[0][0]['cars']![0]['car-0']![0]['make']!

    const res = await SELF.fetch(`${BASE}${SYNC_CLEAR_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ maxCellsPerChunk: BUDGET }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as ClearGarageResponse
    expect(body.cleared).toBe(true)
    let liveRows = 0
    for (const tableId of src.getTableIds()) liveRows += src.getRowCount(tableId)
    expect(body.deletedRows).toBe(liveRows)
    // 3 explicitly seeded (themeId/currency/distanceUnit) + 6 sort/group
    // prefs that GARAGE_VALUES_SCHEMA defaults materialize even though this
    // fixture never sets them (modsSortBy/Dir, maintenanceSortBy/Dir,
    // issuesSortBy/Dir).
    expect(body.deletedValues).toBe(9)
    // Bounded batching actually split the work (≥ one batch per table at this
    // budget, + the values batch).
    expect(body.batches).toBeGreaterThan(src.getTableIds().length)

    const meta = await getMeta(cookie)
    expect(meta.isEmpty).toBe(true)
    expect(meta.hasValues).toBe(false)
    for (const count of Object.values(meta.rowCounts)) expect(count).toBe(0)

    const probe = await runInDurableObject(
      garageStub(userId),
      (instance) => {
        const store = (instance as GarageDO).store!
        const [tableStamps] = store.getMergeableContent()[0]
        let tombstones = 0
        let newestTombstoneHlc = ''
        for (const [rowStamps] of Object.values(tableStamps)) {
          for (const [cellStamps] of Object.values(rowStamps)) {
            for (const [cell, hlc] of Object.values(cellStamps)) {
              if (cell === undefined && hlc) {
                tombstones += 1
                if (hlc > newestTombstoneHlc) newestTombstoneHlc = hlc
              }
            }
          }
        }
        return {
          tables: store.getTables(),
          values: store.getValues(),
          tombstones,
          newestTombstoneHlc,
        }
      },
    )
    // Empty-with-tombstones: no live data, but every cleared cell kept a
    // newer-stamped undefined that out-ranks the seeded stamps under LWW.
    expect(probe.tables).toStrictEqual({})
    expect(probe.values).toStrictEqual({})
    expect(probe.tombstones).toBeGreaterThanOrEqual(countContentCells(src))
    expect(probe.newestTombstoneHlc > seededStamp[1]).toBe(true)
  })

  it('rejects unknown clear options', async () => {
    const { cookie } = session
    const res = await SELF.fetch(`${BASE}${SYNC_CLEAR_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ dropTables: true }),
    })
    expect(res.status).toBe(400)
  })
})
