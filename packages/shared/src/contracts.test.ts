import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  IMG_PATH_PREFIX,
  SHARE_CARD_VIEW,
  SHARE_CREATE_PATH,
  SHARE_IMG_ROUTE,
  SHARE_LINK_ID_MIN_LEN,
  SHARE_LIST_PATH,
  SHARE_PUBLIC_PATH,
  SHARE_REVOKE_PATH,
  SHARE_ROUTE_PREFIX,
  SHARE_VIEW_PARAM,
  UPLOAD_PATH,
  buildPhotoKey,
  createShareLinkPath,
  imgPath,
  parsePhotoKey,
  fullCarSnapshotSchema,
  listingCarSnapshotSchema,
  publicCarSnapshotSchema,
  shareCardPath,
  shareCardResponseSchema,
  shareImgPath,
  shareRevokePath,
  shareSnapshotPath,
  shareSnapshotResponseSchema,
} from './contracts'
import type { ShareCardResponse, ShareSnapshotResponse } from './contracts'
import type { PhotoExt } from './imagePolicy'
import {
  buildFullSnapshot,
  buildListingSnapshot,
  buildPublicSnapshot,
  buildShareCard,
  toCuratedSnapshot,
} from './publicSnapshot'
import type { SnapshotCarInput } from './publicSnapshot'
import type { GarageValues } from './schema'

describe('buildPhotoKey', () => {
  it('builds the documented u/<userId>/<carId>/<photoId>.<ext> shape', () => {
    expect(buildPhotoKey({ userId: 'user1', carId: 'car1', photoId: 'p1', ext: 'webp' })).toBe(
      'u/user1/car1/p1.webp',
    )
    expect(buildPhotoKey({ userId: 'user1', carId: 'car1', photoId: 'p1', ext: 'jpg' })).toBe(
      'u/user1/car1/p1.jpg',
    )
  })
})

describe('parsePhotoKey', () => {
  it('round-trips both stored extensions', () => {
    for (const ext of ['webp', 'jpg'] as PhotoExt[]) {
      const parts = { userId: 'u-123', carId: 'c-456', photoId: 'ph-789', ext }
      expect(parsePhotoKey(buildPhotoKey(parts))).toEqual(parts)
    }
  })

  it('round-trips UUID-shaped ids', () => {
    const parts = {
      userId: '11111111-1111-4111-8111-111111111111',
      carId: '22222222-2222-4222-8222-222222222222',
      photoId: '33333333-3333-4333-8333-333333333333',
      ext: 'webp' as PhotoExt,
    }
    expect(parsePhotoKey(buildPhotoKey(parts))).toEqual(parts)
  })

  it('is a provable inverse of buildPhotoKey for URL-safe id segments', () => {
    // The id charset the upload schema enforces (A-Z a-z 0-9 - _). Any key
    // built from such segments MUST parse back to exactly those parts, so a
    // valid upload can never produce an object /img can't serve.
    const seg = fc.stringMatching(/^[A-Za-z0-9_-]+$/)
    fc.assert(
      fc.property(seg, seg, seg, fc.constantFrom<PhotoExt>('webp', 'jpg'), (userId, carId, photoId, ext) => {
        const parts = { userId, carId, photoId, ext }
        expect(parsePhotoKey(buildPhotoKey(parts))).toEqual(parts)
      }),
    )
  })

  it('rejects malformed keys (so the server can deny before authorizing)', () => {
    expect(parsePhotoKey('')).toBeNull()
    expect(parsePhotoKey('x/uid/cid/p.webp')).toBeNull() // wrong prefix
    expect(parsePhotoKey('u/cid/p.webp')).toBeNull() // too few segments
    expect(parsePhotoKey('u/uid/cid/sub/p.webp')).toBeNull() // too many segments
    expect(parsePhotoKey('u/../cid/p.webp')).toBeNull() // path traversal
    expect(parsePhotoKey('u/uid/../p.webp')).toBeNull() // path traversal
    expect(parsePhotoKey('u/uid/cid/p.png')).toBeNull() // unknown extension
    expect(parsePhotoKey('u/uid/cid/p')).toBeNull() // no extension
    expect(parsePhotoKey('u/uid/cid/p.')).toBeNull() // empty extension
    expect(parsePhotoKey('u/uid/cid/.webp')).toBeNull() // empty photoId
    expect(parsePhotoKey('u//cid/p.webp')).toBeNull() // empty userId
    expect(parsePhotoKey('u/uid//p.webp')).toBeNull() // empty carId
  })
})

describe('imgPath', () => {
  it('prefixes the key with /img and keeps its slashes as path separators', () => {
    const key = buildPhotoKey({ userId: 'u1', carId: 'c1', photoId: 'p1', ext: 'jpg' })
    expect(imgPath(key)).toBe('/img/u/u1/c1/p1.jpg')
    expect(imgPath(key).startsWith(`${IMG_PATH_PREFIX}/`)).toBe(true)
  })
})

describe('upload route constants', () => {
  it('pin the documented paths', () => {
    expect(UPLOAD_PATH).toBe('/api/uploads')
    expect(IMG_PATH_PREFIX).toBe('/img')
  })
})

describe('share route patterns', () => {
  it('pin the documented Hono-style patterns', () => {
    expect(SHARE_CREATE_PATH).toBe('/api/cars/:carId/share')
    expect(SHARE_LIST_PATH).toBe('/api/cars/:carId/share')
    expect(SHARE_REVOKE_PATH).toBe('/api/cars/:carId/share/:id')
    expect(SHARE_PUBLIC_PATH).toBe('/api/share/:token')
    expect(SHARE_IMG_ROUTE).toBe('/api/share/:token/img/:photoId')
  })

  it('keeps the public patterns under SHARE_ROUTE_PREFIX', () => {
    expect(SHARE_PUBLIC_PATH.startsWith(`${SHARE_ROUTE_PREFIX}/`)).toBe(true)
    expect(SHARE_IMG_ROUTE.startsWith(`${SHARE_ROUTE_PREFIX}/`)).toBe(true)
  })
})

describe('share path builders', () => {
  it('build the owner create/list path for a car', () => {
    expect(createShareLinkPath('car-1')).toBe('/api/cars/car-1/share')
  })

  it('build the revoke path from a meta id (token-hash prefix)', () => {
    expect(shareRevokePath('car-1', 'a1b2c3')).toBe('/api/cars/car-1/share/a1b2c3')
  })

  it('build the public snapshot path', () => {
    expect(shareSnapshotPath('tok_123')).toBe('/api/share/tok_123')
  })

  it('build the token-scoped image path', () => {
    expect(shareImgPath('tok_123', 'photo-1')).toBe('/api/share/tok_123/img/photo-1')
  })

  it('percent-encode path segments so they survive routing', () => {
    // A token/id/photoId with reserved characters must not break out of its
    // segment (defensive: real tokens are URL-safe base64, real ids are UUIDs).
    expect(shareSnapshotPath('a/b?c#d')).toBe('/api/share/a%2Fb%3Fc%23d')
    expect(shareRevokePath('car/1', 'x/y')).toBe('/api/cars/car%2F1/share/x%2Fy')
    expect(shareImgPath('a/b', 'p?q')).toBe('/api/share/a%2Fb/img/p%3Fq')
    // round-trip: the encoded segment decodes back to the original.
    expect(decodeURIComponent('a%2Fb%3Fc%23d')).toBe('a/b?c#d')
  })
})

// ── Public snapshot response validator (M4 polish) ──────────
// A fully-populated curator INPUT: every child table has a row and the optional
// numeric/string fields are present, so building it exercises every branch of
// the validator (mileageMiles, nextDueMileage*, coverPhotoId, photo dims, …).
function sampleSnapshotInput(): SnapshotCarInput {
  return {
    id: 'car-1',
    year: '1991',
    make: 'Nissan',
    model: '180SX',
    trim: 'Type X',
    color: 'red',
    mileage: '50,000',
    nickname: 'hatch',
    purchaseDate: '2020-01-02',
    saleDate: '',
    status: 'for-sale',
    salePrice: '',
    tradeFor: '',
    coverPhoto: 'photo-1',
    createdAt: '2020-01-01',
    photos: [
      { id: 'photo-1', dataUrl: '', caption: 'front', uploadedAt: '2020-01-03', width: 1600, height: 1200 },
      { id: 'photo-2', dataUrl: '', caption: '', uploadedAt: '2020-01-04' },
    ],
    wishlist: [
      { id: 'w1', name: 'coilovers', link: '', price: null, category: '', notes: '', status: 'wanted', addedAt: 'x' },
    ],
    mods: [
      {
        id: 'm1',
        name: 'intake',
        category: 'engine',
        description: 'pod filter',
        cost: null,
        installedDate: '2021-03-01',
        shop: '',
        link: 'https://example.test',
        addedAt: '2021-03-01',
      },
    ],
    maintenance: [
      {
        id: 'r1',
        service: 'oil change',
        date: '2021-06-01',
        mileage: '60000',
        cost: null,
        shop: '',
        notes: '',
        nextDueDate: '2022-06-01',
        nextDueMileage: '70000',
        createdAt: '2021-06-01',
      },
    ],
    todos: [{ id: 't1', text: 'wax', priority: 'low', done: false, createdAt: 'x' }],
    issues: [
      { id: 'i1', title: 'rattle', description: '', severity: 'minor', status: 'open', createdAt: 'x', resolvedAt: null },
    ],
  }
}

const snapshotSettings: GarageValues = {
  themeId: 'garage',
  customAccent: '#abcdef',
  currency: 'USD',
  distanceUnit: 'mi',
}

describe('shareSnapshotResponseSchema', () => {
  // Validate against the REAL curator output — if buildPublicSnapshot ever emits
  // a field the validator rejects (or vice versa) this test catches the drift.
  const car = buildPublicSnapshot(sampleSnapshotInput(), snapshotSettings)
  const validBody = { scope: 'curated', car, expiresAt: null } satisfies ShareSnapshotResponse

  it('accepts exactly what buildPublicSnapshot produces (no expiry)', () => {
    const parsed = shareSnapshotResponseSchema.parse(validBody)
    // assignment doubles as a compile-time check that z.infer matches the contract
    const typed: ShareSnapshotResponse = parsed
    expect(typed.scope).toBe('curated')
    expect(typed.car.make).toBe('Nissan')
    expect(typed.car.mileageMiles).toBe(50000)
    expect(typed.car.coverPhotoId).toBe('photo-1')
    expect(typed.car.maintenance[0].nextDueMileageMiles).toBe(70000)
    expect(typed.car.settings.distanceUnit).toBe('mi')
    expect(typed.expiresAt).toBeNull()
  })

  it('accepts a numeric epoch-seconds expiry', () => {
    expect(
      shareSnapshotResponseSchema.parse({ scope: 'curated', car, expiresAt: 1_900_000_000 })
        .expiresAt,
    ).toBe(1_900_000_000)
  })

  it('rejects a leaked secret field anywhere in the tree (strict, deny-by-default)', () => {
    // The curator's whole job is to NOT emit money/shop/notes — if a future
    // change starts leaking one, the strict schema must reject the body rather
    // than let the viewer render it.
    expect(
      shareSnapshotResponseSchema.safeParse({
        scope: 'curated',
        car: { ...car, salePrice: '9000' },
        expiresAt: null,
      }).success,
    ).toBe(false)
    expect(
      publicCarSnapshotSchema.safeParse({
        ...car,
        mods: [{ ...car.mods[0], cost: 9000 }],
      }).success,
    ).toBe(false)
    expect(
      publicCarSnapshotSchema.safeParse({
        ...car,
        settings: { ...car.settings, currency: 'USD' },
      }).success,
    ).toBe(false)
  })

  it('rejects wrong types and unknown statuses', () => {
    expect(
      shareSnapshotResponseSchema.safeParse({ scope: 'curated', car, expiresAt: '1900000000' })
        .success,
    ).toBe(false)
    expect(shareSnapshotResponseSchema.safeParse({ scope: 'curated', car }).success).toBe(false) // missing expiresAt
    expect(shareSnapshotResponseSchema.safeParse({ car, expiresAt: null }).success).toBe(false) // missing scope discriminant
    expect(publicCarSnapshotSchema.safeParse({ ...car, status: 'crashed' }).success).toBe(false)
    expect(publicCarSnapshotSchema.safeParse({ ...car, distanceUnit: 'leagues' }).success).toBe(
      false,
    )
  })
})

describe('shareSnapshotResponseSchema — full scope', () => {
  // Validate against the REAL full curator output — drift between
  // buildFullSnapshot and fullCarSnapshotSchema fails here.
  const fullCar = buildFullSnapshot(sampleSnapshotInput(), snapshotSettings)
  const validFull = { scope: 'full', car: fullCar, expiresAt: null } satisfies ShareSnapshotResponse

  it('accepts exactly what buildFullSnapshot produces, exposing the owner-only fields', () => {
    const parsed = shareSnapshotResponseSchema.parse(validFull)
    const typed: ShareSnapshotResponse = parsed
    expect(typed.scope).toBe('full')
    if (typed.scope !== 'full') throw new Error('expected full scope') // narrows the union
    // Curated fields survive…
    expect(typed.car.make).toBe('Nissan')
    // …plus the owner-only fields the full curator adds.
    expect(typed.car.settings.currency).toBe('USD')
    expect(typed.car.wishlist.length).toBe(1)
    expect(typed.car.todos.length).toBe(1)
    expect(typed.car.issues.length).toBe(1)
  })

  it('a full car body is REJECTED under a curated discriminant (shape must match scope)', () => {
    // The exact escalation the discriminated union prevents: a full car wearing
    // a 'curated' label fails (the curated schema is strict / has no wishlist).
    expect(
      shareSnapshotResponseSchema.safeParse({ scope: 'curated', car: fullCar, expiresAt: null })
        .success,
    ).toBe(false)
    // And the standalone full schema rejects a leaked field beyond its allowlist.
    expect(
      fullCarSnapshotSchema.safeParse({ ...fullCar, secretFutureField: 'x' }).success,
    ).toBe(false)
  })

  it('emits salePriceCurrency next to salePrice in full (review fix #5)', () => {
    const fullPriced = buildFullSnapshot(
      { ...sampleSnapshotInput(), salePrice: '8500', salePriceCurrency: 'JPY' },
      snapshotSettings,
    )
    const parsed = shareSnapshotResponseSchema.parse({
      scope: 'full',
      car: fullPriced,
      expiresAt: null,
    })
    if (parsed.scope !== 'full') throw new Error('expected full')
    expect(parsed.car.salePrice).toBe('8500')
    expect(parsed.car.salePriceCurrency).toBe('JPY')
  })
})

describe('shareSnapshotResponseSchema — listing scope (DEC-14/DEC-13)', () => {
  const listingCar = buildListingSnapshot(
    {
      ...sampleSnapshotInput(),
      salePrice: '8500',
      salePriceCurrency: 'CAD',
      tradeFor: 'RX-7',
      vin: '1HGCM82633A004352',
    },
    snapshotSettings,
  )
  const validListing = { scope: 'listing', car: listingCar, expiresAt: null } satisfies ShareSnapshotResponse

  it('accepts exactly what buildListingSnapshot produces (the four For-Sale fields incl vin)', () => {
    const parsed = shareSnapshotResponseSchema.parse(validListing)
    if (parsed.scope !== 'listing') throw new Error('expected listing scope') // narrows
    expect(parsed.car.salePrice).toBe('8500')
    expect(parsed.car.salePriceCurrency).toBe('CAD')
    expect(parsed.car.tradeFor).toBe('RX-7')
    expect(parsed.car.vin).toBe('1HGCM82633A004352')
    expect(parsed.car.make).toBe('Nissan') // curated base survives
  })

  it('REJECTS a listing car under a curated/full discriminant (vin/salePrice cannot wear another label)', () => {
    expect(
      shareSnapshotResponseSchema.safeParse({ scope: 'curated', car: listingCar, expiresAt: null })
        .success,
    ).toBe(false)
    expect(
      shareSnapshotResponseSchema.safeParse({ scope: 'full', car: listingCar, expiresAt: null })
        .success,
    ).toBe(false)
  })

  it('the listing schema REJECTS a leaked full-only field (deny-by-default, strict)', () => {
    expect(listingCarSnapshotSchema.safeParse({ ...listingCar, wishlist: [] }).success).toBe(false)
    expect(
      listingCarSnapshotSchema.safeParse({ ...listingCar, secretFutureField: 'x' }).success,
    ).toBe(false)
  })

  it('vin is accepted ONLY by the listing schema — curated and full reject it', () => {
    const curated = buildPublicSnapshot(sampleSnapshotInput(), snapshotSettings)
    const full = buildFullSnapshot(sampleSnapshotInput(), snapshotSettings)
    expect(listingCarSnapshotSchema.safeParse({ ...curated, vin: 'X' }).success).toBe(true)
    expect(publicCarSnapshotSchema.safeParse({ ...curated, vin: 'X' }).success).toBe(false)
    expect(fullCarSnapshotSchema.safeParse({ ...full, vin: 'X' }).success).toBe(false)
  })

  it('ownerName (DEC-10) is accepted on all three snapshot schemas', () => {
    const curated = buildPublicSnapshot(sampleSnapshotInput(), snapshotSettings)
    const full = buildFullSnapshot(sampleSnapshotInput(), snapshotSettings)
    expect(publicCarSnapshotSchema.safeParse({ ...curated, ownerName: 'Alex' }).success).toBe(true)
    expect(listingCarSnapshotSchema.safeParse({ ...listingCar, ownerName: 'Alex' }).success).toBe(true)
    expect(fullCarSnapshotSchema.safeParse({ ...full, ownerName: 'Alex' }).success).toBe(true)
  })
})

describe('shareCardPath + shareCardResponseSchema (DEC-11 ?view=card)', () => {
  it('builds the curated-card URL with the view query param', () => {
    expect(shareCardPath('tok-1')).toBe(`${SHARE_ROUTE_PREFIX}/tok-1?${SHARE_VIEW_PARAM}=${SHARE_CARD_VIEW}`)
    // The card URL is a plain GET — it must NOT touch the /view counter path.
    expect(shareCardPath('tok-1')).not.toContain('/view')
  })

  it('accepts a valid card body and infers to the contract type', () => {
    const curated = buildPublicSnapshot(sampleSnapshotInput(), snapshotSettings)
    const card = buildShareCard(curated, 'listing')
    const body = { card, expiresAt: null } satisfies ShareCardResponse
    const parsed = shareCardResponseSchema.safeParse(body)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      const typed: ShareCardResponse = parsed.data
      expect(typed.card.scope).toBe('listing')
      expect(typed.card.modsCount).toBe(curated.mods.length)
    }
  })

  it('is STRICT: a leaked money/VIN key fails validation (deny-by-default)', () => {
    const curated = buildPublicSnapshot(sampleSnapshotInput(), snapshotSettings)
    const card = buildShareCard(curated, 'curated')
    expect(shareCardResponseSchema.safeParse({ card: { ...card, vin: 'X' }, expiresAt: null }).success).toBe(false)
    expect(
      shareCardResponseSchema.safeParse({ card: { ...card, salePrice: '9000' }, expiresAt: null }).success,
    ).toBe(false)
  })

  it('a card built from a LISTING/FULL link is curated-only (no money/VIN reaches the wire)', () => {
    const listingCurated = toCuratedSnapshot(
      buildListingSnapshot(
        { ...sampleSnapshotInput(), salePrice: '8500', salePriceCurrency: 'JPY', vin: 'JT000' },
        snapshotSettings,
      ),
    )
    const card = buildShareCard(listingCurated, 'listing')
    const serialized = JSON.stringify(card)
    expect(serialized).not.toContain('8500')
    expect(serialized).not.toContain('JT000')
  })
})

describe('SHARE_LINK_ID_MIN_LEN', () => {
  it('pins a collision-safe floor for the token-hash prefix id', () => {
    // 24 hex chars = 96 bits of sha256 — the apps/api slice length. Anything
    // shorter risks birthday collisions across an owner's links.
    expect(SHARE_LINK_ID_MIN_LEN).toBe(24)
    expect(SHARE_LINK_ID_MIN_LEN).toBeGreaterThanOrEqual(16)
    // A real 64-char sha256 hex sliced to the floor yields exactly that length.
    const hash = 'a'.repeat(64)
    expect(hash.slice(0, SHARE_LINK_ID_MIN_LEN)).toHaveLength(SHARE_LINK_ID_MIN_LEN)
  })
})
