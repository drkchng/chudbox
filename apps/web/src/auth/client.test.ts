import { describe, expect, it } from 'vitest'
import { RESET_CALLBACK_PATH, VERIFIED_CALLBACK_PATH } from './client'

// The regex Better Auth 1.6.18 applies to a relative callbackURL/redirectTo
// (origin-check middleware runs it with allowRelativePaths: true for those
// labels). Verified against the installed source at
// better-auth/dist/auth/trusted-origins.mjs — reproduced here semantically
// identically (the source writes `\+` inside the char classes, where `\+` and
// `+` are equivalent; unescaped to satisfy no-useless-escape). A value passes
// Better Auth's origin check iff it starts with "/" AND matches this.
const BETTER_AUTH_RELATIVE_CALLBACK =
  /^\/(?!\/|\\|%2f|%5c)[\w\-.+/@]*(?:\?[\w\-.+/=&%@]*)?$/

describe('auth callback paths are clean (BrowserRouter — M5)', () => {
  it('are plain relative paths with no "#" workaround', () => {
    expect(VERIFIED_CALLBACK_PATH).toBe('/auth/verified')
    expect(RESET_CALLBACK_PATH).toBe('/auth/reset')
    expect(VERIFIED_CALLBACK_PATH).not.toContain('#')
    expect(RESET_CALLBACK_PATH).not.toContain('#')
  })

  it('PASS Better Auth\'s relative-callback origin check natively', () => {
    expect(BETTER_AUTH_RELATIVE_CALLBACK.test(VERIFIED_CALLBACK_PATH)).toBe(true)
    expect(BETTER_AUTH_RELATIVE_CALLBACK.test(RESET_CALLBACK_PATH)).toBe(true)
    // …and still pass once Better Auth appends the token/error query string.
    expect(BETTER_AUTH_RELATIVE_CALLBACK.test(`${RESET_CALLBACK_PATH}?token=abc`)).toBe(true)
    expect(
      BETTER_AUTH_RELATIVE_CALLBACK.test(`${VERIFIED_CALLBACK_PATH}?error=INVALID_TOKEN`),
    ).toBe(true)
  })

  it('the old HashRouter form would have FAILED that check (why the workaround existed)', () => {
    expect(BETTER_AUTH_RELATIVE_CALLBACK.test('/#/auth/reset')).toBe(false)
    expect(BETTER_AUTH_RELATIVE_CALLBACK.test('/#/auth/verified')).toBe(false)
  })
})
