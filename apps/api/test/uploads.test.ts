// M3 image-pipeline route tests against the REAL Worker + emulated R2 binding
// (vitest-pool-workers). Covers POST /api/uploads (binding-proxy upload),
// GET /img/<key> (owner-only serving) and POST /api/uploads/delete
// (delete-on-replace/tombstone hook).
import { SELF, env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  UPLOAD_FILE_FIELD,
  UPLOAD_PATH,
  buildPhotoKey,
  imgPath,
} from '@chudbox/shared'
import type { UploadResponse } from '@chudbox/shared'

const BASE = 'https://example.com'
const UPLOAD_DELETE_PATH = `${UPLOAD_PATH}/delete`

// ── Magic-byte fixtures ─────────────────────────────────────
// The route sniffs the BYTES (not the declared type), so test payloads carry
// real headers. All are tiny but parse to small dimensions (20×10), well under
// the route's reject ceiling (maxEdgePx×4 = 6400).
/** RIFF/WEBP + a simple VP8 lossy keyframe sized 20×10. */
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x1e, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, // RIFF..WEBP
  0x56, 0x50, 0x38, 0x20, 0x0e, 0x00, 0x00, 0x00, // 'VP8 ' chunk size
  0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a, 0x14, 0x00, 0x0a, 0x00, // keyframe 20×10
])
/** SOI + SOF0 frame sized 20×10. */
const JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x0a, 0x00, 0x14,
])
/** PNG signature + IHDR sized 20×10 (a format the route must NOT store). */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x14, 0x00, 0x00, 0x00, 0x0a,
])
/** VP8X webp declaring a 10000×10000 canvas (confidently over the ceiling). */
const OVERSIZE_WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, // RIFF..WEBP
  0x56, 0x50, 0x38, 0x58, 0x0a, 0x00, 0x00, 0x00, // 'VP8X' chunk size
  0x00, 0x00, 0x00, 0x00, // flags + reserved
  0x0f, 0x27, 0x00, 0x0f, 0x27, 0x00, // width-1/height-1 = 9999 → 10000²
])

function defaultBytesFor(type: string): Uint8Array {
  if (type === 'image/jpeg') return JPEG_BYTES
  if (type === 'image/webp') return WEBP_BYTES
  return new Uint8Array([1, 2, 3, 4, 5]) // non-image bytes (rejected by the sniff)
}

// ── Auth helper ─────────────────────────────────────────────
// ONE session for the whole file (Better Auth rate-limits sign-up/sign-in
// per endpoint; the file's isolated-storage frame persists beforeAll writes
// across this file's tests, while each test's R2/D1 mutations roll back).
let session: { cookie: string; userId: string }

beforeAll(async () => {
  const email = 'img-user@example.com'
  const password = 'correct-horse-battery'
  const signUp = await SELF.fetch(`${BASE}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name: 'Image Tester' }),
  })
  expect(signUp.ok).toBe(true)
  const { user } = (await signUp.json()) as { user: { id: string } }
  await env.DB.prepare('UPDATE user SET email_verified = 1 WHERE email = ?')
    .bind(email)
    .run()
  const signIn = await SELF.fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  expect(signIn.ok).toBe(true)
  const cookie = (signIn.headers.get('set-cookie') ?? '').match(
    /(?:__Secure-)?better-auth\.session_token=[^;]+/,
  )?.[0]
  if (!cookie) throw new Error('no session cookie after sign-in')
  session = { cookie, userId: user.id }
})

// ── Upload helper ───────────────────────────────────────────
// A `null` field is omitted from the FormData (drives the missing-field tests);
// otherwise the default keeps a valid happy-path request.
type Field = string | null
interface UploadOpts {
  cookie?: string
  bytes?: Uint8Array
  type?: Field // null = omit the file part entirely
  carId?: Field
  photoId?: Field
  width?: Field
  height?: Field
  caption?: string
}

async function postUpload(opts: UploadOpts = {}): Promise<Response> {
  const fd = new FormData()
  if (opts.type !== null) {
    const type = opts.type ?? 'image/webp'
    const bytes = opts.bytes ?? defaultBytesFor(type)
    fd.append(UPLOAD_FILE_FIELD, new Blob([bytes], { type }), 'photo')
  }
  if (opts.carId !== null) fd.append('carId', opts.carId ?? 'car-1')
  if (opts.photoId !== null) fd.append('photoId', opts.photoId ?? 'photo-1')
  if (opts.width !== null) fd.append('width', opts.width ?? '1600')
  if (opts.height !== null) fd.append('height', opts.height ?? '1200')
  if (opts.caption !== undefined) fd.append('caption', opts.caption)
  return SELF.fetch(`${BASE}${UPLOAD_PATH}`, {
    method: 'POST',
    headers: { cookie: opts.cookie ?? session.cookie },
    body: fd,
  })
}

// ── Auth gating ─────────────────────────────────────────────

describe('auth gating', () => {
  it('rejects upload / serve / delete without a session', async () => {
    const upload = await SELF.fetch(`${BASE}${UPLOAD_PATH}`, {
      method: 'POST',
      body: new FormData(),
    })
    expect(upload.status).toBe(401)

    const serve = await SELF.fetch(
      `${BASE}${imgPath('u/someone/car/photo.webp')}`,
    )
    expect(serve.status).toBe(401)

    const del = await SELF.fetch(`${BASE}${UPLOAD_DELETE_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ r2Keys: ['u/someone/car/photo.webp'] }),
    })
    expect(del.status).toBe(401)
  })
})

// ── Upload ──────────────────────────────────────────────────

describe('POST /api/uploads', () => {
  it('stores webp bytes under a session-derived key and returns the row cells', async () => {
    const bytes = WEBP_BYTES
    const res = await postUpload({
      bytes,
      type: 'image/webp',
      carId: 'car-A',
      photoId: 'photo-A',
      width: '1600',
      height: '1067',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as UploadResponse

    const expectedKey = buildPhotoKey({
      userId: session.userId,
      carId: 'car-A',
      photoId: 'photo-A',
      ext: 'webp',
    })
    expect(body).toStrictEqual({
      r2Key: expectedKey,
      width: 1600,
      height: 1067,
      contentType: 'image/webp',
    })

    // Bytes + content-type really landed in R2 under that key.
    const object = await env.BUCKET.get(expectedKey)
    expect(object).not.toBeNull()
    expect(object?.httpMetadata?.contentType).toBe('image/webp')
    expect(new Uint8Array(await object!.arrayBuffer())).toStrictEqual(bytes)
  })

  it('uses a .jpg key for a jpeg upload (ext reflects the real format)', async () => {
    const res = await postUpload({
      type: 'image/jpeg',
      carId: 'car-A',
      photoId: 'photo-jpg',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as UploadResponse
    expect(body.contentType).toBe('image/jpeg')
    expect(body.r2Key.endsWith('.jpg')).toBe(true)
    expect(body.r2Key).toBe(
      buildPhotoKey({
        userId: session.userId,
        carId: 'car-A',
        photoId: 'photo-jpg',
        ext: 'jpg',
      }),
    )
  })

  it('rejects a non-webp/jpeg content type (415)', async () => {
    const res = await postUpload({ type: 'image/png' })
    expect(res.status).toBe(415)
  })

  it('rejects a missing file part (400)', async () => {
    const res = await postUpload({ type: null })
    expect(res.status).toBe(400)
  })

  it('rejects a missing required field (400)', async () => {
    const res = await postUpload({ width: null })
    expect(res.status).toBe(400)
  })

  it('rejects an oversized body before buffering it (413)', async () => {
    // > MAX_UPLOAD_BYTES (15 MiB) + slack (64 KiB): the content-length guard
    // returns 413 without parsing the multipart body.
    const huge = new Uint8Array(15 * 1024 * 1024 + 64 * 1024 + 1024)
    const res = await postUpload({ bytes: huge, type: 'image/webp' })
    expect(res.status).toBe(413)
  })

  it('rejects a chunked / no-Content-Length body before buffering it (411)', async () => {
    // A ReadableStream body is sent chunked → NO Content-Length. The memory
    // bound must hold by rejecting (411) BEFORE formData() drains the stream
    // (which, fully buffered, would be 256 MiB — an OOM on a 128 MiB isolate).
    let pulled = 0
    const oneMiB = new Uint8Array(1024 * 1024)
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        controller.enqueue(oneMiB)
        if (pulled >= 256) controller.close()
      },
    })
    const res = await SELF.fetch(`${BASE}${UPLOAD_PATH}`, {
      method: 'POST',
      headers: {
        cookie: session.cookie,
        'content-type': 'multipart/form-data; boundary=----chudbox',
      },
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })
    expect(res.status).toBe(411)
    // The body stream was never drained → the memory bound held.
    expect(pulled).toBeLessThan(8)
  })

  it("rejects a carId with a slash (400) — can't strand an unreclaimable object", async () => {
    const res = await postUpload({ carId: 'a/b' })
    expect(res.status).toBe(400)
  })

  it("rejects a path-traversal carId '..' (400)", async () => {
    const res = await postUpload({ carId: '..' })
    expect(res.status).toBe(400)
  })

  it('rejects a PNG body mislabeled as image/webp (415 — sniffed, not declared)', async () => {
    const res = await postUpload({ bytes: PNG_BYTES, type: 'image/webp' })
    expect(res.status).toBe(415)
  })

  it('stores the SNIFFED type even when the declared type lies (jpeg bytes as webp)', async () => {
    // Declared image/webp but the bytes are JPEG → stored as image/jpeg / .jpg.
    const res = await postUpload({
      bytes: JPEG_BYTES,
      type: 'image/webp',
      carId: 'car-sniff',
      photoId: 'photo-sniff',
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as UploadResponse
    expect(body.contentType).toBe('image/jpeg')
    expect(body.r2Key.endsWith('.jpg')).toBe(true)
  })

  it('rejects a confidently oversize image (422)', async () => {
    const res = await postUpload({ bytes: OVERSIZE_WEBP_BYTES, type: 'image/webp' })
    expect(res.status).toBe(422)
  })
})

// ── Serve ───────────────────────────────────────────────────

describe('GET /img/<key>', () => {
  it("serves the owner's object with immutable caching and correct bytes", async () => {
    const bytes = WEBP_BYTES
    const up = await postUpload({
      bytes,
      type: 'image/webp',
      carId: 'car-S',
      photoId: 'photo-S',
    })
    expect(up.status).toBe(200)
    const { r2Key } = (await up.json()) as UploadResponse

    const res = await SELF.fetch(`${BASE}${imgPath(r2Key)}`, {
      headers: { cookie: session.cookie },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(res.headers.get('cache-control')).toBe(
      'private, max-age=31536000, immutable',
    )
    expect(res.headers.get('etag')).toBeTruthy()
    expect(new Uint8Array(await res.arrayBuffer())).toStrictEqual(bytes)
  })

  it('404s a well-formed, owned key with no stored object', async () => {
    const key = buildPhotoKey({
      userId: session.userId,
      carId: 'car-missing',
      photoId: 'never-uploaded',
      ext: 'webp',
    })
    const res = await SELF.fetch(`${BASE}${imgPath(key)}`, {
      headers: { cookie: session.cookie },
    })
    expect(res.status).toBe(404)
  })

  it("403s a key owned by another user (owner-only in M3)", async () => {
    const foreign = buildPhotoKey({
      userId: 'someone-else',
      carId: 'car-X',
      photoId: 'photo-X',
      ext: 'webp',
    })
    const res = await SELF.fetch(`${BASE}${imgPath(foreign)}`, {
      headers: { cookie: session.cookie },
    })
    expect(res.status).toBe(403)
  })

  it('404s a malformed key', async () => {
    const res = await SELF.fetch(`${BASE}${imgPath('not-a-real-key')}`, {
      headers: { cookie: session.cookie },
    })
    expect(res.status).toBe(404)
  })
})

// ── Delete (delete-on-replace / tombstone hook) ─────────────

describe('POST /api/uploads/delete', () => {
  async function postDelete(r2Keys: unknown): Promise<Response> {
    return SELF.fetch(`${BASE}${UPLOAD_DELETE_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: session.cookie },
      body: JSON.stringify({ r2Keys }),
    })
  }

  it('deletes an owned object so it no longer serves', async () => {
    const up = await postUpload({
      type: 'image/webp',
      carId: 'car-D',
      photoId: 'photo-D',
    })
    const { r2Key } = (await up.json()) as UploadResponse
    expect(await env.BUCKET.get(r2Key)).not.toBeNull()

    const del = await postDelete([r2Key])
    expect(del.status).toBe(200)
    expect(await del.json()).toStrictEqual({ deleted: 1 })

    expect(await env.BUCKET.get(r2Key)).toBeNull()
    const serve = await SELF.fetch(`${BASE}${imgPath(r2Key)}`, {
      headers: { cookie: session.cookie },
    })
    expect(serve.status).toBe(404)
  })

  it('rejects the whole batch if any key is not owned, deleting nothing', async () => {
    const up = await postUpload({
      type: 'image/webp',
      carId: 'car-D2',
      photoId: 'photo-D2',
    })
    const { r2Key } = (await up.json()) as UploadResponse
    const foreign = buildPhotoKey({
      userId: 'someone-else',
      carId: 'c',
      photoId: 'p',
      ext: 'webp',
    })

    const del = await postDelete([r2Key, foreign])
    expect(del.status).toBe(403)
    // The owned object in the same batch must be untouched.
    expect(await env.BUCKET.get(r2Key)).not.toBeNull()
  })

  it('rejects a malformed key (403) and an empty list (400)', async () => {
    expect((await postDelete(['garbage'])).status).toBe(403)
    expect((await postDelete([])).status).toBe(400)
  })

  it('rejects a chunked / no-Content-Length delete body before reading it (411)', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('{"r2Keys":["x"]}'))
        controller.close()
      },
    })
    const res = await SELF.fetch(`${BASE}${UPLOAD_DELETE_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: session.cookie },
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })
    expect(res.status).toBe(411)
  })
})
