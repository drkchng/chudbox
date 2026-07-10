import { describe, expect, it } from 'vitest'
import { dateComparator, groupSort } from './groupSort'

interface Item {
  id: string
  category: string
  date: string
}

const item = (id: string, category: string, date: string): Item => ({ id, category, date })

describe('dateComparator', () => {
  it('sorts blank dates last regardless of direction', () => {
    const items = [item('a', '', ''), item('b', '', '2026-02-01'), item('c', '', '2026-01-01')]

    const desc = [...items].sort(dateComparator((i: Item) => i.date, 'desc'))
    expect(desc.map((i) => i.id)).toEqual(['b', 'c', 'a'])

    const asc = [...items].sort(dateComparator((i: Item) => i.date, 'asc'))
    expect(asc.map((i) => i.id)).toEqual(['c', 'b', 'a'])
  })
})

describe('groupSort', () => {
  const items = [
    item('a', 'Engine', '2026-03-01'),
    item('b', 'Brakes', '2026-01-15'),
    item('c', 'Engine', '2026-02-01'),
    item('d', '', ''),
  ]

  it('category mode: alphabetical groups, each secondary-sorted by date (desc default)', () => {
    const groups = groupSort(items, (i) => i.category, (i) => i.date, 'category', 'desc')
    expect(groups.map((g) => g.key)).toEqual(['Brakes', 'Engine', 'Other'])
    expect(groups.find((g) => g.key === 'Engine')!.items.map((i) => i.id)).toEqual(['a', 'c'])
  })

  it('date mode: chronological month groups, blank-date group always last regardless of dir', () => {
    const desc = groupSort(items, (i) => i.category, (i) => i.date, 'date', 'desc')
    expect(desc.map((g) => g.key)).toEqual(['2026-03', '2026-02', '2026-01', ''])

    const asc = groupSort(items, (i) => i.category, (i) => i.date, 'date', 'asc')
    expect(asc.map((g) => g.key)).toEqual(['2026-01', '2026-02', '2026-03', ''])
  })
})
