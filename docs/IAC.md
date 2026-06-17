# Infrastructure as Code — decision record

Researched 2026-06-12 against the live Cloudflare Terraform provider (v5.19.1), wrangler docs, and provider issue tracker.

## Decision: wrangler owns the code plane; no full Terraform adoption

**Do not Terraform the Worker stack.** Wrangler (`wrangler.jsonc` + CI `wrangler deploy`) is the source of truth for everything the app's lifecycle touches:

- Worker script + bindings (D1, R2, Durable Objects, Static Assets)
- DO migrations (`new_sqlite_classes` — **required** on the Free plan; classic DOs are Paid-only)
- D1 schema (`wrangler d1 migrations apply`)
- Custom domain (`routes` with `custom_domain: true` in wrangler.jsonc)
- Secrets (`wrangler secret put` / CI secrets — **never through Terraform state**)

This is declarative-enough IaC: the config is versioned in the repo, applied idempotently by CI, and reviewable in PRs.

## Why not the Cloudflare Terraform provider

- Provider v5 (auto-generated from the OpenAPI spec) has **~15% of resources with open correctness issues**; the `cloudflare_workers_script` DO-migration path has been repeatedly broken (#5898, #5701, #6322, #6852) — exactly the resource we'd depend on.
- Worker deploys through Terraform couple infra applies to every code change — wrong cadence, and drift between `terraform apply` and `wrangler dev` semantics.
- Secrets in Terraform land in state files. Hard no (Better Auth secret, Resend key).

## The small remainder: one-time zone glue

A few account/zone-level toggles sit outside wrangler. Options: a tiny idempotent **bootstrap script** (curl against the CF API, checked into `scripts/`) or a **minimal OpenTofu root** covering only these — either is fine; the bootstrap script is the default choice until the count grows:

1. **Image Transformations toggle** (per-zone) — NOT Terraformable on the Free plan anyway; flip in dash or via API.
2. **One rate-limiting rule** (Free plan allows exactly one): match `^/api/(auth|share)/`.
3. **DNS records** for the custom domain (if the zone isn't already on Cloudflare).

If OpenTofu is ever adopted for this: R2 works as an S3-compatible state backend (no extra service), and pin the provider hard.

## Watching, not betting

- **Alchemy** (TypeScript-native CF IaC) — promising fit for this stack but pre-1.0; re-evaluate at 1.x.

## CLI choice — checked 2026-06-12

**Stay on wrangler (v4). Cloudflare is not replacing or deprecating wrangler.**

- The "new CLI" is **`cf`** (npm `cf`, v0.0.6, published 2026-05-28 by workers-sdk maintainers) — an official Cloudflare **Technical Preview** announced 2026-04-13 ([blog](https://blog.cloudflare.com/cf-cli-local-explorer/)). It is the front end of the *future* Wrangler, not a separate successor: "this Technical Preview is just a small piece of the future Wrangler CLI, and over the coming months it will be brought together with the parts of Wrangler you know and love." Not `cloudflared`, `c3`, or `flarectl`.
- It covers only a small subset of products today and has no confirmed parity for what we depend on: DO `new_sqlite_classes` migrations, `d1 migrations apply`, Static Assets `run_worker_first`, secrets, CI `wrangler deploy`, and `@cloudflare/vitest-pool-workers`. Same pre-1.0 "watch, don't bet" posture as Alchemy — re-evaluate when `cf` GA's and merges into Wrangler.
- Meanwhile wrangler v4 is actively expanding (4.100.0, 2026-06-11; experimental TS config via `--x-new-config`), so there is no migration pressure.

## Teardown — checked 2026-06-12

Wrangler is purely imperative: no `destroy`, no state file, no drift detection. `wrangler deploy` push-uploads the script + declared bindings idempotently — DO namespaces are created via the `new_sqlite_classes` migration, Static Assets are uploaded, and the custom-domain route is provisioned with its proxied DNS record — but it does **not** create D1 databases or R2 buckets. Those are account-level resources made once (`wrangler d1 create`, `wrangler r2 bucket create`) and referenced by id/name; the only "state" wrangler tracks is DO migration tags.

`wrangler delete` removes only Worker-scoped state: the script, its secrets, its routes/custom-domain binding, and the Worker's DO namespaces **including all stored DO SQLite data** (destroyed, not recoverable — same finality as a `deleted_classes` migration). It leaves account-level resources orphaned: D1 databases, R2 buckets + their objects, Queues, KV. So a full clean teardown is a manual per-resource checklist, not a `terraform destroy`:

1. `wrangler r2 bucket delete <bucket>` — must empty objects first; non-empty buckets refuse and there's no bulk wrangler purge.
2. `wrangler d1 delete <db>`.
3. `wrangler delete` — script + secrets + routes + DO namespaces & their data.
4. Later additions only: `wrangler queues delete <q>`, `wrangler kv namespace delete <ns>`.
5. The CF zone and the Registrar domain registration survive independently — remove in dash if desired.

Back up D1/R2/DO data before deleting: DO SQLite data dies with the Worker, and there is no reconciliation pass to catch what the checklist misses.
