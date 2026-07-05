/**
 * Image upload + delete routes (M3 — image pipeline server side).
 *
 * Auth pattern is identical to /sync and /api/sync/* (routes/sync.ts): the
 * Better Auth session is validated FIRST, and the R2 key prefix is derived
 * ONLY from the verified session's userId — never trusted from the client
 * (buildPhotoKey takes `userId` from the session). Logged-OUT clients never
 * reach here: photos stay local base64 until sign-in (BACKEND_PLAN.md "Image
 * pipeline"; contracts.ts header).
 *
 * Transport is binding-proxy upload, NOT presigned PUT: the few-hundred-KB
 * downscaled files sit far below R2's request-body cap, Worker CPU billing
 * excludes I/O wait, and env.BUCKET.put needs no S3 token and no bucket CORS
 * (verified research fact #2). The bytes are streamed/handed straight to R2.
 *
 * Content validation does NOT trust the client-declared Content-Type: the file
 * bytes are sniffed by their magic bytes (sniffImageType) and only image/webp
 * or image/jpeg are accepted; the STORED content type and key extension are
 * derived from the SNIFFED type, so a mislabeled / Safari-PNG blob can never be
 * stored as .webp/.jpg. Size is bounded BEFORE the body is buffered (a finite
 * Content-Length within the cap is required), and intrinsic dimensions are
 * re-checked from the bytes (best-effort) against a generous ceiling.
 */
import { Hono } from 'hono'
import {
  FREE_IMAGE_POLICY,
  UPLOAD_DELETE_PATH,
  UPLOAD_FILE_FIELD,
  UPLOAD_PATH,
  buildPhotoKey,
  extForContentType,
  parsePhotoKey,
  readImageDimensions,
  sniffImageType,
  uploadFieldsSchema,
} from '@chudbox/shared'
import type { UploadResponse } from '@chudbox/shared'
import { z } from 'zod'
import { createAuth } from '../auth'

export const uploadsApi = new Hono<{ Bindings: Env }>()

/**
 * Delete-on-replace/tombstone endpoint. The web client POSTs the old r2Key(s)
 * here whenever it removes a photo or replaces a photo row's r2Key, so the R2
 * object is deleted in lock-step (verified research fact #5: lifecycle rules
 * can't do reference-based GC). Path is derived from UPLOAD_PATH so it stays in
 * sync; the client targets `${UPLOAD_PATH}/delete`.
 *
 * The account-deletion prefix purge of `u/<userId>/` now lives in routes/
 * account.ts (purgeUserImages, called by POST /api/account/delete — G4). Still
 * DEFERRED (do NOT build here): a periodic reconciliation sweep for orphans this
 * hook misses (e.g. a tab that crashes between row-delete and delete-call) —
 * cron/lifecycle work outside M3 (BACKEND_PLAN.md Risk #8 / db/schema.md §3).
 *
 * UPLOAD_DELETE_PATH itself moved to shared contracts.ts so the web client
 * imports the SAME constant it POSTs to (the original client shipped calling a
 * nonexistent `DELETE /img/<key>` precisely because this path wasn't shared).
 */

/**
 * Defensive cap on a single uploaded image's bytes. Decoupled from the FREE
 * ImagePolicy's maxEdgePx (a future paid tier raising the cap needs no change
 * here) and far below R2's request-body limit — purely an abuse/DoS bound.
 */
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
/** Multipart envelope + the small text fields, on top of the file itself. */
const UPLOAD_BODY_SLACK_BYTES = 64 * 1024
/** R2 batch-delete accepts up to 1000 keys per call. */
const MAX_DELETE_KEYS = 1000
/** The delete body is a small JSON array of keys; bound it generously. */
const MAX_DELETE_BODY_BYTES = 256 * 1024

/**
 * Reject only CONFIDENTLY-parsed dimensions that clearly blow past anything the
 * client encoder could legitimately produce. The client downscales to
 * maxEdgePx (1600); the ×4 margin (6400 px) keeps the check from ever
 * false-rejecting a valid upload while still catching an absurd decode-bomb
 * descriptor. A header we CAN'T parse is allowed through (the size cap + magic
 * bytes already bound abuse).
 */
const MAX_STORED_EDGE_PX = FREE_IMAGE_POLICY.maxEdgePx * 4

const deleteUploadsSchema = z.strictObject({
  r2Keys: z.array(z.string().min(1)).min(1).max(MAX_DELETE_KEYS),
})

interface DeleteUploadsResponse {
  deleted: number
}

async function getSessionUserId(
  env: Env,
  headers: Headers,
): Promise<string | null> {
  const session = await createAuth(env).api.getSession({ headers })
  return session?.user.id ?? null
}

/**
 * Classify the Content-Length header for a MEMORY-BOUNDED body read. A
 * legitimate same-origin fetch of a FormData/Blob/JSON body always sets a
 * finite numeric Content-Length, so we require one and bound it BEFORE the body
 * is touched. A chunked / absent / non-numeric length (which formData()/json()
 * would otherwise buffer up to the ~100 MB platform cap before any size check)
 * is 'missing'; an over-cap length is 'too-large'; otherwise 'ok'.
 */
function classifyContentLength(
  header: string | undefined,
  maxBytes: number,
): 'missing' | 'too-large' | 'ok' {
  if (header === undefined || !/^\d+$/.test(header)) return 'missing'
  return Number(header) > maxBytes ? 'too-large' : 'ok'
}

uploadsApi.post(UPLOAD_PATH, async (c) => {
  const userId = await getSessionUserId(c.env, c.req.raw.headers)
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  // Memory bound BEFORE buffering: require a finite Content-Length within the
  // cap. The real same-origin client always sets one; a chunked / absent /
  // non-numeric length would let formData() buffer the whole body first.
  const lengthCheck = classifyContentLength(
    c.req.header('content-length'),
    MAX_UPLOAD_BYTES + UPLOAD_BODY_SLACK_BYTES,
  )
  if (lengthCheck === 'missing') {
    return c.json({ error: 'Content-Length required' }, 411)
  }
  if (lengthCheck === 'too-large') {
    return c.json({ error: 'Payload too large' }, 413)
  }

  let form: FormData
  try {
    form = await c.req.raw.formData()
  } catch {
    return c.json({ error: 'Expected multipart/form-data' }, 400)
  }

  const file = form.get(UPLOAD_FILE_FIELD)
  if (!(file instanceof File)) {
    return c.json({ error: `Missing "${UPLOAD_FILE_FIELD}" file field` }, 400)
  }
  if (file.size === 0) {
    return c.json({ error: 'Empty file' }, 400)
  }
  // Defense-in-depth behind the Content-Length guard (a same-origin client's
  // declared length is honest, but never rely on it for the authoritative bound).
  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json({ error: 'Payload too large' }, 413)
  }

  // Buffering is now bounded. Trust the BYTES, not the declared Content-Type:
  // sniff the magic bytes and reject anything that isn't really webp/jpeg. The
  // stored content type + key extension derive from the SNIFFED type, so a
  // mislabeled / Safari-PNG blob can never be stored as .webp/.jpg.
  const bytes = new Uint8Array(await file.arrayBuffer())
  const contentType = sniffImageType(bytes)
  if (!contentType) {
    return c.json(
      { error: 'Only image/webp or image/jpeg uploads are accepted' },
      415,
    )
  }

  // Best-effort dimension re-check (the Worker has no image decoder). Only
  // reject when the size is CONFIDENTLY parsed AND clearly over the ceiling; an
  // unparseable header is allowed through (conservative — wrongly rejecting a
  // valid image is worse than skipping the check).
  const dims = readImageDimensions(bytes, contentType)
  if (dims && Math.max(dims.width, dims.height) > MAX_STORED_EDGE_PX) {
    return c.json({ error: 'Image dimensions exceed the allowed maximum' }, 422)
  }

  const fields = uploadFieldsSchema.safeParse({
    carId: form.get('carId'),
    photoId: form.get('photoId'),
    width: form.get('width'),
    height: form.get('height'),
    caption: form.get('caption') ?? undefined,
  })
  if (!fields.success) {
    return c.json(
      { error: fields.error.issues[0]?.message ?? 'Invalid fields' },
      400,
    )
  }
  const { carId, photoId, width, height } = fields.data

  // userId from the SESSION (never the client); ext reflects the SNIFFED
  // format, so the key suffix is .webp/.jpg accordingly (imagePolicy.ts).
  const r2Key = buildPhotoKey({
    userId,
    carId,
    photoId,
    ext: extForContentType(contentType),
  })
  // The schema already constrains carId/photoId to URL-safe segments; assert
  // the built key is genuinely parseable AND owned by THIS session before the
  // write, so a key that /img can't serve and delete can't reach (an
  // unreclaimable self-orphan) can never be created.
  const parsedKey = parsePhotoKey(r2Key)
  if (!parsedKey || parsedKey.userId !== userId) {
    return c.json({ error: 'Invalid upload target' }, 400)
  }

  await c.env.BUCKET.put(r2Key, bytes, { httpMetadata: { contentType } })

  // The Worker has no image decoder, so the row records the client's intended
  // downscale dimensions (computeTargetSize output, validated as positive ints)
  // rather than re-measuring the bytes. Documented in contracts.ts.
  const response: UploadResponse = { r2Key, width, height, contentType }
  return c.json(response)
})

uploadsApi.post(UPLOAD_DELETE_PATH, async (c) => {
  const userId = await getSessionUserId(c.env, c.req.raw.headers)
  if (!userId) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  // Same memory bound as the upload route: require a finite Content-Length
  // within the cap before reading the JSON body (a chunked / absent length
  // would otherwise let json() buffer it unbounded).
  const lengthCheck = classifyContentLength(
    c.req.header('content-length'),
    MAX_DELETE_BODY_BYTES,
  )
  if (lengthCheck === 'missing') {
    return c.json({ error: 'Content-Length required' }, 411)
  }
  if (lengthCheck === 'too-large') {
    return c.json({ error: 'Payload too large' }, 413)
  }
  let body: unknown
  try {
    body = await c.req.raw.json()
  } catch {
    return c.json({ error: 'Body is not valid JSON' }, 400)
  }
  const parsed = deleteUploadsSchema.safeParse(body)
  if (!parsed.success) {
    return c.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid body' },
      400,
    )
  }

  // Authorize EVERY key against the session prefix before deleting ANY: a
  // malformed key or one outside `u/<userId>/` fails the whole request, so a
  // confused client can't silently no-op or reach another user's objects.
  for (const key of parsed.data.r2Keys) {
    const pk = parsePhotoKey(key)
    if (!pk || pk.userId !== userId) {
      return c.json({ error: 'Forbidden: key not owned by session' }, 403)
    }
  }
  // R2 batch delete is idempotent (deleting an absent key is a no-op), so
  // delete-on-replace can fire repeatedly without error.
  await c.env.BUCKET.delete(parsed.data.r2Keys)

  const response: DeleteUploadsResponse = { deleted: parsed.data.r2Keys.length }
  return c.json(response)
})
