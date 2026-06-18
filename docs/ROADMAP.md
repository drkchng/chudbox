# Chudbox — Build Sequencing Roadmap

> Dependency-ordered plan, grounded in `DESIGN_REVIEW.md` (DEC-1..19 + 73 findings),
> `DATA_MODEL.md` (the expand→contract migration), `COMPLIANCE.md`, `PAYMENTS.md`.
> Greenfield, no live users — optimize for a coherent end state, not incremental safety.

## Phase 0 — Design foundation ✅ DONE (`3411c7b`)
Tailwind v4 + token SSOT (RN-ready) + Base UI primitives + log-first pilot (CarCard, Add-Car). Verified.

## Phase 1 — Roll the design system across all surfaces (#26)
Rebuild the remaining ~30 components on the tokens + primitives: CarProfile + tabs, the other modals (on
`<Modal>`), Settings (+ export/import → **Backup & data**, DEC-12), Garage, the share view (**photos-first**
DEC-8 + **logo-home/CTA** DEC-9). Pure UI, **no data-model dependency**. Fold in the 4 pilot nits.
→ The visible redesign; ends with a coherent app worth deploying.

## Phase 2 — Data-model EXPAND (one additive deploy, reader-first) — `DATA_MODEL §15.8`
A single schema-superset + contracts deploy shipped to ALL clients **before any writer** (a laggard on the
old schema would drop unknown synced cells):
- Garage: `photos.source/sourceId`, `cars.bannerPhoto` + `cars.vin`, new tables `mileage` + `savedBuilds`.
- D1: `ALTER user ADD show_owner_name DEFAULT 1`; `scope += 'listing'` (code-only).
- Snapshot/contracts: curated/listing/full **purpose-gating** + the **structural OG downgrade** + validators.
- Ships WITH the DEC-6 **photo delete-cascade** (re-parent to General; never destroy bytes).
Unblocks every data feature below. **No backfill here.**

## Phase 3 — Feature builds (on EXPAND; each is the writers/SWITCH for its slice)
- **Mileage check-ins** (DEC-16): backfill scalar → first check-in (the ONLY backfill, delete-safety gated),
  dual-write transition, mileage-over-time, maintenance-due/overdue (U2). *[the proactive spine]*
- **Unified photos** (DEC-6): per-item attach + filterable gallery + explicit cover/banner.
- **Share layer**: purpose Showcase/Listing (DEC-14) + VIN (DEC-13) + owner name (DEC-10) + plate (DEC-19);
  (photos-first DEC-8 + home nav DEC-9 came in Phase 1).
- **Follow/save builds** (DEC-11): `savedBuilds` + the **Watching** surface + live refetch — **TanStack
  Query enters here**, for the read surfaces only.

## Phase 4 — Infra-gated
- **Account-deletion that purges DO + R2** — **ELEVATED**: `cars.vin` + `savedBuilds` bearer tokens are
  sensitive at rest in the DO, so this must land before/with the privacy pass and before DO-resident
  sensitive data reaches real users (`DATA_MODEL §15.11 #1`; closes backend gap G4). Also fix the R2-orphan
  delete endpoint.
- **Reminders + push** (DEC-18): CF Cron Trigger + synced push tokens; predicts mileage-due from usage rate.
  *[needs DEC-16 + accounts]*

## Phase 5 — Compliance gate (BEFORE marketing) — `COMPLIANCE.md`
Privacy policy + named privacy officer + `privacy@` contact + cross-border EFVP/DPAs (Cloudflare, Resend) +
the deletion hook (Phase 4) + breach plan. Gate before onboarding real users — not a dev blocker.

## Phase 6 — Paid tier — `PAYMENTS.md`
MoR (Polar with QST confirmed, else Paddle) + an entitlement check in the Workers backend. Annual or >$5.

## Phase 7 — Native app (Expo + Unistyles)
Reuse `packages/shared` (logic + token SSOT); RN UI on Unistyles; web-purchase + app-login; RevenueCat for IAP.

## Cross-cutting gates / open policy calls (owner sign-off at the relevant phase)
- **#268 ceiling:** a heavy-logger envelope (~70k cells at 50 cars × 200 check-ins) exceeds the 20k shard
  budget — staging probe + display downsampling before the data-feature cutover (`DATA_MODEL §15.8`).
- **Curated photo filter** (`§15.7▼`): does a Showcase hide issue/damage photos? Changes already-issued
  shares → your call when building photos/share.
- **Listing consent** (DEC-10×14): master `show_owner_name` wins (listing nudges); add a per-link override
  only if listings should *force* the seller name.
- **`coverPhoto→coverPhotoId`** rename deliberately deferred (a CRDT cell rename is its own expand-contract).

## Parallelizable
**Phase 1 (UI redesign) and Phase 2 (data EXPAND) are independent** — can run concurrently. Phase 3 features
are largely independent of each other once EXPAND lands.
