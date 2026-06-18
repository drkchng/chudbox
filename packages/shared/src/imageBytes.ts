// Byte-level image header parsing (M3 hardening). Hand-rolled (no deps) and
// RN-SAFE: operates ONLY on Uint8Array — NO DOM/Node/canvas/Buffer — so the
// eslint no-restricted-globals guard stays green and the Worker, Vite and Metro
// can all consume it. Two jobs:
//
//   1. sniffImageType — DECIDE the real format from the leading magic bytes so
//      the upload route never trusts the client-declared Content-Type (a
//      mislabeled / Safari-PNG blob can't be stored as .webp/.jpg).
//   2. readImageDimensions / readPngDimensions — best-effort intrinsic size from
//      the header. CONSERVATIVE by contract: return null whenever the size can't
//      be parsed with confidence (never guess). Callers treat a non-null,
//      clearly-oversize result as a reject signal and a null result as
//      "unknown → allow" (other guards bound abuse).

import type { ImageContentType } from './imagePolicy'

/** Intrinsic pixel size parsed from an image header. */
export interface ImageDimensions {
  width: number
  height: number
}

/** True iff `bytes[offset..]` begins with the ASCII codes of `ascii`. */
function matchAscii(bytes: Uint8Array, offset: number, ascii: string): boolean {
  if (offset + ascii.length > bytes.length) return false
  for (let i = 0; i < ascii.length; i += 1) {
    if (bytes[offset + i] !== ascii.charCodeAt(i)) return false
  }
  return true
}

/**
 * Identify an image by its leading magic bytes — NOT by any declared
 * Content-Type. Returns the canonical type for the two formats the pipeline
 * stores, or null for anything else (PNG, GIF, HEIC, a RIFF container that
 * isn't WebP such as WAV/AVI, truncated/empty input, …).
 *
 *   JPEG: FF D8 FF                              (first 3 bytes)
 *   WebP: 'RIFF' (52 49 46 46) at [0..3] AND
 *         'WEBP' (57 45 42 50) at [8..11]       (bytes 4-7 = LE size, ignored)
 */
export function sniffImageType(bytes: Uint8Array): ImageContentType | null {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg'
  }
  if (
    bytes.length >= 12 &&
    matchAscii(bytes, 0, 'RIFF') &&
    matchAscii(bytes, 8, 'WEBP')
  ) {
    return 'image/webp'
  }
  return null
}

/**
 * Intrinsic size from a JPEG header: walk the marker segments to the first SOFn
 * frame header and read its height/width. SOFn = FFC0..FFCF EXCEPT the
 * non-frame markers DHT (C4), JPG (C8) and DAC (CC). Returns null on any
 * structural surprise (no leading 0xFF where a marker is expected, a segment
 * length that runs past the buffer, no SOF before the entropy-coded scan, a
 * zero dimension) — i.e. when the size can't be trusted.
 */
function readJpegDimensions(bytes: Uint8Array): ImageDimensions | null {
  const len = bytes.length
  if (len < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let i = 2
  while (i + 1 < len) {
    // A marker is 0xFF followed by a non-0xFF code; 0xFF may be repeated as fill.
    if (bytes[i] !== 0xff) return null
    let j = i
    while (j < len && bytes[j] === 0xff) j += 1
    if (j >= len) return null
    const marker = bytes[j]
    i = j + 1
    // Standalone markers carry no length payload.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      continue
    }
    // EOI / start-of-scan: stop — a valid file's SOF precedes the scan data.
    if (marker === 0xd9 || marker === 0xda) return null
    if (i + 1 >= len) return null
    const segLen = (bytes[i] << 8) | bytes[i + 1]
    if (segLen < 2) return null
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    if (isSof) {
      // Frame header: len(2) precision(1) height(2) width(2) — 7 bytes from i.
      if (i + 7 > len) return null
      const height = (bytes[i + 3] << 8) | bytes[i + 4]
      const width = (bytes[i + 5] << 8) | bytes[i + 6]
      if (width > 0 && height > 0) return { width, height }
      return null
    }
    i += segLen
  }
  return null
}

/**
 * Intrinsic canvas size from a WebP header. Handles the three frame containers
 * a browser/canvas encoder emits, all carrying the size in the first chunk
 * right after the 12-byte RIFF/WEBP header:
 *
 *   VP8X (extended): 24-bit (canvasW-1) then 24-bit (canvasH-1), little-endian.
 *   VP8L (lossless): 0x2F signature, then 14-bit (W-1) and 14-bit (H-1) packed
 *                    little-endian into the next 4 bytes.
 *   VP8  (lossy):    a keyframe whose 0x9D 0x01 0x2A start code is followed by
 *                    14-bit width then 14-bit height (little-endian).
 *
 * Returns null for any other / truncated chunk (conservative).
 */
function readWebpDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 16) return null

  if (matchAscii(bytes, 12, 'VP8X')) {
    // fourCC(4) size(4) flags(1) reserved(3) | W-1(3 LE) | H-1(3 LE)
    if (bytes.length < 30) return null
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16))
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16))
    return width > 0 && height > 0 ? { width, height } : null
  }

  if (matchAscii(bytes, 12, 'VP8L')) {
    // data starts at 20: 0x2F signature, then 14+14 bits in 4 LE bytes.
    if (bytes.length < 25 || bytes[20] !== 0x2f) return null
    const packed =
      (bytes[21] |
        (bytes[22] << 8) |
        (bytes[23] << 16) |
        (bytes[24] << 24)) >>>
      0
    const width = (packed & 0x3fff) + 1
    const height = ((packed >>> 14) & 0x3fff) + 1
    return { width, height }
  }

  if (matchAscii(bytes, 12, 'VP8 ')) {
    // data starts at 20: frame tag(3) start-code(3) width(2 LE) height(2 LE)
    if (bytes.length < 30) return null
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null
    const width = (bytes[26] | (bytes[27] << 8)) & 0x3fff
    const height = (bytes[28] | (bytes[29] << 8)) & 0x3fff
    return width > 0 && height > 0 ? { width, height } : null
  }

  return null
}

/**
 * Best-effort intrinsic size for one of the two STORED formats, dispatched by a
 * pre-computed sniff result. Conservative: null whenever the header can't be
 * parsed with confidence, so a caller never falsely rejects a valid image.
 */
export function readImageDimensions(
  bytes: Uint8Array,
  sniffedType: ImageContentType,
): ImageDimensions | null {
  if (sniffedType === 'image/jpeg') return readJpegDimensions(bytes)
  if (sniffedType === 'image/webp') return readWebpDimensions(bytes)
  return null
}

/**
 * Intrinsic size from a PNG IHDR (width/height are big-endian at fixed offsets
 * 16 and 20, right after the 8-byte signature and the IHDR chunk header).
 * Returns null for any non-PNG / truncated input. PNG is never STORED by the
 * pipeline, but the web decode-bomb guard needs the source size for the common
 * case where a user picks a PNG.
 */
export function readPngDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.length < 24) return null
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  for (let i = 0; i < sig.length; i += 1) {
    if (bytes[i] !== sig[i]) return null
  }
  if (!matchAscii(bytes, 12, 'IHDR')) return null
  const width =
    ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>> 0
  const height =
    ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>> 0
  return width > 0 && height > 0 ? { width, height } : null
}
