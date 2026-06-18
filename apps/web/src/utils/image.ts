/**
 * Client image pipeline (M3) — the encode + display-resolution seam.
 *
 * encodeForUpload downscales + re-encodes a picked file/blob driven ENTIRELY
 * by the shared FREE_IMAGE_POLICY (the single tier seam — a future paid tier
 * is just a different ImagePolicy passed in). It:
 *   1. decodes with `imageOrientation: 'from-image'` so EXIF rotation is baked
 *      in (and stripped — drawing to a canvas discards all EXIF/GPS metadata,
 *      a privacy win);
 *   2. resizes DURING decode (resizeWidth/Height from computeTargetSize, never
 *      upscaling) so the decoded bitmap — and thus the canvas — stays under
 *      iOS Safari's 16,777,216-px area cap;
 *   3. feature-detects the encoder: it ATTEMPTS WebP and keeps it only if the
 *      produced Blob.type is actually 'image/webp'. Safari/iOS silently ignores
 *      the WebP request on canvas.toBlob and falls back to PNG/JPEG, so the
 *      type arg can never be trusted — when WebP was not honored we re-encode
 *      as JPEG. The ACTUAL produced format decides the stored content type and
 *      the r2Key extension (never hardcoded .webp).
 *
 * The canvas/bitmap factory is injectable so the format-detection logic is unit
 * testable without a DOM (the default factory reads browser globals lazily, so
 * importing this module under the node test runner never touches them).
 *
 * resolvePhotoSrc is the display-time precedence used by every <img>: an
 * uploaded photo (r2Key) serves DIRECTLY from the /img route (the correctness
 * path — never depends on /cdn-cgi/image); otherwise the local base64 side-
 * store payload; otherwise a placeholder. It renders correctly whether r2Key
 * is null (logged-out / pre-upload) or set.
 */
import {
  FREE_IMAGE_POLICY,
  computeTargetSize,
  imgPath,
  readImageDimensions,
  readPngDimensions,
  sniffImageType,
} from '@chudbox/shared'
import type { ImageContentType, ImageDimensions, ImagePolicy, Photo } from '@chudbox/shared'

// ── Encode pipeline ─────────────────────────────────────────

export interface EncodeResult {
  /** The downscaled, re-encoded bytes. */
  blob: Blob
  /** The format ACTUALLY produced (webp iff the encoder honored it; else jpeg). */
  contentType: ImageContentType
  /** Final stored pixel dimensions (== the canvas size). */
  width: number
  height: number
}

interface CreateBitmapOptions {
  imageOrientation?: 'from-image' | 'none'
  resizeWidth?: number
  resizeHeight?: number
  resizeQuality?: 'low' | 'medium' | 'high' | 'pixelated'
}

interface BitmapLike {
  readonly width: number
  readonly height: number
  close?: () => void
}

interface Ctx2DLike {
  drawImage: (image: BitmapLike, dx: number, dy: number) => void
}

interface CanvasLike {
  readonly width: number
  readonly height: number
  getContext: (type: '2d') => Ctx2DLike | null
  toBlob?: (callback: (blob: Blob | null) => void, type?: string, quality?: number) => void
  convertToBlob?: (options?: { type?: string; quality?: number }) => Promise<Blob>
}

export interface EncodeDeps {
  createImageBitmap: (source: Blob, options?: CreateBitmapOptions) => Promise<BitmapLike>
  createCanvas: (width: number, height: number) => CanvasLike
  /**
   * Intrinsic source dimensions for the decode-bomb guard, parsed from the
   * file header WITHOUT decoding. Optional + injectable: the default reads the
   * leading bytes and parses jpeg/webp/png; tests inject a stub to exercise the
   * guard. Returns null when the size can't be determined (caller then falls
   * back to a byte-length bound).
   */
  probeSourceDimensions?: (source: Blob) => Promise<ImageDimensions | null>
}

/**
 * Hard pixel-area cap on a SOURCE we will hand to createImageBitmap. The probe
 * decode allocates full-resolution RGBA (4 bytes/px) BEFORE any downscale, so a
 * ~100 MP source would need ~400 MB and OOM the tab. The stored canvas always
 * stays ≤ maxEdgePx (≤ ~2.6 MP — far under iOS Safari's 16,777,216-px canvas
 * area limit); this much-looser ceiling only guards the transient source
 * allocation. 64 MP (~256 MB RGBA) clears mainstream phone cameras (12–50 MP
 * sensors, incl. 48 MP iPhone/Android JPEGs) while still refusing the genuinely
 * dangerous extremes (108/200 MP) with a clear error rather than an OOM crash.
 * Note: a very-high-MP non-HEIC source above this IS intentionally refused;
 * HEIC sources fall through to the byte-length bound below.
 */
const MAX_SOURCE_DECODE_PIXELS = 64_000_000
/**
 * Fallback bound for source types whose dimensions we can't read from the
 * header (e.g. HEIC/GIF). A coarse proxy — a real picked photo of these types
 * is far smaller — so an absurdly large file is refused before decoding.
 */
const MAX_UNKNOWN_SOURCE_BYTES = 50 * 1024 * 1024
/** Head slice big enough to hold a JPEG SOF past a large EXIF/APP1 segment. */
const SOURCE_HEAD_BYTES = 256 * 1024
/** Thrown (clear message) when a source is too large to safely decode. */
export const TOO_LARGE_IMAGE_MESSAGE = 'too-large image: exceeds the maximum size this device can process'

/**
 * Parse intrinsic source dimensions from header bytes: jpeg/webp via the shared
 * reader, plus a PNG IHDR path (the common non-stored source the file picker
 * yields). Returns null for anything else / unparseable — the caller falls back
 * to a byte-length bound rather than guessing.
 */
export function readSourceDimensions(bytes: Uint8Array): ImageDimensions | null {
  const sniffed = sniffImageType(bytes)
  if (sniffed) return readImageDimensions(bytes, sniffed)
  return readPngDimensions(bytes)
}

/** Default probe: read the file head and parse it (no decode). */
async function defaultProbeSourceDimensions(source: Blob): Promise<ImageDimensions | null> {
  const head = await source.slice(0, SOURCE_HEAD_BYTES).arrayBuffer()
  return readSourceDimensions(new Uint8Array(head))
}

/** Browser factory — globals are read lazily (call time), so node tests that
 *  import this module but inject their own deps never reference them. */
function defaultEncodeDeps(): EncodeDeps {
  return {
    createImageBitmap: (source, options) =>
      (globalThis as unknown as {
        createImageBitmap: (s: Blob, o?: CreateBitmapOptions) => Promise<BitmapLike>
      }).createImageBitmap(source, options),
    createCanvas: (width, height) => {
      if (typeof OffscreenCanvas !== 'undefined') {
        return new OffscreenCanvas(width, height) as unknown as CanvasLike
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      return canvas as unknown as CanvasLike
    },
  }
}

/** Encode one format off the canvas, normalizing OffscreenCanvas.convertToBlob
 *  and HTMLCanvasElement.toBlob and swallowing a hard rejection (some engines
 *  throw on an unsupported type) so the caller can fall through to the next. */
async function canvasToBlob(
  canvas: CanvasLike,
  type: ImageContentType,
  quality: number,
): Promise<Blob | null> {
  try {
    if (typeof canvas.convertToBlob === 'function') {
      return await canvas.convertToBlob({ type, quality })
    }
    if (typeof canvas.toBlob === 'function') {
      const toBlob = canvas.toBlob.bind(canvas)
      return await new Promise<Blob | null>((resolve) => {
        toBlob((blob) => resolve(blob), type, quality)
      })
    }
  } catch {
    return null
  }
  return null
}

/**
 * Downscale + re-encode `source` per `policy`. Returns the produced bytes, the
 * REAL content type, and the final dimensions. Throws only if no encoder is
 * available at all (it always tries JPEG, which every target browser honors).
 */
export async function encodeForUpload(
  source: Blob,
  policy: ImagePolicy = FREE_IMAGE_POLICY,
  deps: EncodeDeps = defaultEncodeDeps(),
): Promise<EncodeResult> {
  // Decode-bomb guard — runs BEFORE any createImageBitmap call. The probe below
  // decodes the source at full resolution (RGBA, 4 bytes/px) before downscaling,
  // so refuse a source whose intrinsic pixel area is absurd. When the header
  // can't be parsed (e.g. HEIC/GIF) fall back to a byte-length bound.
  const probeDims = deps.probeSourceDimensions ?? defaultProbeSourceDimensions
  const srcDims = await probeDims(source)
  if (srcDims) {
    if (srcDims.width * srcDims.height > MAX_SOURCE_DECODE_PIXELS) {
      throw new Error(TOO_LARGE_IMAGE_MESSAGE)
    }
  } else if (source.size > MAX_UNKNOWN_SOURCE_BYTES) {
    throw new Error(TOO_LARGE_IMAGE_MESSAGE)
  }

  // Probe oriented dimensions (EXIF applied) to size the downscale.
  const probe = await deps.createImageBitmap(source, { imageOrientation: 'from-image' })
  const target = computeTargetSize(probe.width, probe.height, policy)
  probe.close?.()

  // Resize DURING decode (keeps the bitmap/canvas under the iOS area cap).
  const bitmap = await deps.createImageBitmap(source, {
    imageOrientation: 'from-image',
    resizeWidth: target.w,
    resizeHeight: target.h,
    resizeQuality: 'high',
  })
  const canvas = deps.createCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close?.()
    throw new Error('2D canvas context unavailable')
  }
  ctx.drawImage(bitmap, 0, 0)
  bitmap.close?.()

  for (const format of policy.preferredFormats) {
    const blob = await canvasToBlob(canvas, format, policy.quality)
    if (!blob) continue
    // Safari ignores the WebP request and hands back PNG/JPEG — reject and fall
    // through. Only trust a WebP result whose Blob.type really is WebP.
    if (format === 'image/webp' && blob.type !== 'image/webp') continue
    const contentType: ImageContentType = blob.type === 'image/webp' ? 'image/webp' : 'image/jpeg'
    return { blob, contentType, width: canvas.width, height: canvas.height }
  }

  // preferredFormats normally includes JPEG; this is the belt-and-suspenders path.
  const jpeg = await canvasToBlob(canvas, 'image/jpeg', policy.quality)
  if (!jpeg) throw new Error('image encoding failed')
  return { blob: jpeg, contentType: 'image/jpeg', width: canvas.width, height: canvas.height }
}

// ── Display resolution ──────────────────────────────────────

/**
 * A joined Photo enriched with the R2 metadata the adapter copies off the
 * synced photos row (the shared Photo shape has no place for it). `dataUrl`
 * stays the raw local base64 payload (or '' once uploaded); `r2Key` is the
 * uploaded object key.
 */
export interface StoredPhoto extends Photo {
  r2Key?: string | null
  width?: number | null
  height?: number | null
}

/** Anything carrying the two fields display resolution needs. */
type PhotoSrcInput = { r2Key?: string | null; dataUrl?: string | null }

/**
 * Display precedence: uploaded object (served directly via /img) → local
 * base64 side-store payload → '' placeholder. Works identically logged-out
 * (r2Key absent → base64) and signed-in (r2Key set → /img).
 */
export function resolvePhotoSrc(photo: PhotoSrcInput): string {
  if (photo.r2Key) return imgPath(photo.r2Key)
  if (photo.dataUrl) return photo.dataUrl
  return ''
}

/** True once the photo has an uploaded R2 object (used for the local-only UI hint). */
export function hasCloudCopy(photo: PhotoSrcInput): boolean {
  return Boolean(photo.r2Key)
}
