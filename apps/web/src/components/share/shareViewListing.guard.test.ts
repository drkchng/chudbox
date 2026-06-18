// Guardrails for the FOR-SALE LISTING ('listing' scope, DEC-14) public viewer.
// The web runner is node (no DOM), so instead of rendering we assert the
// properties that keep the listing view safe + correct:
//
//   1. AUTH-FREE — never imports the auth client (works fully logged-out).
//   2. READ-ONLY — never touches the garage store and has no mutation path.
//   3. ROUTING — SharePage renders the listing viewer ONLY for a server-declared
//      'listing' scope.
//   4. DATA — buildListingSnapshot exposes the buyer-facing listing fields
//      (salePrice + its entered-currency tag, tradeFor, the listing-only VIN) +
//      the owner-opt-in plate, while STILL withholding the full-only data
//      (wishlist/todos/issues, cost/shop/notes) and the raw r2Key/dataUrl/ids.
import { describe, expect, it } from 'vitest'
import { buildListingSnapshot } from '@chudbox/shared'
import type { Car, GarageValues, SnapshotCarInput } from '@chudbox/shared'
import SHARE_LISTING_VIEW from './ShareCarViewListing.tsx?raw'
import SHARE_PAGE from '../../pages/SharePage.tsx?raw'

const AUTH_PATTERNS: RegExp[] = [/authClient/, /useSession/, /auth\/client/, /better-auth/]
const STORE_OR_MUTATION_PATTERNS: RegExp[] = [
  /useGarageStore/,
  /\badd[A-Z]/,
  /\bupdate[A-Z]/,
  /\bdelete[A-Z]/,
  /\btoggle[A-Z]/,
  /onSubmit/,
]

describe('listing viewer works logged-out (no auth client)', () => {
  for (const pattern of AUTH_PATTERNS) {
    it(`ShareCarViewListing does not use ${pattern}`, () => {
      expect(SHARE_LISTING_VIEW).not.toMatch(pattern)
    })
  }
})

describe('listing viewer is read-only (no store, no mutation path)', () => {
  for (const pattern of STORE_OR_MUTATION_PATTERNS) {
    it(`ShareCarViewListing has no ${pattern}`, () => {
      expect(SHARE_LISTING_VIEW).not.toMatch(pattern)
    })
  }
})

describe('SharePage routes scope to the right viewer', () => {
  it('renders the listing viewer ONLY for a listing-scope snapshot', () => {
    expect(SHARE_PAGE).toMatch(/scope === 'listing'/)
    expect(SHARE_PAGE).toMatch(/ShareCarViewListing/)
  })
})

describe('buildListingSnapshot — exposes For-Sale fields, still withholds secrets', () => {
  const car: Car = {
    id: 'car-1',
    year: '2014', make: 'Subaru', model: 'WRX', trim: 'STI', color: 'Blue',
    mileage: '80000', nickname: 'Rex',
    purchaseDate: '2020-01-01', saleDate: '', status: 'for-sale',
    salePrice: '23000', tradeFor: 'a clean E46 M3',
    vin: 'JF1VA1A60E9826434',
    plate: 'GR-WRX', showPlate: true,
    coverPhoto: 'p1', createdAt: '2020-01-01',
    photos: [{ id: 'p1', dataUrl: 'data:image/png;base64,BASE64_MARKER', caption: 'front', uploadedAt: '2020-01-02' }],
    wishlist: [{ id: 'w1', name: 'WL_MARKER', link: '', price: 499, category: 'Brakes', notes: 'soon', status: 'wanted', addedAt: 'x' }],
    mods: [{ id: 'm1', name: 'Coilovers', category: 'Suspension', description: 'lowered', cost: 1200, installedDate: '2021-03-03', shop: 'SHOP_MARKER', link: '', addedAt: '2021-03-03' }],
    maintenance: [{ id: 'r1', service: 'Oil', date: '2022-04-04', mileage: '60000', cost: 75, shop: 'GARAGE_MARKER', notes: 'NOTE_MARKER', nextDueDate: '', nextDueMileage: '', createdAt: '2022-04-04' }],
    todos: [{ id: 't1', text: 'TODO_MARKER', priority: 'high', done: false, createdAt: 'x' }],
    issues: [{ id: 'i1', title: 'ISSUE_MARKER', description: 'd', severity: 'minor', status: 'open', createdAt: 'x', resolvedAt: null }],
  }
  // DEC-1: the entered currency tag (re-attached by the DO from the flat row).
  const input = { ...car, salePriceCurrency: 'CAD' } as SnapshotCarInput
  const settings: GarageValues = { themeId: 'garage', currency: 'USD', distanceUnit: 'mi' }
  const snap = buildListingSnapshot(input, settings)

  it('exposes the buyer-facing listing fields + the opted-in plate', () => {
    expect(snap.salePrice).toBe('23000')
    expect(snap.salePriceCurrency).toBe('CAD') // entered tag, NOT the device USD
    expect(snap.tradeFor).toBe('a clean E46 M3')
    expect(snap.vin).toBe('JF1VA1A60E9826434')
    expect(snap.plate).toBe('GR-WRX')
  })

  it('STILL withholds full-only data and the raw r2Key/dataUrl/internal ids', () => {
    const serialized = JSON.stringify(snap)
    for (const marker of [
      'BASE64_MARKER', 'WL_MARKER', 'SHOP_MARKER', 'GARAGE_MARKER',
      'NOTE_MARKER', 'TODO_MARKER', 'ISSUE_MARKER',
    ]) {
      expect(serialized, `listing leaked ${marker}`).not.toContain(marker)
    }
    const loose = snap as unknown as Record<string, unknown>
    expect(loose.wishlist).toBeUndefined()
    expect(loose.todos).toBeUndefined()
    expect(loose.issues).toBeUndefined()
    expect(snap.mods[0] as unknown as Record<string, unknown>).not.toHaveProperty('cost')
    expect(snap.maintenance[0] as unknown as Record<string, unknown>).not.toHaveProperty('notes')
    expect((snap.photos[0] as unknown as Record<string, unknown>).dataUrl).toBeUndefined()
    expect((snap.settings as unknown as Record<string, unknown>).currency).toBeUndefined()
  })
})
