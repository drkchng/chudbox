/**
 * Account display-settings routes (DEC-10 — owner display name on shares).
 *
 * Two session-authed surfaces on the SAME path:
 *
 *  • GET  /api/account/display — read the caller's { name, showOwnerName }.
 *  • POST /api/account/display — update the display NAME (= user.name, NEVER the
 *    email) and/or the `show_owner_name` consent.
 *
 * Both live on the D1 `user` row. This is the ONE place the owner edits them; it
 * NEVER touches the Durable Object (the golden split — user identity lives in
 * D1, garage content lives in the DO). The public share route reads these same
 * two columns server-side, consent-gated, when injecting `ownerName` into a
 * snapshot — so this route is the write side of that read.
 *
 * The write is a NARROW, additive drizzle update (set only the named columns +
 * updatedAt) — never a rebuild of `user` (which would fire the ON DELETE CASCADE
 * into session/account/share_links). `show_owner_name` is a plain D1 column
 * (Better Auth tolerates the extra defaulted field), so we persist it directly
 * here rather than threading it through Better Auth's additionalFields.
 */
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { ACCOUNT_DISPLAY_PATH, updateAccountDisplaySchema } from '@chudbox/shared'
import type { AccountDisplaySettings } from '@chudbox/shared'
import { createAuth } from '../auth'
import { user } from '../db/schema'

export const accountApi = new Hono<{ Bindings: Env }>()

/** The update body is a tiny `{ name?, showOwnerName? }` JSON object. */
const MAX_BODY_BYTES = 4096

function db(env: Env) {
  return drizzle(env.DB)
}

async function getSessionUserId(env: Env, headers: Headers): Promise<string | null> {
  const session = await createAuth(env).api.getSession({ headers })
  return session?.user.id ?? null
}

/** Read back the authoritative { name, showOwnerName } for one user. */
async function readDisplay(env: Env, userId: string): Promise<AccountDisplaySettings | null> {
  const rows = await db(env)
    .select({ name: user.name, showOwnerName: user.showOwnerName })
    .from(user)
    .where(eq(user.id, userId))
  const row = rows[0]
  if (!row) return null
  return { name: row.name, showOwnerName: row.showOwnerName }
}

// ── GET: read current display settings ──────────────────────
accountApi.get(ACCOUNT_DISPLAY_PATH, async (c) => {
  const userId = await getSessionUserId(c.env, c.req.raw.headers)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)
  const display = await readDisplay(c.env, userId)
  if (!display) return c.json({ error: 'Account not found' }, 404)
  return c.json(display)
})

// ── POST: update display name and/or consent ────────────────
accountApi.post(ACCOUNT_DISPLAY_PATH, async (c) => {
  const userId = await getSessionUserId(c.env, c.req.raw.headers)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)

  // Memory-bounded body read BEFORE buffering (mirrors the share-create guard):
  // require a finite numeric Content-Length within the small JSON cap.
  const lengthHeader = c.req.header('content-length')
  if (lengthHeader === undefined || !/^\d+$/.test(lengthHeader)) {
    return c.json({ error: 'Content-Length required' }, 411)
  }
  if (Number(lengthHeader) > MAX_BODY_BYTES) {
    return c.json({ error: 'Payload too large' }, 413)
  }
  let raw: unknown
  try {
    raw = JSON.parse(await c.req.raw.text())
  } catch {
    return c.json({ error: 'Body is not valid JSON' }, 400)
  }
  const parsed = updateAccountDisplaySchema.safeParse(raw)
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, 400)
  }

  // NARROW, additive update — only the named columns + updatedAt. Never rebuilds
  // `user` (which would cascade-delete session/account/share_links).
  const patch: { name?: string; showOwnerName?: boolean; updatedAt: Date } = {
    updatedAt: new Date(),
  }
  if (parsed.data.name !== undefined) patch.name = parsed.data.name
  if (parsed.data.showOwnerName !== undefined) patch.showOwnerName = parsed.data.showOwnerName
  await db(c.env).update(user).set(patch).where(eq(user.id, userId))

  const display = await readDisplay(c.env, userId)
  if (!display) return c.json({ error: 'Account not found' }, 404)
  return c.json(display)
})
