// M4 public viewer guardrails. The web test runner is `node` (no DOM/jsdom), so
// instead of rendering we assert the two properties that together guarantee the
// viewer "renders only curated fields and works logged-out":
//
//   1. STRUCTURAL — the viewer is driven only by PublicCarSnapshot, whose JSON
//      (even built from a fully-populated car carrying every secret) contains
//      none of the excluded fields/values. This is the data the viewer renders.
//   2. SOURCE — the viewer source never references an excluded field name and
//      never imports/uses the auth client (so it cannot leak a private field
//      and cannot be gated on a session).
//
// Both are regression-proof in a way a screenshot is not: a future edit that
// reaches for car.salePrice, or imports authClient into the viewer, fails here.
import { describe, expect, it } from 'vitest'
import { buildPublicSnapshot } from '@chudbox/shared'
import type { Car, GarageValues, SnapshotCarInput } from '@chudbox/shared'
// Vite/vitest `?raw` imports give the file contents as strings (typed via
// vite/client) — no node:fs, so this stays inside the web app's DOM tsconfig.
import SHARE_CAR_VIEW from './ShareCarView.tsx?raw'
import SHARE_PAGE from '../../pages/SharePage.tsx?raw'
import SHARE_CLIENT from '../../share/shareClient.ts?raw'

// Field NAMES that must never appear in the viewer (deny-by-default allowlist).
const FORBIDDEN_NAME_PATTERNS: RegExp[] = [
  /\bsalePrice\b/, /\bsalePriceCurrency\b/, /\btradeFor\b/,
  /\bwishlist\b/, /\bissues\b/, /\btodos\b/,
  /\bcostCurrency\b/, /\bpriceCurrency\b/, /\bcurrency\b/,
  /\bcost\b/, /\bshop\b/, /\bnotes\b/,
  /\br2Key\b/, /\bdataUrl\b/,
]

const AUTH_PATTERNS: RegExp[] = [/authClient/, /useSession/, /auth\/client/, /better-auth/]

describe('public viewer source never references excluded fields', () => {
  for (const [name, src] of [['ShareCarView', SHARE_CAR_VIEW], ['SharePage', SHARE_PAGE]] as const) {
    for (const pattern of FORBIDDEN_NAME_PATTERNS) {
      it(`${name} does not reference ${pattern}`, () => {
        expect(src).not.toMatch(pattern)
      })
    }
  }
})

describe('public viewer + client work logged-out (no auth client)', () => {
  for (const [name, src] of [
    ['ShareCarView', SHARE_CAR_VIEW],
    ['SharePage', SHARE_PAGE],
    ['shareClient', SHARE_CLIENT],
  ] as const) {
    for (const pattern of AUTH_PATTERNS) {
      it(`${name} does not use ${pattern}`, () => {
        expect(src).not.toMatch(pattern)
      })
    }
  }
})

describe('the snapshot the viewer renders is curated (no secrets in the JSON)', () => {
  // A fully-populated car carrying every excluded secret, plus markers we can
  // grep for in the serialized snapshot.
  const car: Car = {
    id: 'car-1',
    year: '2014', make: 'Subaru', model: 'WRX', trim: 'STI', color: 'WR Blue',
    mileage: '80,000', nickname: 'Rex',
    purchaseDate: '2020-01-01', saleDate: '2025-06-01', status: 'sold',
    salePrice: '99001199', tradeFor: 'SECRET-TRADE-MARKER',
    coverPhoto: 'p1', createdAt: '2020-01-01',
    photos: [
      { id: 'p1', dataUrl: 'data:image/png;base64,SECRET-BASE64-MARKER', caption: 'front', uploadedAt: '2020-01-02' },
    ],
    wishlist: [
      { id: 'w1', name: 'SECRET-WISHLIST-MARKER', link: '', price: 99004499, category: 'x', notes: 'SECRET-NOTE-MARKER', status: 'wanted', addedAt: '2021' },
    ],
    mods: [
      { id: 'm1', name: 'Coilovers', category: 'Suspension', description: 'lowered', cost: 99002299, installedDate: '2021-03-03', shop: 'SECRET-SHOP-MARKER', link: 'https://x', addedAt: '2021-03-03' },
    ],
    maintenance: [
      { id: 'r1', service: 'Oil Change', date: '2022-04-04', mileage: '60000', cost: 99003399, shop: 'SECRET-SHOP-MARKER-2', notes: 'SECRET-NOTE-MARKER-2', nextDueDate: '2023-04-04', nextDueMileage: '70000', createdAt: '2022-04-04' },
    ],
    todos: [{ id: 't1', text: 'SECRET-TODO-MARKER', priority: 'low', done: false, createdAt: '2022' }],
    issues: [{ id: 'i1', title: 'SECRET-ISSUE-MARKER', description: 'd', severity: 'minor', status: 'open', createdAt: '2022', resolvedAt: null }],
  }
  const settings: GarageValues = { themeId: 'garage', customAccent: undefined, currency: 'USD', distanceUnit: 'mi' }

  const snapshot = buildPublicSnapshot(car as SnapshotCarInput, settings)
  const serialized = JSON.stringify(snapshot)

  it('keeps the curated fields the viewer shows', () => {
    expect(snapshot.make).toBe('Subaru')
    expect(snapshot.mods[0].name).toBe('Coilovers')
    expect(snapshot.maintenance[0].service).toBe('Oil Change')
    expect(snapshot.photos[0].photoId).toBe('p1')
    expect(snapshot.coverPhotoId).toBe('p1')
  })

  it.each([
    'SECRET-TRADE-MARKER',
    'SECRET-BASE64-MARKER',
    'SECRET-WISHLIST-MARKER',
    'SECRET-NOTE-MARKER',
    'SECRET-NOTE-MARKER-2',
    'SECRET-SHOP-MARKER',
    'SECRET-SHOP-MARKER-2',
    'SECRET-TODO-MARKER',
    'SECRET-ISSUE-MARKER',
    '99001199', // salePrice
    '99002299', // mod cost
    '99003399', // maintenance cost
    '99004499', // wishlist price
  ])('excludes the secret value %s', (marker) => {
    expect(serialized).not.toContain(marker)
  })

  it.each(['salePrice', 'tradeFor', 'wishlist', 'issues', 'todos', 'cost', 'shop', 'notes', 'currency', 'dataUrl', 'r2Key'])(
    'excludes the field name "%s"',
    (field) => {
      expect(serialized).not.toContain(field)
    },
  )
})
