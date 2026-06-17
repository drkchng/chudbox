/**
 * M2 EMPIRICAL GATE — measure TinyBase #268 fragmented-persister behavior
 * against a real (local workerd) GarageDO and prove the chunked-stamped-seed
 * mitigation works (BACKEND_PLAN.md: "Critical persistence detail", Risk #1,
 * Verification M2 (b)/(c)).
 *
 * What runs here, in order (one file so measurements never run in parallel):
 *  1. A large deterministic synthetic garage (20 cars x years of history),
 *     comfortably past the ~200 KB single-save zone reported in #268.
 *  2. (b) Storage-behavior probe: many small per-cell rows, no JSON blob row
 *     — asserted by row counts/sizes over DISCOVERED tables, not names.
 *  3. (c) THE GATE: chunked stamped seeding of the EMPTY DO through the real
 *     session-authed /api/sync/seed route, then a REAL WsSynchronizer client
 *     attached to /sync. Asserts the post-seed exchange writes ZERO rows on
 *     the DO, genuine deltas stay bounded, and a fresh second client
 *     down-syncs the full garage.
 *  4. Premise falsification: a control DO seeded with PLAIN values (fresh
 *     server-minted stamps). On attach, the synchronizer rewrites every cell
 *     row in ~one unbounded save — the exact write the stamped seed avoids.
 *  5. Ceiling probe: 1k/5k/20k/50k cells in ONE applyMergeableChanges save,
 *     timed, plus a guarded cold-start (constructor full-save) probe.
 *
 * Auth choice (task: "justify the choice"): the gate path uses the REAL
 * session-authed routes (/api/sync/seed, /sync) with a user signed up through
 * Better Auth — that is the faithful production path. The control and ceiling
 * probes bypass auth via runInDurableObject/stub.fetch on separately named
 * DOs: auth is already proven by the gate + sync-seed tests, and these probes
 * isolate persister mechanics that no route exposes (deliberately —
 * seedGarage caps chunks at MAX_SEED_CHUNK_CELLS).
 *
 * CAVEAT (stated wherever numbers are recorded): local workerd enforces
 * neither production CPU/wall-clock limits nor the 1 MiB WebSocket
 * message-receive cap, so "no DO reset locally" is NOT evidence of production
 * safety. The gate's strength is the measured WRITE SHAPE contrast
 * (zero-row attach vs full-store rewrite), which is runtime-independent.
 *
 * Timing note: workerd only advances Date.now() at I/O boundaries, so
 * measurements taken across awaited DO/HTTP calls are real elapsed time,
 * while purely-synchronous spans inside the DO may under-read. Both are
 * reported; treat in-DO numbers as lower bounds.
 */
import { SELF, env, runInDurableObject } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { createMergeableStore } from 'tinybase'
import type { MergeableStore } from 'tinybase'
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client'
import {
  DEFAULT_SEED_CHUNK_CELLS,
  SYNC_META_PATH,
  SYNC_SEED_PATH,
  chunkMergeableContent,
  createGarageStore,
  encodeSeedChunk,
  flattenCar,
} from '@chudbox/shared'
import type {
  Car,
  FlattenedCar,
  FlattenSettings,
  SeedChunk,
  SeedChunkResponse,
  SyncMetaResponse,
} from '@chudbox/shared'
import type { GarageDO } from '../src/durable/GarageDO'

const BASE = 'https://example.com'
const SETTINGS: FlattenSettings = { currency: 'USD', distanceUnit: 'mi' }

// ── Session (one user for the whole file, like sync-seed.test.ts) ──────────

let session: { cookie: string; userId: string }

beforeAll(async () => {
  const email = 'm2-gate@example.com'
  const password = 'correct-horse-battery'
  const signUp = await SELF.fetch(`${BASE}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name: 'M2 Gate' }),
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
  const cookie = (signIn.headers.get('set-cookie') ?? '').match(
    /better-auth\.session_token=[^;]+/,
  )?.[0]
  if (!cookie) throw new Error('no session cookie after sign-in')
  session = { cookie, userId: user.id }
})

// ── Deterministic synthetic garage ──────────────────────────────────────────

interface GarageShape {
  cars: number
  maintenance: number
  mods: number
  todos: number
  issues: number
  wishlist: number
  photos: number
}

/** ~514 cells/car -> ~10.3k cells / ~0.7 MB serialized at 20 cars. */
const GATE_SHAPE: GarageShape = {
  cars: 20,
  maintenance: 20,
  mods: 8,
  todos: 10,
  issues: 6,
  wishlist: 6,
  photos: 4,
}

/** Same generator at ~6 cars (~3.1k cells, ~200 KB) for the control case. */
const CONTROL_SHAPE: GarageShape = { ...GATE_SHAPE, cars: 6 }

const WORDS = [
  'oil', 'filter', 'rotors', 'pads', 'coolant', 'plugs', 'coilover', 'belt',
  'tensioner', 'bushing', 'alignment', 'tires', 'gasket', 'manifold', 'turbo',
]

/** Deterministic pseudo-prose, ~7 bytes/word. */
function text(seed: number, words: number): string {
  const out: string[] = []
  for (let w = 0; w < words; w++) out.push(WORDS[(seed + w * 7) % WORDS.length]!)
  return out.join(' ')
}

const pad = (n: number): string => String(n).padStart(2, '0')

function syntheticCar(i: number, shape: GarageShape): Car {
  const id = `car-${i}`
  const sold = i % 5 === 0
  return {
    id,
    year: String(1990 + (i % 30)),
    make: `Make ${text(i, 1)}`,
    model: `Model ${text(i + 3, 2)}`,
    trim: i % 2 === 0 ? '' : 'Touring',
    color: text(i + 5, 1),
    // Locale separators and free text both occur in real data.
    mileage: i % 3 === 0 ? '88,500' : i % 3 === 1 ? 'unknown' : `${50_000 + i * 1234}`,
    nickname: i % 4 === 0 ? '' : `The ${text(i + 9, 1)}`,
    purchaseDate: `20${10 + (i % 12)}-${pad(1 + (i % 12))}-01`,
    saleDate: sold ? `20${15 + (i % 8)}-09-01` : '',
    status: sold ? 'sold' : i % 4 === 1 ? 'for-sale' : 'current',
    salePrice: sold ? String(4000 + i * 250) : '',
    tradeFor: i % 6 === 0 ? 'something with a clutch' : '',
    // Even cars: real pointer; car-3: deliberately dangling; rest: null.
    coverPhoto: i % 2 === 0 ? `${id}-photo-0` : i === 3 ? 'dangling-photo' : null,
    createdAt: `20${10 + (i % 12)}-01-01`,
    photos: Array.from({ length: shape.photos }, (_, p) => ({
      id: `${id}-photo-${p}`,
      dataUrl: 'data:image/webp;base64,AAAA', // side-map only, never a cell
      caption: text(i + p, 3),
      uploadedAt: `2024-${pad(1 + (p % 12))}-01`,
    })),
    wishlist: Array.from({ length: shape.wishlist }, (_, w) => ({
      id: `${id}-wish-${w}`,
      name: text(i + w, 3),
      link: w % 2 === 0 ? '' : `https://example.com/p/${i}-${w}`,
      price: w % 3 === 0 ? null : w % 3 === 1 ? 0 : 25 * w + 9.99,
      category: text(w, 1),
      notes: text(i * 7 + w, 5),
      status: (['wanted', 'ordered', 'installed'] as const)[w % 3]!,
      addedAt: `2023-${pad(1 + (w % 12))}-11`,
    })),
    mods: Array.from({ length: shape.mods }, (_, m) => ({
      id: `${id}-mod-${m}`,
      name: text(i + m + 2, 3),
      category: text(m, 1),
      description: text(i * 11 + m, 8),
      cost: m % 4 === 0 ? null : m % 4 === 1 ? 0 : 80 * m + 19.5,
      installedDate: `20${14 + (m % 10)}-${pad(1 + (m % 12))}-20`,
      shop: m % 2 === 0 ? 'DIY' : text(m + 4, 2),
      link: '',
      addedAt: `20${14 + (m % 10)}-01-02`,
    })),
    // "Years of history": dates spread over a decade per car.
    maintenance: Array.from({ length: shape.maintenance }, (_, r) => ({
      id: `${id}-rec-${r}`,
      service: text(i + r, 3),
      date: `20${14 + (r % 10)}-${pad(1 + (r % 12))}-15`,
      mileage: r % 5 === 0 ? null : r % 5 === 1 ? 'unknown' : `${30_000 + 1000 * r}`,
      cost: r % 4 === 0 ? 0 : 45 + r * 3,
      shop: text(r, 2),
      notes: text(i * 31 + r, 9),
      nextDueDate: r % 3 === 0 ? '' : `20${15 + (r % 9)}-06-01`,
      nextDueMileage: r % 2 === 0 ? '' : `${40_000 + 1000 * r}`,
      createdAt: `20${14 + (r % 10)}-${pad(1 + (r % 12))}-15`,
    })),
    todos: Array.from({ length: shape.todos }, (_, t) => ({
      id: `${id}-todo-${t}`,
      text: text(i * 13 + t, 6),
      priority: (['low', 'medium', 'high'] as const)[t % 3]!,
      done: t % 2 === 0,
      createdAt: `2025-${pad(1 + (t % 12))}-05`,
    })),
    issues: Array.from({ length: shape.issues }, (_, s) => ({
      id: `${id}-issue-${s}`,
      title: text(i + s + 1, 4),
      description: text(i * 17 + s, 8),
      severity: (['minor', 'moderate', 'critical'] as const)[s % 3]!,
      status: (['open', 'in-progress', 'resolved'] as const)[s % 3]!,
      createdAt: `2024-${pad(1 + (s % 12))}-09`,
      resolvedAt: s % 3 === 2 ? `2025-${pad(1 + (s % 12))}-01` : null,
    })),
  }
}

/** Same setRow pattern the web adapter uses (and sync-seed.test.ts). */
function setCarRows(store: MergeableStore, flat: FlattenedCar): void {
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

function buildGarageStore(uniqueId: string, shape: GarageShape): MergeableStore {
  const store = createGarageStore(uniqueId)
  store.transaction(() => {
    for (let i = 0; i < shape.cars; i++) {
      setCarRows(store, flattenCar(syntheticCar(i, shape), SETTINGS))
    }
    store.setValues({
      themeId: 'midnight',
      customAccent: '#ff5500',
      currency: 'USD',
      distanceUnit: 'mi',
    })
  })
  // Tombstones ride along in the seed (deleted rows leave undefined stamps).
  for (let i = 0; i < shape.cars; i += 4) {
    store.delRow('todos', `car-${i}-todo-0`)
  }
  return store
}

interface ContentStats {
  liveCells: number
  tombstoneCells: number
  values: number
  serializedBytes: number
}

function contentStats(store: MergeableStore): ContentStats {
  const content = store.getMergeableContent()
  let liveCells = 0
  let tombstoneCells = 0
  for (const [rowStamps] of Object.values(content[0][0])) {
    for (const [cellStamps] of Object.values(rowStamps)) {
      for (const [cell] of Object.values(cellStamps)) {
        if (cell === undefined) tombstoneCells += 1
        else liveCells += 1
      }
    }
  }
  const serializedBytes = new TextEncoder().encode(
    JSON.stringify(content, (_k, v: unknown) => (v === undefined ? '￼' : v)),
  ).length
  return {
    liveCells,
    tombstoneCells,
    values: Object.keys(content[1][0]).length,
    serializedBytes,
  }
}

// ── Behavior-based storage probes (no hard-coded table names) ───────────────

function userTableNames(sql: SqlStorage): string[] {
  return sql
    .exec(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .toArray()
    .map((row) => String(row.name))
    .filter((name) => !name.startsWith('_cf_') && !name.startsWith('sqlite_'))
}

interface StorageProbe {
  tables: { name: string; rows: number; totalBytes: number; maxRowBytes: number }[]
  totalRows: number
  totalBytes: number
  maxRowBytes: number
}

function probeStorage(sql: SqlStorage): StorageProbe {
  const tables = userTableNames(sql).map((name) => {
    let rows = 0
    let totalBytes = 0
    let maxRowBytes = 0
    for (const row of sql.exec(`SELECT * FROM "${name}"`)) {
      rows += 1
      const bytes = JSON.stringify(row).length
      totalBytes += bytes
      if (bytes > maxRowBytes) maxRowBytes = bytes
    }
    return { name, rows, totalBytes, maxRowBytes }
  })
  return {
    tables,
    totalRows: tables.reduce((sum, t) => sum + t.rows, 0),
    totalBytes: tables.reduce((sum, t) => sum + t.totalBytes, 0),
    maxRowBytes: tables.reduce((max, t) => Math.max(max, t.maxRowBytes), 0),
  }
}

/**
 * Multiset of every persisted row (ground truth for "what did this exchange
 * write?"): an updated row counts as one removal + one addition.
 */
function snapshotRows(sql: SqlStorage): Map<string, number> {
  const snapshot = new Map<string, number>()
  for (const name of userTableNames(sql)) {
    for (const row of sql.exec(`SELECT * FROM "${name}"`)) {
      const key = `${name} ${JSON.stringify(row)}`
      snapshot.set(key, (snapshot.get(key) ?? 0) + 1)
    }
  }
  return snapshot
}

function diffRowSnapshots(
  before: Map<string, number>,
  after: Map<string, number>,
): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const [key, count] of after) {
    const prev = before.get(key) ?? 0
    if (count > prev) added += count - prev
  }
  for (const [key, count] of before) {
    const next = after.get(key) ?? 0
    if (count > next) removed += count - next
  }
  return { added, removed }
}

// ── DO access helpers ───────────────────────────────────────────────────────

const gateStub = () => env.GARAGE_DO.get(env.GARAGE_DO.idFromName(session.userId))
const namedStub = (name: string) => env.GARAGE_DO.get(env.GARAGE_DO.idFromName(name))
type Stub = ReturnType<typeof namedStub>

const doSnapshot = (stub: Stub) =>
  runInDurableObject(stub, (_instance, state) => snapshotRows(state.storage.sql))

const doHashes = (stub: Stub) =>
  runInDurableObject(stub, (instance) =>
    (instance as GarageDO).store!.getMergeableContentHashes(),
  )

// ── Real WsSynchronizer client over the Worker's /sync route ────────────────

/**
 * createWsSynchronizer (verified in the installed source) needs
 * addEventListener/removeEventListener/send/close plus `readyState` compared
 * against an `OPEN` property on the SOCKET INSTANCE. Browser sockets inherit
 * OPEN from the prototype; workerd sockets expose only the numeric
 * readyState, so without this adapter the synchronizer would wait forever
 * for an 'open' event that already happened.
 */
function adaptSocket(ws: WebSocket): WebSocket {
  return {
    OPEN: 1,
    readyState: 1,
    addEventListener: ws.addEventListener.bind(ws),
    removeEventListener: ws.removeEventListener.bind(ws),
    send: ws.send.bind(ws),
    close: ws.close.bind(ws),
  } as unknown as WebSocket
}

interface WireStats {
  sent: number
  received: number
  sentBytes: number
  receivedBytes: number
  maxMessageBytes: number
  lastActivity: number
}

const newWireStats = (): WireStats => ({
  sent: 0,
  received: 0,
  sentBytes: 0,
  receivedBytes: 0,
  maxMessageBytes: 0,
  lastActivity: Date.now(),
})

/** Approximate payload size: the synchronizer body, sentinel-encoded. */
function bodyBytes(body: unknown): number {
  const encoded = JSON.stringify(body, (_k, v: unknown) =>
    v === undefined ? '￼' : v,
  )
  return encoded === undefined ? 0 : encoded.length
}

async function openWorkerSyncSocket(cookie: string, key: string): Promise<WebSocket> {
  const res = await SELF.fetch(`${BASE}/sync`, {
    headers: { Upgrade: 'websocket', 'sec-websocket-key': key, cookie },
  })
  expect(res.status).toBe(101)
  const ws = res.webSocket
  if (!ws) throw new Error('no webSocket on the 101 response')
  return ws as unknown as WebSocket
}

/** Bypasses the Worker (control/ceiling probes only — see module docblock). */
async function openDirectSyncSocket(stub: Stub, pathId: string, key: string): Promise<WebSocket> {
  const res = await stub.fetch(`https://do/${pathId}`, {
    headers: { Upgrade: 'websocket', 'sec-websocket-key': key },
  })
  expect(res.status).toBe(101)
  const ws = res.webSocket
  if (!ws) throw new Error('no webSocket on the 101 DO response')
  return ws as unknown as WebSocket
}

async function attachSynchronizer(store: MergeableStore, ws: WebSocket, stats: WireStats) {
  const synchronizer = await createWsSynchronizer(
    store,
    adaptSocket(ws),
    30,
    (_to, _req, _msg, body) => {
      stats.sent += 1
      const bytes = bodyBytes(body)
      stats.sentBytes += bytes
      stats.maxMessageBytes = Math.max(stats.maxMessageBytes, bytes)
      stats.lastActivity = Date.now()
    },
    (_from, _req, _msg, body) => {
      stats.received += 1
      const bytes = bodyBytes(body)
      stats.receivedBytes += bytes
      stats.maxMessageBytes = Math.max(stats.maxMessageBytes, bytes)
      stats.lastActivity = Date.now()
    },
  )
  // Listeners are registered; only now let queued messages flow.
  ws.accept()
  await synchronizer.startSync()
  return synchronizer
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor(
  condition: () => boolean | Promise<boolean>,
  what: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await condition()) return
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(50)
  }
}

async function waitForWireQuiet(stats: WireStats, quietMs = 600, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    await sleep(100)
    if (Date.now() - stats.lastActivity >= quietMs) return
    if (Date.now() > deadline) throw new Error('sync wire never went quiet')
  }
}

// ── HTTP seed protocol ──────────────────────────────────────────────────────

async function getMeta(cookie: string): Promise<SyncMetaResponse> {
  const res = await SELF.fetch(`${BASE}${SYNC_META_PATH}`, { headers: { cookie } })
  expect(res.status).toBe(200)
  return (await res.json()) as SyncMetaResponse
}

interface SeedRun {
  chunks: number
  cells: number
  maxBodyBytes: number
  msPerChunk: number[]
}

async function postChunks(cookie: string, chunks: SeedChunk[]): Promise<SeedRun> {
  const run: SeedRun = { chunks: chunks.length, cells: 0, maxBodyBytes: 0, msPerChunk: [] }
  for (const [index, chunk] of chunks.entries()) {
    const body = JSON.stringify({
      chunk: encodeSeedChunk(chunk),
      index,
      total: chunks.length,
    })
    run.maxBodyBytes = Math.max(run.maxBodyBytes, body.length)
    const t0 = Date.now()
    const res = await SELF.fetch(`${BASE}${SYNC_SEED_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body,
    })
    run.msPerChunk.push(Date.now() - t0)
    expect(res.status).toBe(200)
    const parsed = (await res.json()) as SeedChunkResponse
    expect(parsed.applied).toBe(true)
    run.cells += parsed.cells
  }
  return run
}

function msStats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b)
  return {
    min: sorted[0] ?? 0,
    median: sorted[Math.floor(sorted.length / 2)] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    total: sorted.reduce((sum, ms) => sum + ms, 0),
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('M2 gate: #268 fragmented-persister behavior against a real DO', () => {
  it(
    '(b)+(c) chunked stamped seed -> delta-only attach -> bounded edits -> full down-sync',
    { timeout: 240_000 },
    async () => {
      const { cookie } = session
      const report: Record<string, unknown> = {}

      // 1. Large synthetic garage, deterministically generated.
      const clientA = buildGarageStore('m2-client-a', GATE_SHAPE)
      const stats = contentStats(clientA)
      report.garage = stats
      // Comfortably past the ~200 KB single-save zone reported in #268.
      expect(stats.serializedBytes).toBeGreaterThan(400_000)
      expect(stats.liveCells).toBeGreaterThan(8_000)
      expect(stats.tombstoneCells).toBeGreaterThan(0)

      // The DO starts empty (per-test isolated storage).
      expect((await getMeta(cookie)).isEmpty).toBe(true)

      // 2. Seed via chunked STAMPED RPCs through the authed route.
      const chunks = chunkMergeableContent(clientA.getMergeableContent(), {
        maxCellsPerChunk: DEFAULT_SEED_CHUNK_CELLS,
      })
      const seedRun = await postChunks(cookie, chunks)
      report.seed = {
        budget: DEFAULT_SEED_CHUNK_CELLS,
        chunks: seedRun.chunks,
        cellsApplied: seedRun.cells,
        maxBodyBytes: seedRun.maxBodyBytes,
        ms: msStats(seedRun.msPerChunk),
      }
      expect(seedRun.cells).toBe(stats.liveCells + stats.tombstoneCells + stats.values)

      // Seed landed: live row counts match the client store...
      const meta = await getMeta(cookie)
      expect(meta.isEmpty).toBe(false)
      for (const tableId of clientA.getTableIds()) {
        expect(meta.rowCounts[tableId], tableId).toBe(clientA.getRowCount(tableId))
      }
      // ...and the DO's stamps + hashes are IDENTICAL to the client's (the
      // precondition for a delta-only attach).
      expect(await doHashes(gateStub())).toStrictEqual(
        clientA.getMergeableContentHashes(),
      )

      // 3. (b) Storage behavior: many small per-cell rows in DISCOVERED
      // tables — never one JSON blob row (which would be ~serializedBytes).
      const probe = await runInDurableObject(gateStub(), (_instance, state) =>
        probeStorage(state.storage.sql),
      )
      report.storage = {
        tables: probe.tables,
        totalRows: probe.totalRows,
        totalBytes: probe.totalBytes,
        maxRowBytes: probe.maxRowBytes,
        // Everything beyond one row per live cell/value is persister
        // overhead (parent-stamp rows; duplicated per save — see M2_GATE.md).
        overheadRows: probe.totalRows - stats.liveCells - stats.values,
      }
      expect(probe.totalRows).toBeGreaterThanOrEqual(stats.liveCells + stats.values)
      expect(probe.maxRowBytes).toBeLessThan(2_048)
      expect(probe.maxRowBytes * 50).toBeLessThan(stats.serializedBytes)

      // 4. Idempotency at gate scale: re-applying EVERY chunk is a complete
      // no-op — zero rows written (LWW finds hlc == oldHlc; the autosave has
      // nothing to persist). This is also the partial-slice-validity check:
      // hashes assembled from slices already matched the source above.
      const beforeReseed = await doSnapshot(gateStub())
      const reseed = await postChunks(cookie, chunks)
      expect(reseed.cells).toBe(seedRun.cells)
      const afterReseed = await doSnapshot(gateStub())
      expect(diffRowSnapshots(beforeReseed, afterReseed)).toEqual({
        added: 0,
        removed: 0,
      })
      expect(await doHashes(gateStub())).toStrictEqual(
        clientA.getMergeableContentHashes(),
      )

      // 5. (c) THE GATE: attach a REAL WsSynchronizer to /sync. Stamps match,
      // so the exchange must be hashes-only: ZERO rows written on the DO.
      const wireA = newWireStats()
      const wsA = await openWorkerSyncSocket(cookie, 'm2-client-a-key')
      const preAttach = await doSnapshot(gateStub())
      const tAttach = Date.now()
      const syncA = await attachSynchronizer(clientA, wsA, wireA)
      await waitForWireQuiet(wireA)
      const attachMs = Date.now() - tAttach
      const postAttach = await doSnapshot(gateStub())
      const attachDiff = diffRowSnapshots(preAttach, postAttach)
      report.attach = {
        ...attachDiff,
        ms: attachMs,
        messages: wireA.sent + wireA.received,
        approxWireBytes: wireA.sentBytes + wireA.receivedBytes,
        maxMessageBytes: wireA.maxMessageBytes,
      }
      expect(attachDiff).toEqual({ added: 0, removed: 0 })
      // Hash negotiation only — nothing remotely near a full-store exchange.
      expect(wireA.sentBytes + wireA.receivedBytes).toBeLessThan(2_000)

      // 6. Genuine deltas after attach stay bounded: one cell edit + one new
      // row write exactly themselves (+ parent-stamp rows for <=2 saves).
      clientA.setCell('cars', 'car-0', 'nickname', 'Updated after seed')
      clientA.setRow('todos', 'post-seed-todo', {
        carId: 'car-0',
        text: 'verify deltas after attach',
        priority: 'low',
        done: false,
        createdAt: '2026-06-12',
      })
      await waitFor(
        async () =>
          await runInDurableObject(gateStub(), (instance) => {
            const store = (instance as GarageDO).store!
            return (
              store.getCell('cars', 'car-0', 'nickname') === 'Updated after seed' &&
              store.getCell('todos', 'post-seed-todo', 'text') !== undefined
            )
          }),
        'the two edits to reach the DO',
      )
      await waitForWireQuiet(wireA)
      const postEdit = await doSnapshot(gateStub())
      const editDiff = diffRowSnapshots(postAttach, postEdit)
      report.editDeltas = editDiff
      // 6 cells changed/created; the rest is bounded parent-stamp overhead.
      expect(editDiff.added).toBeGreaterThanOrEqual(6)
      expect(editDiff.added).toBeLessThanOrEqual(30)
      expect(editDiff.removed).toBeLessThanOrEqual(4)

      await syncA.destroy()

      // 7. Fresh second client (empty local store) down-syncs the FULL
      // garage; the DO performs reads only (zero rows written).
      //
      // The fresh client is a raw (schema-less) MergeableStore on purpose:
      // applying the shared schema MATERIALIZES the Values defaults
      // (themeId/currency/distanceUnit) as REAL stamped values at store
      // creation, and those fresh stamps are NEWER than the cloud's
      // user-chosen settings — under LWW the blank device would clobber them.
      // That hazard is demonstrated in its own test below; the M2 adapter
      // must resolve Values cloud-wins BEFORE attaching (plan, Migration).
      const clientB = createMergeableStore('m2-client-b')
      const wireB = newWireStats()
      const wsB = await openWorkerSyncSocket(cookie, 'm2-client-b-key')
      const targetHashes = await doHashes(gateStub())
      const preDown = await doSnapshot(gateStub())
      const tDown = Date.now()
      const syncB = await attachSynchronizer(clientB, wsB, wireB)
      await waitFor(
        () =>
          JSON.stringify(clientB.getMergeableContentHashes()) ===
          JSON.stringify(targetHashes),
        'the second client to converge',
        60_000,
      )
      const downMs = Date.now() - tDown
      await waitForWireQuiet(wireB)
      const postDown = await doSnapshot(gateStub())
      report.downSync = {
        ms: downMs,
        messages: wireB.sent + wireB.received,
        approxWireBytes: wireB.sentBytes + wireB.receivedBytes,
        maxMessageBytes: wireB.maxMessageBytes,
        ...diffRowSnapshots(preDown, postDown),
      }
      expect(diffRowSnapshots(preDown, postDown)).toEqual({ added: 0, removed: 0 })
      // The second device really has the whole garage, edits included.
      expect(clientB.getContent()).toStrictEqual(clientA.getContent())
      expect(clientB.getCell('cars', 'car-0', 'nickname')).toBe('Updated after seed')
      await syncB.destroy()

      console.log(`[M2:gate] ${JSON.stringify(report)}`)
    },
  )

  it(
    '(4) control: PLAIN-value seeding (fresh stamps) makes attach a full-store reconcile',
    { timeout: 240_000 },
    async () => {
      const report: Record<string, unknown> = {}
      const stub = namedStub('m2-control')
      const cars = Array.from({ length: CONTROL_SHAPE.cars }, (_, i) =>
        syntheticCar(i, CONTROL_SHAPE),
      )

      // A: seed the DO with PLAIN VALUES — the DO mints FRESH stamps (this is
      // exactly what a naive "POST the cars as JSON" migration would do).
      // Same isolate, so the transaction-log closure works.
      const txLog: number[] = []
      await runInDurableObject(stub, (instance) => {
        const store = (instance as GarageDO).store!
        store.addDidFinishTransactionListener(() => txLog.push(Date.now()))
        store.transaction(() => {
          for (const car of cars) setCarRows(store, flattenCar(car, SETTINGS))
          store.setValues({
            themeId: 'midnight',
            customAccent: '#ff5500',
            currency: 'USD',
            distanceUnit: 'mi',
          })
        })
      })
      const seedTxCount = txLog.length

      // B: the client builds the same garage strictly LATER and then EDITS
      // EVERY CELL, so both stamps and values diverge everywhere with the
      // client newer (deterministic LWW direction: the client should win
      // every cell). Divergent VALUES matter for the write-shape measurement:
      // a merge that replaces only the stamp of an identical value does not
      // change the raw store, so the per-transaction autosave persists
      // nothing for it (the new stamp lives in memory only — measured during
      // development; see M2_GATE.md "stamp-only merges").
      await sleep(20)
      const clientC = buildGarageStore('m2-client-c', CONTROL_SHAPE)
      clientC.transaction(() => {
        for (const tableId of clientC.getTableIds()) {
          clientC.forEachRow(tableId, (rowId) => {
            clientC.forEachCell(tableId, rowId, (cellId, cell) => {
              clientC.setCell(
                tableId,
                rowId,
                cellId,
                typeof cell === 'string'
                  ? `${cell}~`
                  : typeof cell === 'number'
                    ? cell + 1
                    : !cell,
              )
            })
          })
        }
      })
      const stats = contentStats(clientC)
      report.garage = stats

      // Stamps differ even though the cell values are identical.
      const plainHashes = await doHashes(stub)
      expect(plainHashes).not.toStrictEqual(clientC.getMergeableContentHashes())

      // C: attach a real synchronizer for a fixed window. Every hash level
      // differs, so the negotiation exchanges full-store diffs (~the whole
      // serialized garage per round) instead of the gate's few hundred bytes.
      //
      // Observed (and asserted) local outcome: the DO NEVER adopts the
      // client's stamps. Verified cause, by tracing inside the DO during
      // development: WsServerDurableObject's server-side synchronizer
      // registers its apply listener (`persisterListener`) only AFTER its
      // constructor-time `load()` resolves, and that load blocks on a
      // GetContentHashes request — sent when no client is connected — for the
      // hardcoded requestTimeoutSeconds=1. Incoming reconciles inside that
      // window hit `persisterListener?.()` while it is still undefined and
      // are SILENTLY DROPPED (zero server-side transactions despite full
      // cell-diff responses delivered); afterwards the two sides settle into
      // a repeating full-diff exchange that never applies. In production the
      // same ~1s cold-start drop window exists after every DO wake. The
      // stamped chunked seed is immune: its attach has NOTHING to apply.
      const wireC = newWireStats()
      const ws = await openDirectSyncSocket(stub, 'm2-control', 'm2-control-key')
      const preAttach = await doSnapshot(stub)
      const syncC = await attachSynchronizer(clientC, ws, wireC)
      const OBSERVATION_MS = 5_000
      await sleep(OBSERVATION_MS)
      const postAttach = await doSnapshot(stub)
      const attachDiff = diffRowSnapshots(preAttach, postAttach)
      const converged =
        JSON.stringify(await doHashes(stub)) ===
        JSON.stringify(clientC.getMergeableContentHashes())
      report.attachWindow = {
        ms: OBSERVATION_MS,
        converged,
        ...attachDiff,
        messages: wireC.sent + wireC.received,
        approxWireBytes: wireC.sentBytes + wireC.receivedBytes,
        maxMessageBytes: wireC.maxMessageBytes,
        serverTransactions: txLog.length - seedTxCount,
      }
      await syncC.destroy()

      // The premise the gate rests on, falsified from both directions:
      // plain-value seeding turns attach into full-store reconcile traffic
      // (each negotiation round re-ships ~every cell stamp; compare
      // maxMessageBytes with the gate attach's < 2 KB total)...
      expect(wireC.maxMessageBytes).toBeGreaterThan(100_000)
      // ...and locally it does not even converge (see drop-window note above).
      expect(converged).toBe(false)
      expect(attachDiff).toEqual({ added: 0, removed: 0 })

      // D: the write shape the synchronizer performs when its apply DOES go
      // through (post-window in production): the negotiated full-store diff
      // lands in ONE applyMergeableChanges — one transaction, one fragmented
      // save, every cell row rewritten. Demonstrated directly against the
      // same DO storage (chunk budget set above the store size => the whole
      // tables tree in a single changes object, exactly like the
      // synchronizer's assembled tablesChanges).
      const fullChunks = chunkMergeableContent(clientC.getMergeableContent(), {
        maxCellsPerChunk: 1_000_000,
      })
      expect(fullChunks.length).toBe(2) // tables + values
      const txBefore = txLog.length
      const preApply = await doSnapshot(stub)
      const tApply = Date.now()
      await runInDurableObject(stub, async (instance) => {
        const store = (instance as GarageDO).store!
        for (const chunk of fullChunks) store.applyMergeableChanges(chunk)
        await sleep(0) // drain the persister microtasks (sync SQL execs)
      })
      const applyMs = Date.now() - tApply
      const postApply = await doSnapshot(stub)
      const applyDiff = diffRowSnapshots(preApply, postApply)
      const applyTx = txLog.length - txBefore
      report.fullReconcileWrite = {
        ...applyDiff,
        ms: applyMs,
        transactions: applyTx,
        cellsPerTransaction: Math.round(
          (stats.liveCells + stats.tombstoneCells) / Math.max(applyTx - 1, 1),
        ),
      }
      // Every cell row rewritten (client stamps replace server stamps), in
      // ~one giant save — unbounded by anything the app controls. Contrast:
      // the stamped-seed attach above wrote ZERO rows.
      expect(applyTx).toBe(2)
      expect(applyDiff.removed).toBeGreaterThanOrEqual(stats.liveCells)
      expect(applyDiff.added).toBeGreaterThanOrEqual(stats.liveCells)
      // And now the DO matches the client — convergence required the bulk
      // write the synchronizer could not deliver.
      expect(await doHashes(stub)).toStrictEqual(
        clientC.getMergeableContentHashes(),
      )

      console.log(`[M2:control] ${JSON.stringify(report)}`)
    },
  )

  it(
    'fresh schema-applied client fabricates Values default stamps that clobber cloud settings',
    { timeout: 120_000 },
    async () => {
      // Dedicated DO + direct socket: the gate test's DO (same session user)
      // keeps its in-memory stamp map across tests in this pool (hibernatable
      // WebSockets survive the per-test reset), so reusing it here would
      // merge two seeds. Auth is already covered by the gate path.
      const stub = namedStub('m2-values')
      // Cloud garage with user-chosen settings, seeded the RIGHT way.
      const clientA = buildGarageStore('m2-values-a', { ...GATE_SHAPE, cars: 1 })
      expect(clientA.getValue('themeId')).toBe('midnight')
      const chunks = chunkMergeableContent(clientA.getMergeableContent(), {
        maxCellsPerChunk: DEFAULT_SEED_CHUNK_CELLS,
      })
      await runInDurableObject(stub, (instance) => {
        for (const chunk of chunks) {
          const result = (instance as GarageDO).seedGarage(encodeSeedChunk(chunk))
          expect(result.applied).toBe(true)
        }
      })
      expect(await doHashes(stub)).toStrictEqual(
        clientA.getMergeableContentHashes(),
      )

      // Give the server-side synchronizer time to pass its ~1s cold-start
      // listener-registration window (see the control test) so the apply
      // below is actually received.
      await sleep(1_500)

      // A fresh, EMPTY device applying the shared schema: the Values schema
      // defaults materialize as REAL stamped values at creation — stamps
      // NEWER than the cloud's user-chosen settings.
      const fresh = createGarageStore('m2-values-fresh')
      expect(fresh.getValue('themeId')).toBe('garage') // fabricated, stamped
      const freshThemeStamp = fresh.getMergeableContent()[1][0]['themeId']
      const cloudThemeStamp = clientA.getMergeableContent()[1][0]['themeId']
      expect(freshThemeStamp![1]! > cloudThemeStamp![1]!).toBe(true)

      const wire = newWireStats()
      const ws = await openDirectSyncSocket(stub, 'm2-values', 'm2-values-key')
      const sync = await attachSynchronizer(fresh, ws, wire)
      await waitForWireQuiet(wire)
      await sync.destroy()

      // Under LWW the blank device's fabricated defaults WIN: the cloud's
      // themeId/currency/distanceUnit get clobbered back to defaults (and the
      // fresh device never adopts 'midnight'). This is why the M2 web adapter
      // MUST resolve Values with deterministic cloud-wins precedence BEFORE
      // attaching the synchronizer (plan: Migration; Risk #10) — a fresh
      // schema-applied store must never sync its untouched default Values.
      const cloudValues = await runInDurableObject(stub, (instance) =>
        (instance as GarageDO).store!.getValues(),
      )
      expect(fresh.getValue('themeId')).toBe('garage')
      expect(cloudValues['themeId']).toBe('garage') // was 'midnight' — clobbered
      // customAccent has no schema default (nullable) — it survives.
      expect(fresh.getValue('customAccent')).toBe('#ff5500')
      console.log(
        `[M2:values-clobber] ${JSON.stringify({ cloudValues, freshThemeStamp, cloudThemeStamp })}`,
      )
    },
  )

  // ── (5) Ceiling probe ─────────────────────────────────────────────────────
  // How big can ONE applyMergeableChanges-triggered fragmented save get
  // locally before something breaks? Bypasses the seed route on purpose (it
  // caps chunks at MAX_SEED_CHUNK_CELLS); this probes the persister itself.
  // Local workerd enforces no production CPU/wall-clock limits — treat these
  // as throughput datapoints, NOT proof that production survives the same.
  const CEILING_STEPS = [1_000, 5_000, 20_000, 50_000]

  for (const cells of CEILING_STEPS) {
    it(
      `(5) ceiling probe: ${cells} cells in ONE applyMergeableChanges save`,
      { timeout: 240_000 },
      async () => {
        // Schemaless source store: rows of 10 ~30-byte cells.
        const source = createMergeableStore(`probe-src-${cells}`)
        source.transaction(() => {
          for (let r = 0; r < cells / 10; r++) {
            const row: Record<string, string | number> = {}
            for (let c = 0; c < 10; c++) {
              row[`c${c}`] = c % 3 === 0 ? r * 10 + c : text(r + c, 4)
            }
            source.setRow('probe', `row-${r}`, row)
          }
        })
        const chunks = chunkMergeableContent(source.getMergeableContent(), {
          maxCellsPerChunk: cells,
        })
        expect(chunks).toHaveLength(1)
        const chunkBytes = encodeSeedChunk(chunks[0]!).length

        const stub = namedStub(`m2-ceiling-${cells}`)
        // Warm the instance first so constructor cost (load + initial save)
        // doesn't pollute the apply measurement.
        const tWarm = Date.now()
        await runInDurableObject(stub, () => undefined)
        const warmMs = Date.now() - tWarm

        const tOuter = Date.now()
        const inner = await runInDurableObject(stub, async (instance, state) => {
          const store = (instance as GarageDO).store!
          const t0 = Date.now()
          store.applyMergeableChanges(chunks[0]!)
          const t1 = Date.now()
          // One macrotask drains the persister's microtask chain (the SQL
          // execs are synchronous), so the row count below proves the save
          // completed inside this call.
          await sleep(0)
          const t2 = Date.now()
          const rows = probeStorage(state.storage.sql).totalRows
          return { applyMs: t1 - t0, persistMs: t2 - t1, rows }
        })
        const totalMs = Date.now() - tOuter

        // The save completed, per-cell (>= one row per cell), no reset/error.
        expect(inner.rows).toBeGreaterThanOrEqual(cells)

        // Cold start: every DO wake re-persists the FULL store (verified in
        // the installed WsServerDurableObject: constructor load() is followed
        // by startAutoSave()'s unconditional initial save). abort() is the
        // only way to force that locally; guarded because it intentionally
        // breaks the instance.
        let coldStartMs: number | null
        try {
          await runInDurableObject(stub, (_instance, state) => {
            state.abort()
          })
        } catch {
          // abort() always throws/rejects — expected.
        }
        try {
          const tCold = Date.now()
          const rowsAfter = await runInDurableObject(
            namedStub(`m2-ceiling-${cells}`),
            (_instance, state) => probeStorage(state.storage.sql).totalRows,
          )
          coldStartMs = Date.now() - tCold
          expect(rowsAfter).toBeGreaterThanOrEqual(cells)
        } catch {
          coldStartMs = null // not measurable in this environment
        }

        console.log(
          `[M2:ceiling] ${JSON.stringify({
            cells,
            chunkBytes,
            warmMs,
            applyMs: inner.applyMs,
            persistMs: inner.persistMs,
            inDoMs: inner.applyMs + inner.persistMs,
            totalMs,
            rows: inner.rows,
            coldStartMs,
          })}`,
        )
      },
    )
  }
})
