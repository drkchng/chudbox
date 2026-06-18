/**
 * Chudbox Worker — Hono router.
 *
 * `run_worker_first: ["/api/*", "/sync", "/img/*"]` in wrangler.jsonc scopes
 * the Worker to exactly these paths; every other request is served directly
 * from the static assets binding (the SPA), with `single-page-application`
 * not-found handling. `/img/*` is worker-first because the image route gates
 * each object on the session (an asset binding can't auth). It does not shadow
 * any static asset: the SPA build emits hashed files under /assets/* and routes
 * client-side via HashRouter (after `#`), so nothing real lives at /img/*.
 * The notFound fallback below only matters for requests that did reach the
 * Worker.
 */
import { Hono } from 'hono'

import { createAuth } from './auth'
import { imgApi } from './routes/img'
import { shareApi } from './routes/share'
import { syncApi } from './routes/sync'
import { uploadsApi } from './routes/uploads'

const app = new Hono<{ Bindings: Env }>()

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
