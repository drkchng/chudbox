// M4 share-link route tests against the REAL Worker, GarageDO (fragmented
// SQLite) and emulated R2/D1 (vitest-pool-workers). Covers owner create/list/
// revoke, the PUBLIC snapshot + token-scoped image, hashed-at-rest tokens,
// expiry, and lazy-revoke. The snapshot is exercised on a FULLY-POPULATED car
// (every table, secrets in every excluded field) — the security crux.
//
// Each test mints a UNIQUE carId/photoId: this Worker keeps one DO + one D1 per
// user (created in beforeAll), and writes through it are not reliably isolated
// per test, so unique ids keep tests independent (the uploads.test.ts pattern).
import { SELF, env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  SYNC_CLEAR_PATH,
  SYNC_SEED_PATH,
  UPLOAD_FILE_FIELD,
  UPLOAD_PATH,
  buildPhotoKey,
  chunkMergeableContent,
  createGarageStore,
  createShareLinkPath,
  encodeSeedChunk,
  flattenCar,
  shareImgPath,
  shareRevokePath,
  shareSnapshotPath,
  shareViewPath,
} from '@chudbox/shared'
import type {
  Car,
  CreateShareResponse,
  ShareLinkListResponse,
  ShareSnapshotResponse,
  UploadResponse,
} from '@chudbox/shared'
import type { MergeableStore } from 'tinybase'

const BASE = 'https://example.com'

/** RIFF/WEBP + a VP8 lossy keyframe sized 20×10 (passes the upload sniff). */
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x1e, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x20, 0x0e, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a, 0x14, 0x00, 0x0a, 0x00,
])

const nowSeconds = (): number => Math.floor(Date.now() / 1000)

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

interface Ids {
  carId: string
  photoId: string
}
const freshIds = (): Ids => ({ carId: crypto.randomUUID(), photoId: crypto.randomUUID() })

// ── Secrets the snapshot must never leak ────────────────────
const SECRET_STRINGS = [
  'SECRET_salePrice',
  'SECRET_tradeFor',
  'SECRET_wish_name',
  'SECRET_wish_link',
  'SECRET_wish_notes',
  'SECRET_wish_category',
  'SECRET_mod_shop',
  'SECRET_maint_shop',
  'SECRET_maint_notes',
  'SECRET_todo_text',
  'SECRET_issue_title',
  'SECRET_issue_description',
  'SECRET_photo_uploadedAt',
]
const SECRET_NUMBERS = [91919191, 92929292, 93939393]

// ── Auth helper (one session for the file) ──────────────────
let session: { cookie: string; userId: string }

beforeAll(async () => {
  const email = 'share-user@example.com'
  const password = 'correct-horse-battery'
  const signUp = await SELF.fetch(`${BASE}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name: 'Share Tester' }),
  })
  expect(signUp.ok).toBe(true)
  const { user } = (await signUp.json()) as { user: { id: string } }
  await env.DB.prepare('UPDATE user SET email_verified = 1 WHERE email = ?').bind(email).run()
  const signIn = await SELF.fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  expect(signIn.ok).toBe(true)
  // BETTER_AUTH_URL is the https production domain, so Better Auth issues a
  // `__Secure-`-prefixed session cookie. Capture the optional prefix — without
  // it the cookie name we send back never matches and getSession returns null
  // (every authed route then 401s). (Pre-existing harness gotcha shared by the
  // other test files; the prefix is correct + expected under https.)
  const cookie = (signIn.headers.get('set-cookie') ?? '').match(
    /(?:__Secure-)?better-auth\.session_token=[^;]+/,
  )?.[0]
  if (!cookie) throw new Error('no session cookie after sign-in')
  session = { cookie, userId: user.id }
})

// ── Fully-populated car (secrets in every EXCLUDED field) ───
function makeShareCar({ carId, photoId }: Ids): Car {
  return {
    id: carId,
    year: '1991',
    make: 'KEEP_make',
    model: 'KEEP_model',
    trim: 'KEEP_trim',
    color: 'KEEP_color',
    mileage: '50000',
    nickname: 'KEEP_nick',
    purchaseDate: '2020-01-02',
    saleDate: '2024-05-06',
    status: 'for-sale',
    salePrice: 'SECRET_salePrice',
    tradeFor: 'SECRET_tradeFor',
    coverPhoto: photoId,
    createdAt: 'KEEP_createdAt',
    photos: [
      {
        id: photoId,
        dataUrl: 'data:image/webp;base64,AAAA',
        caption: 'KEEP_caption',
        uploadedAt: 'SECRET_photo_uploadedAt',
      },
    ],
    wishlist: [
      {
        id: 'wish-1',
        name: 'SECRET_wish_name',
        link: 'SECRET_wish_link',
        price: 91919191,
        category: 'SECRET_wish_category',
        notes: 'SECRET_wish_notes',
        status: 'wanted',
        addedAt: 'x',
      },
    ],
    mods: [
      {
        id: 'mod-1',
        name: 'KEEP_mod_name',
        category: 'KEEP_mod_category',
        description: 'KEEP_mod_description',
        cost: 92929292,
        installedDate: 'KEEP_mod_installedDate',
        shop: 'SECRET_mod_shop',
        link: 'KEEP_mod_link',
        addedAt: 'KEEP_mod_addedAt',
      },
    ],
    maintenance: [
      {
        id: 'maint-1',
        service: 'KEEP_maint_service',
        date: 'KEEP_maint_date',
        mileage: '80000',
        cost: 93939393,
        shop: 'SECRET_maint_shop',
        notes: 'SECRET_maint_notes',
        nextDueDate: 'KEEP_maint_nextDueDate',
        nextDueMileage: '90000',
        createdAt: 'KEEP_maint_createdAt',
      },
    ],
    todos: [{ id: 'todo-1', text: 'SECRET_todo_text', priority: 'high', done: false, createdAt: 'x' }],
    issues: [
      {
        id: 'issue-1',
        title: 'SECRET_issue_title',
        description: 'SECRET_issue_description',
        severity: 'critical',
        status: 'open',
        createdAt: 'x',
        resolvedAt: null,
      },
    ],
  }
}

// ── Seed/upload helpers ─────────────────────────────────────
async function seedStore(store: MergeableStore): Promise<void> {
  const chunks = chunkMergeableContent(store.getMergeableContent(), { maxCellsPerChunk: 256 })
  for (const [index, chunk] of chunks.entries()) {
    const res = await SELF.fetch(`${BASE}${SYNC_SEED_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: session.cookie },
      body: JSON.stringify({ chunk: encodeSeedChunk(chunk), index, total: chunks.length }),
    })
    expect(res.status).toBe(200)
  }
}

/** Upload the real photo bytes to R2 (so the share image serves) and seed the
 * fully-populated car — with the photo row carrying the matching r2Key — into
 * the caller's DO. Returns the r2Key for absence assertions. */
async function uploadAndSeedCar({ carId, photoId }: Ids): Promise<{ r2Key: string }> {
  const r2Key = buildPhotoKey({ userId: session.userId, carId, photoId, ext: 'webp' })
  const fd = new FormData()
  fd.append(UPLOAD_FILE_FIELD, new Blob([WEBP_BYTES], { type: 'image/webp' }), 'p')
  fd.append('carId', carId)
  fd.append('photoId', photoId)
  fd.append('width', '1600')
  fd.append('height', '1067')
  const up = await SELF.fetch(`${BASE}${UPLOAD_PATH}`, {
    method: 'POST',
    headers: { cookie: session.cookie },
    body: fd,
  })
  expect(up.status).toBe(200)
  expect(((await up.json()) as UploadResponse).r2Key).toBe(r2Key)

  const store = createGarageStore('client-share')
  const flat = flattenCar(makeShareCar({ carId, photoId }), { currency: 'USD', distanceUnit: 'mi' })
  store.setRow('cars', flat.carId, flat.car)
  for (const [table, rows] of [
    ['photos', flat.photos],
    ['wishlist', flat.wishlist],
    ['mods', flat.mods],
    ['maintenance', flat.maintenance],
    ['todos', flat.todos],
    ['issues', flat.issues],
  ] as const) {
    for (const [rowId, row] of Object.entries(rows)) store.setRow(table, rowId, row)
  }
  // r2Key is only written once the photo reaches R2 (M3) — set it on the seeded
  // row so resolveSharePhotoKey returns it.
  store.setCell('photos', photoId, 'r2Key', r2Key)
  store.setValues({ themeId: 'midnight', currency: 'USD', distanceUnit: 'mi' })
  await seedStore(store)
  return { r2Key }
}

async function createLink(carId: string, expiresAt?: number): Promise<CreateShareResponse> {
  const res = await SELF.fetch(`${BASE}${createShareLinkPath(carId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: session.cookie },
    body: JSON.stringify(expiresAt === undefined ? {} : { expiresAt }),
  })
  expect(res.status).toBe(200)
  return (await res.json()) as CreateShareResponse
}

/** Read view_count for a raw token straight from D1 (asserts the stored value). */
async function viewCountFor(token: string): Promise<number | undefined> {
  const row = await env.DB.prepare('SELECT view_count FROM share_links WHERE token_hash = ?')
    .bind(await sha256Hex(token))
    .first<{ view_count: number }>()
  return row?.view_count
}

// ── Auth gating ─────────────────────────────────────────────
describe('share owner routes — auth gating', () => {
  it('rejects create / list / revoke without a session', async () => {
    const { carId } = freshIds()
    const create = await SELF.fetch(`${BASE}${createShareLinkPath(carId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
    expect(create.status).toBe(401)
    const list = await SELF.fetch(`${BASE}${createShareLinkPath(carId)}`)
    expect(list.status).toBe(401)
    const revoke = await SELF.fetch(`${BASE}${shareRevokePath(carId, 'abc')}`, { method: 'DELETE' })
    expect(revoke.status).toBe(401)
  })
})

// ── Create + DO-check ordering ──────────────────────────────
describe('POST create share link', () => {
  it('refuses a car that is not in the caller DO, inserting no row (DO-check first)', async () => {
    const carId = crypto.randomUUID()
    const res = await SELF.fetch(`${BASE}${createShareLinkPath(carId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: session.cookie },
      body: '{}',
    })
    expect(res.status).toBe(404)
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM share_links WHERE car_id = ?')
      .bind(carId)
      .first<{ n: number }>()
    expect(count?.n).toBe(0)
  })

  it('mints a URL-safe token, stores ONLY its sha256, returns the raw token once', async () => {
    const ids = freshIds()
    await uploadAndSeedCar(ids)
    const link = await createLink(ids.carId)

    // ≥128-bit URL-safe base64 token (24 random bytes → 32 chars, no padding).
    expect(link.token).toMatch(/^[A-Za-z0-9_-]{22,}$/)
    // Clean path URL (BrowserRouter — M5): no more `/#/`.
    expect(link.url).toBe(`${BASE}/share/${link.token}`)
    expect(link.expiresAt).toBeNull()

    const rows = await env.DB.prepare(
      'SELECT token_hash, car_id, user_id, expires_at, revoked_at FROM share_links WHERE car_id = ?',
    )
      .bind(ids.carId)
      .all<{
        token_hash: string
        car_id: string
        user_id: string
        expires_at: number | null
        revoked_at: number | null
      }>()
    expect(rows.results.length).toBe(1)
    const stored = rows.results[0]
    // Hashed at rest: the stored value is sha256(token), never the raw token.
    expect(stored.token_hash).toBe(await sha256Hex(link.token))
    expect(stored.token_hash).not.toBe(link.token)
    expect(JSON.stringify(rows.results)).not.toContain(link.token)
    expect(stored.user_id).toBe(session.userId)
    expect(stored.expires_at).toBeNull()
    expect(stored.revoked_at).toBeNull()
  })

  it('rejects an over-cap create body before reading it (413)', async () => {
    const { carId } = freshIds()
    // A JSON body well past the 4 KiB cap → the Content-Length guard 413s before
    // the body is parsed or the DO is touched (no row inserted).
    const big = JSON.stringify({ expiresAt: nowSeconds() + 3600, pad: 'x'.repeat(8192) })
    const res = await SELF.fetch(`${BASE}${createShareLinkPath(carId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: session.cookie },
      body: big,
    })
    expect(res.status).toBe(413)
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM share_links WHERE car_id = ?')
      .bind(carId)
      .first<{ n: number }>()
    expect(count?.n).toBe(0)
  })

  it('rejects a chunked / no-Content-Length create body before reading it (411)', async () => {
    const { carId } = freshIds()
    // A ReadableStream body is sent chunked → NO Content-Length. The guard must
    // reject (411) before text() drains the (unbounded) stream — same hardening
    // as the M3 upload route.
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('{}'))
        controller.close()
      },
    })
    const res = await SELF.fetch(`${BASE}${createShareLinkPath(carId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: session.cookie },
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })
    expect(res.status).toBe(411)
  })

  it('rejects a past expiresAt (400) before touching the DO', async () => {
    const { carId } = freshIds()
    const res = await SELF.fetch(`${BASE}${createShareLinkPath(carId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: session.cookie },
      body: JSON.stringify({ expiresAt: nowSeconds() - 60 }),
    })
    expect(res.status).toBe(400)
  })

  it('stores and echoes an optional future expiry', async () => {
    const ids = freshIds()
    await uploadAndSeedCar(ids)
    const future = nowSeconds() + 3600
    const link = await createLink(ids.carId, future)
    expect(link.expiresAt).toBe(future)
    const snap = await SELF.fetch(`${BASE}${shareSnapshotPath(link.token)}`)
    expect(snap.status).toBe(200)
    expect(((await snap.json()) as ShareSnapshotResponse).expiresAt).toBe(future)
  })
})

// ── Public snapshot (the security crux) ─────────────────────
describe('GET public snapshot', () => {
  it('serves the curated showcase with NO secret fields, no session needed', async () => {
    const ids = freshIds()
    const { r2Key } = await uploadAndSeedCar(ids)
    const link = await createLink(ids.carId)

    const res = await SELF.fetch(`${BASE}${shareSnapshotPath(link.token)}`)
    expect(res.status).toBe(200)
    // Active no-expiry link: edge-cacheable ~60s (s-maxage), but only a SHORT
    // revocable browser max-age so a revoke takes effect quickly.
    expect(res.headers.get('cache-control')).toBe('public, max-age=5, s-maxage=60')
    const body = (await res.json()) as ShareSnapshotResponse
    const { car } = body

    // Allowlisted fields survive.
    expect(car.make).toBe('KEEP_make')
    expect(car.nickname).toBe('KEEP_nick')
    expect(car.status).toBe('for-sale')
    expect(car.mileageRaw).toBe('50000')
    expect(car.mileageMiles).toBe(50000)
    expect(car.coverPhotoId).toBe(ids.photoId)
    expect(car.photos[0].photoId).toBe(ids.photoId)
    expect(car.photos[0].caption).toBe('KEEP_caption')
    expect(car.mods[0].name).toBe('KEEP_mod_name')
    expect(car.maintenance[0].service).toBe('KEEP_maint_service')
    expect(car.maintenance[0].nextDueMileageMiles).toBe(90000)
    expect(car.settings.themeId).toBe('midnight')
    expect(car.settings.distanceUnit).toBe('mi')

    // Excluded whole tables / fields are absent at the key level.
    const loose = car as unknown as Record<string, unknown>
    expect(loose.wishlist).toBeUndefined()
    expect(loose.issues).toBeUndefined()
    expect(loose.todos).toBeUndefined()
    expect(loose.salePrice).toBeUndefined()
    expect(loose.tradeFor).toBeUndefined()
    expect(loose.id).toBeUndefined()
    expect((car.settings as unknown as Record<string, unknown>).currency).toBeUndefined()
    const photo = car.photos[0] as unknown as Record<string, unknown>
    expect(photo.r2Key).toBeUndefined()
    expect(photo.dataUrl).toBeUndefined()
    expect(photo.uploadedAt).toBeUndefined()

    // Deep scan: no secret string/number — nor the raw r2Key — anywhere.
    const serialized = JSON.stringify(body)
    for (const secret of SECRET_STRINGS) {
      expect(serialized, `leaked: ${secret}`).not.toContain(secret)
    }
    for (const amount of SECRET_NUMBERS) {
      expect(serialized, `leaked amount: ${amount}`).not.toContain(String(amount))
    }
    expect(serialized).not.toContain(r2Key)
  })

  it('caps the public cache TTL below 60s for a soon-expiring link', async () => {
    const ids = freshIds()
    await uploadAndSeedCar(ids)
    // Expires in ~10s: the cache cap must follow seconds-until-expiry, not the
    // 60s live-link ceiling, so a revoked/expired link can't keep serving stale.
    const link = await createLink(ids.carId, nowSeconds() + 10)
    const res = await SELF.fetch(`${BASE}${shareSnapshotPath(link.token)}`)
    expect(res.status).toBe(200)
    const cc = res.headers.get('cache-control') ?? ''
    const sMaxAge = Number(/s-maxage=(\d+)/.exec(cc)?.[1])
    expect(sMaxAge).toBeGreaterThan(0)
    expect(sMaxAge).toBeLessThanOrEqual(10) // capped to seconds-until-expiry
    expect(sMaxAge).toBeLessThan(60) // strictly below the live-link ceiling
    // The browser TTL stays short regardless (revoke takes effect quickly).
    const maxAge = Number(/(?:^|[ ,])max-age=(\d+)/.exec(cc)?.[1])
    expect(maxAge).toBeLessThanOrEqual(5)
  })

  it('404s an unknown token', async () => {
    const res = await SELF.fetch(`${BASE}${shareSnapshotPath('totally-unknown-token')}`)
    expect(res.status).toBe(404)
  })

  it('410s an expired link (validity checked before the DO)', async () => {
    const rawToken = `expired-${crypto.randomUUID()}`
    const now = nowSeconds()
    await env.DB.prepare(
      'INSERT INTO share_links (token_hash, user_id, car_id, created_at, expires_at, revoked_at) VALUES (?,?,?,?,?,?)',
    )
      .bind(await sha256Hex(rawToken), session.userId, crypto.randomUUID(), now - 100, now - 10, null)
      .run()
    const res = await SELF.fetch(`${BASE}${shareSnapshotPath(rawToken)}`)
    expect(res.status).toBe(410)
  })

  it('lazy-revokes when the car has gone from the DO (snapshot null → 410 + revoked_at set)', async () => {
    const ids = freshIds()
    await uploadAndSeedCar(ids)
    const link = await createLink(ids.carId)
    // Tombstone the whole garage so getCarSnapshot returns null.
    const clear = await SELF.fetch(`${BASE}${SYNC_CLEAR_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: session.cookie },
      body: '{}',
    })
    expect(clear.status).toBe(200)

    const res = await SELF.fetch(`${BASE}${shareSnapshotPath(link.token)}`)
    expect(res.status).toBe(410)
    const row = await env.DB.prepare('SELECT revoked_at FROM share_links WHERE token_hash = ?')
      .bind(await sha256Hex(link.token))
      .first<{ revoked_at: number | null }>()
    expect(row?.revoked_at).not.toBeNull()
  })
})

// ── Visibility scope: curated (default) vs full (read-only) ──
// The security crux of the scope feature: the link's scope is chosen by the
// authenticated owner at create time and STORED; the public GET builds the
// snapshot strictly from the stored scope, NEVER from any client-supplied
// parameter/header/body. A 'curated' holder cannot escalate to 'full'.
describe('GET public snapshot — visibility scope', () => {
  async function createScopedLink(
    carId: string,
    scope: 'curated' | 'full',
  ): Promise<CreateShareResponse> {
    const res = await SELF.fetch(`${BASE}${createShareLinkPath(carId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: session.cookie },
      body: JSON.stringify({ scope }),
    })
    expect(res.status).toBe(200)
    return (await res.json()) as CreateShareResponse
  }

  it('(a) a FULL link returns the owner-only fields (money/shop/notes, wishlist/todos/issues, salePrice/tradeFor)', async () => {
    const ids = freshIds()
    const { r2Key } = await uploadAndSeedCar(ids)
    const link = await createScopedLink(ids.carId, 'full')

    const res = await SELF.fetch(`${BASE}${shareSnapshotPath(link.token)}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ShareSnapshotResponse
    expect(body.scope).toBe('full')
    if (body.scope !== 'full') throw new Error('expected full scope') // narrows the union
    const { car } = body

    // Curated fields still present…
    expect(car.make).toBe('KEEP_make')
    expect(car.coverPhotoId).toBe(ids.photoId)
    // …and the previously-withheld owner fields are now exposed (read-only).
    expect(car.salePrice).toBe('SECRET_salePrice')
    expect(car.tradeFor).toBe('SECRET_tradeFor')
    expect(car.mods[0].cost).toBe(92929292)
    expect(car.mods[0].shop).toBe('SECRET_mod_shop')
    expect(car.maintenance[0].cost).toBe(93939393)
    expect(car.maintenance[0].shop).toBe('SECRET_maint_shop')
    expect(car.maintenance[0].notes).toBe('SECRET_maint_notes')
    expect(car.wishlist[0].name).toBe('SECRET_wish_name')
    expect(car.wishlist[0].price).toBe(91919191)
    expect(car.wishlist[0].notes).toBe('SECRET_wish_notes')
    expect(car.todos[0].text).toBe('SECRET_todo_text')
    expect(car.issues[0].title).toBe('SECRET_issue_title')
    expect(car.issues[0].description).toBe('SECRET_issue_description')
    expect(car.settings.currency).toBe('USD')

    // (d) Even 'full' NEVER exposes the raw r2Key, the userId/email, the raw
    // photo dataUrl/uploadedAt, or any internal row id.
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain(r2Key)
    expect(serialized).not.toContain(session.userId)
    expect(serialized).not.toContain('share-user@example.com')
    expect(serialized).not.toContain('SECRET_photo_uploadedAt')
    const photo = car.photos[0] as unknown as Record<string, unknown>
    expect(photo.r2Key).toBeUndefined()
    expect(photo.dataUrl).toBeUndefined()
    expect(photo.uploadedAt).toBeUndefined()
    expect((car.wishlist[0] as unknown as Record<string, unknown>).id).toBeUndefined()
    expect((car.mods[0] as unknown as Record<string, unknown>).id).toBeUndefined()
    expect((car.issues[0] as unknown as Record<string, unknown>).id).toBeUndefined()
  })

  it('(b) a CURATED link IGNORES a client scope override (?scope=full + headers) — never serves full data', async () => {
    const ids = freshIds()
    const { r2Key } = await uploadAndSeedCar(ids)
    const link = await createScopedLink(ids.carId, 'curated')

    // Attacker holding a curated link tries every request-side lever to escalate:
    // a query param AND spoofed scope headers. The server reads ONLY the stored
    // scope, so the body must come back curated with no secret anywhere.
    const res = await SELF.fetch(`${BASE}${shareSnapshotPath(link.token)}?scope=full&full=1`, {
      headers: { 'x-share-scope': 'full', 'x-scope': 'full', scope: 'full' },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as ShareSnapshotResponse
    expect(body.scope).toBe('curated')
    const loose = body.car as unknown as Record<string, unknown>
    expect(loose.wishlist).toBeUndefined()
    expect(loose.todos).toBeUndefined()
    expect(loose.issues).toBeUndefined()
    expect(loose.salePrice).toBeUndefined()
    expect(loose.tradeFor).toBeUndefined()

    const serialized = JSON.stringify(body)
    for (const secret of SECRET_STRINGS) {
      expect(serialized, `escalation leaked: ${secret}`).not.toContain(secret)
    }
    for (const amount of SECRET_NUMBERS) {
      expect(serialized, `escalation leaked amount: ${amount}`).not.toContain(String(amount))
    }
    expect(serialized).not.toContain(r2Key)
  })

  it('(c) a row with NO scope set (pre-0002 / DB default) serves the curated showcase unchanged', async () => {
    const ids = freshIds()
    await uploadAndSeedCar(ids)
    // Insert a link row WITHOUT the scope column — exactly what an existing row
    // created before the additive 0002 migration looks like. The NOT NULL
    // DEFAULT 'curated' must apply, so it serves the showcase.
    const rawToken = `legacy-${crypto.randomUUID()}`
    const now = nowSeconds()
    await env.DB.prepare(
      'INSERT INTO share_links (token_hash, user_id, car_id, created_at, expires_at, revoked_at) VALUES (?,?,?,?,?,?)',
    )
      .bind(await sha256Hex(rawToken), session.userId, ids.carId, now - 10, null, null)
      .run()

    const res = await SELF.fetch(`${BASE}${shareSnapshotPath(rawToken)}`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as ShareSnapshotResponse
    expect(body.scope).toBe('curated')
    const loose = body.car as unknown as Record<string, unknown>
    expect(loose.wishlist).toBeUndefined()
    expect(loose.salePrice).toBeUndefined()
  })

  it('stores the chosen scope and surfaces it in the owner list', async () => {
    const ids = freshIds()
    await uploadAndSeedCar(ids)
    await createScopedLink(ids.carId, 'full')
    const listRes = await SELF.fetch(`${BASE}${createShareLinkPath(ids.carId)}`, {
      headers: { cookie: session.cookie },
    })
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as ShareLinkListResponse
    expect(list.links.length).toBe(1)
    expect(list.links[0].scope).toBe('full')
  })

  it('defaults to curated when the create body omits scope', async () => {
    const ids = freshIds()
    await uploadAndSeedCar(ids)
    const link = await createLink(ids.carId) // body is `{}` — no scope
    const stored = await env.DB.prepare('SELECT scope FROM share_links WHERE token_hash = ?')
      .bind(await sha256Hex(link.token))
      .first<{ scope: string }>()
    expect(stored?.scope).toBe('curated')
  })

  it('rejects an unknown scope value (400, no row inserted)', async () => {
    const ids = freshIds()
    await uploadAndSeedCar(ids)
    const res = await SELF.fetch(`${BASE}${createShareLinkPath(ids.carId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: session.cookie },
      body: JSON.stringify({ scope: 'everything' }),
    })
    expect(res.status).toBe(400)
    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM share_links WHERE car_id = ?')
      .bind(ids.carId)
      .first<{ n: number }>()
    expect(count?.n).toBe(0)
  })
})

// ── Token-scoped image ──────────────────────────────────────
describe('GET token-scoped image', () => {
  it("serves the link's photo bytes (no session) and 404s a foreign photoId", async () => {
    const ids = freshIds()
    await uploadAndSeedCar(ids)
    const link = await createLink(ids.carId)
    const res = await SELF.fetch(`${BASE}${shareImgPath(link.token, ids.photoId)}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(res.headers.get('cache-control')).toBe('public, max-age=5, s-maxage=60')
    expect(new Uint8Array(await res.arrayBuffer())).toStrictEqual(WEBP_BYTES)

    const missing = await SELF.fetch(`${BASE}${shareImgPath(link.token, crypto.randomUUID())}`)
    expect(missing.status).toBe(404)
  })

  it('404s the image for an unknown token', async () => {
    const res = await SELF.fetch(`${BASE}${shareImgPath('unknown-token', crypto.randomUUID())}`)
    expect(res.status).toBe(404)
  })
})

// ── List + revoke ───────────────────────────────────────────
describe('list + revoke', () => {
  it('lists links (no raw token/hash) then revokes by id → snapshot & image 410', async () => {
    const ids = freshIds()
    await uploadAndSeedCar(ids)
    const link = await createLink(ids.carId)

    const listRes = await SELF.fetch(`${BASE}${createShareLinkPath(ids.carId)}`, {
      headers: { cookie: session.cookie },
    })
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as ShareLinkListResponse
    expect(list.links.length).toBe(1)
    const meta = list.links[0]
    expect(meta.carId).toBe(ids.carId)
    expect(meta.revokedAt).toBeNull()
    // The meta id is a SHORT prefix of the hash — not the raw token, not the full hash.
    const hash = await sha256Hex(link.token)
    expect(hash.startsWith(meta.id)).toBe(true)
    expect(meta.id.length).toBeLessThan(hash.length)
    expect(JSON.stringify(list)).not.toContain(link.token)

    const revoke = await SELF.fetch(`${BASE}${shareRevokePath(ids.carId, meta.id)}`, {
      method: 'DELETE',
      headers: { cookie: session.cookie },
    })
    expect(revoke.status).toBe(200)

    expect((await SELF.fetch(`${BASE}${shareSnapshotPath(link.token)}`)).status).toBe(410)
    expect((await SELF.fetch(`${BASE}${shareImgPath(link.token, ids.photoId)}`)).status).toBe(410)
  })

  it('404s revoking an id that matches no link for that car', async () => {
    const ids = freshIds()
    await uploadAndSeedCar(ids)
    await createLink(ids.carId)
    // A different car id has no links → 404 (revoke is scoped to user+car).
    const res = await SELF.fetch(`${BASE}${shareRevokePath(crypto.randomUUID(), 'deadbeef')}`, {
      method: 'DELETE',
      headers: { cookie: session.cookie },
    })
    expect(res.status).toBe(404)
  })
})

// ── View counter (POST /api/share/:token/view) ──────────────
describe('record view', () => {
  it('increments a valid link, responds {ok:true} + no-store, and counts again on re-post', async () => {
    const ids = freshIds()
    await uploadAndSeedCar(ids)
    const link = await createLink(ids.carId)
    expect(await viewCountFor(link.token)).toBe(0) // additive column defaults to 0

    const res = await SELF.fetch(`${BASE}${shareViewPath(link.token)}`, { method: 'POST' })
    expect(res.status).toBe(200)
    // UNCACHED on purpose (the snapshot GET is edge-cached, so counting there
    // would undercount) — every ping must reach the origin.
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ ok: true })
    expect(await viewCountFor(link.token)).toBe(1)

    // The server itself has no per-session guard (that lives in the browser
    // client) — a second POST increments again.
    const again = await SELF.fetch(`${BASE}${shareViewPath(link.token)}`, { method: 'POST' })
    expect(again.status).toBe(200)
    expect(await viewCountFor(link.token)).toBe(2)
  })

  it('does NOT increment a revoked link (still 200 + no-store, count frozen)', async () => {
    const ids = freshIds()
    await uploadAndSeedCar(ids)
    const link = await createLink(ids.carId)
    // One real view, then revoke.
    await SELF.fetch(`${BASE}${shareViewPath(link.token)}`, { method: 'POST' })
    expect(await viewCountFor(link.token)).toBe(1)
    const list = (await (
      await SELF.fetch(`${BASE}${createShareLinkPath(ids.carId)}`, { headers: { cookie: session.cookie } })
    ).json()) as ShareLinkListResponse
    const revoke = await SELF.fetch(`${BASE}${shareRevokePath(ids.carId, list.links[0].id)}`, {
      method: 'DELETE',
      headers: { cookie: session.cookie },
    })
    expect(revoke.status).toBe(200)

    const res = await SELF.fetch(`${BASE}${shareViewPath(link.token)}`, { method: 'POST' })
    expect(res.status).toBe(200) // never leaks that the link is gone
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await viewCountFor(link.token)).toBe(1) // frozen — no bump for an invalid link
  })

  it('does NOT increment an expired link', async () => {
    // Insert a directly-expired link (no snapshot needed — validity is checked
    // before anything else) and confirm POST view leaves it at 0.
    const rawToken = `view-expired-${crypto.randomUUID()}`
    const now = nowSeconds()
    await env.DB.prepare(
      'INSERT INTO share_links (token_hash, user_id, car_id, created_at, expires_at, revoked_at, view_count) VALUES (?,?,?,?,?,?,?)',
    )
      .bind(await sha256Hex(rawToken), session.userId, crypto.randomUUID(), now - 100, now - 10, null, 0)
      .run()
    const res = await SELF.fetch(`${BASE}${shareViewPath(rawToken)}`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(await viewCountFor(rawToken)).toBe(0)
  })

  it('does NOT create or increment anything for a garbage/unknown token (still 200)', async () => {
    const res = await SELF.fetch(`${BASE}${shareViewPath('totally-unknown-token')}`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ ok: true })
    // No row was conjured for an unknown token.
    expect(await viewCountFor('totally-unknown-token')).toBeUndefined()
  })

  it('surfaces the running viewCount in the owner list', async () => {
    const ids = freshIds()
    await uploadAndSeedCar(ids)
    const link = await createLink(ids.carId)
    await SELF.fetch(`${BASE}${shareViewPath(link.token)}`, { method: 'POST' })
    await SELF.fetch(`${BASE}${shareViewPath(link.token)}`, { method: 'POST' })
    await SELF.fetch(`${BASE}${shareViewPath(link.token)}`, { method: 'POST' })

    const listRes = await SELF.fetch(`${BASE}${createShareLinkPath(ids.carId)}`, {
      headers: { cookie: session.cookie },
    })
    expect(listRes.status).toBe(200)
    const list = (await listRes.json()) as ShareLinkListResponse
    expect(list.links.length).toBe(1)
    expect(list.links[0].viewCount).toBe(3)
    // The list still leaks no raw token / full hash.
    expect(JSON.stringify(list)).not.toContain(link.token)
  })
})
