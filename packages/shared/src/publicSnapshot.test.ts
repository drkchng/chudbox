import { describe, expect, it } from 'vitest'
import { buildPublicSnapshot } from './publicSnapshot'
import type { SnapshotCarInput } from './publicSnapshot'
import type { GarageValues } from './schema'

// ── Sentinels ───────────────────────────────────────────────
// Every EXCLUDED field carries a unique recognizable value, so a single
// JSON.stringify scan proves no secret content reached the snapshot — whether
// it leaked under its own key or got copied into an allowed one.
const SECRET_STRINGS = [
  'SECRET_salePrice',
  'SECRET_tradeFor',
  'SECRET_salePriceCurrency',
  'SECRET_wishlist_name',
  'SECRET_wishlist_link',
  'SECRET_wishlist_notes',
  'SECRET_wishlist_category',
  'SECRET_mod_shop',
  'SECRET_mod_costCurrency',
  'SECRET_mod_notes',
  'SECRET_maint_shop',
  'SECRET_maint_notes',
  'SECRET_maint_costCurrency',
  'SECRET_todo_text',
  'SECRET_issue_title',
  'SECRET_issue_description',
  'SECRET_photo_uploadedAt',
  'SECRET_photo_extraField',
  'SECRET_future_car_field',
  'SECRET_currency_code',
  'data:image/png;base64,SECRET_PHOTO_BYTES',
  'u/owner-uid/car-1/photo-1.webp',
]
// Money amounts are numbers — assert their digit strings never appear either.
const SECRET_NUMBERS = [91919191, 92929292, 93939393]

// Exactly the keys the allowlist may emit (union over every snapshot subtype).
// The recursive key scan asserts the snapshot contains NOTHING outside this set
// — the deny-by-default guarantee: a field added to the domain model later
// shows up here as a failure, not a silent leak.
const ALLOWED_KEYS = new Set<string>([
  // car
  'year',
  'make',
  'model',
  'trim',
  'color',
  'nickname',
  'mileageRaw',
  'mileageMiles',
  'status',
  'purchaseDate',
  'saleDate',
  'createdAt',
  'coverPhotoId',
  'photos',
  'mods',
  'maintenance',
  'settings',
  // photo
  'photoId',
  'caption',
  'width',
  'height',
  // mod
  'name',
  'category',
  'description',
  'installedDate',
  'link',
  'addedAt',
  // maintenance
  'service',
  'date',
  'nextDueDate',
  'nextDueMileageRaw',
  'nextDueMileageMiles',
  // settings
  'themeId',
  'customAccent',
  'distanceUnit',
])

function collectKeys(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, into)
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      into.add(key)
      collectKeys(child, into)
    }
  }
}

/**
 * A car populated in EVERY table (including the excluded ones) plus extra
 * unknown fields attached via cast — the "fully-populated car" the M4 checklist
 * requires. KEEP_* values must survive; SECRET_* values must not.
 */
function fullyPopulatedCar(): SnapshotCarInput {
  return {
    id: 'car-1',
    year: '1991',
    make: 'KEEP_make_Nissan',
    model: 'KEEP_model_180SX',
    trim: 'KEEP_trim_TypeX',
    color: 'KEEP_color_red',
    mileage: '50000',
    nickname: 'KEEP_nickname',
    purchaseDate: '2020-01-02',
    saleDate: '2024-05-06',
    status: 'for-sale',
    salePrice: 'SECRET_salePrice',
    tradeFor: 'SECRET_tradeFor',
    coverPhoto: 'photo-1',
    createdAt: 'KEEP_car_createdAt',
    photos: [
      {
        id: 'photo-1',
        dataUrl: 'data:image/png;base64,SECRET_PHOTO_BYTES',
        caption: 'KEEP_photo_caption',
        uploadedAt: 'SECRET_photo_uploadedAt',
        width: 1600,
        height: 1200,
        // Fields that are NOT on the curated PublicPhoto — must not pass through.
        r2Key: 'u/owner-uid/car-1/photo-1.webp',
        extraField: 'SECRET_photo_extraField',
      },
      {
        id: 'photo-2',
        dataUrl: 'data:image/png;base64,SECRET_PHOTO_BYTES',
        caption: 'KEEP_photo2_caption',
        uploadedAt: 'SECRET_photo_uploadedAt',
      },
    ],
    wishlist: [
      {
        id: 'wish-1',
        name: 'SECRET_wishlist_name',
        link: 'SECRET_wishlist_link',
        price: 91919191,
        category: 'SECRET_wishlist_category',
        notes: 'SECRET_wishlist_notes',
        status: 'wanted',
        addedAt: 'SECRET_wishlist_addedAt',
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
        // not on PublicMod:
        costCurrency: 'SECRET_mod_costCurrency',
        notes: 'SECRET_mod_notes',
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
        costCurrency: 'SECRET_maint_costCurrency',
      },
    ],
    todos: [
      { id: 'todo-1', text: 'SECRET_todo_text', priority: 'high', done: false, createdAt: 'x' },
    ],
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
    // Fields not yet in the model / never meant to be shared:
    salePriceCurrency: 'SECRET_salePriceCurrency',
    futureSecretField: 'SECRET_future_car_field',
  } as unknown as SnapshotCarInput
}

const settings: GarageValues = {
  themeId: 'KEEP_themeId',
  customAccent: '#abcdef',
  currency: 'SECRET_currency_code',
  distanceUnit: 'mi',
}

describe('buildPublicSnapshot — security allowlist (leak test)', () => {
  const snapshot = buildPublicSnapshot(fullyPopulatedCar(), settings)
  const serialized = JSON.stringify(snapshot)

  it('emits ONLY allowlisted keys anywhere in the tree (deny-by-default)', () => {
    const keys = new Set<string>()
    collectKeys(snapshot, keys)
    const leaked = [...keys].filter((key) => !ALLOWED_KEYS.has(key))
    expect(leaked, `unexpected keys leaked into the snapshot: ${leaked.join(', ')}`).toEqual([])
  })

  it('contains no excluded string value (money/shop/notes/wishlist/issues/todos/dataUrl/r2Key/…)', () => {
    for (const secret of SECRET_STRINGS) {
      expect(serialized, `leaked secret string: ${secret}`).not.toContain(secret)
    }
  })

  it('contains no excluded money amount', () => {
    for (const amount of SECRET_NUMBERS) {
      expect(serialized, `leaked money amount: ${amount}`).not.toContain(String(amount))
    }
  })

  it('drops the excluded whole tables and car fields entirely', () => {
    const loose = snapshot as unknown as Record<string, unknown>
    expect(loose.wishlist).toBeUndefined()
    expect(loose.issues).toBeUndefined()
    expect(loose.todos).toBeUndefined()
    expect(loose.salePrice).toBeUndefined()
    expect(loose.salePriceCurrency).toBeUndefined()
    expect(loose.tradeFor).toBeUndefined()
    expect(loose.id).toBeUndefined()
  })

  it('curates photos to photoId/caption/dimensions only', () => {
    const photo = snapshot.photos[0] as unknown as Record<string, unknown>
    expect(snapshot.photos[0].photoId).toBe('photo-1')
    expect(snapshot.photos[0].caption).toBe('KEEP_photo_caption')
    expect(snapshot.photos[0].width).toBe(1600)
    expect(snapshot.photos[0].height).toBe(1200)
    expect(photo.dataUrl).toBeUndefined()
    expect(photo.r2Key).toBeUndefined()
    expect(photo.uploadedAt).toBeUndefined()
    expect(photo.extraField).toBeUndefined()
    expect(photo.id).toBeUndefined()
    // Second photo has no dims → width/height omitted, not null.
    expect('width' in (snapshot.photos[1] as object)).toBe(false)
    expect('height' in (snapshot.photos[1] as object)).toBe(false)
  })

  it('curates mods (no cost/costCurrency/shop/notes/id)', () => {
    const mod = snapshot.mods[0] as unknown as Record<string, unknown>
    expect(snapshot.mods[0].name).toBe('KEEP_mod_name')
    expect(snapshot.mods[0].description).toBe('KEEP_mod_description')
    expect(snapshot.mods[0].link).toBe('KEEP_mod_link')
    expect(mod.cost).toBeUndefined()
    expect(mod.costCurrency).toBeUndefined()
    expect(mod.shop).toBeUndefined()
    expect(mod.notes).toBeUndefined()
    expect(mod.id).toBeUndefined()
  })

  it('curates maintenance (no cost/costCurrency/shop/notes/id) but keeps mileage', () => {
    const rec = snapshot.maintenance[0] as unknown as Record<string, unknown>
    expect(snapshot.maintenance[0].service).toBe('KEEP_maint_service')
    expect(snapshot.maintenance[0].mileageRaw).toBe('80000')
    expect(snapshot.maintenance[0].mileageMiles).toBe(80000)
    expect(snapshot.maintenance[0].nextDueMileageRaw).toBe('90000')
    expect(snapshot.maintenance[0].nextDueMileageMiles).toBe(90000)
    expect(rec.cost).toBeUndefined()
    expect(rec.costCurrency).toBeUndefined()
    expect(rec.shop).toBeUndefined()
    expect(rec.notes).toBeUndefined()
    expect(rec.id).toBeUndefined()
  })

  it('exposes display settings without currency', () => {
    expect(snapshot.settings.themeId).toBe('KEEP_themeId')
    expect(snapshot.settings.customAccent).toBe('#abcdef')
    expect(snapshot.settings.distanceUnit).toBe('mi')
    expect((snapshot.settings as unknown as Record<string, unknown>).currency).toBeUndefined()
  })

  it('keeps the allowlisted car fields + derived cover/mileage', () => {
    expect(snapshot.year).toBe('1991')
    expect(snapshot.make).toBe('KEEP_make_Nissan')
    expect(snapshot.nickname).toBe('KEEP_nickname')
    expect(snapshot.status).toBe('for-sale')
    expect(snapshot.mileageRaw).toBe('50000')
    expect(snapshot.mileageMiles).toBe(50000)
    expect(snapshot.purchaseDate).toBe('2020-01-02')
    expect(snapshot.saleDate).toBe('2024-05-06')
    expect(snapshot.coverPhotoId).toBe('photo-1')
    expect(snapshot.createdAt).toBe('KEEP_car_createdAt')
  })
})

describe('buildPublicSnapshot — cover photo resolve-with-fallback', () => {
  function carWith(overrides: Partial<SnapshotCarInput>): SnapshotCarInput {
    return { ...fullyPopulatedCar(), ...overrides }
  }

  it('falls back to the first photo when the cover pointer dangles', () => {
    const snap = buildPublicSnapshot(carWith({ coverPhoto: 'no-such-photo' }), settings)
    expect(snap.coverPhotoId).toBe('photo-1')
  })

  it('falls back to the first photo when the cover pointer is null', () => {
    const snap = buildPublicSnapshot(carWith({ coverPhoto: null }), settings)
    expect(snap.coverPhotoId).toBe('photo-1')
  })

  it('omits the cover entirely when there are no photos', () => {
    const snap = buildPublicSnapshot(carWith({ photos: [], coverPhoto: 'photo-1' }), settings)
    expect('coverPhotoId' in snap).toBe(false)
  })
})

describe('buildPublicSnapshot — distance + optional omission', () => {
  function carWith(overrides: Partial<SnapshotCarInput>): SnapshotCarInput {
    return { ...fullyPopulatedCar(), ...overrides }
  }

  it('canonicalizes km mileage with the exact factor', () => {
    const snap = buildPublicSnapshot(
      carWith({ mileage: '1609.344' }),
      { ...settings, distanceUnit: 'km' },
    )
    expect(snap.mileageMiles).toBeCloseTo(1000, 6)
  })

  it('omits mileageMiles for free-text mileage that does not parse', () => {
    const snap = buildPublicSnapshot(carWith({ mileage: '~120k' }), settings)
    expect(snap.mileageRaw).toBe('~120k')
    expect('mileageMiles' in snap).toBe(false)
  })

  it('omits empty optional date fields', () => {
    const snap = buildPublicSnapshot(carWith({ purchaseDate: '', saleDate: '' }), settings)
    expect('purchaseDate' in snap).toBe(false)
    expect('saleDate' in snap).toBe(false)
  })

  it('omits the custom accent when blank', () => {
    const snap = buildPublicSnapshot(fullyPopulatedCar(), { ...settings, customAccent: '' })
    expect('customAccent' in snap.settings).toBe(false)
  })

  it('omits maintenance mileageRaw when the source mileage is null', () => {
    const car = fullyPopulatedCar()
    ;(car.maintenance[0] as unknown as Record<string, unknown>).mileage = null
    const snap = buildPublicSnapshot(car, settings)
    expect('mileageRaw' in snap.maintenance[0]).toBe(false)
    expect('mileageMiles' in snap.maintenance[0]).toBe(false)
  })
})
