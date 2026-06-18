/**
 * Chudbox Worker — Hono router.
 *
 * `run_worker_first: ["/api/*", "/sync", "/img/*", "/share/*"]` in
 * wrangler.jsonc scopes the Worker to exactly these paths; every other request
 * (/, /car/:id, /auth/reset, /auth/verified, …) is served directly from the
 * static assets binding (the SPA), with `single-page-application` not-found
 * handling — index.html for any clean path so BrowserRouter (M5) takes over
 * client-side. `/img/*` is worker-first because the image route gates each
 * object on the session (an asset binding can't auth); `/share/*` is
 * worker-first so the /share/:token DOCUMENT can be augmented with Open Graph
 * meta before that same index.html is served (see the /share/:token handler).
 * Neither shadows a static asset: the SPA build emits hashed files under
 * /assets/*, so nothing real lives at /img/* or /share/*. The notFound fallback
 * below only matters for requests that did reach the Worker.
 */
import { Hono } from 'hono'

import { createAuth } from './auth'
import { injectIntoHead, renderShareMetaTags, shareMetaFromSnapshot } from './og'
import { imgApi } from './routes/img'
import { lookupCuratedShareSnapshot, shareApi } from './routes/share'
import { syncApi } from './routes/sync'
import { uploadsApi } from './routes/uploads'

const app = new Hono<{ Bindings: Env }>()

// Security response headers. CSP is tuned for the same-origin Vite/React +
// Tailwind SPA: `style-src 'unsafe-inline'` covers Tailwind/inline styles,
// `connect-src wss:` covers the /sync WebSocket, and img/font allow the
// same-origin /img pipeline plus data:/blob: previews. Kept deliberately
// permissive on connect-src/img-src so it can't break the live app.
const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload'],
  ['X-Content-Type-Options', 'nosniff'],
  ['X-Frame-Options', 'DENY'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  [
    'Permissions-Policy',
    'geolocation=(), camera=(), microphone=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
  ],
  [
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' wss: https:",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ].join('; '),
  ],
]

// Apply security headers to every Worker-handled response (additive — only
// these named headers are touched, so per-route Cache-Control/no-store,
// Set-Cookie, Content-Type, etc. are preserved). `c.header()` transparently
// reconstructs immutable upstream responses (e.g. the notFound SPA fallback
// served via ASSETS.fetch, and the augmented /share/:token document). NOTE: the
// assets binding's `run_worker_first` only routes /api/*, /sync, /img/* and
// /share/* through the Worker, so the SPA's HTML document for OTHER paths and
// the hashed /assets/* files are served directly by the binding and bypass this
// middleware — covering those needs an assets-side header config (out of scope
// here). The /share/:token HTML, being Worker-served, DOES get these headers.
// WebSocket (101) upgrade responses can't be rebuilt and need no document
// headers, so they're skipped.
app.use('*', async (c, next) => {
  await next()
  if (c.res.status === 101) return
  for (const [name, value] of SECURITY_HEADERS) {
    c.header(name, value)
  }
})

app.get('/api/health', (c) => c.json({ ok: true }))

// Chunked stamped seeding / clearing / meta for the user's GarageDO (M2).
// Each route validates the session before touching the DO.
app.route('/', syncApi)

// Image pipeline (M3): session-authed binding-proxy upload + delete-on-replace,
// and owner-only object serving. Each route validates the session first.
app.route('/', uploadsApi)
app.route('/', imgApi)

// Share links (M4): owner-authed create/list/revoke + PUBLIC (no session)
// snapshot and token-scoped image. The public routes live under /api/share/*
// (already worker-first via run_worker_first ["/api/*", ...]); they derive
// the owner/car/R2-key SERVER-SIDE from the validated share_links row.
app.route('/', shareApi)

// Better Auth owns everything under /api/auth/*.
app.on(['GET', 'POST'], '/api/auth/*', (c) =>
  createAuth(c.env).handler(c.req.raw),
)

// WebSocket sync. AUTH FIRST: the session is validated before the Durable
// Object is touched, and the DO name comes ONLY from the verified session's
// userId — never from client input.
app.get('/sync', async (c) => {
  const auth = createAuth(c.env)
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
    return c.json({ error: 'Expected a WebSocket upgrade request' }, 426)
  }
  const id = c.env.GARAGE_DO.idFromName(session.user.id)
  const stub = c.env.GARAGE_DO.get(id)
  // Rewrite the path so the DO's pathId is the verified userId (useful for
  // logging; the DO identity above is what actually isolates users).
  const url = new URL(c.req.raw.url)
  url.pathname = `/${session.user.id}`
  return stub.fetch(new Request(url, c.req.raw))
})

// Share-link DOCUMENT (M5): the /share/:token HTML page is served THROUGH the
// Worker (wrangler `run_worker_first` routes /share/* here) so we can inject
// Open Graph / Twitter meta for link-preview crawlers. We fetch the built SPA
// shell from the assets binding, then — for an ACTIVE link with a cover photo —
// inject CURATED-ONLY meta (title + count line + the PUBLIC token-scoped cover
// URL a crawler can fetch with no session). Invalid/expired/revoked/car-gone or
// no-photo falls back to the plain shell (the SPA renders the error state
// client-side). Either way the normal SPA bundle still loads, so React hydrates
// for human visitors. The security-headers middleware (app.use('*')) wraps this
// Worker response just like every other.
app.get('/share/:token', async (c) => {
  const url = new URL(c.req.url)
  // The assets binding serves index.html for any non-asset path
  // (single-page-application not_found_handling); ask for it explicitly.
  const shell = await c.env.ASSETS.fetch(new URL('/index.html', url.origin))
  if (!shell.ok) return shell
  const html = await shell.text()

  // PUBLIC + unauth lookup; ALWAYS curated (never 'full', even for a full link)
  // — see lookupCuratedShareSnapshot. Any DO/D1 hiccup degrades to the plain
  // shell rather than 500-ing the share page.
  let body = html
  try {
    const token = c.req.param('token')
    const snapshot = await lookupCuratedShareSnapshot(c.env, token)
    if (snapshot && snapshot.coverPhotoId !== undefined) {
      const meta = shareMetaFromSnapshot(snapshot, token, url.origin)
      body = injectIntoHead(html, renderShareMetaTags(meta))
    }
  } catch {
    body = html
  }
  return c.html(body)
})

app.notFound((c) => {
  // Unknown /api, /sync or /img routes are real 404s (e.g. a non-GET on /img/*);
  // anything else that somehow reached the Worker falls through to the static
  // SPA assets so navigation requests still render the app.
  const { pathname } = new URL(c.req.url)
  if (
    pathname.startsWith('/api/') ||
    pathname === '/sync' ||
    pathname.startsWith('/img/')
  ) {
    return c.json({ error: 'Not found' }, 404)
  }
  return c.env.ASSETS.fetch(c.req.raw)
})

export default app
export { GarageDO } from './durable/GarageDO'
