/**
 * Image serving route (M3) — GET /img/<key...>.
 *
 * Serves stored R2 objects DIRECTLY (verified research fact #1: this is the
 * correctness path; Cloudflare Image Transformations / /cdn-cgi/image is a
 * future, optional enhancement and M3 must not depend on it).
 *
 * Auth pattern matches /sync and /api/sync/*: the Better Auth session is
 * validated FIRST. Authorization is OWNER-ONLY in M3 — the key embeds the
 * owner's userId (parsePhotoKey), and we serve it only when that equals the
 * session user. The DO/store never trusts a client-supplied prefix, and neither
 * do we.
 *
 * M4 SEAM (do NOT build here): token-gated public read. A valid share token
 * will additionally authorize keys belonging to that link's car — bypassing the
 * owner check below — but that authorization lives in routes/share.ts, not in
 * this owner-only route. Leave this check as the sole gate for M3.
 */
import { Hono } from 'hono'
import { IMG_PATH_PREFIX, contentTypeForExt, parsePhotoKey } from '@chudbox/shared'
import { createAuth } from '../auth'

export const imgApi = new Hono<{ Bindings: Env }>()

async function getSessionUserId(
  env: Env,
  headers: Headers,
): Promise<string | null> {
  const session = await createAuth(env).api.getSession({ headers })
  return session?.user.id ?? null
}

imgApi.get(`${IMG_PATH_PREFIX}/*`, async (c) => {
  const userId = await getSessionUserId(c.env, c.req.raw.headers)
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  // imgPath() concatenates the key (URL-safe UUID segments + extension) after
  // '/img/' verbatim, so the raw pathname after the prefix IS the key. URL
  // pathname keeps percent-encoding, so decode defensively (a no-op for a real
  // key) — an attacker can't encode slashes to slip past parsePhotoKey's
  // strict 4-segment check.
  const { pathname } = new URL(c.req.url)
  const rawKey = pathname.slice(IMG_PATH_PREFIX.length + 1)
  let key: string
  try {
    key = decodeURIComponent(rawKey)
  } catch {
    return c.json({ error: 'Bad request' }, 400)
  }

  const parsed = parsePhotoKey(key)
  if (!parsed) {
    return c.json({ error: 'Not found' }, 404)
  }
  if (parsed.userId !== userId) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const object = await c.env.BUCKET.get(key)
  if (!object) {
    return c.json({ error: 'Not found' }, 404)
  }

  const headers = new Headers()
  // Pulls Content-Type (and any other stored httpMetadata) from the object.
  object.writeHttpMetadata(headers)
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', contentTypeForExt(parsed.ext))
  }
  // Each upload mints a fresh photoId, so a key's bytes never change — cache
  // hard. `private`: owner-scoped (M4 public sharing serves via its own route).
  headers.set('Cache-Control', 'private, max-age=31536000, immutable')
  headers.set('ETag', object.httpEtag)
  return new Response(object.body, { headers })
})
