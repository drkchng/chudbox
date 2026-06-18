import { describe, expect, it } from 'vitest'
import {
  readImageDimensions,
  readPngDimensions,
  sniffImageType,
} from './imageBytes'

// ── Fixture builders (hand-built minimal headers) ───────────
const bytes = (...vals: number[]): Uint8Array => new Uint8Array(vals)

/** 'RIFF' <4-byte size> 'WEBP' then a chunk body. */
function webp(...chunk: number[]): Uint8Array {
  return new Uint8Array([
    0x52, 0x49, 0x46, 0x46, // RIFF
    0x00, 0x00, 0x00, 0x00, // size (ignored)
    0x57, 0x45, 0x42, 0x50, // WEBP
    ...chunk,
  ])
}

/** A JPEG SOF0 frame: SOI, then SOFn with the given precision/height/width. */
function jpegSof(marker: number, height: number, width: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, marker, // SOFn
    0x00, 0x11, // segment length (17)
    0x08, // precision
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    // (rest of the frame header is not read)
  ])
}

describe('sniffImageType', () => {
  it('detects a JPEG by FF D8 FF', () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00))).toBe('image/jpeg')
  })

  it('detects a WebP by RIFF....WEBP', () => {
    expect(sniffImageType(webp(0x56, 0x50, 0x38, 0x20))).toBe('image/webp')
  })

  it('rejects a PNG header', () => {
    expect(
      sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)),
    ).toBeNull()
  })

  it('rejects a RIFF container that is not WebP (e.g. WAV)', () => {
    const wav = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, // RIFF
      0x24, 0x00, 0x00, 0x00, // size
      0x57, 0x41, 0x56, 0x45, // WAVE (not WEBP)
    ])
    expect(sniffImageType(wav)).toBeNull()
  })

  it('rejects truncated and empty input', () => {
    expect(sniffImageType(bytes(0xff, 0xd8))).toBeNull() // 2 bytes, not 3
    expect(sniffImageType(webp().subarray(0, 11))).toBeNull() // RIFF but < 12
    expect(sniffImageType(new Uint8Array(0))).toBeNull()
  })

  it('does not mistake a near-miss JPEG (FF D8 00) for an image', () => {
    expect(sniffImageType(bytes(0xff, 0xd8, 0x00))).toBeNull()
  })
})

describe('readImageDimensions — JPEG', () => {
  it('reads width/height from an SOF0 frame', () => {
    expect(readImageDimensions(jpegSof(0xc0, 10, 20), 'image/jpeg')).toEqual({
      width: 20,
      height: 10,
    })
  })

  it('reads dimensions from a progressive SOF2 frame', () => {
    expect(readImageDimensions(jpegSof(0xc2, 480, 640), 'image/jpeg')).toEqual({
      width: 640,
      height: 480,
    })
  })

  it('skips a preceding APP1/EXIF segment before the SOF', () => {
    const withExif = new Uint8Array([
      0xff, 0xd8, // SOI
      0xff, 0xe1, // APP1
      0x00, 0x08, // segment length 8 → 6 payload bytes
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
      0xff, 0xc0, // SOF0
      0x00, 0x11, 0x08,
      0x04, 0x00, // height 1024
      0x05, 0x00, // width 1280
    ])
    expect(readImageDimensions(withExif, 'image/jpeg')).toEqual({
      width: 1280,
      height: 1024,
    })
  })

  it('does NOT read dimensions from a DHT (C4) marker (not a frame)', () => {
    // C4 is excluded from SOFn; this DHT-shaped segment must not be parsed as a frame.
    const dht = new Uint8Array([
      0xff, 0xd8,
      0xff, 0xc4, // DHT (not SOF)
      0x00, 0x04, // length 4 → 2 payload bytes
      0x00, 0x00,
      // …no SOF follows → unparseable
    ])
    expect(readImageDimensions(dht, 'image/jpeg')).toBeNull()
  })

  it('returns null for a truncated frame header (no false reject)', () => {
    // Marker + partial length only — cannot confidently parse.
    expect(readImageDimensions(bytes(0xff, 0xd8, 0xff, 0xc0, 0x00), 'image/jpeg')).toBeNull()
  })

  it('returns null when there is no leading SOI', () => {
    expect(readImageDimensions(bytes(0x00, 0x00, 0xff, 0xc0), 'image/jpeg')).toBeNull()
  })
})

describe('readImageDimensions — WebP', () => {
  it('reads a VP8X (extended) canvas size', () => {
    const vp8x = webp(
      0x56, 0x50, 0x38, 0x58, // 'VP8X'
      0x0a, 0x00, 0x00, 0x00, // chunk size
      0x00, // flags
      0x00, 0x00, 0x00, // reserved
      0x13, 0x00, 0x00, // width-1 = 19  → 20
      0x09, 0x00, 0x00, // height-1 = 9  → 10
    )
    expect(readImageDimensions(vp8x, 'image/webp')).toEqual({ width: 20, height: 10 })
  })

  it('reads a VP8L (lossless) size from the packed bits', () => {
    // width 20 (w-1=19), height 10 (h-1=9): packed = 19 | (9<<14) = 0x00024013
    const vp8l = webp(
      0x56, 0x50, 0x38, 0x4c, // 'VP8L'
      0x06, 0x00, 0x00, 0x00, // chunk size
      0x2f, // signature
      0x13, 0x40, 0x02, 0x00, // packed 14+14 bits, little-endian
    )
    expect(readImageDimensions(vp8l, 'image/webp')).toEqual({ width: 20, height: 10 })
  })

  it('reads a simple VP8 (lossy) keyframe size', () => {
    const vp8 = webp(
      0x56, 0x50, 0x38, 0x20, // 'VP8 '
      0x0a, 0x00, 0x00, 0x00, // chunk size
      0x00, 0x00, 0x00, // frame tag
      0x9d, 0x01, 0x2a, // keyframe start code
      0x14, 0x00, // width 20
      0x0a, 0x00, // height 10
    )
    expect(readImageDimensions(vp8, 'image/webp')).toEqual({ width: 20, height: 10 })
  })

  it('parses a confidently-oversize VP8X canvas (used by the route ceiling)', () => {
    const big = webp(
      0x56, 0x50, 0x38, 0x58, // 'VP8X'
      0x0a, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x0f, 0x27, 0x00, // width-1 = 9999 → 10000
      0x0f, 0x27, 0x00, // height-1 = 9999 → 10000
    )
    expect(readImageDimensions(big, 'image/webp')).toEqual({ width: 10000, height: 10000 })
  })

  it('returns null for a VP8 with a wrong start code, or a truncated chunk', () => {
    const badStart = webp(
      0x56, 0x50, 0x38, 0x20,
      0x0a, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, // wrong start code
      0x14, 0x00, 0x0a, 0x00,
    )
    expect(readImageDimensions(badStart, 'image/webp')).toBeNull()
    expect(readImageDimensions(webp(0x56, 0x50, 0x38, 0x58), 'image/webp')).toBeNull()
  })
})

describe('readPngDimensions', () => {
  function png(width: number, height: number): Uint8Array {
    return new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // signature
      0x00, 0x00, 0x00, 0x0d, // IHDR length
      0x49, 0x48, 0x44, 0x52, // 'IHDR'
      (width >>> 24) & 0xff, (width >>> 16) & 0xff, (width >>> 8) & 0xff, width & 0xff,
      (height >>> 24) & 0xff, (height >>> 16) & 0xff, (height >>> 8) & 0xff, height & 0xff,
    ])
  }

  it('reads width/height from the IHDR', () => {
    expect(readPngDimensions(png(1280, 1024))).toEqual({ width: 1280, height: 1024 })
  })

  it('returns null for a non-PNG / truncated input', () => {
    expect(readPngDimensions(bytes(0xff, 0xd8, 0xff))).toBeNull()
    expect(readPngDimensions(png(10, 10).subarray(0, 20))).toBeNull()
    expect(readPngDimensions(new Uint8Array(0))).toBeNull()
  })
})
