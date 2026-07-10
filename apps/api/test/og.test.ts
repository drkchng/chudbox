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
  escapeHtmlText,
  injectIntoHead,
  overrideDocumentMeta,
  renderShareMetaTags,
  shareMetaFromSnapshot,
} from '../src/og'
import type { ShareMeta } from '../src/og'

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

describe('escapeHtmlText', () => {
  it('escapes the text-content-breaking characters but leaves quotes', () => {
    expect(escapeHtmlText('a&b<c>d"e\'f')).toBe('a&amp;b&lt;c&gt;d"e\'f')
  })
})

describe('overrideDocumentMeta', () => {
  const SHELL =
    '<!doctype html><html><head>' +
    '<meta name="description" content="DEFAULT BLURB" />' +
    '<title>Chudbox — My Garage</title>' +
    '</head><body><div id="root"></div></body></html>'
  const META: ShareMeta = {
    title: '2008 Acura RSX — Track Rat',
    description: '1 mod · 1 maintenance record — shared on Chudbox',
    url: 'https://example.com/share/tok',
  }

  it('replaces the shell <title> and <meta name="description"> with the share values', () => {
    const out = overrideDocumentMeta(SHELL, META)
    expect(out).toContain('<title>2008 Acura RSX — Track Rat</title>')
    expect(out).toContain(
      '<meta name="description" content="1 mod · 1 maintenance record — shared on Chudbox" />',
    )
    expect(out).not.toContain('My Garage')
    expect(out).not.toContain('DEFAULT BLURB')
    expect(out.match(/<title>/g)?.length).toBe(1)
    // The rest of the document (the SPA root) is untouched.
    expect(out).toContain('<div id="root"></div>')
  })

  it('text-escapes a </title> breakout attempt in the title (crawler-safe)', () => {
    const out = overrideDocumentMeta(SHELL, {
      ...META,
      title: '</title><script>alert(1)</script>',
    })
    expect(out).not.toContain('<script>')
    expect(out).not.toContain('</title><script')
    expect(out).toContain('&lt;/title&gt;&lt;script&gt;')
  })

  it('attribute-escapes a breakout attempt in the description', () => {
    const out = overrideDocumentMeta(SHELL, {
      ...META,
      description: '"><script>alert(1)</script>',
    })
    expect(out).not.toContain('<script>')
    expect(out).not.toContain('"><script')
    expect(out).toContain('&quot;&gt;&lt;script&gt;')
  })

  it('leaves HTML untouched when the shell has no title/description tags', () => {
    const plain = '<html><head></head><body></body></html>'
    expect(overrideDocumentMeta(plain, META)).toBe(plain)
  })

  it('inserts $-sequences in the title verbatim (no String.replace pattern corruption)', () => {
    // `$&`/`$$` are special in a replacement STRING; with a replacer function
    // they must survive verbatim (only `&` is escaped by escapeHtmlText).
    const out = overrideDocumentMeta(SHELL, { ...META, title: 'Big $& Deal $$ Co' })
    expect(out).toContain('<title>Big $&amp; Deal $$ Co</title>')
    expect(out).not.toContain('My Garage')
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
    body: JSON.stringify({ email, password, name: 'OG Tester', tosAcceptedVersion: 1 }),
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
    // DEC-13: a VIN that the OG/crawler path must NEVER render (review fix #1).
    vin: 'OGVIN1234567890XX',
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

async function seedCar(ids: Ids, opts?: { noCover?: boolean }): Promise<void> {
  const store = createGarageStore('og-client')
  const base = makeCar(ids)
  const car = opts?.noCover ? { ...base, coverPhoto: '', photos: [] } : base
  const flat = flattenCar(car, { currency: 'USD', distanceUnit: 'mi' })
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

async function createLink(
  carId: string,
  scope?: 'curated' | 'listing' | 'full',
): Promise<CreateShareResponse> {
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

  // Review fix #1 (MAJOR): the OG/crawler path is the highest-exposure surface
  // (crawler-cached, NO session). It must be STRUCTURALLY private-free — the
  // rendered /share/:token HTML must NEVER contain the car's VIN, even for a
  // LISTING link (where the snapshot scope CAN carry vin). The OG path downgrades
  // every scope to curated, so vin is absent by construction.
  it('NEVER renders the VIN in the /share/:token HTML for a listing link (regression #1)', async () => {
    const ids = freshIds()
    await seedCar(ids)
    const link = await createLink(ids.carId, 'listing')

    const res = await SELF.fetch(`${BASE}/share/${link.token}`)
    expect(res.status).toBe(200)
    const html = await res.text()
    // The curated title still drives the preview…
    expect(html).toContain('property="og:title" content="2008 Acura RSX')
    // …but the VIN (a fraud-enabling identifier) is NOWHERE in the document.
    expect(html).not.toContain('OGVIN1234567890XX')
    // …and neither is the price/other private data.
    for (const secret of SECRETS) {
      expect(html, `listing-preview leaked: ${secret}`).not.toContain(secret)
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

// ── Regression (#13): the share document must OVERRIDE the shell's default
// <title> + <meta name="description"> — not merely APPEND og/twitter tags.
// Crawlers/unfurlers that read the BARE <title> / <meta name="description">
// (the universal fallback, and several prefer it) otherwise keep the baked-in
// generic shell values → the preview shows "Chudbox — My Garage" + the generic
// blurb instead of the curated car snapshot (the reported production symptom).
// "My Garage" / "All local, no account needed" are ASCII fragments UNIQUE to
// the two default tags in apps/web/index.html.
describe('GET /share/:token document — overrides the default shell title/description', () => {
  it('replaces the default <title> + description with curated values (curated link)', async () => {
    const ids = freshIds()
    await seedCar(ids)
    const link = await createLink(ids.carId)

    const res = await SELF.fetch(`${BASE}/share/${link.token}`)
    expect(res.status).toBe(200)
    const html = await res.text()

    // The car-specific values now drive the bare-HTML fallback…
    expect(html).toContain('<title>2008 Acura RSX')
    expect(html).toContain('<meta name="description" content="1 mod')
    // …and the generic shell defaults are GONE (the reported symptom).
    expect(html).not.toContain('My Garage')
    expect(html).not.toContain('All local, no account needed')
    // Exactly one <title> element survives (no duplicate appended tag).
    expect(html.match(/<title>/g)?.length).toBe(1)
    // The SPA bundle still loads for human visitors.
    expect(html).toContain('id="root"')
    expect(html).toContain('<script')
  })

  it('also overrides the title/description for a FULL-scoped link (still curated, defaults gone)', async () => {
    const ids = freshIds()
    await seedCar(ids)
    const link = await createLink(ids.carId, 'full')

    const res = await SELF.fetch(`${BASE}/share/${link.token}`)
    expect(res.status).toBe(200)
    const html = await res.text()

    expect(html).toContain('<title>2008 Acura RSX')
    expect(html).toContain('<meta name="description" content="1 mod')
    expect(html).not.toContain('My Garage')
    expect(html).not.toContain('All local, no account needed')
    expect(html.match(/<title>/g)?.length).toBe(1)
  })

  // A valid build with NO cover photo still gets a correct title/description
  // preview (just no image) — the injection is gated on the snapshot, not on a
  // cover photo. Guards against a photo-less share falling through to the
  // generic shell.
  it('overrides title/description for a photo-less build, omitting og:image', async () => {
    const ids = freshIds()
    await seedCar(ids, { noCover: true })
    const link = await createLink(ids.carId)

    const res = await SELF.fetch(`${BASE}/share/${link.token}`)
    expect(res.status).toBe(200)
    const html = await res.text()

    // Title + description + og:title are still curated…
    expect(html).toContain('<title>2008 Acura RSX')
    expect(html).toContain('property="og:title" content="2008 Acura RSX')
    expect(html).not.toContain('My Garage')
    expect(html).not.toContain('All local, no account needed')
    // …but with no cover there are no image tags.
    expect(html).not.toContain('property="og:image"')
    expect(html).not.toContain('name="twitter:image"')
  })
})
