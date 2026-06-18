/**
 * Sync wiring (M2, gates (e)/(f)) — the golden rule: ALL migration / merge
 * resolution / DO seeding & clearing happens via bounded chunked RPCs BEFORE
 * the WS synchronizer attaches. The synchronizer then only ever exchanges
 * genuine deltas, never the un-chunkable full-store reconcile of TinyBase
 * #268.
 *
 * Decision matrix (decideSyncPlan, pure — unit tested):
 * - cloud no rows + local no rows → attach
 * - cloud no rows + local rows    → seed → verify → attach
 * - cloud rows    + local no rows → adopt cloud values → attach (download)
 * - cloud rows    + local rows    → explicit user choice:
 *     Merge (default) → adopt cloud values → seed → attach   (union; same-id
 *                       rows resolve per-cell LWW; distinct ids may duplicate)
 *     Keep cloud      → reset local (stamp map included) → attach
 *     Keep local      → clear cloud (chunked tombstones) → RE-STAMP local →
 *                       seed → verify → attach
 *
 * Why the extra steps exist:
 * - "adopt cloud values" (apply-cloud-values) implements deterministic
 *   cloud-wins for Values WITHOUT an extra endpoint: the local store's VALUE
 *   stamps are dropped (setMergeableContent of [tables, empty-values]
 *   preserves table stamps verbatim), so the DO's values flow in unopposed on
 *   attach and the subsequent seed carries no competing value stamps. Wall
 *   clock HLC order never decides settings.
 * - "re-stamp local" (restamp-local) is REQUIRED after a cloud clear: the
 *   DO's clear tombstones carry fresh DO-side HLCs that out-stamp the local
 *   store's original cell stamps, so for every (table,row,cell) path the DO
 *   previously held, seeding original stamps would be a silent LWW no-op —
 *   and attach would then propagate those tombstones and delete the matching
 *   local cells. Re-minting the local stamps (reset stamp map + setContent)
 *   makes the seed win. Before re-stamping we additionally WAIT until the
 *   client's clock reads past the server's Date header (clock-skew guard):
 *   HLCs compare clock READINGS, so once our reading exceeds the server's
 *   reported reading the new stamps beat the tombstones regardless of which
 *   wall clock is "right".
 * - "verify-seed" re-reads /api/sync/meta and compares live row counts before
 *   attaching — the backstop when a seed is wholesale-swallowed. Residual
 *   (documented) gap: counts cannot detect PARTIALLY swallowed rows, and a DO
 *   whose HLC clock ran ahead of wall time (seenHlc of a fast client's
 *   stamps) could still out-stamp a re-seed; closing that fully needs a
 *   contract addition (clear response exposing the DO's post-clear HLC, or
 *   meta exposing content hashes) — deferred, flagged for the API owner.
 * - "reset local" (keep-cloud) resets the local stamp map rather than
 *   delRow-ing: local tombstones would out-stamp and DELETE the cloud rows on
 *   attach.
 *
 * The pure pieces (decideSyncPlan, runSyncSteps over an injected SyncEnv) are
 * unit tested against a simulated DO (a second MergeableStore driven through
 * the same shared seed/clear semantics as GarageDO).
 */
import {
  DEFAULT_SEED_CHUNK_CELLS,
  GARAGE_TABLE_IDS,
  SYNC_CLEAR_PATH,
  SYNC_META_PATH,
  SYNC_PATH,
  SYNC_SEED_PATH,
  chunkMergeableContent,
  encodeSeedChunk,
} from '@chudbox/shared'
import type { SeedChunkRequest, SyncMetaResponse } from '@chudbox/shared'
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client'
import type { WsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client'
import type { MergeableContent, MergeableStore, Store } from 'tinybase'
import {
  NEEDS_RESEED_VALUE,
  PAIRED_USER_VALUE,
  PHOTO_PAYLOADS_TABLE,
} from './adapter'
import { emptyMergeableContent } from './backup'

// ── Pure decision logic ─────────────────────────────────────
export type MergeChoice = 'merge' | 'keep-cloud' | 'keep-local'

export type SyncStep =
  | 'apply-cloud-values'
  | 'seed'
  | 'verify-seed'
  | 'clear-cloud'
  | 'restamp-local'
  | 'reset-local'
  | 'attach'

export interface SyncPlanInput {
  cloudHasRows: boolean
  cloudHasValues: boolean
  localHasRows: boolean
  choice?: MergeChoice
}

export type SyncDecision =
  | { kind: 'plan'; steps: SyncStep[] }
  | { kind: 'need-choice' }

export function decideSyncPlan(input: SyncPlanInput): SyncDecision {
  const { cloudHasRows, cloudHasValues, localHasRows, choice } = input
  const adoptCloudValues: SyncStep[] = cloudHasValues ? ['apply-cloud-values'] : []
  if (!localHasRows) {
    // Nothing local to protect or seed — straight download.
    return { kind: 'plan', steps: [...adoptCloudValues, 'attach'] }
  }
  if (!cloudHasRows) {
    return {
      kind: 'plan',
      steps: [...adoptCloudValues, 'seed', 'verify-seed', 'attach'],
    }
  }
  // Both sides have car data: never blind-merge.
  if (choice === undefined) return { kind: 'need-choice' }
  switch (choice) {
    case 'merge':
      return { kind: 'plan', steps: [...adoptCloudValues, 'seed', 'attach'] }
    case 'keep-cloud':
      return { kind: 'plan', steps: ['reset-local', 'attach'] }
    case 'keep-local':
      return {
        kind: 'plan',
        steps: ['clear-cloud', 'restamp-local', 'seed', 'verify-seed', 'attach'],
      }
  }
}

// ── Step primitives (pure over injected stores) ─────────────

/** Drop local VALUE stamps, keep table stamps verbatim (cloud-wins Values). */
function resetLocalValueStamps(store: MergeableStore): void {
  const [tables] = store.getMergeableContent()
  store.setMergeableContent([tables, [{}, '', 0]] as unknown as MergeableContent)
}

/** Wholesale local reset: data AND stamp map (keep-cloud — no tombstones). */
function resetLocalStore(store: MergeableStore, localStore: Store): void {
  store.setMergeableContent(emptyMergeableContent())
  // Cloud photos have no local payloads until M3; orphaned blobs go too.
  // Sentinels (values) are intentionally untouched.
  localStore.delTable(PHOTO_PAYLOADS_TABLE)
}

/** Re-mint every local stamp at "now" (post-clear seeds must out-stamp tombstones). */
function restampLocalStore(store: MergeableStore): void {
  const content = store.getContent()
  store.setMergeableContent(emptyMergeableContent())
  store.setContent(content)
}

export function localRowCounts(store: MergeableStore): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const tableId of GARAGE_TABLE_IDS) {
    counts[tableId] = store.getRowIds(tableId).length
  }
  return counts
}

function localHasRows(store: MergeableStore): boolean {
  return GARAGE_TABLE_IDS.some((tableId) => store.getRowIds(tableId).length > 0)
}

export class SeedVerificationError extends Error {
  constructor(tableId: string, expected: number, actual: number) {
    super(
      `seed verification failed: ${tableId} has ${actual} cloud rows, expected ${expected}`,
    )
    this.name = 'SeedVerificationError'
  }
}

// ── Step executor ───────────────────────────────────────────
export interface SyncEnv {
  store: MergeableStore
  localStore: Store
  /** Same-origin JSON fetch; throws on non-2xx. */
  fetchJson: (path: string, init?: { method?: string; body?: string }) => Promise<unknown>
  /** Construct + start the WS synchronizer (only ever called LAST). */
  attach: () => Promise<void>
  maxCellsPerChunk?: number
  /**
   * Server wall clock (ms) from the most recent RPC response's Date header.
   * restamp-local waits until the local clock reads past it (+ the header's
   * 1s granularity) so re-minted stamps beat the clear tombstones even when
   * the device clock is behind. Unset (tests / stripped header) → no wait.
   */
  lastServerDateMs?: number
}

/** Hard cap on how long restamp-local will wait out clock skew. */
const MAX_CLOCK_SKEW_WAIT_MS = 30_000
const DATE_HEADER_GRANULARITY_MS = 1_100

async function waitUntilClockPasses(serverDateMs: number | undefined): Promise<void> {
  if (serverDateMs === undefined) return
  const target = serverDateMs + DATE_HEADER_GRANULARITY_MS
  const wait = target - Date.now()
  if (wait <= 0) return
  if (wait > MAX_CLOCK_SKEW_WAIT_MS) {
    throw new Error(
      'this device’s clock is too far behind the server to safely keep local data',
    )
  }
  await new Promise<void>((resolve) => setTimeout(resolve, wait))
}

async function seedCloud(env: SyncEnv): Promise<void> {
  const chunks = chunkMergeableContent(env.store.getMergeableContent(), {
    maxCellsPerChunk: env.maxCellsPerChunk ?? DEFAULT_SEED_CHUNK_CELLS,
  })
  for (let index = 0; index < chunks.length; index++) {
    const body: SeedChunkRequest = {
      chunk: encodeSeedChunk(chunks[index]),
      index,
      total: chunks.length,
    }
    await env.fetchJson(SYNC_SEED_PATH, { method: 'POST', body: JSON.stringify(body) })
  }
}

async function verifySeed(env: SyncEnv): Promise<void> {
  const meta = (await env.fetchJson(SYNC_META_PATH)) as SyncMetaResponse
  const expected = localRowCounts(env.store)
  for (const tableId of GARAGE_TABLE_IDS) {
    const actual = meta.rowCounts[tableId] ?? 0
    if (actual !== expected[tableId]) {
      throw new SeedVerificationError(tableId, expected[tableId], actual)
    }
  }
}

export async function runSyncSteps(steps: SyncStep[], env: SyncEnv): Promise<void> {
  for (const step of steps) {
    switch (step) {
      case 'apply-cloud-values':
        resetLocalValueStamps(env.store)
        break
      case 'seed':
        await seedCloud(env)
        break
      case 'verify-seed':
        await verifySeed(env)
        break
      case 'clear-cloud':
        await env.fetchJson(SYNC_CLEAR_PATH, { method: 'POST', body: '{}' })
        break
      case 'restamp-local':
        await waitUntilClockPasses(env.lastServerDateMs)
        restampLocalStore(env.store)
        break
      case 'reset-local':
        resetLocalStore(env.store, env.localStore)
        break
      case 'attach':
        await env.attach()
        break
    }
  }
}

// ── Controller (browser singleton; deps injected for tests) ─
export type SyncStatus =
  | 'idle'
  | 'connecting'
  | 'awaiting-choice'
  | 'applying'
  | 'syncing'
  | 'disconnected'
  | 'error'

export interface SyncController {
  start: (userId: string) => void
  stop: () => void
  choose: (choice: MergeChoice) => void
  /** Local data was wholesale-replaced (backup import) — re-negotiate. */
  replaceLocalData: (replace: () => void) => void
  getStatus: () => SyncStatus
  getError: () => string | null
  subscribe: (listener: () => void) => () => void
}

export interface SyncControllerDeps {
  store: MergeableStore
  localStore: Store
  /**
   * Resolves when local persistence + the first-run import are done. Awaited
   * before ANY negotiation so emptiness/pairing are never judged against a
   * half-loaded store.
   */
  ready?: () => Promise<void>
  fetchJson?: SyncEnv['fetchJson']
  makeWebSocket?: () => WebSocket
}

async function defaultFetchJson(
  path: string,
  init: { method?: string; body?: string } | undefined,
  onServerDate: (ms: number) => void,
): Promise<unknown> {
  const response = await fetch(path, {
    method: init?.method ?? 'GET',
    body: init?.body,
    headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    credentials: 'same-origin',
  })
  const dateHeader = response.headers.get('date')
  if (dateHeader !== null) {
    const ms = Date.parse(dateHeader)
    if (!Number.isNaN(ms)) onServerDate(ms)
  }
  if (!response.ok) {
    throw new Error(`${path} failed with status ${response.status}`)
  }
  return response.json()
}

function defaultMakeWebSocket(): WebSocket {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws'
  return new WebSocket(`${proto}://${location.host}${SYNC_PATH}`)
}

export function createSyncController(deps: SyncControllerDeps): SyncController {
  const { store, localStore } = deps
  const fetchJson: SyncEnv['fetchJson'] =
    deps.fetchJson ??
    ((path, init) => defaultFetchJson(path, init, (ms) => (env.lastServerDateMs = ms)))
  const makeWebSocket = deps.makeWebSocket ?? defaultMakeWebSocket

  let status: SyncStatus = 'idle'
  let error: string | null = null
  let generation = 0
  let currentUserId: string | null = null
  let synchronizer: WsSynchronizer<WebSocket> | null = null
  /** Stashed when awaiting the user's merge choice. */
  let pendingInput: Omit<SyncPlanInput, 'choice'> | null = null

  const listeners = new Set<() => void>()
  const setStatus = (next: SyncStatus, message: string | null = null): void => {
    status = next
    error = message
    for (const listener of listeners) listener()
  }

  const destroySynchronizer = (): void => {
    if (synchronizer) {
      const current = synchronizer
      synchronizer = null
      void current.destroy()
    }
  }

  const attach = async (): Promise<void> => {
    const myGeneration = generation
    const ws = makeWebSocket()
    const created = await createWsSynchronizer(store, ws)
    if (myGeneration !== generation) {
      void created.destroy()
      return
    }
    synchronizer = created
    await created.startSync()
    ws.addEventListener('close', () => {
      if (myGeneration === generation && status === 'syncing') {
        // Per tinybase defaults there is no auto-reconnect; surface it.
        setStatus('disconnected')
      }
    })
  }

  const env: SyncEnv = { store, localStore, fetchJson, attach }

  const finishPairing = (userId: string): void => {
    localStore.setValue(PAIRED_USER_VALUE, userId)
    localStore.delValue(NEEDS_RESEED_VALUE)
  }

  const runPlan = async (steps: SyncStep[], userId: string): Promise<void> => {
    const myGeneration = generation
    setStatus('applying')
    try {
      await runSyncSteps(steps, env)
      if (myGeneration !== generation) return
      finishPairing(userId)
      setStatus('syncing')
    } catch (cause) {
      if (myGeneration !== generation) return
      destroySynchronizer()
      setStatus('error', cause instanceof Error ? cause.message : 'sync failed')
    }
  }

  const negotiate = async (userId: string): Promise<void> => {
    const myGeneration = generation
    setStatus('connecting')
    try {
      await deps.ready?.()
      if (myGeneration !== generation) return
      const paired = localStore.getValue(PAIRED_USER_VALUE) === userId
      const needsReseed = localStore.getValue(NEEDS_RESEED_VALUE) === true
      if (paired && !needsReseed) {
        // Stamp lineage is already shared (the IndexedDB persister keeps HLC
        // metadata across reloads) — attach exchanges only genuine deltas.
        await attach()
        if (myGeneration !== generation) return
        setStatus('syncing')
        return
      }
      const meta = (await fetchJson(SYNC_META_PATH)) as SyncMetaResponse
      if (myGeneration !== generation) return
      const input: Omit<SyncPlanInput, 'choice'> = {
        cloudHasRows: Object.values(meta.rowCounts).some((count) => count > 0),
        cloudHasValues: meta.hasValues,
        localHasRows: localHasRows(store),
      }
      // A reseed after a local wholesale replace is by definition keep-local.
      const presetChoice: MergeChoice | undefined =
        paired && needsReseed ? 'keep-local' : undefined
      const decision = decideSyncPlan({ ...input, choice: presetChoice })
      if (decision.kind === 'need-choice') {
        pendingInput = input
        setStatus('awaiting-choice')
        return
      }
      await runPlan(decision.steps, userId)
    } catch (cause) {
      if (myGeneration !== generation) return
      setStatus('error', cause instanceof Error ? cause.message : 'sync failed')
    }
  }

  const start = (userId: string): void => {
    if (currentUserId === userId && status !== 'idle' && status !== 'error') return
    generation += 1
    currentUserId = userId
    pendingInput = null
    destroySynchronizer()
    void negotiate(userId)
  }

  const stop = (): void => {
    generation += 1
    currentUserId = null
    pendingInput = null
    destroySynchronizer()
    setStatus('idle')
  }

  const choose = (choice: MergeChoice): void => {
    if (status !== 'awaiting-choice' || pendingInput === null || currentUserId === null) return
    const decision = decideSyncPlan({ ...pendingInput, choice })
    pendingInput = null
    if (decision.kind === 'plan') void runPlan(decision.steps, currentUserId)
  }

  const replaceLocalData = (replace: () => void): void => {
    const userId = currentUserId
    // Detach FIRST: a wholesale replace under a live synchronizer would
    // reconcile mid-reset and could push a giant changeset to the DO (#268).
    generation += 1
    pendingInput = null
    destroySynchronizer()
    replace()
    // Persisted flag: the cloud copy is now stale relative to this device,
    // and the replace re-minted stamps — next negotiation must re-seed.
    localStore.setValue(NEEDS_RESEED_VALUE, true)
    if (userId !== null) {
      currentUserId = userId
      void negotiate(userId)
    } else {
      setStatus('idle')
    }
  }

  return {
    start,
    stop,
    choose,
    replaceLocalData,
    getStatus: () => status,
    getError: () => error,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
