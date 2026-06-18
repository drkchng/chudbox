import { describe, expect, it } from 'vitest'
import type { Car, Photo } from '@chudbox/shared'
import {
  buildItemKindMap,
  photosForItem,
  resolveBannerPhoto,
  resolveCoverPhoto,
  resolvedSource,
} from './photoBuckets'

// A minimal car shell with just the fields the resolvers read.
function car(overrides: Partial<Car>): Car {
  return {
    id: 'car-1',
    year: '', make: '', model: '', trim: '', color: '', mileage: '',
    nickname: '', purchaseDate: '', saleDate: '', status: 'current',
    salePrice: '', tradeFor: '', createdAt: '',
    coverPhoto: null, bannerPhoto: null,
    photos: [], wishlist: [], mods: [], maintenance: [], todos: [], issues: [],
    ...overrides,
  }
}

const photo = (over: Partial<Photo>): Photo => ({
  id: 'p', dataUrl: '', caption: '', uploadedAt: '', ...over,
})

describe('resolvedSource (§15.2 coherence rule)', () => {
  it('buckets by the resolved parent, never the raw source hint', () => {
    const c = car({
      mods: [{ id: 'mod-1', name: '', category: '', description: '', cost: null, installedDate: '', shop: '', link: '', addedAt: '' }],
    })
    const kindMap = buildItemKindMap(c)
    // sourceId resolves to a live mod → 'mod', regardless of the stale hint.
    expect(resolvedSource(photo({ sourceId: 'mod-1', source: 'issue' }), kindMap)).toBe('mod')
    // No sourceId → General ('car').
    expect(resolvedSource(photo({}), kindMap)).toBe('car')
    // A stale source='mod' with NO sourceId still resolves to General.
    expect(resolvedSource(photo({ source: 'mod' }), kindMap)).toBe('car')
  })

  it('coalesces a DANGLING sourceId (deleted/unmerged parent) to General', () => {
    const kindMap = buildItemKindMap(car({}))
    expect(resolvedSource(photo({ sourceId: 'gone', source: 'mod' }), kindMap)).toBe('car')
    expect(resolvedSource(photo({ sourceId: '' }), kindMap)).toBe('car')
  })

  it('resolves each kind from its own table', () => {
    const c = car({
      mods: [{ id: 'm', name: '', category: '', description: '', cost: null, installedDate: '', shop: '', link: '', addedAt: '' }],
      maintenance: [{ id: 'r', service: '', date: '', mileage: null, cost: null, shop: '', notes: '', nextDueDate: '', nextDueMileage: '', createdAt: '' }],
      issues: [{ id: 'i', title: '', description: '', severity: 'minor', status: 'open', createdAt: '' }],
      todos: [{ id: 't', text: '', priority: 'low', done: false, createdAt: '' }],
    })
    const k = buildItemKindMap(c)
    expect(resolvedSource(photo({ sourceId: 'm' }), k)).toBe('mod')
    expect(resolvedSource(photo({ sourceId: 'r' }), k)).toBe('maintenance')
    expect(resolvedSource(photo({ sourceId: 'i' }), k)).toBe('issue')
    expect(resolvedSource(photo({ sourceId: 't' }), k)).toBe('todo')
  })
})

describe('photosForItem', () => {
  it('returns only the photos whose sourceId matches the item', () => {
    const photos = [
      photo({ id: 'a', sourceId: 'mod-1' }),
      photo({ id: 'b', sourceId: 'mod-2' }),
      photo({ id: 'c', sourceId: 'mod-1' }),
      photo({ id: 'd' }), // General
    ]
    expect(photosForItem(photos, 'mod-1').map((p) => p.id)).toEqual(['a', 'c'])
    expect(photosForItem(photos, 'mod-2').map((p) => p.id)).toEqual(['b'])
    expect(photosForItem(photos, 'nope')).toEqual([])
  })
})

describe('cover/banner resolution (soft pointers may dangle)', () => {
  const photos = [photo({ id: 'p1' }), photo({ id: 'p2' }), photo({ id: 'p3' })]

  it('cover: coverPhoto → first → none', () => {
    expect(resolveCoverPhoto({ photos, coverPhoto: 'p2' })?.id).toBe('p2')
    expect(resolveCoverPhoto({ photos, coverPhoto: 'dangling' })?.id).toBe('p1') // fallback to first
    expect(resolveCoverPhoto({ photos, coverPhoto: null })?.id).toBe('p1')
    expect(resolveCoverPhoto({ photos: [], coverPhoto: 'x' })).toBeUndefined()
  })

  it('banner: bannerPhoto → coverPhoto → first → none', () => {
    expect(resolveBannerPhoto({ photos, bannerPhoto: 'p3', coverPhoto: 'p2' })?.id).toBe('p3')
    // banner dangles → fall through to cover
    expect(resolveBannerPhoto({ photos, bannerPhoto: 'gone', coverPhoto: 'p2' })?.id).toBe('p2')
    // both dangle / absent → first
    expect(resolveBannerPhoto({ photos, bannerPhoto: null, coverPhoto: null })?.id).toBe('p1')
    expect(resolveBannerPhoto({ photos: [], bannerPhoto: 'x', coverPhoto: 'y' })).toBeUndefined()
  })
})
