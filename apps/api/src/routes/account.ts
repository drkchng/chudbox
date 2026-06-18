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
import {
  ACCOUNT_DELETE_PATH,
  ACCOUNT_DISPLAY_PATH,
  updateAccountDisplaySchema,
} from '@chudbox/shared'
import type { AccountDeleteResponse, AccountDisplaySettings } from '@chudbox/shared'
import { createAuth } from '../auth'
import { user } from '../db/schema'

export const accountApi = new Hono<{ Bindings: Env }>()

/** The update body is a tiny `{ name?, showOwnerName? }` JSON object. */
const MAX_BODY_BYTES = 4096

/** R2 list/delete page size. A single list page returns <= this many keys, and
 * R2 batch-delete accepts up to 1000 keys per call, so one delete per page is
 * always within bounds. */
const R2_PURGE_PAGE = 1000

function db(env: Env) {
  return drizzle(env.DB)
}

async function getSessionUserId(env: Env, headers: Headers): Promise<string | null> {
  const session = await createAuth(env).api.getSession({ headers })
  return session?.user.id ?? null
}

function garageStub(env: Env, userId: string) {
  return env.GARAGE_DO.get(env.GARAGE_DO.idFromName(userId))
}

/**
 * Delete EVERY R2 object under `u/<userId>/` — the user's entire image prefix.
 *
 * R2 `list()` is PAGINATED (it returns at most ~1000 keys and a `truncated`
 * flag + cursor), so we loop on the cursor until the listing is exhausted and
 * batch-delete each page. Idempotent: deleting an absent key is a no-op and an
 * empty prefix lists nothing, so a retry after a partial failure is safe.
 *
 * The prefix carries a TRAILING SLASH (`u/<userId>/`) so it can only ever match
 * this user's own keys — never a prefix-sibling like `u/<userId>extra/…`. The
 * userId is the verified-session id derived by the caller (never client input),
 * the same value buildPhotoKey embeds, so this bounds the purge to exactly the
 * objects the upload route could have written for this user.
 */
async function purgeUserImages(bucket: R2Bucket, userId: string): Promise<number> {
  // The canonical photo key is `u/<userId>/<carId>/<photoId>.<ext>`
  // (buildPhotoKey, contracts.ts), so `u/<userId>/` is the user's whole image
  // prefix. The trailing slash keeps it from matching a prefix-sibling.
  const prefix = `u/${userId}/`
  let cursor: string | undefined
  let deleted = 0
  for (;;) {
    const listed = await bucket.list({ prefix, cursor, limit: R2_PURGE_PAGE })
    const keys = listed.objects.map((object) => object.key)
    if (keys.length > 0) {
      await bucket.delete(keys)
      deleted += keys.length
    }
    if (!listed.truncated) break
    cursor = listed.cursor
  }
  return deleted
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

// ── POST: delete the caller's account + ALL their data (G4) ──
// Right-to-erasure (Law 25). Destructive + OWN-ACCOUNT-ONLY: the target userId
// comes ONLY from the validated session. No request body is read at all, so
// there is nothing a client could send to select WHOSE account is deleted — the
// IDOR surface is closed by construction, not by an ownership check.
accountApi.post(ACCOUNT_DELETE_PATH, async (c) => {
  const userId = await getSessionUserId(c.env, c.req.raw.headers)
  if (!userId) return c.json({ error: 'Unauthorized' }, 401)

  // PURGE-FIRST: clear the stores D1's FK cascade can't reach BEFORE deleting the
  // user row, so no orphaned garage/images can survive a row-delete race. Both
  // purges are idempotent, so a retry after a partial failure is safe.
  //
  //  1. Durable Object — the user's whole garage MergeableStore + its DO SQLite
  //     (cars, photo metadata, mileage, savedBuilds incl. bearer tokens, …).
  await garageStub(c.env, userId).purgeAll()
  //  2. R2 — every image object under `u/<userId>/` (paginated list + delete).
  await purgeUserImages(c.env.BUCKET, userId)

  //  3. D1 — delete the `user` row. The FK ON DELETE CASCADE removes session,
  //     account, and share_links in the same statement (schema.ts: all three
  //     user FKs are ON DELETE CASCADE). Cascading away the session rows also
  //     invalidates the caller's own cookie server-side — they are signed out.
  await db(c.env).delete(user).where(eq(user.id, userId))

  // BACKUP-RETENTION CAVEAT (Law 25 — disclose the window in the privacy policy):
  // the LIVE stores are now empty, but Cloudflare D1 Time-Travel and any R2/DO
  // point-in-time backups may retain copies for the platform's bounded window.
  // Nothing in this Worker can purge those; they age out on the provider's clock.
  const body: AccountDeleteResponse = { deleted: true }
  return c.json(body)
})
