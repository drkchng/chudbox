/**
 * DEC-11 follow/save — the durable "Watching" state + its offline caches.
 *
 * This is the SECOND seam onto the same two TinyBase stores the garage adapter
 * drives, kept deliberately SEPARATE from `GarageState`/the nested `Car`
 * aggregate (DATA_MODEL §12.0/§12.4): a SavedBuild is already flat, lives in its
 * own top-level `savedBuilds` table (NOT a child of `cars`), and is read as the
 * whole bounded table — never joined per car.
 *
 *  • `savedBuilds` (SYNCED MergeableStore table): the durable follow intent +
 *    a small denormalized curated header (`cached*`). Local-first (works logged
 *    out) and CRDT-synced once an account exists — exactly like the garage.
 *  • `savedBuildSnapshots` (LOCAL-only side store, SAVED_BUILD_SNAPSHOTS_TABLE):
 *    the heavy full curated snapshot cache for offline detail (§12.3). The #268
 *    pressure-relief valve — re-fetchable, never synced (the photoPayloads
 *    pattern).
 *
 * KEY (§12.1): rowId of BOTH tables = `sha256(rawToken)` hex — content-addressed,
 * so the same link saved on two devices yields the same rowId and the CRDT
 * UNIONS them (per-cell LWW on `nickname`), never duplicates. The hash is async
 * (crypto.subtle), so it is computed by the save ACTION (already doing IO), never
 * inside a pure sync flatten.
 *
 * The raw `token` is a BEARER credential at rest (same confidentiality class as
 * garage data): fine to store in the follower's own store, but NEVER logged.
 */
import { joinSavedBuild } from '@chudbox/shared'
import type {
  PublicCarSnapshot,
  SavedBuild,
  SavedBuildRow,
  ShareCardSnapshot,
} from '@chudbox/shared'
import type { MergeableStore, Store } from 'tinybase'
import { SAVED_BUILD_SNAPSHOTS_TABLE } from './adapter'

/** The synced top-level table (in GARAGE_TABLE_IDS; NOT a child of cars). */
const SAVED_BUILDS_TABLE = 'savedBuilds'

const now = (): string => new Date().toISOString()

/**
 * Content-addressed rowId = sha256(rawToken) lowercase hex (§12.1). ASYNC
 * (crypto.subtle), so it is computed by the save action, mirroring the OWNER
 * side where `share_links.token_hash = sha256(token)` is the D1 PK.
 */
export async function savedBuildId(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export interface SaveBuildInput {
  /** Follower's personal label. '' = a real "cleared" state; omit = leave unset. */
  nickname?: string
  /** The build's curated card — drives the synced `cached*` header cells. */
  card?: ShareCardSnapshot
  /** The full CURATED snapshot to cache locally for offline detail (§12.3). */
  snapshot?: PublicCarSnapshot
}

export interface SavedBuildsController {
  store: MergeableStore
  localStore: Store
  /** Subscribe to Watching-state changes (table or local snapshot cache). */
  subscribe: (listener: () => void) => () => void
  /** The whole Watching list, joined + sorted (sortOrder ?? savedAt desc). */
  list: () => SavedBuild[]
  /** The joined SavedBuild for a raw token (matched on the `token` cell), or null. */
  getByToken: (token: string) => SavedBuild | null
  /** The cached full CURATED snapshot for a saved-build id (= rowId), or null. */
  getSnapshot: (id: string) => PublicCarSnapshot | null
  /**
   * Follow a build. Content-addressed + idempotent: re-saving the same token
   * hits the same rowId, so `token`/`savedAt` are written only when NEW (per-cell
   * no-op otherwise; two devices converge with no duplicate).
   */
  saveBuild: (token: string, input?: SaveBuildInput) => Promise<void>
  /** Unfollow: tombstone the synced row + drop the local snapshot cache. */
  unsaveBuild: (token: string) => Promise<void>
  /** Set the follower's personal nickname ('' = cleared). No-op if not saved. */
  setNickname: (token: string, nickname: string) => Promise<void>
  /**
   * Live-refetch SUCCESS (§12.8 #5): overwrite the `cached*` header + bump
   * `lastRefreshedAt` and CLEAR `unavailableSince`. No-op if the build was
   * unsaved between the fetch starting and finishing (never resurrects a row).
   */
  applyCardRefresh: (token: string, card: ShareCardSnapshot) => Promise<void>
  /**
   * Live-refetch 404/410 (§15.9): the token dangled (revoked/expired/car gone).
   * Set `unavailableSince` but KEEP the row + last-good header so the user sees
   * "no longer available" and can Remove it — never auto-deleted.
   */
  markUnavailable: (token: string) => Promise<void>
}

export function createSavedBuildsController({
  store,
  localStore,
}: {
  store: MergeableStore
  localStore: Store
}): SavedBuildsController {
  const listeners = new Set<() => void>()
  let dirty = true
  let cache: SavedBuild[] = []
  let notifyScheduled = false

  const notify = (): void => {
    dirty = true
    if (notifyScheduled) return
    notifyScheduled = true
    queueMicrotask(() => {
      notifyScheduled = false
      for (const listener of listeners) listener()
    })
  }

  // The list reads the SYNCED table; the offline detail cache is a SEPARATE local
  // table — either changing should repaint the Watching surface.
  store.addTableListener(SAVED_BUILDS_TABLE, () => notify())
  localStore.addTableListener(SAVED_BUILD_SNAPSHOTS_TABLE, () => notify())

  const rebuild = (): void => {
    cache = store
      .getRowIds(SAVED_BUILDS_TABLE)
      .map((id) => joinSavedBuild(id, store.getRow(SAVED_BUILDS_TABLE, id) as SavedBuildRow))
      .sort((a, b) => {
        // Manual `sortOrder` (asc) wins; rows without it fall back to savedAt
        // desc (newest first), tie-broken by id so the order is deterministic.
        if (a.sortOrder != null && b.sortOrder != null && a.sortOrder !== b.sortOrder) {
          return a.sortOrder - b.sortOrder
        }
        if (a.sortOrder != null && b.sortOrder == null) return -1
        if (a.sortOrder == null && b.sortOrder != null) return 1
        if (a.savedAt !== b.savedAt) return a.savedAt < b.savedAt ? 1 : -1
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      })
    dirty = false
  }

  const list = (): SavedBuild[] => {
    if (dirty) rebuild()
    return cache
  }

  const getByToken = (token: string): SavedBuild | null =>
    list().find((b) => b.token === token) ?? null

  const getSnapshot = (id: string): PublicCarSnapshot | null => {
    const raw = localStore.getCell(SAVED_BUILD_SNAPSHOTS_TABLE, id, 'snapshot') as string | undefined
    if (raw == null || raw === '') return null
    try {
      return JSON.parse(raw) as PublicCarSnapshot
    } catch {
      return null
    }
  }

  // ── Writers ──────────────────────────────────────────────────
  /** Overwrite the synced `cached*` header from a curated card + stamp freshness.
   * Strict-null: a nullable cached cell is DELETED when its source is blank, so
   * the row stays byte-consistent with the flatten omit rule. MUST run inside a
   * transaction. */
  const writeCachedHeader = (id: string, card: ShareCardSnapshot): void => {
    store.setCell(SAVED_BUILDS_TABLE, id, 'cachedYear', card.year)
    store.setCell(SAVED_BUILDS_TABLE, id, 'cachedMake', card.make)
    store.setCell(SAVED_BUILDS_TABLE, id, 'cachedModel', card.model)
    // The build's OWN nickname ('' is a real value — distinct from the follower's
    // personal `nickname`).
    store.setCell(SAVED_BUILDS_TABLE, id, 'cachedNickname', card.nickname)
    if (card.ownerName != null && card.ownerName !== '') {
      store.setCell(SAVED_BUILDS_TABLE, id, 'cachedOwnerName', card.ownerName)
    } else {
      store.delCell(SAVED_BUILDS_TABLE, id, 'cachedOwnerName')
    }
    store.setCell(SAVED_BUILDS_TABLE, id, 'cachedStatus', card.status)
    store.setCell(SAVED_BUILDS_TABLE, id, 'cachedMileageRaw', card.mileageRaw)
    store.setCell(SAVED_BUILDS_TABLE, id, 'cachedModsCount', card.modsCount)
    if (card.coverPhotoId != null && card.coverPhotoId !== '') {
      store.setCell(SAVED_BUILDS_TABLE, id, 'cachedCoverPhotoId', card.coverPhotoId)
    } else {
      store.delCell(SAVED_BUILDS_TABLE, id, 'cachedCoverPhotoId')
    }
    store.setCell(SAVED_BUILDS_TABLE, id, 'cachedScope', card.scope)
    store.setCell(SAVED_BUILDS_TABLE, id, 'lastRefreshedAt', now())
    // A successful refresh proves the link is live → clear any dangling flag.
    store.delCell(SAVED_BUILDS_TABLE, id, 'unavailableSince')
  }

  const saveBuild = async (token: string, input: SaveBuildInput = {}): Promise<void> => {
    const id = await savedBuildId(token)
    store.transaction(() => {
      if (!store.hasRow(SAVED_BUILDS_TABLE, id)) {
        store.setCell(SAVED_BUILDS_TABLE, id, 'token', token)
        store.setCell(SAVED_BUILDS_TABLE, id, 'savedAt', now())
      }
      if (input.nickname != null) store.setCell(SAVED_BUILDS_TABLE, id, 'nickname', input.nickname)
      if (input.card) writeCachedHeader(id, input.card)
    })
    // The heavy curated snapshot cache lives ONLY in the local side store (never
    // synced) — exactly the photoPayloads pattern. Curated by construction.
    if (input.snapshot) {
      localStore.setRow(SAVED_BUILD_SNAPSHOTS_TABLE, id, {
        snapshot: JSON.stringify(input.snapshot),
        fetchedAt: now(),
      })
    }
  }

  const unsaveBuild = async (token: string): Promise<void> => {
    const id = await savedBuildId(token)
    store.delRow(SAVED_BUILDS_TABLE, id)
    localStore.delRow(SAVED_BUILD_SNAPSHOTS_TABLE, id)
  }

  const setNickname = async (token: string, nickname: string): Promise<void> => {
    const id = await savedBuildId(token)
    if (!store.hasRow(SAVED_BUILDS_TABLE, id)) return
    // '' is a real "cleared" state (distinct from never-set null) — write it.
    store.setCell(SAVED_BUILDS_TABLE, id, 'nickname', nickname)
  }

  const applyCardRefresh = async (token: string, card: ShareCardSnapshot): Promise<void> => {
    const id = await savedBuildId(token)
    if (!store.hasRow(SAVED_BUILDS_TABLE, id)) return
    store.transaction(() => writeCachedHeader(id, card))
  }

  const markUnavailable = async (token: string): Promise<void> => {
    const id = await savedBuildId(token)
    if (!store.hasRow(SAVED_BUILDS_TABLE, id)) return
    if (store.getCell(SAVED_BUILDS_TABLE, id, 'unavailableSince') == null) {
      store.setCell(SAVED_BUILDS_TABLE, id, 'unavailableSince', now())
    }
  }

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  return {
    store,
    localStore,
    subscribe,
    list,
    getByToken,
    getSnapshot,
    saveBuild,
    unsaveBuild,
    setNickname,
    applyCardRefresh,
    markUnavailable,
  }
}
