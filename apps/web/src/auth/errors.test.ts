import { describe, expect, it } from 'vitest'
import {
  authErrorMessage,
  callAuth,
  isUnverifiedEmailError,
  MIN_PASSWORD_LENGTH,
  NETWORK_ERROR,
} from './errors'
import type { AuthError } from './errors'

const err = (overrides: Partial<AuthError>): AuthError => ({
  status: 400,
  statusText: 'Bad Request',
  ...overrides,
})

describe('callAuth', () => {
  it('passes through a resolved { data, error } result', async () => {
    const result = await callAuth(Promise.resolve({ data: { ok: true }, error: null }))
    expect(result).toEqual({ data: { ok: true }, error: null })
  })

  it('passes through a resolved API error', async () => {
    const apiError = err({ code: 'INVALID_EMAIL_OR_PASSWORD', status: 401, statusText: 'Unauthorized' })
    const result = await callAuth(Promise.resolve({ data: null, error: apiError }))
    expect(result.data).toBeNull()
    expect(result.error).toBe(apiError)
  })

  it('converts a thrown network error into NETWORK_ERROR instead of rejecting', async () => {
    const result = await callAuth(Promise.reject(new TypeError('Failed to fetch')))
    expect(result.data).toBeNull()
    expect(result.error).toBe(NETWORK_ERROR)
  })
})

describe('authErrorMessage', () => {
  it('detects rate limiting by status alone (bare 429, no code)', () => {
    expect(authErrorMessage(err({ status: 429, statusText: 'Too Many Requests' }))).toMatch(/too many attempts/i)
  })

  it('prefers the 429 message even when a code is present', () => {
    expect(
      authErrorMessage(err({ status: 429, code: 'INVALID_EMAIL_OR_PASSWORD' })),
    ).toMatch(/too many attempts/i)
  })

  it('maps known Better Auth codes to friendly messages', () => {
    expect(authErrorMessage(err({ code: 'INVALID_EMAIL_OR_PASSWORD', status: 401 }))).toBe('Wrong email or password.')
    expect(authErrorMessage(err({ code: 'EMAIL_NOT_VERIFIED', status: 403 }))).toMatch(/not been verified/i)
    expect(authErrorMessage(err({ code: 'USER_ALREADY_EXISTS', status: 422 }))).toMatch(/already exists/i)
    expect(authErrorMessage(err({ code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', status: 422 }))).toMatch(/already exists/i)
    expect(authErrorMessage(err({ code: 'INVALID_TOKEN', status: 400 }))).toMatch(/invalid or has expired/i)
    expect(authErrorMessage(err({ code: 'PASSWORD_TOO_SHORT', status: 400 }))).toContain(String(MIN_PASSWORD_LENGTH))
  })

  it('maps a network failure to a connectivity message', () => {
    expect(authErrorMessage(NETWORK_ERROR)).toMatch(/can't reach the server/i)
    expect(authErrorMessage(err({ status: 0, statusText: '', code: undefined }))).toMatch(/can't reach the server/i)
  })

  it('falls back to the server message, then to a generic message', () => {
    expect(authErrorMessage(err({ code: 'SOMETHING_NEW', message: 'Custom server detail' }))).toBe('Custom server detail')
    expect(authErrorMessage(err({}))).toMatch(/something went wrong/i)
  })
})

describe('isUnverifiedEmailError', () => {
  it('matches only the EMAIL_NOT_VERIFIED code', () => {
    expect(isUnverifiedEmailError(err({ code: 'EMAIL_NOT_VERIFIED', status: 403 }))).toBe(true)
    expect(isUnverifiedEmailError(err({ code: 'INVALID_EMAIL_OR_PASSWORD', status: 401 }))).toBe(false)
    expect(isUnverifiedEmailError(null)).toBe(false)
  })
})
