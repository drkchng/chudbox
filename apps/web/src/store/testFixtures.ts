// Shared fixtures for the M2 store tests. Deliberately exercises the strict
// null inventory: 0 amounts, false todos, '' raw strings, null-vs-'' mileage,
// null/0 prices, a dangling coverPhoto pointer, and resolved/unresolved
// issues. Child arrays are listed in ascending timestamp order with sorted
// ids so a flatten → join round trip is deep-equal to the input.
import type { Car } from '@chudbox/shared'

export function isoAt(offsetSeconds: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, offsetSeconds)).toISOString()
}

export function plainCar(id: string, createdAtOffset = 0, overrides: Partial<Car> = {}): Car {
  return {
    id,
    year: '1999',
    make: 'Mazda',
    model: 'Miata',
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
    createdAt: isoAt(createdAtOffset),
    photos: [],
    wishlist: [],
    mods: [],
    maintenance: [],
    todos: [],
    issues: [],
    ...overrides,
  }
}

/** A car covering every nullable/falsy edge in the round-trip inventory. */
export function richCar(id: string, createdAtOffset = 0): Car {
  return {
    id,
    year: '1994',
    make: 'Mazda',
    model: 'RX-7',
    trim: 'R2',
    color: 'Vintage Red',
    mileage: '120,000',
    nickname: 'Seven',
    purchaseDate: '2020-05-01',
    saleDate: '',
    status: 'current',
    salePrice: '',
    tradeFor: '',
    coverPhoto: `${id}-dangling`, // soft pointer that resolves to nothing
    createdAt: isoAt(createdAtOffset),
    photos: [
      {
        id: `${id}-p1`,
        dataUrl: 'data:image/png;base64,AAAA',
        caption: 'front quarter',
        uploadedAt: isoAt(createdAtOffset + 1),
      },
    ],
    wishlist: [
      {
        id: `${id}-w1`,
        name: 'free sticker',
        link: '',
        price: 0, // 0 is a real price
        category: 'exterior',
        notes: '',
        status: 'wanted',
        addedAt: isoAt(createdAtOffset + 2),
      },
      {
        id: `${id}-w2`,
        name: 'coilovers',
        link: 'https://example.com',
        price: null, // blank price
        category: 'suspension',
        notes: 'someday',
        status: 'ordered',
        addedAt: isoAt(createdAtOffset + 3),
      },
    ],
    mods: [
      {
        id: `${id}-m1`,
        name: 'exhaust',
        category: 'performance',
        description: '',
        cost: 1234.56,
        installedDate: '2021-01-01',
        shop: '',
        link: '',
        addedAt: isoAt(createdAtOffset + 4),
      },
      {
        id: `${id}-m2`,
        name: 'gifted intake',
        category: 'performance',
        description: 'no receipt',
        cost: null,
        installedDate: '',
        shop: '',
        link: '',
        addedAt: isoAt(createdAtOffset + 5),
      },
    ],
    maintenance: [
      {
        id: `${id}-r1`,
        service: 'oil change',
        date: '2024-04-01',
        mileage: '12,000', // parses → canonical miles
        cost: 0, // free
        shop: '',
        notes: '',
        nextDueDate: '',
        nextDueMileage: '',
        createdAt: isoAt(createdAtOffset + 6),
      },
      {
        id: `${id}-r2`,
        service: 'inspection',
        date: '2024-05-01',
        mileage: '', // '' is a REAL value, distinct from null
        cost: null,
        shop: '',
        notes: '',
        nextDueDate: '',
        nextDueMileage: 'unknown', // free text → no canonical miles
        createdAt: isoAt(createdAtOffset + 7),
      },
      {
        id: `${id}-r3`,
        service: 'alignment',
        date: '2024-06-01',
        mileage: null, // null → cell omitted entirely
        cost: 89.99,
        shop: 'Local shop',
        notes: '',
        nextDueDate: '',
        nextDueMileage: '',
        createdAt: isoAt(createdAtOffset + 8),
      },
    ],
    todos: [
      {
        id: `${id}-t1`,
        text: 'wash it',
        priority: 'low',
        done: false, // false is a real value
        createdAt: isoAt(createdAtOffset + 9),
      },
      {
        id: `${id}-t2`,
        text: 'register it',
        priority: 'high',
        done: true,
        createdAt: isoAt(createdAtOffset + 10),
      },
    ],
    issues: [
      {
        id: `${id}-i1`,
        title: 'apex seals',
        description: 'of course',
        severity: 'critical',
        status: 'open',
        createdAt: isoAt(createdAtOffset + 11),
        resolvedAt: null,
      },
      {
        id: `${id}-i2`,
        title: 'squeaky belt',
        description: '',
        severity: 'minor',
        status: 'resolved',
        createdAt: isoAt(createdAtOffset + 12),
        resolvedAt: isoAt(createdAtOffset + 13),
      },
    ],
  }
}
