// M3 client image pipeline: the LOAD-BEARING WebP feature-detection (Safari
// silently ignores the type arg on canvas.toBlob), the downscale dims flowing
// through computeTargetSize, and the display-source precedence.
import { describe, expect, it, vi } from 'vitest'
import { FREE_IMAGE_POLICY, extForContentType } from '@chudbox/shared'
import {
  TOO_LARGE_IMAGE_MESSAGE,
  encodeForUpload,
  hasCloudCopy,
  readSourceDimensions,
  resolvePhotoSrc,
} from './image'
import type { EncodeDeps } from './image'

interface CanvasLikeMock {
  width: number
  height: number
  getContext: () => { drawImage: () => void }
  toBlob: (cb: (b: Blob | null) => void, type?: string, quality?: number) => void
}

/**
 * A canvas whose toBlob either honors the requested type or — like Safari/iOS —
 * silently substitutes PNG when WebP is requested. Records the (type, quality)
 * pairs it was asked for so the test can assert the encoder retried.
 */
function makeCanvas(
  width: number,
  height: number,
  honorWebp: boolean,
  calls: { type?: string; quality?: number }[],
): CanvasLikeMock {
  return {
    width,
    height,
    getContext: () => ({ drawImage: () => {} }),
    toBlob: (cb, type, quality) => {
      calls.push({ type, quality })
      const produced = type === 'image/webp' && !honorWebp ? 'image/png' : (type ?? 'image/png')
      cb(new Blob([new Uint8Array([0x1, 0x2, 0x3])], { type: produced }))
    },
  }
}

/** Injected deps: probe returns a 4000×3000 source; the resize decode echoes the requested size. */
function makeDeps(
  honorWebp: boolean,
  bitmapOptions: { resizeWidth?: number; resizeHeight?: number }[],
  canvasCalls: { type?: string; quality?: number }[],
): EncodeDeps {
  return {
    createImageBitmap: vi.fn(async (_source, options) => {
      bitmapOptions.push({ resizeWidth: options?.resizeWidth, resizeHeight: options?.resizeHeight })
      if (options?.resizeWidth !== undefined && options?.resizeHeight !== undefined) {
        return { width: options.resizeWidth, height: options.resizeHeight, close: () => {} }
      }
      return { width: 4000, height: 3000, close: () => {} }
    }),
    createCanvas: vi.fn((w, h) => makeCanvas(w, h, honorWebp, canvasCalls) as unknown as ReturnType<EncodeDeps['createCanvas']>),
  }
}

const source = new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/jpeg' })

describe('encodeForUpload — WebP feature detection', () => {
  it('keeps WebP when the encoder honors it (.webp)', async () => {
    const bitmapOpts: { resizeWidth?: number; resizeHeight?: number }[] = []
    const canvasCalls: { type?: string; quality?: number }[] = []
    const result = await encodeForUpload(source, FREE_IMAGE_POLICY, makeDeps(true, bitmapOpts, canvasCalls))

    expect(result.contentType).toBe('image/webp')
    expect(result.blob.type).toBe('image/webp')
    expect(extForContentType(result.contentType)).toBe('webp')
    // Honored on the first attempt — no JPEG re-encode.
    expect(canvasCalls).toEqual([{ type: 'image/webp', quality: 0.78 }])
  })

  it('falls back to JPEG when WebP is silently ignored (.jpg)', async () => {
    const bitmapOpts: { resizeWidth?: number; resizeHeight?: number }[] = []
    const canvasCalls: { type?: string; quality?: number }[] = []
    const result = await encodeForUpload(source, FREE_IMAGE_POLICY, makeDeps(false, bitmapOpts, canvasCalls))

    expect(result.contentType).toBe('image/jpeg')
    expect(result.blob.type).toBe('image/jpeg')
    expect(extForContentType(result.contentType)).toBe('jpg')
    // Tried WebP, saw a non-WebP blob, re-encoded as JPEG.
    expect(canvasCalls).toEqual([
      { type: 'image/webp', quality: 0.78 },
      { type: 'image/jpeg', quality: 0.78 },
    ])
  })
})

describe('encodeForUpload — downscale via computeTargetSize', () => {
  it('resizes a 4000×3000 source to a 1600px long edge during decode', async () => {
    const bitmapOpts: { resizeWidth?: number; resizeHeight?: number }[] = []
    const canvasCalls: { type?: string; quality?: number }[] = []
    const result = await encodeForUpload(source, FREE_IMAGE_POLICY, makeDeps(true, bitmapOpts, canvasCalls))

    expect(result.width).toBe(1600)
    expect(result.height).toBe(1200)
    // First call probes (no resize); second resizes to the computed target.
    expect(bitmapOpts[0]).toEqual({ resizeWidth: undefined, resizeHeight: undefined })
    expect(bitmapOpts[1]).toEqual({ resizeWidth: 1600, resizeHeight: 1200 })
  })

  it('routes the cap through the injected policy (the tier seam)', async () => {
    const bitmapOpts: { resizeWidth?: number; resizeHeight?: number }[] = []
    const canvasCalls: { type?: string; quality?: number }[] = []
    const result = await encodeForUpload(
      source,
      { ...FREE_IMAGE_POLICY, maxEdgePx: 800, quality: 0.5 },
      makeDeps(true, bitmapOpts, canvasCalls),
    )
    expect(result.width).toBe(800)
    expect(result.height).toBe(600)
    expect(canvasCalls[0]?.quality).toBe(0.5)
  })
})

describe('encodeForUpload — decode-bomb guard', () => {
  it('refuses an oversize source BEFORE decoding it (clear error, no createImageBitmap)', async () => {
    const deps = makeDeps(true, [], [])
    // 20000×20000 = 400 MP → would allocate ~1.6 GB of RGBA in the probe decode.
    deps.probeSourceDimensions = async () => ({ width: 20000, height: 20000 })
    await expect(encodeForUpload(source, FREE_IMAGE_POLICY, deps)).rejects.toThrow(
      TOO_LARGE_IMAGE_MESSAGE,
    )
    expect(deps.createImageBitmap).not.toHaveBeenCalled()
  })

  it('proceeds for a normal-size source', async () => {
    const deps = makeDeps(true, [], [])
    deps.probeSourceDimensions = async () => ({ width: 4000, height: 3000 })
    const result = await encodeForUpload(source, FREE_IMAGE_POLICY, deps)
    expect(result.width).toBe(1600)
    expect(deps.createImageBitmap).toHaveBeenCalled()
  })

  it('falls back to a byte-length bound when dimensions are unreadable (e.g. HEIC)', async () => {
    const deps = makeDeps(true, [], [])
    deps.probeSourceDimensions = async () => null // unparseable header
    // A small unknown-type source is allowed through (clamped at decode anyway)…
    const small = { size: 1024 } as unknown as Blob
    await expect(
      encodeForUpload(small, FREE_IMAGE_POLICY, deps),
    ).resolves.toBeTruthy()
    // …but an absurdly large one is refused before decoding.
    const huge = { size: 60 * 1024 * 1024 } as unknown as Blob
    await expect(encodeForUpload(huge, FREE_IMAGE_POLICY, deps)).rejects.toThrow(
      TOO_LARGE_IMAGE_MESSAGE,
    )
  })
})

describe('readSourceDimensions — header parsing for the decode guard', () => {
  it('reads a JPEG SOF0 size', () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x0a, 0x00, 0x14,
    ])
    expect(readSourceDimensions(jpeg)).toEqual({ width: 20, height: 10 })
  })

  it('reads a WebP VP8X size', () => {
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
      0x56, 0x50, 0x38, 0x58, 0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x13, 0x00, 0x00, 0x09, 0x00, 0x00,
    ])
    expect(readSourceDimensions(webp)).toEqual({ width: 20, height: 10 })
  })

  it('reads a PNG IHDR size (a common picked source)', () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x14, 0x00, 0x00, 0x00, 0x0a,
    ])
    expect(readSourceDimensions(png)).toEqual({ width: 20, height: 10 })
  })

  it('returns null for an unrecognized source (e.g. GIF) — caller falls back', () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    expect(readSourceDimensions(gif)).toBeNull()
  })
})

describe('resolvePhotoSrc — display precedence', () => {
  it('serves an uploaded photo directly from /img (r2Key wins)', () => {
    expect(resolvePhotoSrc({ r2Key: 'u/a/b/c.webp', dataUrl: 'data:image/png;base64,AAAA' })).toBe(
      '/img/u/a/b/c.webp',
    )
  })

  it('falls back to the local base64 payload when there is no r2Key', () => {
    expect(resolvePhotoSrc({ r2Key: null, dataUrl: 'data:image/png;base64,AAAA' })).toBe(
      'data:image/png;base64,AAAA',
    )
    expect(resolvePhotoSrc({ dataUrl: 'data:x' })).toBe('data:x')
  })

  it('returns the empty placeholder when neither source is present', () => {
    expect(resolvePhotoSrc({ r2Key: null, dataUrl: '' })).toBe('')
    expect(resolvePhotoSrc({})).toBe('')
  })

  it('hasCloudCopy reflects the r2Key', () => {
    expect(hasCloudCopy({ r2Key: 'u/a/b/c.jpg' })).toBe(true)
    expect(hasCloudCopy({ r2Key: null })).toBe(false)
    expect(hasCloudCopy({})).toBe(false)
  })
})
