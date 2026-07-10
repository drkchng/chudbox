import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  KM_PER_MILE,
  flattenCar,
  flattenSavedBuild,
  joinCar,
  joinSavedBuild,
  milesToUnit,
  parseMileageMiles,
} from './flatten'
import type { FlattenSettings, FlattenedCar } from './flatten'
import { GARAGE_TABLES_SCHEMA } from './schema'
import type {
  Car,
  CarStoredStatus,
  Issue,
  IssueSeverity,
  IssueStatus,
  MaintenanceRecord,
  MileageCheckIn,
  MileageSource,
  Mod,
  Photo,
  PhotoSource,
  SavedBuild,
  Todo,
  TodoPriority,
  WishlistItem,
  WishlistStatus,
} from './types'
import type { DistanceUnitCode } from './units'

// ── Generators ──────────────────────────────────────────────
// Strings deliberately mix plain ASCII with full-unicode graphemes; numbers
// explicitly cover 0; booleans cover false; nullables cover null — the strict
// null rule says all of these are real values that must survive a round trip.

const idArb = fc.uuid()
const strArb = fc.oneof(fc.string(), fc.string({ unit: 'grapheme' }))

const amountArb = fc.oneof(
  fc.constant(0), // 0 is a real amount — must not be dropped as falsy
  fc.integer({ min: -1_000_000, max: 1_000_000 }),
  fc
    .double({ noNaN: true, noDefaultInfinity: true })
    .map((v) => (Object.is(v, -0) ? 0 : v)),
)
const nullableAmountArb = fc.option(amountArb, { nil: null })

// Free-text mileage: numeric, locale-separated numeric, and non-parsing junk.
const mileageStringArb = fc.oneof(
  fc.constant(''),
  fc.constant('12,000'),
  fc.constant('unknown'),
  fc.constant('~120k'),
  fc.constant('TMU'),
  fc.nat({ max: 500_000 }).map(String),
  strArb,
)

const salePriceArb = fc.oneof(
  fc.constant(''), // blank — must NOT gain a currency tag
  fc.nat({ max: 1_000_000 }).map(String),
  strArb,
)

const photoArb: fc.Arbitrary<Photo> = fc.record({
  id: idArb,
  dataUrl: strArb.map((s) => `data:image/webp;base64,${s}`),
  caption: strArb,
  uploadedAt: strArb,
  // DEC-6: a General photo is ABSENT source (flatten omits 'car'); item-attached
  // photos carry a non-car source + a sourceId. 'car' is deliberately NOT in the
  // generator (it round-trips to absent), exercised separately below.
  source: fc.option(
    fc.constantFrom<PhotoSource>('mod', 'maintenance', 'issue', 'todo'),
    { nil: undefined },
  ),
  sourceId: fc.option(idArb, { nil: undefined }),
})

// DEC-16: each check-in freezes its OWN entry unit (NOT the device unit).
const mileageCheckInArb: fc.Arbitrary<MileageCheckIn> = fc.record({
  id: idArb,
  value: mileageStringArb,
  unit: fc.constantFrom<DistanceUnitCode>('mi', 'km'),
  date: strArb,
  source: fc.constantFrom<MileageSource>('manual', 'initial', 'import', 'legacy-edit'),
  createdAt: strArb,
})

const wishlistArb: fc.Arbitrary<WishlistItem> = fc.record({
  id: idArb,
  name: strArb,
  link: strArb,
  price: nullableAmountArb,
  category: strArb,
  notes: strArb,
  status: fc.constantFrom<WishlistStatus>('wanted', 'ordered', 'installed'),
  addedAt: strArb,
})

const modArb: fc.Arbitrary<Mod> = fc.record({
  id: idArb,
  name: strArb,
  category: strArb,
  description: strArb,
  cost: nullableAmountArb,
  installedDate: strArb,
  shop: strArb,
  link: strArb,
  addedAt: strArb,
})

const maintenanceArb: fc.Arbitrary<MaintenanceRecord> = fc.record({
  id: idArb,
  service: strArb,
  date: strArb,
  // null and '' are distinct round-trippable states
  mileage: fc.option(mileageStringArb, { nil: null }),
  cost: nullableAmountArb,
  shop: strArb,
  notes: strArb,
  nextDueDate: strArb,
  nextDueMileage: mileageStringArb,
  createdAt: strArb,
})

const todoArb: fc.Arbitrary<Todo> = fc.record({
  id: idArb,
  text: strArb,
  priority: fc.constantFrom<TodoPriority>('low', 'medium', 'high'),
  done: fc.boolean(), // false is a real value
  createdAt: strArb,
})

const issueArb: fc.Arbitrary<Issue> = fc.record({
  id: idArb,
  title: strArb,
  description: strArb,
  severity: fc.constantFrom<IssueSeverity>('minor', 'moderate', 'high', 'critical'),
  status: fc.constantFrom<IssueStatus>('open', 'in-progress', 'resolved'),
  createdAt: strArb,
  resolvedAt: fc.option(strArb, { nil: null }),
})

const uniqueById = <T extends { id: string }>(arb: fc.Arbitrary<T>) =>
  fc.uniqueArray(arb, { selector: (x: T) => x.id, maxLength: 5 })

// coverPhoto: null, a real photoId, or a DANGLING id (deleted on another device)
const coverPhotoArb = (photos: Photo[]): fc.Arbitrary<string | null> =>
  fc.oneof(
    fc.constant(null),
    fc.uuid(), // dangling pointer — must round-trip verbatim
    ...(photos.length > 0
      ? [fc.constantFrom(...photos.map((p) => p.id))]
      : []),
  )

// bannerPhoto round-trips like coverPhoto, but joinCar is transparent for it
// (absent ⇔ no banner), so the generator never emits an explicit null — it emits
// ABSENT or a (possibly dangling) photoId. The null/absent equivalence is
// asserted at the cell level below.
const bannerPhotoArb = (photos: Photo[]): fc.Arbitrary<string | undefined> =>
  fc.oneof(
    fc.constant(undefined),
    fc.uuid(),
    ...(photos.length > 0 ? [fc.constantFrom(...photos.map((p) => p.id))] : []),
  )

const carArb: fc.Arbitrary<Car> = uniqueById(photoArb).chain((photos) =>
  fc.record({
    id: idArb,
    year: strArb,
    make: strArb,
    model: strArb,
    trim: strArb,
    color: strArb,
    mileage: mileageStringArb,
    nickname: strArb,
    purchaseDate: strArb,
    saleDate: strArb,
    status: fc.constantFrom<CarStoredStatus>(
      'current',
      'for-sale',
      'for-trade',
      'totaled',
      'sold',
    ),
    salePrice: salePriceArb,
    tradeFor: strArb,
    // DEC-13 VIN: ABSENT or a non-empty value ('' round-trips to absent, pinned
    // separately). DEC-6 bannerPhoto + DEC-16 mileageLog (absent or non-empty).
    vin: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
    // DEC-19 plate: ABSENT or non-empty ('' ⇒ absent, pinned separately).
    // showPlate: ABSENT or true (false ⇔ absent, like a null bannerPhoto — the
    // hidden default never materializes a cell), pinned separately.
    plate: fc.option(fc.string({ minLength: 1 }), { nil: undefined }),
    showPlate: fc.option(fc.constant(true), { nil: undefined }),
    coverPhoto: coverPhotoArb(photos),
    bannerPhoto: bannerPhotoArb(photos),
    createdAt: strArb,
    photos: fc.constant(photos),
    wishlist: uniqueById(wishlistArb),
    mods: uniqueById(modArb),
    maintenance: uniqueById(maintenanceArb),
    todos: uniqueById(todoArb),
    issues: uniqueById(issueArb),
    mileageLog: fc.option(
      fc.uniqueArray(mileageCheckInArb, { selector: (x) => x.id, minLength: 1, maxLength: 4 }),
      { nil: undefined },
    ),
  }),
)

const settingsArb: fc.Arbitrary<FlattenSettings> = fc.record({
  currency: fc.constantFrom('USD', 'EUR', 'JPY', 'KWD', 'CAD'),
  distanceUnit: fc.constantFrom<'mi' | 'km'>('mi', 'km'),
})

// ── Row-invariant helpers ───────────────────────────────────

const tableEntries = (flat: FlattenedCar) =>
  [
    ['cars', { [flat.carId]: flat.car }],
    ['photos', flat.photos],
    ['wishlist', flat.wishlist],
    ['mods', flat.mods],
    ['maintenance', flat.maintenance],
    ['todos', flat.todos],
    ['issues', flat.issues],
    ['mileage', flat.mileage],
  ] as const

function assertRowInvariants(flat: FlattenedCar, settings: FlattenSettings, car: Car) {
  for (const [tableId, rows] of tableEntries(flat)) {
    const cellSchemas: Record<string, { type: string }> = GARAGE_TABLES_SCHEMA[tableId]
    for (const row of Object.values(rows)) {
      for (const [cellId, value] of Object.entries(row)) {
        // No dataUrl (or any other off-schema) cell, anywhere.
        expect(cellId, `${tableId}.${cellId} must be in the schema`).not.toBe('dataUrl')
        expect(cellSchemas[cellId], `${tableId}.${cellId} must be in the schema`).toBeDefined()
        // Cells never hold null/undefined (strict null rule: omit instead)…
        expect(value).not.toBeNull()
        expect(value).not.toBeUndefined()
        // …and match their declared scalar type.
        expect(typeof value).toBe(cellSchemas[cellId]!.type)
      }
    }
  }

  // Every non-null amount carries its *Currency tag — and only then.
  for (const row of Object.values(flat.wishlist)) {
    expect('priceCurrency' in row).toBe('price' in row)
    if (row.priceCurrency !== undefined) expect(row.priceCurrency).toBe(settings.currency)
  }
  for (const row of [...Object.values(flat.mods), ...Object.values(flat.maintenance)]) {
    expect('costCurrency' in row).toBe('cost' in row)
    if (row.costCurrency !== undefined) expect(row.costCurrency).toBe(settings.currency)
  }
  expect('salePriceCurrency' in flat.car).toBe(flat.car.salePrice !== '')

  // mileageMiles present iff the raw parses numerically.
  expect('mileageMiles' in flat.car).toBe(
    parseMileageMiles(flat.car.mileageRaw, settings.distanceUnit) !== null,
  )
  for (const row of Object.values(flat.maintenance)) {
    expect('mileageMiles' in row).toBe(
      row.mileageRaw !== undefined &&
        parseMileageMiles(row.mileageRaw, settings.distanceUnit) !== null,
    )
    expect('nextDueMileageMiles' in row).toBe(
      parseMileageMiles(row.nextDueMileageRaw, settings.distanceUnit) !== null,
    )
  }

  // maintenance.mileageRaw mirrors the source: present iff source non-null.
  for (const rec of car.maintenance) {
    expect('mileageRaw' in flat.maintenance[rec.id]!).toBe(rec.mileage !== null)
  }

  // DEC-16: each check-in's valueMiles is present IFF its raw parses under ITS
  // OWN frozen unit (NOT the device unit).
  for (const checkIn of car.mileageLog ?? []) {
    const row = flat.mileage[checkIn.id]!
    expect(row.valueRaw).toBe(checkIn.value)
    expect(row.unit).toBe(checkIn.unit)
    expect('valueMiles' in row).toBe(parseMileageMiles(checkIn.value, checkIn.unit) !== null)
  }

  // DEC-6: a General photo (absent/'car' source) carries no `source` cell; an
  // item-attached photo carries its non-car source verbatim.
  for (const photo of car.photos) {
    const row = flat.photos[photo.id]!
    expect('source' in row).toBe(photo.source != null && photo.source !== 'car')
    expect('sourceId' in row).toBe(photo.sourceId != null)
  }

  // Photo payloads: every dataUrl is in the side map, keyed by photoId.
  for (const photo of car.photos) {
    expect(flat.photoPayloads[photo.id]).toBe(photo.dataUrl)
  }
}

// ── THE round-trip property ─────────────────────────────────

describe('flattenCar / joinCar round trip', () => {
  it(
    'joinCar(flattenCar(car)) deep-equals the input Car for arbitrary cars',
    () => {
      fc.assert(
        fc.property(carArb, settingsArb, (car, settings) => {
          const flat = flattenCar(car, settings)
          expect(joinCar(flat)).toEqual(car)
          assertRowInvariants(flat, settings, car)
        }),
        { numRuns: 200 },
      )
    },
    15000,
  )

  it('round-trips the explicit falsy-vs-null fixture (0, false, "", null, dangling cover)', () => {
    const car: Car = {
      id: 'car-1',
      year: '1991',
      make: 'Nissan',
      model: '180SX 流れ星',
      trim: '',
      color: 'gunmetal',
      mileage: '12,000',
      nickname: '',
      purchaseDate: '2024-01-15',
      saleDate: '',
      status: 'current',
      salePrice: '', // blank — stays '' and must NOT gain a currency tag
      tradeFor: '',
      coverPhoto: 'deleted-photo-id', // dangling pointer
      createdAt: '2024-01-15T00:00:00.000Z',
      photos: [
        { id: 'p1', dataUrl: 'data:image/webp;base64,AAAA', caption: '', uploadedAt: 'x' },
      ],
      wishlist: [
        {
          id: 'w1',
          name: 'free sticker',
          link: '',
          price: 0, // 0 is a real price
          category: 'exterior',
          notes: '',
          status: 'wanted',
          addedAt: 'x',
        },
        {
          id: 'w2',
          name: 'coilovers',
          link: '',
          price: null, // blank — cell omitted
          category: 'suspension',
          notes: '',
          status: 'ordered',
          addedAt: 'x',
        },
      ],
      mods: [],
      maintenance: [
        {
          id: 'm1',
          service: 'oil',
          date: '',
          mileage: null, // null and '' are distinct states…
          cost: null,
          shop: '',
          notes: '',
          nextDueDate: '',
          nextDueMileage: '',
          createdAt: 'x',
        },
        {
          id: 'm2',
          service: 'plugs',
          date: '',
          mileage: '', // …'' is a real, round-trippable cell
          cost: 0,
          shop: '',
          notes: '',
          nextDueDate: '',
          nextDueMileage: 'unknown',
          createdAt: 'x',
        },
        {
          id: 'm3',
          service: 'belt',
          date: '',
          mileage: '12,000',
          cost: 129.99,
          shop: '',
          notes: '',
          nextDueDate: '',
          nextDueMileage: '24,000',
          createdAt: 'x',
        },
      ],
      todos: [
        { id: 't1', text: 'bleed brakes', priority: 'high', done: false, createdAt: 'x' },
      ],
      issues: [
        {
          id: 'i1',
          title: 'boost leak',
          description: '',
          severity: 'moderate',
          status: 'open',
          createdAt: 'x',
          resolvedAt: null,
        },
      ],
    }
    const settings: FlattenSettings = { currency: 'USD', distanceUnit: 'mi' }
    const flat = flattenCar(car, settings)

    expect(joinCar(flat)).toEqual(car)
    assertRowInvariants(flat, settings, car)

    // Pin the cell-level expectations by hand:
    expect(flat.car.mileageMiles).toBe(12_000)
    expect(flat.car.salePriceCurrency).toBeUndefined()
    expect(flat.car.coverPhoto).toBe('deleted-photo-id')
    expect(flat.wishlist['w1']).toMatchObject({ price: 0, priceCurrency: 'USD' })
    expect('price' in flat.wishlist['w2']!).toBe(false)
    expect('priceCurrency' in flat.wishlist['w2']!).toBe(false)
    expect('mileageRaw' in flat.maintenance['m1']!).toBe(false)
    expect(flat.maintenance['m2']!.mileageRaw).toBe('')
    expect('mileageMiles' in flat.maintenance['m2']!).toBe(false)
    expect(flat.maintenance['m3']).toMatchObject({
      mileageRaw: '12,000',
      mileageMiles: 12_000,
      nextDueMileageRaw: '24,000',
      nextDueMileageMiles: 24_000,
      cost: 129.99,
      costCurrency: 'USD',
    })
    expect(flat.todos['t1']!.done).toBe(false)
    expect('resolvedAt' in flat.issues['i1']!).toBe(false)
    expect(flat.photoPayloads['p1']).toBe('data:image/webp;base64,AAAA')
  })

  it('non-empty salePrice gains the device currency tag', () => {
    const car = minimalCar({ salePrice: '8500' })
    const flat = flattenCar(car, { currency: 'CAD', distanceUnit: 'mi' })
    expect(flat.car.salePrice).toBe('8500')
    expect(flat.car.salePriceCurrency).toBe('CAD')
    expect(joinCar(flat)).toEqual(car)
  })

  it('normalizes absent optional fields (undefined coverPhoto/resolvedAt) to null on join', () => {
    const car = minimalCar({})
    delete (car as Partial<Car>).coverPhoto // property absent entirely
    car.issues = [
      {
        id: 'i1',
        title: 't',
        description: '',
        severity: 'minor',
        status: 'open',
        createdAt: 'x',
        // resolvedAt property intentionally absent
      } as Issue,
    ]
    const joined = joinCar(flattenCar(car, { currency: 'USD', distanceUnit: 'mi' }))
    expect(joined.coverPhoto).toBeNull()
    expect(joined.issues[0]!.resolvedAt).toBeNull()
  })
})

describe('new cells + tables (DEC-6/13/16/11) round trip + omission', () => {
  it('round-trips vin, bannerPhoto, photo source/sourceId, and the mileage timeline', () => {
    const car: Car = {
      ...minimalCar({}),
      id: 'car-x',
      vin: '1HGCM82633A004352',
      plate: 'GR-SUPRA',
      showPlate: true,
      coverPhoto: 'p1',
      bannerPhoto: 'p2',
      photos: [
        { id: 'p1', dataUrl: 'data:,a', caption: 'general', uploadedAt: 'x' }, // General (absent source)
        {
          id: 'p2',
          dataUrl: 'data:,b',
          caption: 'mod shot',
          uploadedAt: 'y',
          source: 'mod',
          sourceId: 'mod-1',
        },
      ],
      mileageLog: [
        { id: 'ck1', value: '12,000', unit: 'km', date: '2024-01-01', source: 'manual', createdAt: 'a' },
        { id: 'ck2', value: 'unknown', unit: 'mi', date: '2024-02-01', source: 'initial', createdAt: 'b' },
      ],
    }
    const flat = flattenCar(car, { currency: 'USD', distanceUnit: 'mi' })
    expect(joinCar(flat)).toEqual(car)

    expect(flat.car.vin).toBe('1HGCM82633A004352')
    // DEC-19: plate + showPlate materialize cells only when present/opted-in.
    expect(flat.car.plate).toBe('GR-SUPRA')
    expect(flat.car.showPlate).toBe(true)
    expect(flat.car.bannerPhoto).toBe('p2')
    // DEC-6: General photo has NO source/sourceId cell; item photo carries both.
    expect('source' in flat.photos['p1']!).toBe(false)
    expect('sourceId' in flat.photos['p1']!).toBe(false)
    expect(flat.photos['p2']).toMatchObject({ source: 'mod', sourceId: 'mod-1' })
    // DEC-16: the km check-in canonicalizes with ITS OWN frozen unit (×1.609344),
    // not the device 'mi'; the non-parsing 'unknown' reading has no valueMiles.
    expect(flat.mileage['ck1']!.valueMiles).toBe(12_000 / KM_PER_MILE)
    expect(flat.mileage['ck1']!.unit).toBe('km')
    expect('valueMiles' in flat.mileage['ck2']!).toBe(false)
  })

  it('omits the default/sentinel cells (vin "", source "car", null bannerPhoto, empty timeline)', () => {
    const car: Car = {
      ...minimalCar({}),
      vin: '', // blank ⇒ no cell (absent ⇔ '')
      plate: '', // blank ⇒ no cell (absent ⇔ '')
      showPlate: false, // hidden default ⇒ no cell (absent ⇔ false)
      bannerPhoto: null, // explicit null ⇒ no cell
      photos: [{ id: 'p1', dataUrl: 'data:,a', caption: '', uploadedAt: 'x', source: 'car' }], // General
      mileageLog: [],
    }
    const flat = flattenCar(car, { currency: 'USD', distanceUnit: 'mi' })
    expect('vin' in flat.car).toBe(false)
    expect('plate' in flat.car).toBe(false)
    expect('showPlate' in flat.car).toBe(false)
    expect('bannerPhoto' in flat.car).toBe(false)
    expect('source' in flat.photos['p1']!).toBe(false) // 'car' is never materialized
    expect(Object.keys(flat.mileage)).toHaveLength(0)

    const joined = joinCar(flat)
    expect('vin' in joined).toBe(false)
    expect('plate' in joined).toBe(false)
    expect('showPlate' in joined).toBe(false)
    expect('bannerPhoto' in joined).toBe(false)
    expect('mileageLog' in joined).toBe(false)
    expect(joined.photos[0]!.source).toBeUndefined()
  })

  it('round-trips a SavedBuild, distinguishing null (never set) from "" (cleared) nickname', () => {
    const build: SavedBuild = {
      id: 'sha-abc',
      token: 'rawtok',
      savedAt: '2026-01-01',
      nickname: '', // cleared — a REAL, distinct state
      sortOrder: 0, // 0 is a real value
      cachedYear: '1999',
      cachedMake: 'Mazda',
      cachedModel: 'Miata',
      cachedNickname: null, // never set
      cachedOwnerName: 'Alex',
      cachedStatus: 'for-sale',
      cachedMileageRaw: '90000',
      cachedModsCount: 0,
      cachedCoverPhotoId: 'cover-1',
      cachedScope: 'listing',
      lastRefreshedAt: '2026-01-02',
      unavailableSince: null,
    }
    const row = flattenSavedBuild(build)
    expect(joinSavedBuild('sha-abc', row)).toEqual(build)
    // null cells are OMITTED; '' / 0 are written explicitly (strict null rule).
    expect('cachedNickname' in row).toBe(false)
    expect('unavailableSince' in row).toBe(false)
    expect(row.nickname).toBe('')
    expect(row.sortOrder).toBe(0)
    expect(row.cachedModsCount).toBe(0)
  })

  it('joins an all-absent SavedBuild row back to all-null cached fields', () => {
    const joined = joinSavedBuild('sha-xyz', { token: 't', savedAt: 's' })
    expect(joined).toEqual({
      id: 'sha-xyz',
      token: 't',
      savedAt: 's',
      nickname: null,
      sortOrder: null,
      cachedYear: null,
      cachedMake: null,
      cachedModel: null,
      cachedNickname: null,
      cachedOwnerName: null,
      cachedStatus: null,
      cachedMileageRaw: null,
      cachedModsCount: null,
      cachedCoverPhotoId: null,
      cachedScope: null,
      lastRefreshedAt: null,
      unavailableSince: null,
    })
  })
})

describe('parseMileageMiles', () => {
  it('strips locale separators before parsing — "12,000" is 12000, never 12', () => {
    expect(parseMileageMiles('12,000', 'mi')).toBe(12_000)
    expect(parseMileageMiles('12 000', 'mi')).toBe(12_000)
    expect(parseMileageMiles("12'000", 'mi')).toBe(12_000)
    expect(parseMileageMiles('1,234,567.8', 'mi')).toBe(1_234_567.8)
  })

  it('applies the exact ×1.609344 factor for km entries', () => {
    expect(parseMileageMiles('12,000', 'km')).toBe(12_000 / KM_PER_MILE)
    expect(parseMileageMiles('160934.4', 'km')).toBeCloseTo(100_000, 9)
    expect(KM_PER_MILE).toBe(1.609344)
  })

  it('returns null for free text, partial numbers, empty and null', () => {
    expect(parseMileageMiles('unknown', 'mi')).toBeNull()
    expect(parseMileageMiles('~120k', 'mi')).toBeNull()
    expect(parseMileageMiles('TMU', 'mi')).toBeNull()
    expect(parseMileageMiles('120k', 'mi')).toBeNull() // parseFloat prefix trap
    expect(parseMileageMiles('120000 miles', 'mi')).toBeNull()
    expect(parseMileageMiles('-5', 'mi')).toBeNull()
    expect(parseMileageMiles('', 'mi')).toBeNull()
    expect(parseMileageMiles(null, 'mi')).toBeNull()
    expect(parseMileageMiles(undefined, 'mi')).toBeNull()
  })

  it('accepts plain and decimal numerics', () => {
    expect(parseMileageMiles('0', 'mi')).toBe(0)
    expect(parseMileageMiles(' 42 ', 'mi')).toBe(42)
    expect(parseMileageMiles('123456.5', 'mi')).toBe(123_456.5)
  })
})

describe('milesToUnit', () => {
  it('returns miles unchanged for the mi unit', () => {
    expect(milesToUnit(74_565, 'mi')).toBe(74_565)
    expect(milesToUnit(0, 'mi')).toBe(0)
  })

  it('scales by the exact ×1.609344 factor for km', () => {
    expect(milesToUnit(100_000, 'km')).toBe(100_000 * KM_PER_MILE)
    expect(milesToUnit(1, 'km')).toBe(1.609344)
  })

  it('is the inverse of parseMileageMiles (km round-trip is lossless)', () => {
    const miles = parseMileageMiles('120000', 'km')! // canonical from a km entry
    expect(milesToUnit(miles, 'km')).toBeCloseTo(120_000, 6)
  })
})

// Minimal car fixture for targeted cases.
function minimalCar(overrides: Partial<Car>): Car {
  return {
    id: 'car-min',
    year: '',
    make: '',
    model: '',
    trim: '',
    color: '',
    mileage: '',
    nickname: '',
    purchaseDate: '',
    saleDate: '',
    status: 'current',
    salePrice: '',
    tradeFor: '',
    coverPhoto: null,
    createdAt: '',
    photos: [],
    wishlist: [],
    mods: [],
    maintenance: [],
    todos: [],
    issues: [],
    ...overrides,
  }
}
