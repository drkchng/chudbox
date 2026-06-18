// DEC-11 follow/save — the writers + offline caches over the two TinyBase stores.
// Covers the spec-critical guarantees: content-addressed rowId (merge-idempotent,
// no duplicates), the local-only snapshot cache, nickname null-vs-'' semantics,
// the live-refetch write (applyCardRefresh) and dangling-token handling
// (markUnavailable keeps the row).
import { describe, expect, it } from 'vitest'
import { createGarageStore } from '@chudbox/shared'
import type { PublicCarSnapshot, ShareCardSnapshot } from '@chudbox/shared'
import { createStore } from 'tinybase'
import { SAVED_BUILD_SNAPSHOTS_TABLE } from './adapter'
import { createSavedBuildsController, savedBuildId } from './savedBuilds'

function makeController() {
  return createSavedBuildsController({ store: createGarageStore(), localStore: createStore() })
}

const TOKEN = 'tok-abcDEF123_-'

const card = (over: Partial<ShareCardSnapshot> = {}): ShareCardSnapshot => ({
  year: '2020',
  make: 'Toyota',
  model: 'Supra',
  nickname: 'Owner nick',
  status: 'current',
  mileageRaw: '100000',
  mileageMiles: 100000,
  modsCount: 3,
  coverPhotoId: 'photo-1',
  scope: 'curated',
  distanceUnit: 'mi',
  ...over,
})

const curatedSnapshot = (): PublicCarSnapshot => ({
  year: '2020',
  make: 'Toyota',
  model: 'Supra',
  trim: '',
  color: '',
  nickname: 'Owner nick',
  mileageRaw: '100000',
  status: 'current',
  createdAt: '2020-01-01',
  photos: [{ photoId: 'photo-1', caption: '' }],
  mods: [],
  maintenance: [],
  settings: { themeId: 'garage', distanceUnit: 'mi' },
})

describe('savedBuildId — content-addressed rowId', () => {
  it('is sha256(token) lowercase hex and deterministic (same on every device)', async () => {
    const id = await savedBuildId(TOKEN)
    expect(id).toMatch(/^[0-9a-f]{64}$/)
    expect(await savedBuildId(TOKEN)).toBe(id)
    expect(await savedBuildId('other')).not.toBe(id)
  })
})

describe('saveBuild — content-addressed + idempotent', () => {
  it('writes the row at rowId = sha256(token) with token/savedAt + cached header', async () => {
    const c = makeController()
    await c.saveBuild(TOKEN, { card: card(), snapshot: curatedSnapshot() })
    const id = await savedBuildId(TOKEN)
    expect(c.store.getRowIds('savedBuilds')).toEqual([id])
    expect(c.store.getCell('savedBuilds', id, 'token')).toBe(TOKEN)
    expect(c.store.getCell('savedBuilds', id, 'cachedYear')).toBe('2020')
    expect(c.store.getCell('savedBuilds', id, 'cachedNickname')).toBe('Owner nick')
    expect(c.store.getCell('savedBuilds', id, 'cachedModsCount')).toBe(3)
    expect(c.store.getCell('savedBuilds', id, 'cachedScope')).toBe('curated')
    expect(c.store.getCell('savedBuilds', id, 'lastRefreshedAt')).toBeTypeOf('string')
    // The heavy snapshot cache lives ONLY in the local side store.
    const cached = c.localStore.getCell(SAVED_BUILD_SNAPSHOTS_TABLE, id, 'snapshot') as string
    expect(JSON.parse(cached)).toEqual(curatedSnapshot())
  })

  it('re-saving the SAME token is a per-cell no-op on identity (no duplicate row)', async () => {
    const c = makeController()
    await c.saveBuild(TOKEN, { card: card() })
    const id = await savedBuildId(TOKEN)
    const firstSavedAt = c.store.getCell('savedBuilds', id, 'savedAt') as string

    await c.saveBuild(TOKEN, { card: card({ make: 'Nissan', modsCount: 9 }) })
    // Still exactly ONE row, at the same content-addressed id.
    expect(c.store.getRowIds('savedBuilds')).toEqual([id])
    // savedAt is preserved (only written when the row is new).
    expect(c.store.getCell('savedBuilds', id, 'savedAt')).toBe(firstSavedAt)
    // …but the cached header is refreshed.
    expect(c.store.getCell('savedBuilds', id, 'cachedMake')).toBe('Nissan')
    expect(c.store.getCell('savedBuilds', id, 'cachedModsCount')).toBe(9)
  })

  it('two devices saving the same link converge to the SAME rowId (no dup on merge)', async () => {
    const a = makeController()
    const b = makeController()
    await a.saveBuild(TOKEN, { card: card() })
    await b.saveBuild(TOKEN, { card: card({ nickname: 'B nick' }) })
    expect(a.store.getRowIds('savedBuilds')[0]).toBe(b.store.getRowIds('savedBuilds')[0])
  })
})

describe('getByToken / getSnapshot / list', () => {
  it('joins the row back to a SavedBuild and reads the cached snapshot by id', async () => {
    const c = makeController()
    await c.saveBuild(TOKEN, { card: card(), snapshot: curatedSnapshot() })
    const build = c.getByToken(TOKEN)
    expect(build?.token).toBe(TOKEN)
    expect(build?.cachedMake).toBe('Toyota')
    expect(build && c.getSnapshot(build.id)).toEqual(curatedSnapshot())
    expect(c.getByToken('nope')).toBeNull()
  })

  it('list sorts by savedAt desc (newest first) with no manual sortOrder', async () => {
    const c = makeController()
    await c.saveBuild('tok-old', { card: card() })
    await c.saveBuild('tok-new', { card: card() })
    const oldId = await savedBuildId('tok-old')
    const newId = await savedBuildId('tok-new')
    c.store.setCell('savedBuilds', oldId, 'savedAt', '2020-01-01T00:00:00.000Z')
    c.store.setCell('savedBuilds', newId, 'savedAt', '2024-01-01T00:00:00.000Z')
    expect(c.list().map((b) => b.token)).toEqual(['tok-new', 'tok-old'])
  })
})

describe('setNickname — null (never set) vs "" (cleared)', () => {
  it("'' is a real, distinct cleared state", async () => {
    const c = makeController()
    await c.saveBuild(TOKEN, { card: card() })
    const id = await savedBuildId(TOKEN)
    // Never set → absent ⇔ null on join.
    expect(c.store.hasCell('savedBuilds', id, 'nickname')).toBe(false)
    expect(c.getByToken(TOKEN)?.nickname).toBeNull()

    await c.setNickname(TOKEN, 'My S2K')
    expect(c.getByToken(TOKEN)?.nickname).toBe('My S2K')

    await c.setNickname(TOKEN, '')
    // '' is written (distinct from absent) — a real cleared label.
    expect(c.store.getCell('savedBuilds', id, 'nickname')).toBe('')
    expect(c.getByToken(TOKEN)?.nickname).toBe('')
  })

  it('is a no-op for an unsaved token (never resurrects a row)', async () => {
    const c = makeController()
    await c.setNickname(TOKEN, 'ghost')
    expect(c.store.getRowIds('savedBuilds')).toHaveLength(0)
  })
})

describe('unsaveBuild', () => {
  it('tombstones the synced row AND drops the local snapshot cache', async () => {
    const c = makeController()
    await c.saveBuild(TOKEN, { card: card(), snapshot: curatedSnapshot() })
    const id = await savedBuildId(TOKEN)
    await c.unsaveBuild(TOKEN)
    expect(c.store.hasRow('savedBuilds', id)).toBe(false)
    expect(c.localStore.hasRow(SAVED_BUILD_SNAPSHOTS_TABLE, id)).toBe(false)
    expect(c.getByToken(TOKEN)).toBeNull()
  })
})

describe('applyCardRefresh — the live-refetch write', () => {
  it('overwrites the cached header, stamps lastRefreshedAt, and CLEARS unavailableSince', async () => {
    const c = makeController()
    await c.saveBuild(TOKEN, { card: card() })
    const id = await savedBuildId(TOKEN)
    await c.markUnavailable(TOKEN)
    expect(c.store.getCell('savedBuilds', id, 'unavailableSince')).toBeTypeOf('string')

    await c.applyCardRefresh(TOKEN, card({ make: 'Honda', status: 'for-sale' }))
    expect(c.store.getCell('savedBuilds', id, 'cachedMake')).toBe('Honda')
    expect(c.store.getCell('savedBuilds', id, 'cachedStatus')).toBe('for-sale')
    // A successful refresh proves the link is live again.
    expect(c.store.hasCell('savedBuilds', id, 'unavailableSince')).toBe(false)
  })

  it('is a no-op if the build was unsaved between fetch start and finish', async () => {
    const c = makeController()
    await c.applyCardRefresh(TOKEN, card())
    expect(c.store.getRowIds('savedBuilds')).toHaveLength(0)
  })
})

describe('markUnavailable — dangling token (404/410)', () => {
  it('sets unavailableSince but KEEPS the row + last-good header', async () => {
    const c = makeController()
    await c.saveBuild(TOKEN, { card: card({ make: 'Mazda' }) })
    const id = await savedBuildId(TOKEN)
    await c.markUnavailable(TOKEN)
    expect(c.store.hasRow('savedBuilds', id)).toBe(true)
    expect(c.store.getCell('savedBuilds', id, 'cachedMake')).toBe('Mazda') // last good
    const stamp = c.store.getCell('savedBuilds', id, 'unavailableSince')
    expect(stamp).toBeTypeOf('string')
    // Idempotent — re-marking does not overwrite the first-seen stamp.
    await c.markUnavailable(TOKEN)
    expect(c.store.getCell('savedBuilds', id, 'unavailableSince')).toBe(stamp)
  })

  it('is a no-op for an unsaved token', async () => {
    const c = makeController()
    await c.markUnavailable(TOKEN)
    expect(c.store.getRowIds('savedBuilds')).toHaveLength(0)
  })
})
