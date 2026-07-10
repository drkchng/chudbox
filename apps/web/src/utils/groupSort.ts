import type { ItemSortBy, SortDir } from '../store/adapter'

export type { SortDir }

// Shared grouping/sorting for the Mods and Maintenance tabs: group by an
// explicit category (alphabetical groups, each secondary-sorted by date) or
// by the month of a date field (chronological groups, each sorted by exact
// date). Both axes respect the same direction toggle — 'desc' (default)
// reads as "newest/largest first", 'asc' as "oldest/smallest first". Items
// with no date always sort last, regardless of direction.

export interface SortGroup<T> {
  key: string
  label: string
  items: T[]
}

const monthKey = (iso: string): string => (iso ? iso.slice(0, 7) : '')

export const monthLabel = (key: string): string => {
  if (!key) return 'No date'
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

/** A comparator over items' date field: blank dates always sort last,
 *  regardless of `dir` — the rest respect 'desc' (newest first) / 'asc'
 *  (oldest first). Timestamps are parsed once per item, not per comparison. */
export function dateComparator<T>(getDate: (item: T) => string, dir: SortDir): (a: T, b: T) => number {
  const dirSign = dir === 'asc' ? 1 : -1
  const timestamps = new Map<T, number | null>()
  const timeOf = (item: T): number | null => {
    let t = timestamps.get(item)
    if (t === undefined) {
      const iso = getDate(item)
      t = iso ? new Date(iso).getTime() : null
      timestamps.set(item, t)
    }
    return t
  }
  return (a, b) => {
    const ta = timeOf(a)
    const tb = timeOf(b)
    if (ta === null && tb === null) return 0
    if (ta === null) return 1
    if (tb === null) return -1
    return dirSign * (ta - tb)
  }
}

export function groupSort<T>(
  items: T[],
  getCategory: (item: T) => string,
  getDate: (item: T) => string,
  sortBy: ItemSortBy,
  dir: SortDir,
): SortGroup<T>[] {
  const dirSign = dir === 'asc' ? 1 : -1
  const byDate = dateComparator(getDate, dir)

  const bucketKey = sortBy === 'category' ? (item: T) => getCategory(item) || 'Other' : (item: T) => monthKey(getDate(item))

  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = bucketKey(item)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(item)
  }

  const orderedKeys = [...groups.keys()].sort((a, b) => {
    if (sortBy === 'category') return a.localeCompare(b)
    // Month grouping: '' (no date) always sorts last, independent of dir.
    if (a === '') return 1
    if (b === '') return -1
    return dirSign * (a < b ? -1 : a > b ? 1 : 0)
  })

  return orderedKeys.map((key) => ({
    key,
    label: sortBy === 'category' ? key : monthLabel(key),
    items: [...groups.get(key)!].sort(byDate),
  }))
}
