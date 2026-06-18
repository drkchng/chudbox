// @ts-nocheck
/**
 * Mode-1 E2E server orchestrator — the target of Playwright's `webServer.command`.
 *
 * Does, in order, then stays in the foreground so Playwright owns its lifecycle:
 *   1. wipes + recreates an ISOLATED local-persistence dir (no shared dev/prod state),
 *   2. GENERATES an isolated wrangler config (absolute paths, localhost vars, no
 *      production routes) — see WHY below,
 *   3. builds the SPA (`turbo run build --filter=web` — builds @chudbox/shared first),
 *   4. applies D1 migrations to that isolated dir (via the normal apps/api config —
 *      same DB name + persist dir, so it's the same local D1),
 *   5. boots `wrangler dev --local --config <generated>`, teeing output to a log
 *      file the email-verify helper tails.
 *
 * WHY a generated config instead of --env-file / --var:
 *   apps/api/wrangler.jsonc pins production `vars` (BETTER_AUTH_URL=chudbox.com,
 *   AUTH_EMAIL_FROM). In wrangler 4.100 those config `vars` WIN over both
 *   `--env-file` secrets and `--var` flags for the same key — so the Worker would
 *   run as Better Auth baseURL=chudbox.com, which (a) rejects same-origin localhost
 *   requests with INVALID_ORIGIN and (b) points verification links at PRODUCTION.
 *   A dedicated config is the only deterministic override. It also guarantees the
 *   dev-fallback email path: with no RESEND_API_KEY var and no .dev.vars beside the
 *   generated config, RESEND_API_KEY is undefined => email.ts logs the link, sends
 *   nothing (no network, no real mail). The repo-root .env is never read.
 *
 * Playwright waits on GET /api/health (see playwright.config.ts), so steps 3-4
 * complete before the suite starts. Paths MUST mirror e2e/harness/config.ts.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HARNESS_DIR = dirname(fileURLToPath(import.meta.url))
const E2E_DIR = resolve(HARNESS_DIR, '..')
const REPO_ROOT = resolve(E2E_DIR, '..')
const API_DIR = join(REPO_ROOT, 'apps', 'api')
const WEB_DIST = join(REPO_ROOT, 'apps', 'web', 'dist')
const DRIZZLE_DIR = join(API_DIR, 'drizzle')
const WORKER_MAIN = join(API_DIR, 'src', 'index.ts')
const TMP_DIR = join(E2E_DIR, '.tmp')
const STATE_DIR = join(TMP_DIR, 'state')
const LOG_FILE = join(TMP_DIR, 'wrangler-dev.log')
const CONFIG_FILE = join(TMP_DIR, 'wrangler.e2e.json')

const PORT = String(process.env.E2E_PORT ?? 8788)
const BASE_URL = `http://localhost:${PORT}`

// CI=1 keeps wrangler non-interactive (no update prompts); metrics off for hermeticity.
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }

function step(label, cmd, args, opts = {}) {
  process.stdout.write(`\n[e2e-harness] ${label}\n`)
  const res = spawnSync(cmd, args, { stdio: 'inherit', env, ...opts })
  if (res.status !== 0) {
    process.stderr.write(`[e2e-harness] FAILED: ${label} (exit ${res.status})\n`)
    process.exit(res.status ?? 1)
  }
}

// 1. Fresh isolated persistence + log + config.
rmSync(STATE_DIR, { recursive: true, force: true })
rmSync(LOG_FILE, { force: true })
mkdirSync(STATE_DIR, { recursive: true })

// 2. Generate the isolated wrangler config (absolute paths; localhost vars).
//    NO RESEND_API_KEY => dev-fallback email. BETTER_AUTH_URL pinned to the test
//    origin so verification links land on THIS server and same-origin auth works.
const e2eConfig = {
  name: 'chudbox',
  main: WORKER_MAIN,
  compatibility_date: '2026-06-01',
  compatibility_flags: ['nodejs_compat'],
  vars: {
    BETTER_AUTH_URL: BASE_URL,
    BETTER_AUTH_SECRET: 'e2e-local-only-secret-not-for-production-0000',
    AUTH_EMAIL_FROM: 'Chudbox <dev@localhost>',
  },
  d1_databases: [
    {
      binding: 'DB',
      database_name: 'chudbox',
      database_id: '40423aaf-0d07-41ba-9177-ea29912a741d',
      migrations_dir: DRIZZLE_DIR,
    },
  ],
  r2_buckets: [{ binding: 'BUCKET', bucket_name: 'chudbox-images' }],
  durable_objects: { bindings: [{ name: 'GARAGE_DO', class_name: 'GarageDO' }] },
  migrations: [{ tag: 'v1', new_sqlite_classes: ['GarageDO'] }],
  assets: {
    directory: WEB_DIST,
    binding: 'ASSETS',
    not_found_handling: 'single-page-application',
    run_worker_first: ['/api/*', '/sync', '/img/*', '/share/*'],
  },
}
writeFileSync(CONFIG_FILE, JSON.stringify(e2eConfig, null, 2))

// 3. Build the SPA wrangler will serve from apps/web/dist.
step('building web (turbo run build --filter=web)…', 'pnpm', ['exec', 'turbo', 'run', 'build', '--filter=web'], { cwd: REPO_ROOT })

// 4. Apply D1 migrations to the isolated local DB (non-interactive). The normal
//    apps/api config + the same --persist-to dir => the same local database the
//    Worker will open.
step(
  'applying D1 migrations (local)…',
  'pnpm',
  ['exec', 'wrangler', 'd1', 'migrations', 'apply', 'chudbox', '--local', '--persist-to', STATE_DIR],
  { cwd: API_DIR, stdio: ['ignore', 'inherit', 'inherit'] },
)

// 5. Boot wrangler dev (long-lived). Tee output -> parent stdio + log file.
process.stdout.write('\n[e2e-harness] starting wrangler dev…\n')
const logStream = createWriteStream(LOG_FILE, { flags: 'a' })
const child = spawn(
  'pnpm',
  ['exec', 'wrangler', 'dev', '--config', CONFIG_FILE, '--local', '--port', PORT, '--ip', '127.0.0.1', '--persist-to', STATE_DIR],
  { cwd: API_DIR, env },
)
child.stdout.on('data', (d) => {
  process.stdout.write(d)
  logStream.write(d)
})
child.stderr.on('data', (d) => {
  process.stderr.write(d)
  logStream.write(d)
})
child.on('exit', (code) => {
  logStream.end()
  process.exit(code ?? 0)
})

// Forward termination so wrangler (and its workerd children) shut down with us.
function shutdown() {
  try {
    child.kill('SIGTERM')
  } catch {
    /* already gone */
  }
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
