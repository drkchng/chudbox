// Guardrails for the FULL ('full' scope) public viewer. The web runner is node
// (no DOM), so instead of rendering we assert the properties that make the full
// view safe and correct:
//
//   1. AUTH-FREE — the full viewer never imports the auth client, so it works
//      fully logged-out (everything comes from the token + the snapshot body).
//   2. READ-ONLY — it never touches the garage store and has no add/edit/delete
//      path: a future edit that reaches for useGarageStore or a mutation helper
//      (which would let a public viewer mutate data) fails here.
//   3. ROUTING — SharePage renders the full viewer ONLY for a server-declared
//      'full' scope; otherwise it stays the curated showcase.
//   4. DATA — buildFullSnapshot exposes the owner-only fields the curated viewer
//      hides (wishlist/todos/issues, cost/shop/notes, salePrice/tradeFor) while
//      STILL withholding the raw r2Key / dataUrl / internal row ids.
import { describe, expect, it } from 'vitest'
import { buildFullSnapshot } from '@chudbox/shared'
import type { Car, GarageValues, SnapshotCarInput } from '@chudbox/shared'
// Vite/vitest `?raw` imports give the file contents as strings.
import SHARE_FULL_VIEW from './ShareCarViewFull.tsx?raw'
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

describe('full share viewer works logged-out (no auth client)', () => {
  for (const pattern of AUTH_PATTERNS) {
    it(`ShareCarViewFull does not use ${pattern}`, () => {
      expect(SHARE_FULL_VIEW).not.toMatch(pattern)
    })
  }
})

describe('full share viewer is read-only (no store, no mutation path)', () => {
  for (const pattern of STORE_OR_MUTATION_PATTERNS) {
    it(`ShareCarViewFull has no ${pattern}`, () => {
      expect(SHARE_FULL_VIEW).not.toMatch(pattern)
    })
  }
  it('renders the owner-only sections (wishlist / to-dos / issues)', () => {
    expect(SHARE_FULL_VIEW).toMatch(/car\.wishlist/)
    expect(SHARE_FULL_VIEW).toMatch(/car\.todos/)
    expect(SHARE_FULL_VIEW).toMatch(/car\.issues/)
  })
})

describe('SharePage routes scope to the right viewer', () => {
  it('renders the full viewer ONLY for a full-scope snapshot', () => {
    expect(SHARE_PAGE).toMatch(/scope === 'full'/)
    expect(SHARE_PAGE).toMatch(/ShareCarViewFull/)
  })
})

describe('buildFullSnapshot — exposes owner-only fields, still withholds secrets', () => {
  const car: Car = {
    id: 'car-1',
    year: '2014', make: 'Subaru', model: 'WRX', trim: 'STI', color: 'Blue',
    mileage: '80000', nickname: 'Rex',
    purchaseDate: '2020-01-01', saleDate: '', status: 'for-sale',
    salePrice: '9000', tradeFor: 'a clean E46 M3',
    coverPhoto: 'p1', createdAt: '2020-01-01',
    photos: [{ id: 'p1', dataUrl: 'data:image/png;base64,BASE64_MARKER', caption: 'front', uploadedAt: '2020-01-02' }],
    wishlist: [{ id: 'w1', name: 'WL_MARKER', link: '', price: 499, category: 'Brakes', notes: 'soon', status: 'wanted', addedAt: 'x' }],
    mods: [{ id: 'm1', name: 'Coilovers', category: 'Suspension', description: 'lowered', cost: 1200, installedDate: '2021-03-03', shop: 'SHOP_MARKER', link: '', addedAt: '2021-03-03' }],
    maintenance: [{ id: 'r1', service: 'Oil', date: '2022-04-04', mileage: '60000', cost: 75, shop: 'GARAGE_MARKER', notes: 'NOTE_MARKER', nextDueDate: '', nextDueMileage: '', createdAt: '2022-04-04' }],
    todos: [{ id: 't1', text: 'TODO_MARKER', priority: 'high', done: false, createdAt: 'x' }],
    issues: [{ id: 'i1', title: 'ISSUE_MARKER', description: 'd', severity: 'minor', status: 'open', createdAt: 'x', resolvedAt: null }],
  }
  const settings: GarageValues = { themeId: 'garage', currency: 'USD', distanceUnit: 'mi' }
  const snap = buildFullSnapshot(car as SnapshotCarInput, settings)

  it('includes the previously-withheld owner fields', () => {
    expect(snap.salePrice).toBe('9000')
    expect(snap.tradeFor).toBe('a clean E46 M3')
    expect(snap.wishlist[0].name).toBe('WL_MARKER')
    expect(snap.wishlist[0].price).toBe(499)
    expect(snap.todos[0].text).toBe('TODO_MARKER')
    expect(snap.issues[0].title).toBe('ISSUE_MARKER')
    expect(snap.mods[0].cost).toBe(1200)
    expect(snap.mods[0].shop).toBe('SHOP_MARKER')
    expect(snap.maintenance[0].cost).toBe(75)
    expect(snap.maintenance[0].shop).toBe('GARAGE_MARKER')
    expect(snap.maintenance[0].notes).toBe('NOTE_MARKER')
    expect(snap.settings.currency).toBe('USD')
  })

  it('still withholds the raw r2Key/dataUrl and every internal row id', () => {
    const serialized = JSON.stringify(snap)
    expect(serialized).not.toContain('BASE64_MARKER')
    const photo = snap.photos[0] as unknown as Record<string, unknown>
    expect(photo.dataUrl).toBeUndefined()
    expect(photo.r2Key).toBeUndefined()
    expect((snap.wishlist[0] as unknown as Record<string, unknown>).id).toBeUndefined()
    expect((snap.todos[0] as unknown as Record<string, unknown>).id).toBeUndefined()
    expect((snap.issues[0] as unknown as Record<string, unknown>).id).toBeUndefined()
    expect((snap.mods[0] as unknown as Record<string, unknown>).id).toBeUndefined()
  })
})
