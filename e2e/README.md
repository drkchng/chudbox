# Chudbox E2E (Playwright) — Mode 1: local `wrangler dev`

End-to-end browser tests that drive the **real** stack — the built React SPA, the
Hono Worker, Better Auth, and emulated D1 / R2 / Durable Objects — against a
local `wrangler dev`. No cloud, no production data, no real email, no cost.

```bash
pnpm test:e2e            # one command: builds the SPA, boots wrangler dev, runs the suite
pnpm test:e2e:ui         # same, in the Playwright UI runner
pnpm test:e2e:typecheck  # type-check the suite without running it
```

> **First run on a machine/CI:** install the browser + its system libraries once
> (needs `sudo`/root for the libs):
>
> ```bash
> pnpm exec playwright install --with-deps chromium
> ```
>
> `@playwright/test` and the Chromium binary are already in the workspace; only
> the OS libraries (libnss3, libnspr4, libgbm, libasound2, …) need installing,
> which is what `--with-deps` does.

---

## What it covers

| Spec | Flow |
| --- | --- |
| `tests/auth.spec.ts` | Sign up → verify (via the dev-fallback link) → sign in; plus sign-in refused before verification. |
| `tests/car-mod.spec.ts` | Add a car → land on `/car/:id` → log a mod → it appears. |
| `tests/mileage-units.spec.ts` | Settings km/mi toggle **converts the displayed number** (100,000 mi → 160,934 km), not just the unit label. |
| `tests/modal-dismiss.spec.ts` | AddCar modal closes on **Escape** and on a **backdrop click**; an inside-content click does not. |
| `tests/share.spec.ts` | Create a share link → open `/share/:token` in a fresh **logged-out** context → curated read-only page, no edit controls; the "Everything" scope adds the extra sections. |

All routes are the **clean BrowserRouter URLs** (`/`, `/car/:id`, `/share/:token`,
`/auth/verified`) — no `#`.

## How the harness works (`harness/devServer.mjs`)

Playwright's `webServer` runs `node e2e/harness/devServer.mjs`, which:

1. wipes + recreates an **isolated** local-persistence dir at `e2e/.tmp/state`
   (the emulated D1 / R2 / DO live there — never your normal `apps/api/.wrangler`
   dev data, never production);
2. **generates** an isolated wrangler config (`e2e/.tmp/wrangler.e2e.json`) with
   absolute paths, `localhost` vars, and **no production routes** — see
   *Gotchas* below for why a generated config is required;
3. builds the SPA (`turbo run build --filter=web`, which builds `@chudbox/shared`
   first) so wrangler serves `apps/web/dist`;
4. applies the D1 migrations (`drizzle/`) to the isolated DB;
5. boots `wrangler dev --local`, teeing its output to `e2e/.tmp/wrangler-dev.log`.

Playwright waits on `GET /api/health` before the suite starts. Everything under
`e2e/.tmp/` is gitignored and recreated on every boot, so cleanup is just
removing that directory.

### Email verification without real email

`RESEND_API_KEY` is intentionally **unset**, so `apps/api/src/email.ts` takes the
dev-fallback path and **logs** the verification link instead of sending mail:

```
[auth-email] (dev fallback, RESEND_API_KEY not set) to=<email> subject="Verify your Chudbox email" link=<url>
```

`harness/email.ts` tails the teed log for that line and drives the link to
complete verify → auto-sign-in. **Why the log and not D1:** in Better Auth 1.6.18
the email-verification token is a stateless signed **JWT embedded in the URL** —
it is *not* written to the D1 `verification` table (verified empirically: that
table is empty for a fresh signup). The log line is the only local source of the
usable link. (`harness/d1.ts` still reads the local D1 directly for server-side
ground truth, e.g. asserting `email_verified` flipped.)

## Gotchas (why the harness is shaped this way)

- **Generated wrangler config, not `--env-file`/`--var`.** `apps/api/wrangler.jsonc`
  pins production `vars` (`BETTER_AUTH_URL=https://chudbox.com`, `AUTH_EMAIL_FROM`).
  In wrangler 4.100 those config `vars` **win** over both `--env-file` secrets and
  `--var` flags for the same key, so the Worker would run as Better Auth
  `baseURL=chudbox.com` — which rejects same-origin localhost requests
  (`INVALID_ORIGIN`) **and points verification links at production**. A dedicated
  generated config is the only deterministic override; it also guarantees the
  dev-fallback email path (no `RESEND_API_KEY`, and no `.dev.vars` beside the
  generated config), and the repo-root `.env` is never read.
- **`localhost`, not `127.0.0.1`.** Better Auth issues the auto-sign-in cookie for
  the request host and logs verify links using `BETTER_AUTH_URL`'s host; the
  base URL is `http://localhost:8788` so the cookie stays in scope across the
  verify redirect. wrangler binds `127.0.0.1`, which `localhost` resolves to.
- **Serial, single-worker.** All specs share one local server (one D1/DO/R2).
  Tests isolate via unique accounts (`uniqueEmail()`) and fresh browser contexts;
  serial execution keeps the shared dev server unstressed and the shared email
  log unambiguous.
- **Locale pinned to `en-US`** (in `playwright.config.ts`) so mileage grouping
  (`toLocaleString`) is deterministic (`160,934`).

## Layout

```
playwright.config.ts          # repo root: testDir + webServer wiring
e2e/
  harness/
    config.ts                 # ports, paths, base URL, email subjects
    devServer.mjs             # webServer command: build + migrate + boot wrangler
    email.ts                  # tail the dev-fallback log → drive verification
    d1.ts                     # query the local D1 (wrangler d1 execute --local)
    actions.ts                # reusable UI flows (addCar, addMod, sign-up/in, sync…)
  tests/*.spec.ts             # the five flows
  tsconfig.json               # `pnpm test:e2e:typecheck`
  .tmp/                       # gitignored runtime scratch (state, log, generated config)
```

## Port

Defaults to `8788` (so it doesn't clash with a normal `wrangler dev` on 8787).
Override with `E2E_PORT` — `devServer.mjs` bakes the chosen port into the
generated config's `BETTER_AUTH_URL`, and `playwright.config.ts` reads the same
constant.

## CI (GitHub Actions)

```yaml
name: e2e
on: [push, pull_request]

jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4
        with:
          version: 11.6.0

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      # Chromium + its OS libraries (the suite uses the chromium project only).
      - run: pnpm exec playwright install --with-deps chromium

      # Builds the SPA, boots wrangler dev (emulated D1/R2/DO, dev-fallback email),
      # and runs all specs. CI=1 makes wrangler non-interactive and the config
      # adds retries.
      - run: pnpm test:e2e
        env:
          CI: '1'

      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: playwright-report
          path: e2e/playwright-report/
          retention-days: 7
```
