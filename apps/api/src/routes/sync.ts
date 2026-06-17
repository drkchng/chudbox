/**
 * Session-authed sync seed/clear/meta routes (M2).
 *
 * Same auth pattern as /sync: the Better Auth session is validated FIRST, and
 * the Durable Object is addressed ONLY via GARAGE_DO.idFromName(verified
 * userId) — never from client input. The GarageDO RPC methods have no other
 * ingress (the namespace binding is reachable only from this Worker).
 *
 * Bodies are zod-validated against the shared contracts and bounded in size;
 * the chunk payload itself is decoded + structurally validated again INSIDE
 * the DO (defense in depth — see seed.ts/isSeedChunk).
 */
import { Hono } from 'hono'
import {
  MAX_SEED_BODY_BYTES,
  SYNC_CLEAR_PATH,
  SYNC_META_PATH,
  SYNC_SEED_PATH,
  clearGarageRequestSchema,
  seedChunkRequestSchema,
} from '@chudbox/shared'
import type { SeedChunkResponse } from '@chudbox/shared'
import { createAuth } from '../auth'

export const syncApi = new Hono<{ Bindings: Env }>()

async function getSessionUserId(
  env: Env,
  headers: Headers,
): Promise<string | null> {
  const session = await createAuth(env).api.getSession({ headers })
  return session?.user.id ?? null
}

function garageStub(env: Env, userId: string) {
  return env.GARAGE_DO.get(env.GARAGE_DO.idFromName(userId))
}

/**
 * Read a JSON body with a hard size bound. Returns the parsed value, or a
 * Response (413/400) when the body is oversized or unparseable. An empty body
 * parses as {} (used by /api/sync/clear).
 */
async function readBoundedJson(
  c: { req: { raw: Request } },
  json: (body: object, status: 400 | 413) => Response,
): Promise<unknown | Response> {
  const declared = Number(c.req.raw.headers.get('content-length') ?? '0')
  if (declared > MAX_SEED_BODY_BYTES) {
    return json({ error: 'Payload too large' }, 413)
  }
  const text = await c.req.raw.text()
  // text.length is UTF-16 units; the content-length check above covers the
  // byte count whenever the client declares one. Belt and braces.
  if (text.length > MAX_SEED_BODY_BYTES) {
    return json({ error: 'Payload too large' }, 413)
  }
  if (text.trim() === '') {
    return {}
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    return json({ error: 'Body is not valid JSON' }, 400)
  }
}

syncApi.post(SYNC_SEED_PATH, async (c) => {
  const userId = await getSessionUserId(c.env, c.req.raw.headers)
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const body = await readBoundedJson(c, (b, s) => c.json(b, s))
  if (body instanceof Response) {
    return body
  }
  const parsed = seedChunkRequestSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, 400)
  }
  const { chunk, index, total } = parsed.data
  const result = await garageStub(c.env, userId).seedGarage(chunk)
  if (!result.applied) {
    return c.json({ error: result.error }, 400)
  }
  const response: SeedChunkResponse = {
    applied: true,
    index,
    total,
    cells: result.cells,
  }
  return c.json(response)
})

syncApi.post(SYNC_CLEAR_PATH, async (c) => {
  const userId = await getSessionUserId(c.env, c.req.raw.headers)
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const body = await readBoundedJson(c, (b, s) => c.json(b, s))
  if (body instanceof Response) {
    return body
  }
  const parsed = clearGarageRequestSchema.safeParse(body)
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, 400)
  }
  return c.json(await garageStub(c.env, userId).clearGarage(parsed.data))
})

syncApi.get(SYNC_META_PATH, async (c) => {
  const userId = await getSessionUserId(c.env, c.req.raw.headers)
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  return c.json(await garageStub(c.env, userId).getMeta())
})
