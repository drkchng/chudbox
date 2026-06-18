import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  FREE_IMAGE_POLICY,
  computeTargetSize,
  contentTypeForExt,
  extForContentType,
} from './imagePolicy'

describe('FREE_IMAGE_POLICY', () => {
  it('is the documented free-tier config (single source of truth)', () => {
    expect(FREE_IMAGE_POLICY).toEqual({
      maxEdgePx: 1600,
      quality: 0.78,
      keepOriginals: false,
      preferredFormats: ['image/webp', 'image/jpeg'],
    })
  })
})

describe('computeTargetSize', () => {
  const p = FREE_IMAGE_POLICY

  it('downscales landscape to a 1600px long edge, preserving aspect', () => {
    expect(computeTargetSize(4000, 3000, p)).toEqual({ w: 1600, h: 1200 })
  })

  it('downscales portrait to a 1600px long edge, preserving aspect', () => {
    expect(computeTargetSize(3000, 4000, p)).toEqual({ w: 1200, h: 1600 })
  })

  it('downscales a square to the cap on both edges', () => {
    expect(computeTargetSize(2000, 2000, p)).toEqual({ w: 1600, h: 1600 })
  })

  it('never upscales an image smaller than the cap', () => {
    expect(computeTargetSize(800, 600, p)).toEqual({ w: 800, h: 600 })
    expect(computeTargetSize(1000, 1000, p)).toEqual({ w: 1000, h: 1000 })
    expect(computeTargetSize(640, 480, p)).toEqual({ w: 640, h: 480 })
  })

  it('leaves an image already at the exact cap unchanged', () => {
    expect(computeTargetSize(1600, 1200, p)).toEqual({ w: 1600, h: 1200 })
    expect(computeTargetSize(1200, 1600, p)).toEqual({ w: 1200, h: 1600 })
    expect(computeTargetSize(1600, 1600, p)).toEqual({ w: 1600, h: 1600 })
  })

  it('routes the cap through the policy (the tier seam)', () => {
    expect(computeTargetSize(4000, 2000, { ...p, maxEdgePx: 800 })).toEqual({ w: 800, h: 400 })
  })

  it('floors degenerate (non-finite / non-positive) inputs to 1px', () => {
    expect(computeTargetSize(0, 0, p)).toEqual({ w: 1, h: 1 })
    expect(computeTargetSize(-100, 50, p)).toEqual({ w: 1, h: 50 })
    expect(computeTargetSize(Number.NaN, 1000, p)).toEqual({ w: 1, h: 1000 })
  })

  it('never upscales, never exceeds the cap, always ≥ 1px (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20000 }),
        fc.integer({ min: 1, max: 20000 }),
        (w, h) => {
          const out = computeTargetSize(w, h, p)
          expect(out.w).toBeLessThanOrEqual(w)
          expect(out.h).toBeLessThanOrEqual(h)
          expect(Math.max(out.w, out.h)).toBeLessThanOrEqual(p.maxEdgePx)
          expect(out.w).toBeGreaterThanOrEqual(1)
          expect(out.h).toBeGreaterThanOrEqual(1)
        },
      ),
    )
  })

  it('preserves aspect ratio within rounding tolerance (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 400, max: 8000 }),
        fc.integer({ min: 400, max: 8000 }),
        (w, h) => {
          const out = computeTargetSize(w, h, p)
          const srcRatio = w / h
          const outRatio = out.w / out.h
          // relative error — integer rounding of the short edge stays well under 5%
          expect(Math.abs(srcRatio - outRatio) / srcRatio).toBeLessThan(0.05)
        },
      ),
    )
  })
})

describe('extForContentType / contentTypeForExt', () => {
  it('maps produced content types to key extensions', () => {
    expect(extForContentType('image/webp')).toBe('webp')
    expect(extForContentType('image/jpeg')).toBe('jpg')
    // the JPEG fallback path: anything that is not webp stores as .jpg
    expect(extForContentType('image/png')).toBe('jpg')
    expect(extForContentType('')).toBe('jpg')
  })

  it('maps extensions back to content types', () => {
    expect(contentTypeForExt('webp')).toBe('image/webp')
    expect(contentTypeForExt('jpg')).toBe('image/jpeg')
    expect(contentTypeForExt('jpeg')).toBe('image/jpeg')
  })

  it('round-trips the two stored formats', () => {
    expect(contentTypeForExt(extForContentType('image/webp'))).toBe('image/webp')
    expect(contentTypeForExt(extForContentType('image/jpeg'))).toBe('image/jpeg')
    expect(extForContentType(contentTypeForExt('webp'))).toBe('webp')
    expect(extForContentType(contentTypeForExt('jpg'))).toBe('jpg')
  })
})
