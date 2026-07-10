// G4 / Law-25 account-deletion purge — end-to-end against the REAL Worker,
// GarageDO (fragmented SQLite), and emulated R2/D1 (vitest-pool-workers).
//
// The crux this file proves: deleting an account purges EVERY store — the D1
// user row + its FK-cascaded share_links, the user's Durable Object garage
// (cars/photos/mileage/savedBuilds incl. bearer tokens), AND every R2 image
// under u/<userId>/ — and that the flow is OWN-ACCOUNT-ONLY (401 without a
// session; no IDOR — a request body can never steer it at another user).
//
// Each test mints its OWN user(s) with a unique email, so each has its own DO
// (idFromName(userId)) and the tests never collide through the per-user
// singleton DO/D1 that this Worker keeps (the share.test.ts / uploads.test.ts
// isolation pattern).
import { SELF, env, runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_DISPLAY_PATH,
  ACCOUNT_DELETE_PATH,
  SYNC_SEED_PATH,
  UPLOAD_FILE_FIELD,
  UPLOAD_PATH,
  buildPhotoKey,
  chunkMergeableContent,
  createGarageStore,
  createShareLinkPath,
  encodeSeedChunk,
  flattenCar,
} from '@chudbox/shared'
import type { Car, CreateShareResponse, SyncMetaResponse, UploadResponse } from '@chudbox/shared'
import type { MergeableStore } from 'tinybase'
import type { GarageDO } from '../src/durable/GarageDO'
import { SNAPSHOT_KEY } from '../src/durable/snapshotPersister'

const BASE = 'https://example.com'

/** RIFF/WEBP + a VP8 lossy keyframe sized 20×10 (passes the upload sniff). */
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x1e, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x20, 0x0e, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a, 0x14, 0x00, 0x0a, 0x00,
])

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ── Users ───────────────────────────────────────────────────
interface User {
  cookie: string
  userId: string
  email: string
}

async function createVerifiedUser(email: string, name = 'Purge Tester'): Promise<User> {
  const password = 'correct-horse-battery'
  // Better Auth applies a STRICT special rate-limit rule to /sign-up + /sign-in
  // (max 3 per 10s window per IP). This file mints several users from the same
  // emulated client IP, so reset the D1-backed limiter before each auth call —
  // a test-harness accommodation only (the limiter itself is proven elsewhere).
  await env.DB.prepare('DELETE FROM rate_limit').run()
  const signUp = await SELF.fetch(`${BASE}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name, tosAcceptedVersion: 1 }),
  })
  expect(signUp.ok).toBe(true)
  const { user } = (await signUp.json()) as { user: { id: string } }
  await env.DB.prepare('UPDATE user SET email_verified = 1 WHERE email = ?').bind(email).run()
  await env.DB.prepare('DELETE FROM rate_limit').run()
  const signIn = await SELF.fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  expect(signIn.ok).toBe(true)
  // Under https BETTER_AUTH_URL the cookie is `__Secure-`-prefixed; capture the
  // optional prefix or getSession never matches and every authed route 401s.
  const cookie = (signIn.headers.get('set-cookie') ?? '').match(
    /(?:__Secure-)?better-auth\.session_token=[^;]+/,
  )?.[0]
  if (!cookie) throw new Error('no session cookie after sign-in')
  return { cookie, userId: user.id, email }
}

// ── DO / R2 / D1 probes ─────────────────────────────────────
function garageStub(userId: string) {
  return env.GARAGE_DO.get(env.GARAGE_DO.idFromName(userId))
}

/** The user's DO garage meta, read straight off the DO instance. */
async function doMeta(userId: string): Promise<SyncMetaResponse> {
  return runInDurableObject(garageStub(userId), (instance) =>
    (instance as unknown as GarageDO).getMeta(),
  )
}

/** Every R2 object key under the user's `u/<userId>/` prefix. */
async function r2KeysUnder(userId: string): Promise<string[]> {
  const listed = await env.BUCKET.list({ prefix: `u/${userId}/` })
  return listed.objects.map((object) => object.key)
}

async function userRowExists(userId: string): Promise<boolean> {
  const row = await env.DB.prepare('SELECT id FROM user WHERE id = ?').bind(userId).first<{ id: string }>()
  return row != null
}

async function shareLinkCount(userId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM share_links WHERE user_id = ?')
    .bind(userId)
    .first<{ n: number }>()
  return row?.n ?? 0
}

async function sessionCount(userId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM session WHERE user_id = ?')
    .bind(userId)
    .first<{ n: number }>()
  return row?.n ?? 0
}

// ── Seed a populated garage (car + photo + saved build) ─────
function makeCar(carId: string, photoId: string): Car {
  return {
    id: carId,
    year: '1999',
    make: 'PURGE_make',
    model: 'PURGE_model',
    trim: 'PURGE_trim',
    color: 'PURGE_color',
    mileage: '120000',
    nickname: 'PURGE_nick',
    purchaseDate: '2020-01-02',
    saleDate: '',
    status: 'current',
    salePrice: '',
    tradeFor: '',
    // DEC-13: VIN is personal-data-adjacent — exactly the kind of cell §15.11 #1
    // says the DO-purge must erase.
    vin: 'VIN0PURGE12345678',
    coverPhoto: photoId,
    createdAt: '2026-01-01',
    photos: [{ id: photoId, dataUrl: 'data:image/webp;base64,AAAA', caption: 'c', uploadedAt: '2026-01-01' }],
    wishlist: [],
    mods: [],
    maintenance: [],
    todos: [],
    issues: [],
    mileageLog: [],
  }
}

async function seedStore(cookie: string, store: MergeableStore): Promise<void> {
  const chunks = chunkMergeableContent(store.getMergeableContent(), { maxCellsPerChunk: 256 })
  for (const [index, chunk] of chunks.entries()) {
    const res = await SELF.fetch(`${BASE}${SYNC_SEED_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ chunk: encodeSeedChunk(chunk), index, total: chunks.length }),
    })
    expect(res.status).toBe(200)
  }
}

/**
 * Give a user real cloud data across all three non-D1-cascading stores:
 *  - an R2 image object under u/<userId>/…,
 *  - a fully-seeded car (with the matching r2Key) in their DO,
 *  - a `savedBuilds` row holding a RAW bearer token at rest (§15.11 #1),
 *  - a D1 share_links row (cascades on user-delete — asserted separately).
 * Returns the r2Key + the saved-build token for absence assertions.
 */
async function populate(user: User): Promise<{ r2Key: string; savedToken: string }> {
  const carId = crypto.randomUUID()
  const photoId = crypto.randomUUID()
  const r2Key = buildPhotoKey({ userId: user.userId, carId, photoId, ext: 'webp' })

  // 1. R2: upload the real bytes so an object exists under the prefix.
  const fd = new FormData()
  fd.append(UPLOAD_FILE_FIELD, new Blob([WEBP_BYTES], { type: 'image/webp' }), 'p')
  fd.append('carId', carId)
  fd.append('photoId', photoId)
  fd.append('width', '1600')
  fd.append('height', '1067')
  const up = await SELF.fetch(`${BASE}${UPLOAD_PATH}`, {
    method: 'POST',
    headers: { cookie: user.cookie },
    body: fd,
  })
  expect(up.status).toBe(200)
  expect(((await up.json()) as UploadResponse).r2Key).toBe(r2Key)

  // 2. DO: seed the car + a savedBuilds row carrying a bearer token at rest.
  const store = createGarageStore('client-purge')
  const flat = flattenCar(makeCar(carId, photoId), { currency: 'USD', distanceUnit: 'mi' })
  store.setRow('cars', flat.carId, flat.car)
  for (const [rowId, row] of Object.entries(flat.photos)) store.setRow('photos', rowId, row)
  for (const [rowId, row] of Object.entries(flat.mileage)) store.setRow('mileage', rowId, row)
  store.setCell('photos', photoId, 'r2Key', r2Key)
  const savedToken = `bearer-${user.userId}-token`
  store.setRow('savedBuilds', await sha256Hex(savedToken), {
    token: savedToken,
    savedAt: '2026-01-01T00:00:00Z',
  })
  store.setValues({ themeId: 'midnight', currency: 'USD', distanceUnit: 'mi' })
  await seedStore(user.cookie, store)

  // 3. D1: a share_links row for that car (DO-check-then-insert).
  const link = await SELF.fetch(`${BASE}${createShareLinkPath(carId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: user.cookie },
    body: '{}',
  })
  expect(link.status).toBe(200)
  expect(((await link.json()) as CreateShareResponse).token).toBeTruthy()

  return { r2Key, savedToken }
}

async function postDelete(init: RequestInit = {}): Promise<Response> {
  return SELF.fetch(`${BASE}${ACCOUNT_DELETE_PATH}`, { method: 'POST', ...init })
}

// ── Auth gating ─────────────────────────────────────────────
describe('POST /api/account/delete — auth gating', () => {
  it('rejects a logged-out request (401) and erases nothing', async () => {
    const victim = await createVerifiedUser('delete-401@example.com')
    await populate(victim)

    const res = await postDelete() // no cookie
    expect(res.status).toBe(401)

    // Untouched: the user, their DO garage, and their R2 objects all survive.
    expect(await userRowExists(victim.userId)).toBe(true)
    expect((await doMeta(victim.userId)).isEmpty).toBe(false)
    expect((await r2KeysUnder(victim.userId)).length).toBeGreaterThan(0)
  })
})

// ── Full purge (the happy path) ─────────────────────────────
describe('POST /api/account/delete — full purge', () => {
  it('clears D1 (user + cascaded share_links/session), the DO garage, and R2', async () => {
    const user = await createVerifiedUser('delete-purge@example.com')
    const { r2Key } = await populate(user)

    // Precondition: every store really holds this user's data.
    expect(await userRowExists(user.userId)).toBe(true)
    expect(await shareLinkCount(user.userId)).toBe(1)
    expect(await sessionCount(user.userId)).toBeGreaterThan(0)
    const before = await doMeta(user.userId)
    expect(before.isEmpty).toBe(false)
    expect(before.rowCounts.cars).toBe(1)
    expect(before.rowCounts.savedBuilds).toBe(1) // bearer token at rest
    expect(await r2KeysUnder(user.userId)).toContain(r2Key)

    // Delete the OWN account (session cookie only — no body).
    const res = await postDelete({ headers: { cookie: user.cookie } })
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual({ deleted: true })

    // D1: the user is gone, and the FK ON DELETE CASCADE took share_links +
    // session with it.
    expect(await userRowExists(user.userId)).toBe(false)
    expect(await shareLinkCount(user.userId)).toBe(0)
    expect(await sessionCount(user.userId)).toBe(0)

    // DO: a fresh meta read reports an empty garage (no cars, no savedBuilds,
    // no Values) — every cell + the bearer token are gone.
    const after = await doMeta(user.userId)
    expect(after.isEmpty).toBe(true)
    expect(after.rowCounts.cars).toBe(0)
    expect(after.rowCounts.savedBuilds).toBe(0)
    expect(after.hasValues).toBe(false)

    // R2: nothing remains under the user's prefix.
    expect(await r2KeysUnder(user.userId)).toStrictEqual([])

    // The session is invalidated server-side: a follow-up authed call 401s.
    const after401 = await SELF.fetch(`${BASE}${ACCOUNT_DISPLAY_PATH}`, {
      headers: { cookie: user.cookie },
    })
    expect(after401.status).toBe(401)
  })

  it('is idempotent — purgeAll twice on an already-purged DO leaves it empty', async () => {
    const user = await createVerifiedUser('delete-idem@example.com')
    await populate(user)
    expect((await doMeta(user.userId)).isEmpty).toBe(false)

    // Two RPC purges back-to-back: the second is a safe no-op, not an error.
    await runInDurableObject(garageStub(user.userId), (i) => (i as unknown as GarageDO).purgeAll())
    await runInDurableObject(garageStub(user.userId), (i) => (i as unknown as GarageDO).purgeAll())
    expect((await doMeta(user.userId)).isEmpty).toBe(true)

    // At-rest erasure holds AND stays held: purgeAll orders deleteAll behind
    // the emptied-store autosave on the persister's scheduler, so no late
    // async save can write a snapshot back after the wipe. The re-check
    // after a beat is the tripwire for that race.
    const snapshotAtRest = () =>
      runInDurableObject(garageStub(user.userId), (_i, state) =>
        state.storage.get<Uint8Array>(SNAPSHOT_KEY),
      )
    expect(await snapshotAtRest()).toBeUndefined()
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(await snapshotAtRest()).toBeUndefined()
  })
})

// ── No IDOR (own-account-only) ──────────────────────────────
describe('POST /api/account/delete — own-account-only (no IDOR)', () => {
  it("cannot delete another user's data — even when their id is in the body", async () => {
    const victim = await createVerifiedUser('delete-idor-victim@example.com')
    const attacker = await createVerifiedUser('delete-idor-attacker@example.com')
    const { r2Key } = await populate(victim)
    await populate(attacker)

    // Attacker calls delete with THEIR session but the VICTIM's id in the body.
    // The endpoint reads the userId ONLY from the session and ignores the body,
    // so this deletes the ATTACKER, never the victim.
    const res = await postDelete({
      headers: { 'Content-Type': 'application/json', cookie: attacker.cookie },
      body: JSON.stringify({ userId: victim.userId }),
    })
    expect(res.status).toBe(200)

    // Attacker (the session owner) is the one erased.
    expect(await userRowExists(attacker.userId)).toBe(false)
    expect((await doMeta(attacker.userId)).isEmpty).toBe(true)
    expect(await r2KeysUnder(attacker.userId)).toStrictEqual([])

    // Victim is completely intact across every store.
    expect(await userRowExists(victim.userId)).toBe(true)
    expect(await shareLinkCount(victim.userId)).toBe(1)
    expect((await doMeta(victim.userId)).isEmpty).toBe(false)
    expect(await r2KeysUnder(victim.userId)).toContain(r2Key)
  })
})
