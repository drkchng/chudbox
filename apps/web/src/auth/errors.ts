/**
 * Normalization + friendly messages for Better Auth client errors.
 *
 * Better Auth action calls resolve to `{ data, error }` for HTTP errors but
 * REJECT outright on network failures (better-fetch does not catch `fetch`
 * exceptions). `callAuth` folds both shapes into one result so callers never
 * need try/catch, never surface a raw exception, and never log anything that
 * could carry credentials.
 */

export interface AuthError {
  code?: string | undefined
  message?: string | undefined
  status: number
  statusText: string
}

export interface AuthResult<T> {
  data: T | null
  error: AuthError | null
}

/** Matches Better Auth's default `minPasswordLength` (verified in 1.6.18). */
export const MIN_PASSWORD_LENGTH = 8

export const NETWORK_ERROR: AuthError = {
  code: 'NETWORK_ERROR',
  status: 0,
  statusText: '',
}

/**
 * Await a Better Auth client call, converting a thrown network error into a
 * normal `{ data: null, error: NETWORK_ERROR }` result.
 */
export async function callAuth<T>(
  call: Promise<{ data: T; error: AuthError | null }>,
): Promise<AuthResult<T>> {
  try {
    const { data, error } = await call
    return { data, error }
  } catch {
    // fetch() rejected: offline, DNS failure, or no backend running.
    // Deliberately not logged — offline is a normal state for this app.
    return { data: null, error: NETWORK_ERROR }
  }
}

const CODE_MESSAGES: Record<string, string> = {
  NETWORK_ERROR: "Can't reach the server — check your connection and try again.",
  INVALID_EMAIL_OR_PASSWORD: 'Wrong email or password.',
  EMAIL_NOT_VERIFIED: 'This email address has not been verified yet.',
  USER_ALREADY_EXISTS: 'An account with this email already exists.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'An account with this email already exists.',
  PASSWORD_TOO_SHORT: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
  PASSWORD_TOO_LONG: 'That password is too long.',
  INVALID_TOKEN: 'This link is invalid or has expired.',
  INVALID_EMAIL: 'Enter a valid email address.',
}

/**
 * Map an auth error to a short, human message. Rate limiting is detected by
 * status (a Cloudflare rate-limit rule returns a bare 429 with no JSON body,
 * so there is no code to match on).
 */
export function authErrorMessage(error: AuthError): string {
  if (error.status === 429) return 'Too many attempts — wait a minute, then try again.'
  const byCode: string | undefined = error.code !== undefined ? CODE_MESSAGES[error.code] : undefined
  if (byCode !== undefined) return byCode
  if (error.status === 0) return CODE_MESSAGES.NETWORK_ERROR
  return error.message || 'Something went wrong — try again.'
}

export function isUnverifiedEmailError(error: AuthError | null): boolean {
  return error?.code === 'EMAIL_NOT_VERIFIED'
}
