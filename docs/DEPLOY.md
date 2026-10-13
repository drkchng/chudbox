# Chudbox — Deploy Runbook

How Chudbox is deployed on Cloudflare, and how to set up your own copy. The app is a single **Worker + Static Assets** that serves the SPA, the Hono API, the sync WebSocket, and the image and share routes. It is backed by **Durable Objects** (SQLite, per-user garage sync), **D1** (auth and share links), and **R2** (images), on a **custom domain**.

## Current state

- **Live at https://chudbox.com**, deployed to Cloudflare Workers.
- **Continuous deployment:** every push to `master` runs `.github/workflows/deploy.yml` (see [CI/CD](#cicd)).
- **Config in the repo:** `apps/api/wrangler.jsonc` holds the bindings, the custom-domain route, and the non-secret vars. D1 migrations are in `apps/api/drizzle/`.
- **GitHub Actions secrets in use:** `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
- **Worker secrets in use:** `BETTER_AUTH_SECRET` and `RESEND_API_KEY` (set with `wrangler secret put`, never committed).
- **Email:** `chudbox.com` is a verified Resend sending domain (noted in `wrangler.jsonc`, 2026-06-18).
- **Old GitHub Pages site:** the earlier browser-only version at `drkchng.github.io/chudbox` is no longer updated. No workflow deploys to it, and `base` in `apps/web/vite.config.ts` is `'/'`.

> See [IAC.md](./IAC.md) for *why* wrangler owns the deploy (not Terraform) and the teardown checklist. Cost figures below were checked against Cloudflare and Resend docs on 2026-06-17.

---

## Costs

| Item | Cost | Notes |
|---|---|---|
| **Domain** | **~$10/yr** | The only unavoidable cost. Needed for same-origin auth and a custom domain. At-cost via Cloudflare Registrar (.com ≈ $10.44, no markup). |
| Workers + Durable Objects | **$0** | Free plan: 100k requests/day, SQLite-backed Durable Objects included. Optional **$5/mo** Workers Paid is **account-wide**, only if you outgrow Free. |
| R2 (images) | **$0** | 10 GB + 1M writes + 10M reads/mo free; **egress is free**. Billed only on overage. |
| D1 (auth + share_links) | **$0** | Free tier covers this scale (5M reads, 100k writes/day, 5 GB). |
| Resend (email) | **$0** | Free tier: 100/day, 3,000/mo. No card. |
| **Total** | **~$10/yr to start** | Plus an optional ~$5/mo later. No per-project fees; the $5 (if ever) is account-wide. |

---

## Setting up your own deployment

### Prerequisites (account and browser steps)

1. **Create a Cloudflare account.** No card is required for Workers, D1, and Durable Objects on the Free plan.
2. **Get a domain.** The easiest route is **Cloudflare Registrar**, which activates the zone automatically so the `custom_domain` route works. If you bring an existing domain, point its nameservers at Cloudflare first, and don't pre-create a conflicting CNAME on the target hostname.
3. **Enable R2.** ⚠️ **This is the only step that requires a credit card on file**, even though free-tier usage is $0 (no upfront charge and no minimum). R2 is the one card-gated, overage-billable service in the stack. If you would rather not add a card yet, you can deploy auth and sync (text-only) without R2 and add it later; see [Deferring R2](#spending-safety).
4. **Create an API token** (Cloudflare dashboard → My Profile → API Tokens). Start from the **"Edit Cloudflare Workers"** template, then ⚠️ **manually add `D1 → Edit`**, because the template omits it and `wrangler d1` commands fail without it. Confirm it also has `Workers R2 Storage: Edit` and `Zone → Workers Routes: Edit` for your domain's zone. Alternatively, authenticate locally with `wrangler login`.
5. **Create a Resend account** (no card) and get an API key. ⚠️ The test address `onboarding@resend.dev` only emails *your own* signup address. To send verification and reset emails to **real users**, verify your sending domain by adding **SPF and DKIM** TXT records (DMARC recommended).
6. **Set up Email Routing for the privacy contact.** The published Law 25 privacy contact is `LEGAL_CONTACT_EMAIL` in `packages/shared/src/legal.ts` (`privacy@chudbox.com`), shown on `/privacy`, `/terms`, and in Settings. In the dashboard, go to your zone → Email → Email Routing, enable it, add your personal address as a verified destination, and create a rule that forwards the privacy address to it. Until the rule exists, the published contact is unreachable by email. This is free and coexists with Resend's sending DNS records.
7. *(Optional)* Add the one free Cloudflare **rate-limit rule** on `^/api/(auth|share)/`. Image Transformations stay off; the image pipeline doesn't depend on them.

### Configuration to change

In `apps/api/wrangler.jsonc`:

- `routes[0].pattern`: your own hostname (the file currently points at `chudbox.com`).
- `d1_databases[0].database_id`: the id printed by `wrangler d1 create` below.
- `vars.BETTER_AUTH_URL`: `https://<your-domain>`.
- `vars.AUTH_EMAIL_FROM`: a sender on your verified Resend domain, e.g. `Chudbox <noreply@<your-domain>>`.
- `r2_buckets[0].bucket_name`: only if you name your bucket something other than `chudbox-images`.

`BETTER_AUTH_URL` and `AUTH_EMAIL_FROM` are **plain vars, not secrets**; keep them in `wrangler.jsonc`. Only the two values in step 4 below are secrets.

### First deploy (CLI)

Run these from the repo root after `pnpm install`.

```bash
# 1. Authenticate: either `wrangler login` (browser), or export the API token
export CLOUDFLARE_API_TOKEN=...      # Workers + R2 + D1 + Zone Routes edit

# 2. Create the account-level resources (one time):
pnpm --filter api exec wrangler d1 create chudbox            # copy database_id into wrangler.jsonc
pnpm --filter api exec wrangler r2 bucket create chudbox-images   # matches the BUCKET binding

# 3. Apply the D1 schema (Better Auth tables, share links, and later migrations):
pnpm --filter api exec wrangler d1 migrations apply chudbox --remote

# 4. Set the secrets (`secret put` reads stdin, so this is scriptable):
openssl rand -base64 32 | pnpm --filter api exec wrangler secret put BETTER_AUTH_SECRET
echo "<resend-key>"     | pnpm --filter api exec wrangler secret put RESEND_API_KEY

# 5. Build and deploy: Worker, Durable Object migration, D1/R2 bindings, SPA assets, custom domain
pnpm build
pnpm --filter api exec wrangler deploy
```

The Durable Object migration uses `new_sqlite_classes`, which is required on the Free plan.

### Deploying changes

After the first deploy you don't run these by hand: pushing to `master` does it (see below). Pending D1 migrations are applied automatically before each deploy.

---

## CI/CD

`.github/workflows/deploy.yml` runs on every push to `master` (and can be started manually with `workflow_dispatch`). It uses Node 24 and the pnpm version pinned in `package.json`, and runs, in order:

1. `pnpm install --frozen-lockfile`
2. `pnpm typecheck`
3. `pnpm lint`
4. `pnpm build`
5. `pnpm test`
6. `wrangler d1 migrations apply chudbox --remote` (from `apps/api`)
7. `wrangler deploy` (from `apps/api`)

A failing step stops the pipeline, so a broken change never reaches production. The build runs **before** the tests on purpose: `apps/api/test/og.test.ts` exercises the real `/share/:token` route, which reads `apps/web/dist/index.html` through the `ASSETS` binding. Deploys are serialized (a `deploy-production` concurrency group that does not cancel in-progress runs).

Required repository secrets (Settings → Secrets and variables → Actions):

| Secret | Purpose |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Token with Workers Scripts, D1, and R2 edit on the account (remember `D1: Edit`). |
| `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account id (dashboard → Workers overview). |

To skip a deploy for a docs-only change, put `[skip ci]` in the commit message.

The Playwright end-to-end suite (`pnpm test:e2e`) runs against a local `wrangler dev` server and is not part of this workflow.

---

## Spending safety

**There is no hard spend cap that auto-stops usage.** Cloudflare's 2026 **Budget Alerts** are explicitly *"informational only — they do not pause or cap usage."* The safety model is structural, not a switch:

- **Workers, Durable Objects, and D1 on Free** hard-stop with errors at the daily caps, with no overage, no charge, and no silent auto-upgrade to Paid. That is effectively a hard $0 ceiling. *Don't click upgrade unless you consciously accept overage billing.*
- **Resend Free** hard-stops at its quota and cannot bill you.
- **R2 is the only service that can bill** (card on file, no hard overage cap). Mitigations, in order:
  1. The app minimizes the blast radius: buckets are **private** (served only through the authenticated owner-only `/img` route and token-scoped share routes, never public), uploads are **authenticated, size-capped, and magic-byte validated**, and **egress is free** (no bandwidth denial-of-wallet).
  2. Set an **account Budget Alert** ($1–5): Manage Account → Billing → Billable Usage → Create budget alert (available because R2 makes the account pay-as-you-go).
  3. Add **R2 usage notifications** (storage → 10 GB, operations → free limits) under Notifications.
  4. Apply the **rate-limit rule** on `/api/(auth|share)/` at deploy time.
- **Deferring R2 (most conservative):** R2 is the *only* card-gated piece. You can deploy auth and text-only sync on a structurally $0, zero-card footprint, and add R2 (and the card) when you want cloud images. The app is layered exactly this way.

---

## Post-deploy smoke test

- Sign up → receive the Resend verification email → verify → sign in.
- Logged **out**, the app still works fully (local-first).
- Add a car on two devices → it syncs. Add a photo → it lands in R2 and is served through `/img`.
- Create a share link → open it logged out → you get the read-only page. Revoke it → the link returns 410.
- Paste a share link into a chat app → the link preview card renders.

## Local development

Local setup does not need any Cloudflare account. See the **Running locally** section of the [README](../README.md). Note that `wrangler.jsonc` pins `BETTER_AUTH_URL` to production, so local sign-in needs the `--var BETTER_AUTH_URL:http://localhost:8787` override described there.
