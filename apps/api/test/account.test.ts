// DEC-10 — account display-settings route tests against the REAL Worker + D1
// (vitest-pool-workers). Covers the session gate, reading the defaulted
// { name, showOwnerName }, partial updates (name only / consent only), and the
// validation guards. This is the WRITE side of the share route's consent-gated
// ownerName injection (asserted end-to-end in share.test.ts).
import { SELF, env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { ACCOUNT_DISPLAY_PATH } from '@chudbox/shared'
import type { AccountDisplaySettings } from '@chudbox/shared'

const BASE = 'https://example.com'

let session: { cookie: string; userId: string }

beforeAll(async () => {
  const email = 'account-user@example.com'
  const password = 'correct-horse-battery'
  const signUp = await SELF.fetch(`${BASE}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name: 'Account Tester', tosAcceptedVersion: 1 }),
  })
  expect(signUp.ok).toBe(true)
  const { user } = (await signUp.json()) as { user: { id: string } }
  await env.DB.prepare('UPDATE user SET email_verified = 1 WHERE email = ?').bind(email).run()
  const signIn = await SELF.fetch(`${BASE}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  expect(signIn.ok).toBe(true)
  const cookie = (signIn.headers.get('set-cookie') ?? '').match(
    /(?:__Secure-)?better-auth\.session_token=[^;]+/,
  )?.[0]
  if (!cookie) throw new Error('no session cookie after sign-in')
  session = { cookie, userId: user.id }
})

const authed = (init: RequestInit = {}): RequestInit => ({
  ...init,
  headers: { 'Content-Type': 'application/json', cookie: session.cookie, ...(init.headers ?? {}) },
})

async function getDisplay(init?: RequestInit): Promise<Response> {
  return SELF.fetch(`${BASE}${ACCOUNT_DISPLAY_PATH}`, { method: 'GET', ...init })
}
async function postDisplay(body: unknown, init?: RequestInit): Promise<Response> {
  return SELF.fetch(
    `${BASE}${ACCOUNT_DISPLAY_PATH}`,
    authed({ method: 'POST', body: JSON.stringify(body), ...init }),
  )
}

describe('GET /api/account/display', () => {
  it('requires a session (401 logged-out)', async () => {
    const res = await getDisplay()
    expect(res.status).toBe(401)
  })

  it('returns the defaulted { name, showOwnerName } for the signed-in owner', async () => {
    const res = await getDisplay(authed())
    expect(res.status).toBe(200)
    const body = (await res.json()) as AccountDisplaySettings
    expect(body.name).toBe('Account Tester')
    // DEC-10: show_owner_name DEFAULT 1 ⇒ shown by default (opt-out).
    expect(body.showOwnerName).toBe(true)
  })
})

describe('POST /api/account/display', () => {
  it('requires a session (401 logged-out)', async () => {
    const res = await SELF.fetch(`${BASE}${ACCOUNT_DISPLAY_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Nope' }),
    })
    expect(res.status).toBe(401)
  })

  it('updates the display name and persists it', async () => {
    const res = await postDisplay({ name: 'Felix R.' })
    expect(res.status).toBe(200)
    expect(((await res.json()) as AccountDisplaySettings).name).toBe('Felix R.')
    const reread = (await (await getDisplay(authed())).json()) as AccountDisplaySettings
    expect(reread.name).toBe('Felix R.')
    // A direct D1 read confirms the column actually changed.
    const row = await env.DB.prepare('SELECT name FROM user WHERE id = ?')
      .bind(session.userId)
      .first<{ name: string }>()
    expect(row?.name).toBe('Felix R.')
  })

  it('toggles the show_owner_name consent independently of the name', async () => {
    const off = (await (await postDisplay({ showOwnerName: false })).json()) as AccountDisplaySettings
    expect(off.showOwnerName).toBe(false)
    expect(off.name).toBe('Felix R.') // name untouched by a consent-only update
    const row = await env.DB.prepare('SELECT show_owner_name FROM user WHERE id = ?')
      .bind(session.userId)
      .first<{ show_owner_name: number }>()
    expect(row?.show_owner_name).toBe(0)
    // restore for any later tests in this file
    await postDisplay({ showOwnerName: true })
  })

  it('rejects an empty body (no fields to update)', async () => {
    const res = await postDisplay({})
    expect(res.status).toBe(400)
  })

  it('rejects an empty/whitespace display name', async () => {
    const res = await postDisplay({ name: '   ' })
    expect(res.status).toBe(400)
  })

  it('rejects an unknown field (strict body)', async () => {
    const res = await postDisplay({ name: 'X', email: 'evil@example.com' })
    expect(res.status).toBe(400)
  })
})
