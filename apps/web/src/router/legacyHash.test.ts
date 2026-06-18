import { describe, expect, it } from 'vitest'
import { legacyHashToCleanUrl } from './legacyHash'

describe('legacyHashToCleanUrl', () => {
  it('rewrites a legacy share-link hash to the clean path', () => {
    expect(legacyHashToCleanUrl('#/share/abc123', '')).toBe('/share/abc123')
  })

  it('rewrites a legacy car-profile hash to the clean path', () => {
    expect(legacyHashToCleanUrl('#/car/42', '')).toBe('/car/42')
  })

  it('rewrites the bare root hash to "/"', () => {
    expect(legacyHashToCleanUrl('#/', '')).toBe('/')
  })

  it('carries the legacy reset token (it sat in the REAL ?… before the #)', () => {
    // /?token=xyz#/auth/reset  ->  /auth/reset?token=xyz
    expect(legacyHashToCleanUrl('#/auth/reset', '?token=xyz')).toBe('/auth/reset?token=xyz')
  })

  it('carries the legacy verify error (it sat INSIDE the hash after the path)', () => {
    // /#/auth/verified?error=INVALID  ->  /auth/verified?error=INVALID
    expect(legacyHashToCleanUrl('#/auth/verified?error=INVALID_TOKEN', '')).toBe(
      '/auth/verified?error=INVALID_TOKEN',
    )
  })

  it('merges the real query with the hash-internal query', () => {
    expect(legacyHashToCleanUrl('#/auth/reset?foo=1', '?token=x')).toBe(
      '/auth/reset?token=x&foo=1',
    )
  })

  it('returns null for no hash (nothing to rewrite)', () => {
    expect(legacyHashToCleanUrl('', '')).toBeNull()
    expect(legacyHashToCleanUrl('', '?token=x')).toBeNull()
  })

  it('returns null for a bare in-page anchor (not a legacy route)', () => {
    expect(legacyHashToCleanUrl('#', '')).toBeNull()
    expect(legacyHashToCleanUrl('#section', '')).toBeNull()
  })
})
