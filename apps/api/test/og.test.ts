// M5 Open Graph injection tests.
//
//  • Pure helpers (escape / build / render / inject) — no session needed.
//  • Integration through the REAL Worker + GarageDO + emulated D1/R2: GET the
//    /share/:token DOCUMENT and assert the injected <head> meta. The security
//    crux: the preview is CURATED-ONLY (even for a 'full' link) and never leaks
//    a private field, and the HTML values are attribute-escaped.
import { SELF, env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  SYNC_SEED_PATH,
  chunkMergeableContent,
  createGarageStore,
  createShareLinkPath,
  encodeSeedChunk,
  flattenCar,
  shareImgPath,
} from '@chudbox/shared'
import type { Car, CreateShareResponse, PublicCarSnapshot } from '@chudbox/shared'
import type { MergeableStore } from 'tinybase'
import {
  escapeHtmlAttr,
  injectIntoHead,
  renderShareMetaTags,
  shareMetaFromSnapshot,
} from '../src/og'

const BASE = 'https://example.com'

// ── Pure helpers ────────────────────────────────────────────
describe('escapeHtmlAttr', () => {
  it('escapes the five attribute-breaking characters', () => {
    expect(escapeHtmlAttr('a&b<c>d"e\'f')).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f')
  })
})

const SNAPSHOT_BASE: PublicCarSnapshot = {
  year: '2008',
  make: 'Acura',
  model: 'RSX',
  trim: 'Type-S',
  color: 'red',
  nickname: '',
  mileageRaw: '90000',
  status: 'current',
  createdAt: 'x',
  coverPhotoId: 'photo-1',
  photos: [{ photoId: 'photo-1', caption: '' }],
  mods: [
    { name: 'm1', category: 'c', description: '', installedDate: '', link: '', addedAt: 'x' },
  ],
  maintenance: [{ service: 's1', date: '', createdAt: 'x' }],
  settings: { themeId: 'garage', distanceUnit: 'mi' },
}

describe('shareMetaFromSnapshot', () => {
  it('builds the title from year/make/model', () => {
    const meta = shareMetaFromSnapshot(SNAPSHOT_BASE, 'tok', BASE)
    expect(meta.title).toBe('2008 Acura RSX')
  })

  it('appends a non-empty nickname', () => {
    const meta = shareMetaFromSnapshot({ ...SNAPSHOT_BASE, nickname: 'Track Rat' }, 'tok', BASE)
    expect(meta.title).toBe('2008 Acura RSX — Track Rat')
  })

  it('builds a singular/plural count description', () => {
    const one = shareMetaFromSnapshot(SNAPSHOT_BASE, 'tok', BASE)
    expect(one.description).toBe('1 mod · 1 maintenance record — shared on Chudbox')
    const many = shareMetaFromSnapshot(
      { ...SNAPSHOT_BASE, mods: [...SNAPSHOT_BASE.mods, ...SNAPSHOT_BASE.mods], maintenance: [] },
      'tok',
      BASE,
    )
    expect(many.description).toBe('2 mods · 0 maintenance records — shared on Chudbox')
  })

  it('builds an absolute token-scoped cover image + clean url', () => {
    const meta = shareMetaFromSnapshot(SNAPSHOT_BASE, 'tok-123', BASE)
    expect(meta.url).toBe(`${BASE}/share/tok-123`)
    expect(meta.image).toBe(`${BASE}${shareImgPath('tok-123', 'photo-1')}`)
  })

  it('omits the image when the car has no cover photo', () => {
    const { coverPhotoId: _omit, ...noCover } = SNAPSHOT_BASE
    const meta = shareMetaFromSnapshot({ ...noCover, photos: [] }, 'tok', BASE)
    expect(meta.image).toBeUndefined()
  })
})

describe('renderShareMetaTags', () => {
  it('emits the OG + Twitter tags', () => {
    const block = renderShareMetaTags(shareMetaFromSnapshot(SNAPSHOT_BASE, 'tok', BASE))
    expect(block).toContain('property="og:type" content="website"')
    expect(block).toContain('property="og:site_name" content="Chudbox"')
    expect(block).toContain('property="og:title" content="2008 Acura RSX"')
    expect(block).toContain('name="twitter:card" content="summary_large_image"')
    expect(block).toContain('property="og:image"')
    expect(block).toContain('name="twitter:image"')
  })

  it('escapes an attacker-controlled value (no attribute/markup breakout)', () => {
    const evil = shareMetaFromSnapshot(
      { ...SNAPSHOT_BASE, make: '"><script>alert(1)</script>' },
      'tok',
      BASE,
    )
    const block = renderShareMetaTags(evil)
    expect(block).not.toContain('<script>')
    expect(block).not.toContain('"><script')
    expect(block).toContain('&lt;script&gt;')
  })
})

describe('injectIntoHead', () => {
  it('inserts the block immediately before </head>', () => {
    const out = injectIntoHead('<html><head><title>x</title></head><body></body></html>', '<meta />')
    expect(out).toContain('<meta />\n  </head>')
    expect(out.indexOf('<meta />')).toBeLessThan(out.indexOf('</head>'))
  })

  it('returns the HTML unchanged when there is no </head>', () => {
    expect(injectIntoHead('<html><body></body></html>', '<meta />')).toBe(
      '<html><body></body></html>',
    )
  })
})

// ── Integration through the Worker ──────────────────────────
const SECRETS = ['SECRET_salePrice', 'SECRET_mod_shop', 'SECRET_maint_notes', 'SECRET_wish_name']

let session: { cookie: string; userId: string }

beforeAll(async () => {
  const email = 'og-user@example.com'
  const password = 'correct-horse-battery'
  const signUp = await SELF.fetch(`${BASE}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name: 'OG Tester' }),
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
  const cookie = (signIn.headers.get('set-cookie') ?? '').match(
    /(?:__Secure-)?better-auth\.session_token=[^;]+/,
  )?.[0]
  if (!cookie) throw new Error('no session cookie after sign-in')
  session = { cookie, userId: user.id }
})

interface Ids {
  carId: string
  photoId: string
}
const freshIds = (): Ids => ({ carId: crypto.randomUUID(), photoId: crypto.randomUUID() })

/** A car with secrets in every excluded field + one mod, one maintenance, one
 * photo (the cover). The secrets must never reach the curated preview. */
function makeCar({ carId, photoId }: Ids): Car {
  return {
    id: carId,
    year: '2008',
    make: 'Acura',
    model: 'RSX',
    trim: 'Type-S',
    color: 'red',
    mileage: '90000',
    nickname: 'Track Rat',
    purchaseDate: '',
    saleDate: '',
    status: 'for-sale',
    salePrice: 'SECRET_salePrice',
    tradeFor: '',
    coverPhoto: photoId,
    createdAt: 'x',
    photos: [{ id: photoId, dataUrl: '', caption: 'KEEP_caption', uploadedAt: 'x' }],
    wishlist: [
      { id: 'w1', name: 'SECRET_wish_name', link: '', price: null, category: '', notes: '', status: 'wanted', addedAt: 'x' },
    ],
    mods: [
      { id: 'mod-1', name: 'Coilovers', category: 'Suspension', description: '', cost: null, installedDate: '', shop: 'SECRET_mod_shop', link: '', addedAt: 'x' },
    ],
    maintenance: [
      { id: 'm1', service: 'Oil change', date: '', mileage: '90000', cost: null, shop: '', notes: 'SECRET_maint_notes', nextDueDate: '', nextDueMileage: '', createdAt: 'x' },
    ],
    todos: [],
    issues: [],
  }
}

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

async function seedCar(ids: Ids): Promise<void> {
  const store = createGarageStore('og-client')
  const flat = flattenCar(makeCar(ids), { currency: 'USD', distanceUnit: 'mi' })
  store.setRow('cars', flat.carId, flat.car)
  for (const [table, rows] of [
    ['photos', flat.photos],
    ['wishlist', flat.wishlist],
    ['mods', flat.mods],
    ['maintenance', flat.maintenance],
  ] as const) {
    for (const [rowId, row] of Object.entries(rows)) store.setRow(table, rowId, row)
  }
  store.setValues({ themeId: 'midnight', currency: 'USD', distanceUnit: 'mi' })
  await seedStore(store)
}

async function createLink(carId: string, scope?: 'curated' | 'full'): Promise<CreateShareResponse> {
  const res = await SELF.fetch(`${BASE}${createShareLinkPath(carId)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: session.cookie },
    body: JSON.stringify(scope ? { scope } : {}),
  })
  expect(res.status).toBe(200)
  return (await res.json()) as CreateShareResponse
}

describe('GET /share/:token document — OG injection', () => {
  it('injects the car title + cover image and still loads the SPA bundle', async () => {
    const ids = freshIds()
    await seedCar(ids)
    const link = await createLink(ids.carId)

    const res = await SELF.fetch(`${BASE}/share/${link.token}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()

    // Car-specific preview meta.
    expect(html).toContain('property="og:title" content="2008 Acura RSX — Track Rat"')
    expect(html).toContain('property="og:description" content="1 mod · 1 maintenance record')
    expect(html).toContain(`property="og:image" content="${BASE}${shareImgPath(link.token, ids.photoId)}"`)
    expect(html).toContain('name="twitter:card" content="summary_large_image"')
    expect(html).toContain(`property="og:url" content="${BASE}/share/${link.token}"`)
    // The normal SPA shell still loads so React hydrates for humans.
    expect(html).toContain('id="root"')
    expect(html).toContain('<script')

    // The security-headers middleware covers this Worker-served HTML.
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')

    // No private field leaks into the preview.
    for (const secret of SECRETS) {
      expect(html, `leaked: ${secret}`).not.toContain(secret)
    }
  })

  it('forces CURATED meta even for a FULL-scoped link (preview never exposes private data)', async () => {
    const ids = freshIds()
    await seedCar(ids)
    const link = await createLink(ids.carId, 'full')

    const res = await SELF.fetch(`${BASE}/share/${link.token}`)
    expect(res.status).toBe(200)
    const html = await res.text()
    // Still gets a title (it's a valid car)…
    expect(html).toContain('property="og:title" content="2008 Acura RSX — Track Rat"')
    // …but the full link's private fields never reach the public preview.
    for (const secret of SECRETS) {
      expect(html, `full-link preview leaked: ${secret}`).not.toContain(secret)
    }
  })

  it('serves the plain shell with default meta for a garbage token (no injection)', async () => {
    const res = await SELF.fetch(`${BASE}/share/totally-unknown-token`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    // No car-specific meta was injected…
    expect(html).not.toContain('property="og:title"')
    // …but the default Chudbox shell (with its baked title) is served and loads.
    expect(html).toContain('Chudbox')
    expect(html).toContain('id="root"')
  })

  it('serves the plain shell for a revoked link', async () => {
    const ids = freshIds()
    await seedCar(ids)
    const link = await createLink(ids.carId)
    // Revoke it directly.
    await env.DB.prepare('UPDATE share_links SET revoked_at = ? WHERE car_id = ?')
      .bind(Math.floor(Date.now() / 1000), ids.carId)
      .run()
    const res = await SELF.fetch(`${BASE}/share/${link.token}`)
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).not.toContain('property="og:title"')
    expect(html).toContain('id="root"')
  })
})
