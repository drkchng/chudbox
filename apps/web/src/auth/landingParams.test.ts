import { describe, expect, it } from 'vitest'
import { resetTokenFromParams, verifyErrorFromParams } from './landingParams'

const params = (search: string) => new URLSearchParams(search)

describe('resetTokenFromParams', () => {
  it('reads the token from the normal query string', () => {
    expect(resetTokenFromParams(params('?token=abc123'))).toBe('abc123')
  })

  it('returns "" when the link carried an error (so the page shows invalid, not a form)', () => {
    expect(resetTokenFromParams(params('?error=INVALID_TOKEN'))).toBe('')
    // error wins even if a token is also present
    expect(resetTokenFromParams(params('?error=INVALID_TOKEN&token=abc'))).toBe('')
  })

  it('returns "" when there is no token', () => {
    expect(resetTokenFromParams(params(''))).toBe('')
  })
})

describe('verifyErrorFromParams', () => {
  it('reads the error code from the normal query string', () => {
    expect(verifyErrorFromParams(params('?error=INVALID_TOKEN'))).toBe('INVALID_TOKEN')
  })

  it('returns "" on success (no error param)', () => {
    expect(verifyErrorFromParams(params(''))).toBe('')
  })
})
