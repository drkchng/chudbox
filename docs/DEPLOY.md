# Chudbox — Deploy Runbook

How to take Chudbox live on Cloudflare. The app is a single **Worker + Static Assets** serving the SPA, the Hono API, the sync WebSocket, and image/share routes, backed by **Durable Objects** (SQLite, per-user garage sync), **D1** (auth + share links), and **R2** (images), on a **custom domain**.

The code, `wrangler.jsonc`, and D1 migrations are all in the repo — only the real resource IDs and secrets are placeholders. Nothing has been deployed; GitHub Pages is frozen (no further pushes) and `base` is already `'/'`.

> See [IAC.md](./IAC.md) for *why* wrangler owns the deploy (not Terraform) and the teardown checklist. Verified against live Cloudflare/Resend docs 2026-06-17.

---

## Costs

| Item | Cost | Notes |
|---|---|---|
| **Domain** | **~$10/yr** | The only unavoidable cost. Needed for same-origin auth + custom domain. At-cost via Cloudflare Registrar (.com ≈ $10.44, no markup). |
| Workers + Durable Objects | **$0** | Free plan: 100k req/day, SQLite DOs included. Optional **$5/mo** Workers Paid is **account-wide**, only if you outgrow Free. |
| R2 (images) | **$0** | 10 GB + 1M writes + 10M reads/mo free; **egress free**. Billed only on overage. |
| D1 (auth + share_links) | **$0** | Free tier covers this scale (5M reads, 100k writes/day, 5 GB). |
| Resend (email) | **$0** | Free tier: 100/day · 3,000/mo. No card. |
| **Total** | **~$10/yr to start** | + optional ~$5/mo later. No per-project fees — the $5 (if ever) is account-wide. |

---

## Before you start — what only you can do (account / browser)

1. **Create a Cloudflare account.** No card required for Workers/D1/DO Free.
2. **Get the domain.** Easiest: buy through **Cloudflare Registrar** — it auto-activates the zone (no nameserver step), so the `custom_domain` deploy just works. (Bringing an existing domain = point its nameservers at Cloudflare first.) Don't pre-create a clashing CNAME on the target hostname.
3. **Enable R2.** ⚠️ **This is the only step that requires a credit card on file** — even though free-tier usage is $0 (no upfront charge, no $5 minimum). R2 is the one card-gated, overage-billable surface in the stack. *(If you'd rather not put a card down yet, you can deploy auth + sync (text-only) without R2 and add it later — see "Deferring R2" below.)*
4. **Create an API token** (Cloudflare dash → My Profile → API Tokens). Start from the **"Edit Cloudflare Workers"** template, then ⚠️ **manually add `D1 → Edit`** — the template omits it and `wrangler d1` commands fail without it. Confirm it also has `Workers R2 Storage: Edit` and `Zone → Workers Routes: Edit` for your domain's zone. Hand me this token (or run `! wrangler login` for interactive browser OAuth).
5. **Resend account.** Sign up (no card), get an API key. ⚠️ The test address `onboarding@resend.dev` only emails *your own* signup address — to send verification/reset emails to **real users** you must verify your sending domain (add **SPF + DKIM** TXT records, DMARC recommended). Since DNS is on Cloudflare, I can add those records via CLI.
6. **Email Routing for `privacy@chudbox.com`** (dash → your zone → Email → Email Routing): enable it, add your personal address as a verified destination, and create the routing rule `privacy@chudbox.com → <your inbox>`. This is the published Law 25 privacy contact (`LEGAL_CONTACT_EMAIL` in `packages/shared/src/legal.ts`, shown on /privacy, /terms, and in Settings); until this rule exists the published contact is unreachable by email. Free; coexists with Resend's *sending* DNS records (routing adds its own MX).
7. *(Optional, deferred)* The one free Cloudflare **rate-limit rule** on `^/api/(auth|share)/`. Image Transformations stay off (the image pipeline doesn't depend on them).

---

## Spending safety

**There is no hard spend cap that auto-stops usage.** Cloudflare's 2026 **Budget Alerts** are explicitly *"informational only — they do not pause or cap usage."* The safety model is structural, not a switch:

- **Workers + Durable Objects + D1 on Free** hard-stop with errors at the daily caps — **no overage, no charge, and no silent auto-upgrade** to Paid. Effectively a hard $0 ceiling. *Don't click upgrade unless you consciously accept overage billing.*
- **Resend Free** hard-stops at its quota — cannot bill you.
- **R2 is the only surface that can bill** (card on file, overage has no hard cap). Mitigations, in order:
  1. The app already minimizes the blast radius: buckets are **private** (served only via the authed owner-only `/img` and token-scoped share routes — never public), uploads are **authed + size-capped + magic-byte-validated**, and **egress is free** (no bandwidth denial-of-wallet).
  2. Set an **account Budget Alert** ($1–5): Manage Account → Billing → Billable Usage → Create budget alert (you qualify because R2 makes the account pay-as-you-go).
  3. Add **R2 usage notifications** (storage → 10 GB, ops → free limits) under Notifications.
  4. Apply the **rate-limit rule** on `/api/(auth|share)/` at deploy.
- **Deferring R2 (max paranoia):** R2 is the *only* card-gated piece. You can deploy **M1 + M2 (auth + sync, text-only)** on a structurally-$0, zero-card footprint and add R2 (and the card) when you want cloud images. The app is layered exactly this way.

---

## Deploy sequence (CLI — runs from here once you've done the above)

```bash
# 1. Auth: either `wrangler login` (browser) or export the API token:
export CLOUDFLARE_API_TOKEN=...    # token with Workers + R2 + D1 + Zone-Routes Edit

# 2. Create the account-level resources (one-time):
wrangler d1 create chudbox                 # → copy the database_id into apps/api/wrangler.jsonc
wrangler r2 bucket create chudbox-images   # → matches the BUCKET binding

# 3. Apply the D1 schema (Better Auth tables + share_links — already authored):
pnpm --filter api exec wrangler d1 migrations apply chudbox --remote

# 4. Set secrets (secret put reads stdin, so this is scriptable):
openssl rand -base64 32 | wrangler secret put BETTER_AUTH_SECRET
echo "https://<your-domain>" | wrangler secret put BETTER_AUTH_URL
echo "<resend-key>"          | wrangler secret put RESEND_API_KEY
echo "noreply@<your-domain>" | wrangler secret put AUTH_EMAIL_FROM

# 5. Build + deploy (Worker + DO migration + D1/R2 bindings + SPA assets + custom domain):
pnpm exec turbo run build
pnpm --filter api exec wrangler deploy
```

Before deploy, replace the placeholder `database_id` (and confirm the `routes`/`custom_domain` hostname) in `apps/api/wrangler.jsonc`. The DO migration uses `new_sqlite_classes` (required on Free).

---

## CI

`cloudflare/wrangler-action` with `CLOUDFLARE_API_TOKEN` as a repo secret is the standard path: on push → `pnpm i` → `turbo build` → `wrangler d1 migrations apply --remote` → `wrangler deploy`. Same token/scopes as above (remember `D1: Edit`).

---

## Post-deploy smoke

- Sign up → receive the Resend verification email → verify → sign in.
- Logged **out**, the app still works fully (local-first).
- Add a car on two devices → it syncs. Add a photo → it lands in R2, serves via `/img`.
- Create a share link → open it logged-out → curated read-only page; revoke → 410.
