import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

describe('GET /api/health', () => {
  it('returns {ok:true}', async () => {
    const res = await SELF.fetch('https://example.com/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})

describe('GET /sync', () => {
  it('rejects requests without a session before touching the DO', async () => {
    const res = await SELF.fetch('https://example.com/sync', {
      headers: { Upgrade: 'websocket' },
    })
    expect(res.status).toBe(401)
  })

  it('rejects unauthenticated non-upgrade requests too', async () => {
    const res = await SELF.fetch('https://example.com/sync')
    expect(res.status).toBe(401)
  })
})

describe('Better Auth handler at /api/auth/*', () => {
  it('is mounted (sign-up endpoint responds, not 404)', async () => {
    const res = await SELF.fetch('https://example.com/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'smoke@example.com',
        password: 'correct-horse-battery',
        name: 'Smoke Test',
      }),
    })
    expect(res.status).not.toBe(404)
    expect(res.ok).toBe(true)
    const body = (await res.json()) as { user?: { email?: string } }
    expect(body.user?.email).toBe('smoke@example.com')
  })

  it('persists the user to D1 via the drizzle adapter', async () => {
    const signUp = await SELF.fetch(
      'https://example.com/api/auth/sign-up/email',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'persisted@example.com',
          password: 'correct-horse-battery',
          name: 'Persisted User',
        }),
      },
    )
    expect(signUp.ok).toBe(true)

    const { env } = await import('cloudflare:test')
    const row = await env.DB.prepare(
      'SELECT email, email_verified FROM user WHERE email = ?',
    )
      .bind('persisted@example.com')
      .first<{ email: string; email_verified: number }>()
    expect(row?.email).toBe('persisted@example.com')
    // requireEmailVerification: the fresh user must not be verified yet.
    expect(row?.email_verified).toBe(0)
  })

  it('refuses sign-in before email verification (requireEmailVerification)', async () => {
    await SELF.fetch('https://example.com/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'unverified@example.com',
        password: 'correct-horse-battery',
        name: 'Unverified',
      }),
    })
    const signIn = await SELF.fetch(
      'https://example.com/api/auth/sign-in/email',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'unverified@example.com',
          password: 'correct-horse-battery',
        }),
      },
    )
    expect(signIn.status).toBe(403)
  })
})

describe('fallthrough', () => {
  it('404s unknown /api routes as JSON, not SPA HTML', async () => {
    const res = await SELF.fetch('https://example.com/api/nope')
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toContain('application/json')
  })
})
