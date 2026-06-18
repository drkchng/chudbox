// M4 share-links client seam: the owner create/list/revoke HTTP shapes, the
// public snapshot fetch's status mapping (works logged-out), the copy-once
// invariant (raw token only ever comes from create, never from list), the
// optional-expiry conversion, and the clipboard helper — all over an injected
// fetch / clipboard so no DOM is required.
import { describe, expect, it, vi } from 'vitest'
import {
  createShareLinkPath,
  shareRevokePath,
  shareSnapshotPath,
  shareViewPath,
} from '@chudbox/shared'
import type {
  CreateShareResponse,
  ShareLinkMeta,
  ShareSnapshotResponse,
} from '@chudbox/shared'
import {
  copyToClipboard,
  createShareLink,
  expiryInputToEpochSeconds,
  fetchShareSnapshot,
  formatViewCount,
  listShareLinks,
  recordShareView,
  revokeShareLink,
  viewedSessionKey,
} from './shareClient'
import type { FetchLike, SessionStorageLike } from './shareClient'

type Responder = (url: string, init?: RequestInit) => Response | Promise<Response>

function makeFetch(responder: Responder) {
  const calls: { url: string; init?: RequestInit }[] = []
  const fetchImpl = vi.fn<FetchLike>(async (url, init) => {
    calls.push({ url, init })
    return responder(url, init)
  })
  return { fetchImpl, calls }
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const CREATE_RES: CreateShareResponse = {
  url: 'https://chudbox.app/#/share/RAWTOKEN123',
  token: 'RAWTOKEN123',
  expiresAt: null,
}

const META: ShareLinkMeta = {
  id: 'a1b2c3d4',
  carId: 'car-1',
  createdAt: 1_700_000_000,
  expiresAt: null,
  revokedAt: null,
  viewCount: 0,
  scope: 'curated',
}

/** Map-backed sessionStorage stub so the once-per-session guard is observable. */
function makeStorage(initial: Record<string, string> = {}): SessionStorageLike & {
  map: Map<string, string>
} {
  const map = new Map(Object.entries(initial))
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  }
}

describe('createShareLink', () => {
  it('POSTs the carId path with same-origin credentials and an expiresAt body, returning the once-shown url+token', async () => {
    const { fetchImpl, calls } = makeFetch(() => json(CREATE_RES))
    const res = await createShareLink({ carId: 'car 1', expiresAt: null, fetchImpl })

    expect(res).toEqual(CREATE_RES)
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(createShareLinkPath('car 1')) // path-encodes the id
    expect(calls[0].init?.method).toBe('POST')
    expect(calls[0].init?.credentials).toBe('same-origin')
    // scope defaults to the safe curated showcase when the caller omits it.
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ expiresAt: null, scope: 'curated' })
  })

  it('passes a future expiresAt through verbatim', async () => {
    const { fetchImpl, calls } = makeFetch(() => json({ ...CREATE_RES, expiresAt: 2_000_000_000 }))
    await createShareLink({ carId: 'car-1', expiresAt: 2_000_000_000, fetchImpl })
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ expiresAt: 2_000_000_000, scope: 'curated' })
  })

  it('sends the chosen full scope in the create body', async () => {
    const { fetchImpl, calls } = makeFetch(() => json(CREATE_RES))
    await createShareLink({ carId: 'car-1', expiresAt: null, scope: 'full', fetchImpl })
    expect(JSON.parse(calls[0].init?.body as string)).toEqual({ expiresAt: null, scope: 'full' })
  })

  it('throws the server error message on a non-2xx response', async () => {
    const { fetchImpl } = makeFetch(() => json({ error: 'car not found' }, 404))
    await expect(createShareLink({ carId: 'gone', expiresAt: null, fetchImpl })).rejects.toThrow('car not found')
  })

  it('throws with the status when the error body is not JSON', async () => {
    const { fetchImpl } = makeFetch(() => new Response('nope', { status: 500 }))
    await expect(createShareLink({ carId: 'c', expiresAt: null, fetchImpl })).rejects.toThrow('500')
  })
})

describe('copy-once invariant', () => {
  it('the raw token/url comes from create; list yields only metadata (no token, no url)', async () => {
    const created = await createShareLink({
      carId: 'car-1',
      expiresAt: null,
      fetchImpl: makeFetch(() => json(CREATE_RES)).fetchImpl,
    })
    expect(created.token).toBe('RAWTOKEN123')
    expect(created.url).toContain('RAWTOKEN123')

    const links = await listShareLinks({
      carId: 'car-1',
      fetchImpl: makeFetch(() => json({ links: [META] })).fetchImpl,
    })
    for (const link of links) {
      expect(link).not.toHaveProperty('token')
      expect(link).not.toHaveProperty('url')
    }
  })
})

describe('listShareLinks', () => {
  it('GETs the carId path with credentials and returns the links array', async () => {
    const { fetchImpl, calls } = makeFetch(() => json({ links: [META] }))
    const links = await listShareLinks({ carId: 'car-1', fetchImpl })
    expect(links).toEqual([META])
    expect(calls[0].url).toBe(createShareLinkPath('car-1'))
    expect(calls[0].init?.method).toBe('GET')
    expect(calls[0].init?.credentials).toBe('same-origin')
  })

  it('throws on a non-2xx response', async () => {
    const { fetchImpl } = makeFetch(() => json({ error: 'unauthorized' }, 401))
    await expect(listShareLinks({ carId: 'car-1', fetchImpl })).rejects.toThrow('unauthorized')
  })
})

describe('revokeShareLink', () => {
  it('DELETEs the per-id revoke path with credentials', async () => {
    const { fetchImpl, calls } = makeFetch(() => new Response(null, { status: 204 }))
    await revokeShareLink({ carId: 'car-1', id: 'a1b2c3d4', fetchImpl })
    expect(calls[0].url).toBe(shareRevokePath('car-1', 'a1b2c3d4'))
    expect(calls[0].init?.method).toBe('DELETE')
    expect(calls[0].init?.credentials).toBe('same-origin')
  })

  it('throws on a non-2xx response', async () => {
    const { fetchImpl } = makeFetch(() => json({ error: 'not found' }, 404))
    await expect(revokeShareLink({ carId: 'car-1', id: 'x', fetchImpl })).rejects.toThrow('not found')
  })
})

describe('fetchShareSnapshot — public, no auth, status mapping', () => {
  const SNAPSHOT: ShareSnapshotResponse = {
    scope: 'curated',
    expiresAt: null,
    car: {
      year: '2014', make: 'Subaru', model: 'WRX', trim: 'STI', color: 'Blue',
      nickname: 'Rex', mileageRaw: '80000', status: 'current', createdAt: '2020-01-01',
      photos: [], mods: [], maintenance: [],
      settings: { themeId: 'garage', distanceUnit: 'mi' },
    },
  }

  it('maps 200 → ok and requests the public path WITHOUT credentials (works logged-out)', async () => {
    const { fetchImpl, calls } = makeFetch(() => json(SNAPSHOT))
    const result = await fetchShareSnapshot('TOK', fetchImpl)
    expect(result).toEqual({ kind: 'ok', data: SNAPSHOT })
    expect(calls[0].url).toBe(shareSnapshotPath('TOK'))
    expect(calls[0].init?.method).toBe('GET')
    expect(calls[0].init?.credentials).toBe('omit')
  })

  it('maps 404 → not-found (invalid token)', async () => {
    const { fetchImpl } = makeFetch(() => json({ error: 'not found' }, 404))
    expect(await fetchShareSnapshot('TOK', fetchImpl)).toEqual({ kind: 'not-found' })
  })

  it('maps 410 → gone (revoked or expired)', async () => {
    const { fetchImpl } = makeFetch(() => json({ error: 'gone' }, 410))
    expect(await fetchShareSnapshot('TOK', fetchImpl)).toEqual({ kind: 'gone' })
  })

  it('maps 5xx → error', async () => {
    const { fetchImpl } = makeFetch(() => json({ error: 'boom' }, 500))
    expect(await fetchShareSnapshot('TOK', fetchImpl)).toEqual({ kind: 'error', message: 'boom' })
  })

  it('maps a network throw → error (never throws)', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => { throw new TypeError('offline') })
    const result = await fetchShareSnapshot('TOK', fetchImpl)
    expect(result.kind).toBe('error')
  })

  it('maps a non-JSON 200 body → error (never cast-and-crash)', async () => {
    const { fetchImpl } = makeFetch(
      () => new Response('<html>not json</html>', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    const result = await fetchShareSnapshot('TOK', fetchImpl)
    expect(result.kind).toBe('error')
  })

  it('maps a schema-invalid 200 body → error (strict validation, leaked field)', async () => {
    // A field the curator started leaking (strictObject) must fail validation
    // and land in `error`, never reach the viewer as `ok`.
    const { fetchImpl } = makeFetch(
      () => json({ car: { ...SNAPSHOT.car, salePrice: '9000' }, expiresAt: null }),
    )
    const result = await fetchShareSnapshot('TOK', fetchImpl)
    expect(result.kind).toBe('error')
  })

  it('maps a 200 body missing a required field → error (not ok)', async () => {
    const carWithoutMake: Record<string, unknown> = { ...SNAPSHOT.car }
    delete carWithoutMake.make
    const { fetchImpl } = makeFetch(() => json({ car: carWithoutMake, expiresAt: null }))
    const result = await fetchShareSnapshot('TOK', fetchImpl)
    expect(result.kind).toBe('error')
  })

  it('maps a 200 body with a wrong-typed field → error (not ok)', async () => {
    const { fetchImpl } = makeFetch(() => json({ car: SNAPSHOT.car, expiresAt: 'soon' }))
    const result = await fetchShareSnapshot('TOK', fetchImpl)
    expect(result.kind).toBe('error')
  })
})

describe('expiryInputToEpochSeconds', () => {
  const now = new Date('2026-06-17T10:00:00')

  it('treats empty input as no expiry (null)', () => {
    expect(expiryInputToEpochSeconds('', now)).toEqual({ ok: true, value: null })
    expect(expiryInputToEpochSeconds('   ', now)).toEqual({ ok: true, value: null })
  })

  it('converts a future date to end-of-day epoch seconds', () => {
    const result = expiryInputToEpochSeconds('2026-12-31', now)
    expect(result.ok).toBe(true)
    if (result.ok) {
      const expected = Math.floor(new Date('2026-12-31T23:59:59').getTime() / 1000)
      expect(result.value).toBe(expected)
      expect(result.value).toBeGreaterThan(Math.floor(now.getTime() / 1000))
    }
  })

  it('rejects a past date', () => {
    expect(expiryInputToEpochSeconds('2020-01-01', now)).toEqual({ ok: false, error: expect.any(String) })
  })

  it('rejects an unparseable date', () => {
    const result = expiryInputToEpochSeconds('not-a-date', now)
    expect(result.ok).toBe(false)
  })
})

describe('copyToClipboard', () => {
  it('writes the exact text and reports success', async () => {
    const writeText = vi.fn(async () => {})
    expect(await copyToClipboard('https://x/#/share/TOK', { writeText })).toBe(true)
    expect(writeText).toHaveBeenCalledWith('https://x/#/share/TOK')
  })

  it('reports failure when the clipboard rejects', async () => {
    const writeText = vi.fn(async () => { throw new Error('denied') })
    expect(await copyToClipboard('x', { writeText })).toBe(false)
  })

  it('reports failure when no clipboard is available', async () => {
    expect(await copyToClipboard('x', undefined)).toBe(false)
  })
})

describe('recordShareView — once per browser session per token', () => {
  it('POSTs the view path WITHOUT credentials and marks the session on first call', async () => {
    const { fetchImpl, calls } = makeFetch(() => json({ ok: true }))
    const storage = makeStorage()
    await recordShareView('TOK', { fetchImpl, storage })

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(shareViewPath('TOK'))
    expect(calls[0].init?.method).toBe('POST')
    expect(calls[0].init?.credentials).toBe('omit') // public — no session
    // The guard key is set so a later call this session is a no-op.
    expect(storage.map.get(viewedSessionKey('TOK'))).toBe('1')
  })

  it('does NOT re-POST when the token is already marked viewed this session (refresh)', async () => {
    const { fetchImpl, calls } = makeFetch(() => json({ ok: true }))
    const storage = makeStorage({ [viewedSessionKey('TOK')]: '1' })
    await recordShareView('TOK', { fetchImpl, storage })
    expect(calls).toHaveLength(0)
  })

  it('fires exactly once across two calls in the same session (guard set before fetch)', async () => {
    const { fetchImpl, calls } = makeFetch(() => json({ ok: true }))
    const storage = makeStorage()
    await recordShareView('TOK', { fetchImpl, storage })
    await recordShareView('TOK', { fetchImpl, storage })
    expect(calls).toHaveLength(1)
  })

  it('still pings a DIFFERENT token (the guard is per-token)', async () => {
    const { fetchImpl, calls } = makeFetch(() => json({ ok: true }))
    const storage = makeStorage({ [viewedSessionKey('TOK')]: '1' })
    await recordShareView('OTHER', { fetchImpl, storage })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(shareViewPath('OTHER'))
  })

  it('never throws/rejects when the network fails (fire-and-forget), but still marks the session', async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => {
      throw new TypeError('offline')
    })
    const storage = makeStorage()
    await expect(recordShareView('TOK', { fetchImpl, storage })).resolves.toBeUndefined()
    expect(storage.map.get(viewedSessionKey('TOK'))).toBe('1')
  })

  it('proceeds to ping when sessionStorage throws (private mode / disabled)', async () => {
    const { fetchImpl, calls } = makeFetch(() => json({ ok: true }))
    const throwing: SessionStorageLike = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    await expect(recordShareView('TOK', { fetchImpl, storage: throwing })).resolves.toBeUndefined()
    expect(calls).toHaveLength(1) // counts rather than silently skipping
  })

  it('does nothing for an empty token', async () => {
    const { fetchImpl, calls } = makeFetch(() => json({ ok: true }))
    await recordShareView('', { fetchImpl, storage: makeStorage() })
    expect(calls).toHaveLength(0)
  })
})

describe('formatViewCount — owner-list display', () => {
  it('singularizes exactly one view', () => {
    expect(formatViewCount(1)).toBe('1 view')
  })

  it('pluralizes zero and many', () => {
    expect(formatViewCount(0)).toBe('0 views')
    expect(formatViewCount(12)).toBe('12 views')
  })

  it('coerces missing/negative/non-finite/fractional counts to a clean integer', () => {
    expect(formatViewCount(-5)).toBe('0 views')
    expect(formatViewCount(Number.NaN)).toBe('0 views')
    expect(formatViewCount(3.9)).toBe('3 views')
  })
})
