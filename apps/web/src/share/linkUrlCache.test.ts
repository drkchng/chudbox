import { describe, expect, it } from 'vitest'
import { forgetShareUrl, getShareUrl, rememberShareUrl, shareUrlKey } from './linkUrlCache'
import type { LocalStorageLike } from './linkUrlCache'

/** Map-backed localStorage stub (mirrors shareClient.test.ts's makeStorage). */
function makeStorage(initial: Record<string, string> = {}): LocalStorageLike & {
  map: Map<string, string>
} {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  }
}

const ID = 'a1b2c3d4e5f6a7b8c9d0e1f2'
const URL = 'https://chudbox.com/share/RAWTOKEN123'

describe('linkUrlCache', () => {
  it('round-trips a remembered URL by link id', () => {
    const storage = makeStorage()
    rememberShareUrl(ID, URL, storage)
    expect(storage.map.get(shareUrlKey(ID))).toBe(URL)
    expect(getShareUrl(ID, storage)).toBe(URL)
  })

  it('returns null for a link this device never created', () => {
    expect(getShareUrl(ID, makeStorage())).toBeNull()
  })

  it('forgets a URL on revoke', () => {
    const storage = makeStorage({ [shareUrlKey(ID)]: URL })
    forgetShareUrl(ID, storage)
    expect(getShareUrl(ID, storage)).toBeNull()
  })

  it('ignores empty ids/urls and never throws on a broken storage', () => {
    const storage = makeStorage()
    rememberShareUrl('', URL, storage)
    rememberShareUrl(ID, '', storage)
    expect(storage.map.size).toBe(0)

    const broken: LocalStorageLike = {
      getItem: () => { throw new Error('quota') },
      setItem: () => { throw new Error('quota') },
      removeItem: () => { throw new Error('quota') },
    }
    expect(() => rememberShareUrl(ID, URL, broken)).not.toThrow()
    expect(getShareUrl(ID, broken)).toBeNull()
    expect(() => forgetShareUrl(ID, broken)).not.toThrow()
  })

  it('is safe under node where localStorage is undefined (default param)', () => {
    expect(() => rememberShareUrl(ID, URL)).not.toThrow()
    expect(getShareUrl(ID)).toBeNull()
    expect(() => forgetShareUrl(ID)).not.toThrow()
  })
})
