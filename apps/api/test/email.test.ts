import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderAuthEmail, sendAuthEmail } from '../src/email'

const URL = 'https://chudbox.com/api/auth/verify-email?token=abc123&callbackURL=%2F'

describe('renderAuthEmail', () => {
  it('uses the verification subject/heading/CTA copy', () => {
    const { subject, html, text } = renderAuthEmail('verification', URL)
    expect(subject).toBe('Verify your Chudbox email')
    expect(html).toContain('Confirm your email')
    expect(html).toContain('>Confirm email<')
    expect(text).toContain('Confirm your email — Chudbox')
    // Real Better Auth default expiry (1h), not a placeholder.
    expect(html).toContain('expires in about an hour')
  })

  it('uses the reset subject/heading/CTA copy', () => {
    const { subject, html, text } = renderAuthEmail('reset', URL)
    expect(subject).toBe('Reset your Chudbox password')
    expect(html).toContain('Reset your password')
    expect(html).toContain('>Reset password<')
    expect(text).toContain('back in the garage')
    expect(text).toContain('your password stays the same')
  })

  it('embeds the action URL in both the button and the raw fallback', () => {
    const { html, text } = renderAuthEmail('verification', URL)
    // Plain-text part always carries the raw link.
    expect(text).toContain(URL)
    // HTML escapes & to &amp; in href + raw-URL block (valid HTML).
    const escaped = URL.replace(/&/g, '&amp;')
    expect(html).toContain(`href="${escaped}"`)
    expect(html).toContain(`>${escaped}<`)
    expect(html).not.toContain(`href="${URL}"`) // raw & must be escaped
  })

  it('is dark-mode hardened and email-client compatible', () => {
    const { html } = renderAuthEmail('reset', URL)
    expect(html).toContain('<html lang="en"')
    expect(html).toContain('name="color-scheme" content="dark light"')
    expect(html).toContain('name="supported-color-schemes" content="dark light"')
    // Layout tables are presentation, not data tables.
    expect(html).toContain('role="presentation"')
    // Explicit per-cell dark background (Outlook reads bgcolor).
    expect(html).toContain('bgcolor="#0F0F0F"')
    expect(html).toContain('bgcolor="#1A1A1A"')
    // No external images / tracking pixels.
    expect(html).not.toContain('<img')
  })

  it('uses dark-on-orange for the CTA (AA), never white-on-orange', () => {
    const { html } = renderAuthEmail('verification', URL)
    expect(html).toContain('background-color:#F97316')
    expect(html).toContain('color:#0F0F0F')
    // The failing app pattern (white text on the accent fill) must not appear.
    expect(html).not.toMatch(/#F97316[^]*?color:#FFFFFF/i)
    expect(html).not.toMatch(/color:#FFFFFF[^]*?#F97316/i)
  })
})

describe('sendAuthEmail', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('dev fallback: logs the link and does not call fetch when no API key', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await sendAuthEmail(
      {},
      { to: 'a@b.com', subject: 'S', url: URL, text: 'T', html: '<p>H</p>' },
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledOnce()
    expect(log.mock.calls[0][0]).toContain(URL)
  })

  it('sends both html and text in the Resend payload', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{"id":"x"}', { status: 200 }))
    await sendAuthEmail(
      { RESEND_API_KEY: 'k', AUTH_EMAIL_FROM: 'Chudbox <noreply@chudbox.com>' },
      { to: 'a@b.com', subject: 'S', url: URL, text: 'T', html: '<p>H</p>' },
    )
    expect(fetchSpy).toHaveBeenCalledOnce()
    const init = fetchSpy.mock.calls[0][1] as RequestInit
    const payload = JSON.parse(init.body as string)
    expect(payload.from).toBe('Chudbox <noreply@chudbox.com>')
    expect(payload.html).toBe('<p>H</p>')
    expect(payload.text).toBe('T')
  })

  it('never throws when Resend delivery fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))
    await expect(
      sendAuthEmail(
        { RESEND_API_KEY: 'k' },
        { to: 'a@b.com', subject: 'S', url: URL, text: 'T', html: '<p>H</p>' },
      ),
    ).resolves.toBeUndefined()
  })
})
