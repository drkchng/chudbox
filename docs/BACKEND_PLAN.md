# Add a backend to Chudbox (offline-first sync, auth, image storage)

> Hardened by an adversarial review pass (db-engineer + skeptic, 2026-06-09) — see **Review & hardening** at the end for what changed and why.
>
> Re-audited 2026-06-12 (Fable, against repo HEAD `19e470d` + live sources): verdict **sound — amendments folded in**. Stack pins re-verified current (TinyBase 8.4.2 still latest, #268 still open/unchanged, Better Auth 1.6.18). Corrections: `dist/` was never committed; backup-v1 contract is narrower than assumed; `maintenance.mileageRaw` is nullable. Additions: test harness (the M2 gate had no runner), R2 presign credential dependency, PRODUCT.md update, account-deletion lifecycle, seed-slicing validity check + fallback, auth rate limiting.

## Context

**The app today.** Despite the repo name `vroomshop`, the app is **"Chudbox"** — a React 19 + Vite 8 + TypeScript SPA (Tailwind, react-router `HashRouter`), deployed as static files to **GitHub Pages** under base `/chudbox/`. It is **100% local-first**: no backend, no auth, no network calls. All state is one global Zustand store (`src/store/useGarageStore.ts`) persisted as a single JSON blob to IndexedDB (key `garage-store`) via `localforage`. The domain model (`src/types.ts`) is a single **nested `Car` aggregate** with embedded arrays (`photos[]`, `wishlist[]`, `mods[]`, `maintenance[]`, `todos[]`, `issues[]`); **images are base64 `dataUrl` strings stored inline**. There is no `userId`/ownership anywhere and no seed data.

**Why change.** The user wants data to live "in multiple places": durable cloud storage, cross-device access, and room to grow (including native mobile apps later). Concretely: blob storage for images, a real database, and TypeScript business logic with auth — **without** the risk of a usage-based "surprise bill," and without losing the app's instant, offline-first feel.

**Intended outcome.** A monorepo where the existing SPA keeps working offline with **no account required**, and **signing in turns on cross-device sync + cloud backup** (migrating the local garage up). Images move to object storage. A future Expo mobile app reuses a shared package. Cost starts at **~$0** and is flat/predictable even at the optional Paid tier (~$5/mo), with **zero image-egress fees**.

## Decisions (locked with the user)

| Area | Decision |
|---|---|
| Host | **Cloudflare** serverless |
| Sync model | **Full offline-first** + cross-device merge (single-owner ⇒ last-write-wins for same-row edits; initial account adoption needs explicit reconciliation — see Migration) |
| Accounts | **Optional** — app works with no account; **sign in to sync**. Private per-user garages + **read-only public share links** for a car |
| Auth | **Better Auth**, email/password + **email verification & password reset** (email via **Resend** free tier) |
| Sync engine | **TinyBase `MergeableStore`** (per-cell HLC last-write-wins) synced via **one Cloudflare Durable Object per user**, persisted in **fragmented (per-cell) mode** |
| Database | **D1** (SQLite) for auth + share-links; garage content lives in each user's **DO SQLite** |
| Images | **R2** (zero egress); client downscales, uploads via presigned PUT, store keeps only the object key — **never** in the synced store |
| Repo | **Monorepo** — pnpm workspaces + Turborepo; `packages/shared` is RN-safe for future mobile |
| API runtime | **Hono** on Workers; **Drizzle** for D1 schema/migrations; **Zod** (shared) for validation |
| Frontend deploy | Move off GitHub Pages → **single Worker with Static Assets** (SPA + `/api` + `/sync` same-origin) on a custom domain |

*Stack checked against current docs/source on 2026-06-09: TinyBase **v8.4.2** (incl. the open #268 fragmented-persister timeout — see Risk #1), Better Auth v1.6.x (native D1 since 1.5), Durable Objects SQLite GA (available on Workers **Free**), R2 zero-egress, Workers Static Assets + `run_worker_first`. The fragmented-mode write ceiling is treated as a must-measure unknown, not a verified constant.*

## Architecture overview

```
                       ┌─────────────────────────── one Cloudflare Worker (custom domain) ───────────────────────────┐
  Browser / Expo app   │                                                                                              │
  ┌────────────────┐   │  Hono router (run_worker_first scopes /api + /sync; everything else = static SPA assets)     │
  │ TinyBase       │   │   ├─ /api/auth/*   → Better Auth (native D1)                                                 │
  │ MergeableStore │◄──┼── /sync (WebSocket)→ validate session cookie → route to GarageDO.idFromName(verified userId)  │
  │  + IndexedDB   │   │   ├─ /api/uploads  → presigned R2 PUT (key prefix from session)                              │
  │  (offline)     │   │   ├─ /api/share/*  → token-gated read-only car snapshot (no account)                         │
  └──────┬─────────┘   │   └─ /img/*        → auth/token-gated image fetch (R2 + /cdn-cgi/image)                      │
         │ WS sync      │                                                                                              │
         ▼              │   D1: user/session/account/verification (+ share_links)     R2: u/<uid>/<carId>/<photoId>    │
  ┌────────────────┐    │   Durable Object per user: MergeableStore → DO-SQLite in FRAGMENTED (per-cell) mode          │
  │ GarageDO (DO)  │◄───┘                                                                                              │
  └────────────────┘                                                                                                  └─
```

- **Logged out:** TinyBase store persists only to local IndexedDB. App behaves exactly like today.
- **Logged in:** a `WsSynchronizer` attaches and reconciles the local store with the user's DO; writes stay local-first/optimistic, sync in the background. The DO's SQLite is the durable source of record; clients are full offline replicas.
- **Auth seam (be precise):** TinyBase has **no official auth feature**. The pattern is custom-but-low-risk: the Worker validates the Better Auth session → `userId` **before** any DO call, then routes to `GARAGE_DO.idFromName(userId)` using a **server-controlled** request path. The DO name is never derived from client input.

## Monorepo layout

Tooling: **pnpm workspaces + Turborepo**. `packages/shared` is **built with `tsup`** to ESM + `.d.ts` (RN-safe; Vite, Workers, and Metro all consume plain compiled JS). `shared` stays free of Node/DOM-only deps (no `localforage`, `fs`, `window`).

```
chudbox/                              # repo root (rename from vroomshop later; optional)
├─ pnpm-workspace.yaml  turbo.json  tsconfig.base.json  package.json  vitest.workspace.ts
├─ db/schema.md                       # NEW: source-of-truth doc for BOTH schemas (D1 + TinyBase) + documented gaps
├─ apps/
│  ├─ web/                            # the current SPA moved here ~verbatim
│  │  ├─ src/ (pages, components, store/ adapter, auth client, ...)
│  │  ├─ vite.config.ts               # base '/' (was '/chudbox/'); dev proxy /api,/sync → :8787
│  │  └─ package.json                 # react19, tinybase@8.4.2 (pinned), @chudbox/shared
│  ├─ api/                            # Cloudflare Worker
│  │  ├─ src/
│  │  │  ├─ index.ts                  # Hono app, run_worker_first routing, WS session-auth
│  │  │  ├─ auth.ts                   # betterAuth(env) — native D1, email/pw + verify/reset (Resend); pinned version
│  │  │  ├─ durable/GarageDO.ts       # extends WsServerDurableObject; createPersister → DO-SQL FRAGMENTED mode
│  │  │  ├─ routes/uploads.ts  routes/share.ts  routes/img.ts
│  │  │  └─ db/ (drizzle schema + D1 migrations)
│  │  ├─ wrangler.jsonc               # bindings: D1, R2, DO namespace (new_sqlite_classes), assets
│  │  └─ package.json                 # hono, better-auth (pinned), drizzle-orm, tinybase@8.4.2, @chudbox/shared
│  └─ mobile/                         # FUTURE Expo app (stub created in M5)
└─ packages/
   └─ shared/  (@chudbox/shared, tsup-built, RN-safe)
      ├─ types.ts      # moved from web/src/types.ts (Car, Photo, ...)
      ├─ schema.ts     # the single source-of-truth TinyBase TablesSchema + ValuesSchema (no defaults on nullable cells)
      ├─ flatten.ts    # Car ↔ tables mapping with the strict null rule (the round-trip seam; unit-tested)
      ├─ zod.ts        # request/form validators
      ├─ contracts.ts  # sync path + share API request/response types
      ├─ money.ts      # ISO-4217-aware money (amount + currency code); display conversion only
      └─ store.ts      # createGarageStore(): typed MergeableStore (persister/synchronizer injected per platform)
```

## Data model

TinyBase cells must be scalar, and we want per-field merge granularity, so the nested `Car` **normalizes** into one parent table + child tables keyed by `carId`. **Ownership is implicit**: the whole store lives in the user's DO (`idFromName(userId)`), so no `userId` column is needed inside the store.

**Per-user DO store (TinyBase → DO SQLite, FRAGMENTED mode).** Money fields carry a per-row currency code (FX is time-varying ⇒ can't canonicalize); distance keeps the **raw entry string** as source of truth **plus** a parsed canonical `mileageMiles` (exact ×1.609344 factor) for comparison/aggregation. Migration sentinels are **NOT** here — they live in a local-only store (see Migration).

| Object | rowId | key cells |
|---|---|---|
| `Values` | — | themeId, customAccent, currency, distanceUnit |
| `cars` | carId | year, make, model, trim, color, **mileageRaw, mileageMiles**, nickname, purchaseDate, saleDate, status, **salePrice, salePriceCurrency**, tradeFor, coverPhoto, createdAt |
| `photos` | photoId | carId, **r2Key** (replaces `dataUrl`), caption, uploadedAt, width?, height? |
| `wishlist` | itemId | carId, name, link, **price, priceCurrency**, category, notes, status, addedAt |
| `mods` | modId | carId, name, category, description, **cost, costCurrency**, installedDate, shop, link, addedAt |
| `maintenance` | recId | carId, service, date, **mileageRaw, mileageMiles**, **cost, costCurrency**, shop, notes, nextDueDate, **nextDueMileageRaw, nextDueMileageMiles**, createdAt |
| `todos` | todoId | carId, text, priority, done, createdAt |
| `issues` | issueId | carId, title, description, severity, status, createdAt, resolvedAt |

*Currency columns are omitted (not written) when their amount is null, per the strict-null rule. `salePrice` stays a string field as today (`''` when blank) but gains `salePriceCurrency` when non-empty.*

**Critical persistence detail — TWO cliffs, neither stock mode is unconditionally safe (must validate empirically in M2):**
- The DO-SQL persister has two modes, each with a documented failure at scale:
  - **JSON mode (the default):** serializes the *entire* MergeableStore (every row + per-cell HLC metadata) into **one** SQLite row → hits Cloudflare's **2 MB row limit** for a heavy text-only garage and silently breaks sync.
  - **Fragmented mode:** stores **one row per cell**, so the 2 MB row cap never bites a text cell — **but** TinyBase **issue #268 (OPEN, unfixed through v8.4)** is a **single open report** that the fragmented persister *times out and resets the DO* on a large write (reporter cites **~200 KB+**). The exact threshold and root cause are **not firmly pinned down upstream** — source inspection of the fragmented `setPersisted` *indicates* per-cell writes within a save, so the cost **plausibly scales with single-save changeset size** (which would make steady-state single-cell edits fine). **Treat the ceiling as a must-measure unknown, not a constant** — the M2 gate measures the real number.
- **The one write that matters is the empty-DO first sync (and every new device after).** The dangerous single changesets are (a) the local bulk migration — bounded by chunking the *local* persister — and (b) the synchronizer's **first full-store reconciliation into an empty/cleared DO**, which it performs as **one un-chunkable `setPersisted`** from inside TinyBase. App-level "chunk the migration" does **not** bound (b). The app-controllable fix: **populate the DO via bounded chunked DO RPCs BEFORE attaching the synchronizer** — each RPC applies one chunk of the local store's **mergeable content (per-cell HLC stamps), NOT plain cell values** (`getMergeableContent` → `setMergeableContent`/`applyMergeableChanges` on the DO). Seeding *values* would mint fresh stamps on the DO, so on attach the synchronizer would see every cell as divergent and re-reconcile the whole store in one `setPersisted` — recreating the very #268 write. Seeding *stamped content* means the DO's store matches the client's, so attach exchanges **only genuine deltas**. (Keep-local's "clear cloud" is likewise a bulk DO write → chunk it the same way.)
- **Plan: fragmented mode + chunked seed-RPC-before-attach.** Create the persister as `createDurableObjectSqlStoragePersister(store, ctx.storage.sql, /* opts */ { mode: 'fragmented' })` (verify the exact arg position/mode key against the pinned `tinybase@8.4.2` — the default is confirmed JSON).
- **Validate, don't assume (M2 gate):** drive the **empty-DO first-sync path specifically** — attach a *large* synthetic local garage to an **empty** `wrangler dev` DO, and have a **fresh second device** sync a large DO — and confirm the chunked seed RPC completes without a DO-reset. **Seed-slicing validity is a named sub-item of this gate:** chunks are hand-sliced from `getMergeableContent()` (stamps **and hashes**) — validate that partial slices are accepted by `applyMergeableChanges`/`setMergeableContent` and that hash mismatches don't trigger the very full-store reconcile the seeding exists to prevent (the "no large post-seed reconcile write" assertion catches this). Pre-decided fallback if slicing proves invalid: **invert stamp authority** — seed the DO with plain values via chunked RPCs, then have the client adopt the DO's mergeable content wholesale into local IndexedDB *before* attaching, so the bulk write lands client-side, not on the DO. Record the measured ceiling and set store-size monitoring below it (cell-count budget). The storage test asserts **behavior** (many per-cell rows, not one JSON blob), not hard-coded table names. If even chunked RPCs can't bound it, the pre-decided fallbacks are: smaller chunks, JSON mode behind a hard size guard, or sharding the store (a genuine tradeoff — neither stock mode is free).

**Round-trip correctness (the strict null rule — MAJOR):**
- A cell is omitted **iff the value is strictly `null`/`undefined` — never merely falsy.** `0` (free part), `false` (`todos.done`), and `''` (e.g. `mileageRaw`) are valid values and must be written explicitly, or they corrupt on round-trip. Encode this once in `flatten.ts`.
- **Nullable cells declare a type but NO TinyBase `default`** (a default would resurrect a value where the user meant blank). The join adapter maps *absent → null*.
- Nullable inventory to handle explicitly (from `src/types.ts` + the new unit columns): `cars.coverPhoto`, `wishlist.price`/`priceCurrency`, `mods.cost`/`costCurrency`, `cars.salePriceCurrency`, `maintenance.cost`/`costCurrency`, the canonical `*Miles` cells (`cars.mileageMiles`, `maintenance.mileageMiles`, `nextDueMileageMiles` — **present iff the raw string parses numerically**), `issues.resolvedAt`, new `photos.width?/height?`, **and `maintenance.mileageRaw`** — its source `MaintenanceRecord.mileage` is **`string | null`** (`src/types.ts:56`), unlike `cars.mileage` and `nextDueMileage` which are plain strings. `null` and `''` are distinct round-trippable states: omit the cell iff `null`, write `''` explicitly. The non-nullable `*Raw` mileage strings and other required fields are often `''` (a real, round-trippable cell). **`mileageRaw` is the authoritative display value; `mileageMiles` is only for comparison/aggregation.**
- **`coverPhoto` is a soft pointer to a `photoId` and can dangle after a merge** (device A deletes the cover photo; device B's pointer still references it). Resolve cover by lookup-with-fallback (missing → first photo → placeholder); the UI must never assume it resolves.

**Indexes / access (MINOR but cheap):**
- Define a TinyBase `Index` on `carId` for each child table so `getCarSnapshot(carId)` and the `useCar(id)` join are O(rows-for-this-car), not O(whole garage).
- Deletes are handled by the CRDT: `delRow`/`delCell` emit newer HLC-stamped tombstones that win under LWW and propagate. We do **not** hand-roll tombstones.

**Units cleanup (replaces the lossy in-place rewrite in `src/utils/units.ts`):**
- **Model: store-as-entered + convert only at display; never mutate stored values when the user flips a setting** (today's `setCurrency`/`setDistanceUnit` rewrite-in-place is the bug). Money and distance differ in how they store, because their conversions differ:
  - **Money — tag each amount with its entry currency** (`priceCurrency`/`costCurrency`/`salePriceCurrency`, ISO-4217). FX is **time-varying**, so you cannot canonicalize to one currency without loss; keep the amount in the currency entered and convert at display with current rates only if you must aggregate. If you store integer minor units, use each currency's **ISO-4217 exponent** (JPY=0, most=2), *not* a blanket `*100`.
  - **Distance — keep the raw entry string as the source of truth** (`mileageRaw`) and add a parsed canonical value (`mileageMiles`) for comparison/aggregation only. The conversion factor ×1.609344 is exact by definition (float math aside, ~1e-15 — immaterial for odometers, and the raw string is preserved anyway), so a single canonical unit needs no per-row unit tag. **`mileageRaw` is free text** (people type "unknown", "~120k", "TMU"), so `mileageMiles` is **present only when `mileageRaw` parses numerically** (strip locale separators first — `parseFloat("12,000") → 12` truncates).
- **Existing data is only partially recoverable.** For users who never changed currency/unit, the stored number is what they typed → tag with the current setting (currency code; convert numeric mileage to miles). For users who changed settings, the originals were irreversibly rounded through approximate rates — **snapshot current values as the baseline in the current setting; do NOT back-convert** (compounds loss). Document this in `db/schema.md`. Migration verify rule: **every amount has a currency; `mileageRaw` mirrors the source (cars: always present; maintenance: present iff source mileage non-null); `mileageMiles` present iff the raw parses numerically.**

**D1 (relational/auth only — never garage content).** Better Auth tables `user`, `session`, `account`, `verification` (confirm the generated migration includes indexes on `session.userId/token`, `account.userId`, `verification.identifier`). Plus:
```sql
share_links(
  token_hash   TEXT PRIMARY KEY,                 -- sha256(rawToken); raw token shown once at creation
  user_id      TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,  -- D1 enforces FKs by default
  car_id       TEXT NOT NULL,                     -- SOFT ref: car lives in the DO, no FK possible
  created_at   INTEGER NOT NULL,                  -- epoch SECONDS (pin the unit repo-wide; compare like-for-like)
  expires_at   INTEGER,                           -- null = no expiry
  revoked_at   INTEGER,                           -- null = active
  CHECK (expires_at IS NULL OR expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX share_links_user_car ON share_links(user_id, car_id);  -- dedupe / revoke-by-car / user cascade
-- If "one active link per car" is the intent (not multiple), instead/also:
-- CREATE UNIQUE INDEX share_links_one_active ON share_links(user_id, car_id) WHERE revoked_at IS NULL;
```
- **Pin the epoch unit** (seconds) everywhere so `expires_at > now` compares like-for-like.
- Token is a **bearer credential**: store only `sha256(token)`, look up by hash, ≥128-bit entropy from `crypto.getRandomValues` (URL-safe base64 ≥22 chars).
- `car_id` has no FK by necessity; enforce the binding at **create time** (RPC the caller's own DO to confirm the car exists before inserting — DO-check first, then D1 insert, since D1↔DO is not atomic), and **lazy-revoke** when `getCarSnapshot` later returns "not found" (set `revoked_at`, return 410/404).
- **`ON DELETE CASCADE` fires even under `defer_foreign_keys`** — a migration that *rebuilds* the `user` table (drop/recreate) will cascade-delete `share_links`. Low risk, but use additive (not table-rebuild) migrations on `user`, or detach the FK during such a migration.

## Key subsystems

**Auth + DO routing.** Better Auth mounted at `/api/auth/*` on Hono with native D1 (email/password + verification + reset; Resend for delivery; `batch()` for atomic multi-statement writes since D1 lacks interactive transactions). For sync, the SPA opens a **same-origin** `wss://<domain>/sync`; the session cookie rides the upgrade (same-origin ⇒ `SameSite=Lax` is always sent — verified). The Worker validates the session → `userId` **before** any DO call (cost + security), then routes to `GARAGE_DO.idFromName(userId)` with a server-controlled path. Pin the Better Auth version; verify `cookieCache` behavior (watch upstream #4203 — D1-only/no secondaryStorage should avoid it). **Rate-limit `/api/auth/*`:** Better Auth's built-in limiter is in-memory → per-isolate on Workers (near-useless against distributed abuse); back it with D1/KV secondary storage or a Cloudflare rate-limiting rule.

**Sync / offline.** `packages/shared/store.ts` exports `createGarageStore()` returning a typed `MergeableStore`. Persister/synchronizer injected per platform: web = `persister-indexed-db` + `synchronizer-ws-client`; **DO = fragmented `persister-durable-object-sql-storage`**; RN (later) = `persister-expo-sqlite`. Logged-out users get the persister only (no synchronizer) → today's behavior. WS messages bill ~20:1 and idle connections hibernate (no duration charge), so a chatty synchronizer is cheap.

**Image pipeline (replaces base64).** On add: downscale via `createImageBitmap` → `<canvas>` (max ~1600px long edge) → `canvas.toBlob('image/webp', 0.8)` (handle EXIF orientation). `POST /api/uploads` (session-authed) returns a presigned PUT for key **`u/<userId>/<carId>/<photoId>.webp`** — **the key prefix is derived server-side from the session**, never trusted from the client. Browser PUTs bytes straight to R2 (bucket CORS = app origin). **Presigning is S3-API-only** — the R2 *binding* cannot presign; the Worker needs an R2 S3 API token (access key/secret) stored as secrets + `aws4fetch`. Simpler alternative if that extra credential is unwanted: same-origin `PUT /api/uploads` proxied through the binding (`env.BUCKET.put()`) — no S3 keys, no bucket CORS, trivially fine for ~200 KB downscaled WebPs. Only the **`r2Key` string** goes into the `photos` row. Display via `/img/<key>` (session- or token-gated), optionally `/cdn-cgi/image/width=…` for thumbnails. **R2 orphans:** tombstoned/duplicate photos don't auto-delete — add a reconciliation sweep (or delete-on-tombstone hook); note as a known intentional gap.

**Share-links.** `POST /api/cars/:carId/share` confirms the car exists in the caller's DO, then inserts `{ token_hash, user_id, car_id }` and returns the raw URL **once**. `GET /api/share/:token` hashes the token, looks up `(userId, carId)`, checks validity (`revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now)`), reads that user's DO via a **read-only `getCarSnapshot(carId)` RPC** (carId-indexed), returns a plain JSON snapshot with photo URLs rewritten to token-scoped `/img` routes, **edge-cached (~60s, per-colo)** and **rate-limited**. A public React route renders it read-only by reusing existing `CarProfile` components.

**Frontend adapter (minimize component churn).** Keep `apps/web/src/store/useGarageStore.ts` and **re-export the same hook/action surface**, backed by TinyBase `ui-react` instead of Zustand:
- `useCar(id)` joins child tables (via the carId indexes) into the existing nested `Car` shape, so `CarProfile` is unchanged.
- The **garage list uses a lightweight selector** (cover photo + counts), NOT the full nested join per `CarCard` — avoids O(cars × rows) renders.
- Actions (`addCar/updateCar/deleteCar/addPhoto/addMod/...`) reimplemented as `setRow/setPartialRow/setCell/delRow` with **identical signatures**. `setCurrency/setDistanceUnit` become `Values` writes (and stop rewriting history).
- Switch `uid()` (Math.random+Date.now) → **`crypto.randomUUID()`** to avoid cross-device rowId collisions.

**Migration (first-run + sign-in-later) — one golden rule: finish all migration/backfill/merge-resolution and seed/clear the DO via chunked RPCs BEFORE the WS synchronizer attaches.** This ordering fixes sentinel-flipping, makes "Keep cloud/local" implementable (a CRDT can't un-merge once joined), and — critically — means the synchronizer attaches to an **already-populated** DO and only exchanges deltas, so it never performs the un-chunkable full-store `setPersisted` that triggers #268. Note this does *not* make the bulk write disappear: the initial DO population **is** a bulk write, just moved into our **chunked `seedGarage(carChunk)` RPC** (each chunk its own storage op) where we control its size — which is exactly what the M2 gate measures.

- **Sentinels live in a LOCAL-ONLY store, never in synced `Values`.** `idbMigrated` and `unitsSchemaVersion` are per-device migration state. If they synced, the "cloud-wins for `Values`" policy could clear `idbMigrated` from a fresh DO (→ re-import → **duplicate garage**), and per-cell LWW can't express the monotonic "once-true / max-version" these flags need (→ reopens the ×100 backfill landmine). Keep them in the same non-mergeable local persister used for base64 parking (or a small `localforage` key).
- **First-run import** of the existing IndexedDB `garage-store` blob (parse the zustand persist wrapper `{ state: { cars, themeId, customAccent, currency, distanceUnit }, version }` — `version` is the implicit zustand default **`0`**, distinct from the backup's `version: 1`): flatten `state.cars[]` into tables (currency-tag amounts, canonicalize mileage), settings → `Values`. Gate on the local `idbMigrated`; **write in chunks** (car-by-car); keep the old blob (don't delete) for rollback. Keep the JSON **backup** contract working: today's v1 export is `{ version: 1, exportedAt, cars, themeId, customAccent }` — **no `currency`/`distanceUnit`**, and the current import restores only those three fields. v2 reassembles nested cars from tables; accept both. **A v1 import must tag amounts/mileage with the importing device's *current* settings**, which may differ from the settings at export time — same unrecoverability caveat as live data; document in `db/schema.md`.
- **Base64 photos stay OUT of the mergeable store.** Park them in the **separate, local-only, non-mergeable Store/persister** keyed by photoId; synced `photos` rows carry only metadata until M3 fills `r2Key`. **M2 read path:** when a photo row has no `r2Key`, the `<img>` resolves from this local side-store; document that photos are local-only (don't cross-device sync) until M3.
- **Units backfill** is gated on the local `unitsSchemaVersion` — double-applying the conversion is a ×100/parse landmine. No-op if already applied; verify-before-commit (counts unchanged, no negatives, every amount has a currency, `mileageRaw` present and `mileageMiles` present iff it parses numerically).
- **Sign-in with a populated local store + a DO that already has data:** do NOT blind-merge. Distinct client UUIDs union → **duplicate cars** (LWW can't dedupe different rowIds; non-destructive but visible). Present an explicit choice — **Merge** (union; warn "may create duplicates"), **Keep cloud**, **Keep local** (default Merge), and **apply it before attaching the synchronizer**: for Keep-cloud, clear the local store first; for Keep-local, clear/tombstone the cloud rows via **chunked DO RPCs** (itself a bulk DO write — same #268 surface, same chunking), then re-seed; only then attach. For `Values` (fixed keys that contend under HLC), use **deterministic precedence** (cloud-wins), not wall-clock HLC. Offer a post-merge de-dupe affordance.

## Deployment

- **Single Worker, Static Assets, custom domain** (`apps/api/wrangler.jsonc`): bindings for D1, R2, the `GarageDO` namespace (`new_sqlite_classes`), and `assets` → `apps/web/dist` with SPA fallback. `run_worker_first: ["/api/*","/sync"]` scopes only those to the Worker (navigation requests don't bill invocations; compat date ≥ 2025-04-01). Same-origin ⇒ Better Auth cookies + WS-upgrade cookie work with `SameSite=Lax`, zero CORS. The custom domain must be **proxied (orange-cloud)** to enable `/cdn-cgi/image` transforms.
- **Local dev:** `turbo dev` runs `vite` (web) + `wrangler dev` (api, :8787, emulates D1/R2/DO); Vite `server.proxy` forwards `/api` + `/sync` → `:8787` for same-origin locally (use Secure-cookie-on-localhost handling).
- **CI:** replace `.github/workflows/deploy.yml` (GH Pages — it already builds fresh in CI; `dist/` is git-ignored and was never committed) with `pnpm i → turbo build → wrangler d1 migrations apply → wrangler deploy` (`cloudflare/wrangler-action`, `CLOUDFLARE_API_TOKEN` secret).

## Milestones (sequenced; M2 is the high-risk one — not a routine increment)

| # | Goal | Key files / packages | Main risks |
|---|---|---|---|
| **M0** | **Monorepo refactor, no behavior change.** pnpm+Turborepo; move SPA → `apps/web`; create `@chudbox/shared` (move `types.ts`,`units.ts`; tsup build); **wire the test harness — vitest at the workspace root + `fast-check`** (the repo has zero test infra and the M2 gate runs on it; `@cloudflare/vitest-pool-workers` lands with the Worker in M1/M2). **`base` flips to `'/'` and `.github/workflows/deploy.yml` is deleted** — decided 2026-06-12: we build straight through to the Cloudflare cutover with **no interim pushes to GH Pages**; the currently-deployed Pages build stays frozen until M1's Worker replaces it. Local dev/build identical; nothing deploys until M1. | `pnpm-workspace.yaml`,`turbo.json`,`tsconfig.base.json`,`vitest.workspace.ts`,`apps/web/*`,`packages/shared/*`,`vite.config.ts`,`.github/workflows/deploy.yml` | Import-path churn; keep build green; HashRouter still fine |
| **M1** | **Better Auth + optional accounts.** Email/pw signup/login + verify/reset (Resend); **logged-out app unchanged**; deploy single Worker + Static Assets on custom domain (same-origin); update `PRODUCT.md` (purpose → local-first, optional account adds sync/backup). | `apps/api` (`index.ts`,`auth.ts` native D1, drizzle schema+migrations); `apps/web` login/signup UI + auth client; `wrangler.jsonc`; CI→wrangler; `PRODUCT.md` | Cookie/origin + custom-domain setup; D1 `batch()`; pin Better Auth + verify `cookieCache`; Resend wiring; rate-limit `/api/auth/*` (built-in limiter is per-isolate in-memory on Workers — back with D1/KV or a CF rate-limit rule) |
| **M2** ⚠️ | **TinyBase + DO sync (text data) + local migration — HIGHEST RISK.** Irreversible storage-format migration **and** big-bang data-layer swap (Zustand→TinyBase) behind the existing `useGarageStore` surface; one parity bug breaks the app. Fragmented mode + **chunked bulk writes**; **migrate/backfill/merge before attaching the synchronizer**; sentinels local-only; base64 parked local-only; units cleanup. **Gate task: empirically measure the fragmented-mode bulk-write ceiling (#268) against a real `wrangler dev` DO and confirm chunking clears it.** Photos do NOT cross-device sync until M3 (not a regression). | `packages/shared/schema.ts`,`flatten.ts`,`money.ts`,`store.ts`; `apps/web/src/store/useGarageStore.ts` (adapter); `apps/api/durable/GarageDO.ts` (**fragmented**) + WS-auth route; `src/pages/Garage.tsx` backup; `db/schema.md` | **#268 fragmented bulk-write timeout — empty-DO seed must be chunked + stamped (ceiling measured in M2)** (and 2 MB if JSON); strict-null parity; idempotent/local sentinels; merge clear-before-attach; selector/action parity; round-trip test |
| **M3** | **Images → R2.** Client downscale → presigned PUT → `r2Key` in row → display via `/img`; migrate parked base64 photos to R2. | `apps/api/routes/uploads.ts`,`img.ts`; `apps/web` `src/components/tabs/PhotosTab.tsx` (FileReader→compress+PUT) + `<img>` swap in `CarCard.tsx`,`CarProfile.tsx`; R2 bucket+CORS; `photos` schema (`r2Key`) | Presigned key-prefix scoping; CORS; EXIF; migrating large local blobs; R2 orphans; transform billing |
| **M4** | **Share-links.** Unguessable, hashed-at-rest read-only public car page (no account). | `apps/api/routes/share.ts`; D1 `share_links`; DO `getCarSnapshot` RPC; web public viewer route + share button | Abuse/rate-limit (per-colo cache); token-as-credential; DO-check-then-D1 ordering; lazy-revoke; image exposure scope |
| **M5** | **Mobile-ready hardening.** Lock `@chudbox/shared` RN-safety; add `persister-expo-sqlite`; stub `apps/mobile` Expo app reusing `createGarageStore()`. | `packages/shared` (no Node/DOM deps); `apps/mobile` Expo skeleton; Metro config | `crypto.randomUUID` in RN; Metro resolution (improved on RN ≥0.79; tsup output + explicit import paths as backstop) |

## Critical files (current → role in this work)

- `src/store/useGarageStore.ts` — the **data-layer seam**; becomes the TinyBase-backed adapter that **preserves the exact action/selector surface**.
- `src/types.ts` — moves to `packages/shared`; basis for the TinyBase `TablesSchema`/`ValuesSchema` and `flatten.ts`.
- `src/utils/units.ts` — replaced by store-as-entered + display-time conversion (`packages/shared/money.ts`); fixes the lossy in-place rewrite.
- `src/pages/Garage.tsx` — `useBackup` (`exportData`/`readFile`/`confirmImport`) backup contract + first-run migration trigger + auth/share entry points.
- `src/components/tabs/PhotosTab.tsx` — the `FileReader.readAsDataURL` upload seam → downscale + presigned-PUT.
- `src/components/CarCard.tsx`, `src/pages/CarProfile.tsx` — `<img src={dataUrl}>` → `<img src={/img/r2Key}>`; cover-photo resolve-with-fallback.
- `vite.config.ts` (`base`, dev proxy) and `.github/workflows/deploy.yml` (→ Wrangler/Cloudflare).
- **New:** `db/schema.md` (both schemas + documented gaps). **Keep as-is:** `src/utils/exportMarkdown.ts`, `src/utils/carStatus.ts` (`getCarStatus`), `src/utils/categories.ts`, `src/utils/themes.ts`.

## Risks & gotchas

1. **DO persister mode — TWO cliffs, the top risk (validate empirically in M2):** JSON mode = whole garage in one **2 MB** row; fragmented mode = DO-reset timeout on a large **single-save changeset** (open TinyBase **#268**, a single ~200 KB+ report, unfixed through v8.4; exact threshold/cause **not firmly established upstream → to be measured, not assumed**). The write that matters is the **empty-DO first sync / new-device sync**, which the synchronizer does as one un-chunkable `setPersisted`. Chosen: **fragmented + populate the DO via chunked `seedGarage` RPCs (stamped mergeable content, not plain values) *before* attaching the synchronizer**, so the DO's stamps match the client's and attach exchanges only genuine deltas. M2 gate measures the empty-DO path **and asserts the post-seed attach does no large reconcile write**; **store-size monitoring set below the measured ceiling (cell-count budget)**; fallbacks pre-decided (smaller chunks → JSON+size-guard → shard). *(Confirmed in `tinybase@8.4.2`: default mode is JSON; fragmented persists per-cell. Table names asserted by behavior, not hard-coded.)*
2. **First-sign-in merge duplicates:** union of distinct-UUID rows ⇒ duplicate cars (not data loss). Needs explicit Merge/Keep-cloud/Keep-local, **applied before the synchronizer attaches** (a CRDT can't un-merge), + deterministic Values precedence. "LWW is fine" applies only to same-row concurrent edits.
3. **Strict null rule + per-amount currency tags:** omit cells only on `null`/`undefined`, never falsy; no defaults on nullable cells; **money carries a per-row currency code, distance is canonical-miles + raw string**; round-trip property test (`Car → flatten → tables → join → Car` deep-equals over nulls/`0`/`false`/`''`/dangling `coverPhoto`).
4. **Migration idempotency:** sentinel-gate IndexedDB import (`idbMigrated`) and units backfill (`unitsSchemaVersion`) — but the **sentinels live in a local-only store, not synced `Values`** (else cloud-wins merge re-fires them → duplicate garage / ×100 backfill). Double-apply is the landmine the sentinels prevent.
5. **Keep base64 out of the mergeable store** — separate local-only store until R2 (M3), else M2 hits the cliff.
6. **WS auth needs same-origin** (single Worker) — a split origin forces a short-lived WS-ticket flow. Validate session **before** touching the DO. The auth layer is a custom (not official-TinyBase) pattern.
7. **Token = credential:** hash at rest, ≥128-bit entropy. **D1↔DO not atomic:** DO-check first, then D1 insert; lazy-revoke on snapshot miss.
8. **R2 orphans:** tombstoned/duplicate photos need a reconciliation sweep. **Account deletion is a sibling gap:** D1 cascades `share_links`, but DO SQLite and R2 have no cascade — user deletion must also call the user's DO `deleteAll()` and delete the R2 prefix `u/<uid>/` (or record as a known intentional gap).
9. **Cost is bounded but not magic:** share-link edge cache is **per-colo** (a viral link wakes the DO ~once per data-center per TTL); add store-size monitoring (targeted at the #268 zone) beyond a budget alert.
10. **Cross-device rowId collisions:** `crypto.randomUUID()`. **Don't coerce free-text date fields to DATE.** **HLC vs wall-clock skew** — prefer explicit precedence for `Values`. **`ON DELETE CASCADE` + `user`-table rebuild** can cascade-delete `share_links` — use additive migrations on `user`.
11. **Base `/chudbox/`** — flipped to `'/'` in M0; GH Pages receives no further pushes (frozen until M1's Worker replaces it; decided 2026-06-12). (`dist/` is already git-ignored and was never committed — earlier drafts said otherwise.)

## Confirm at kickoff (not blocking M0)

- **Custom domain**: which domain (~$10/yr), and confirm OK to move the frontend off `*.github.io` / drop `/chudbox/`. (Needed for same-origin auth + image transforms.)
- **Cloudflare plan**: SQLite-backed DOs run on **Workers Free**; start there. Upgrade to **Workers Paid ($5/mo)** only when you want higher limits / to remove the 100k-requests/day cap. (This corrects the earlier "Paid required" note — it isn't.)
- **Resend** account (free tier) for verification/reset emails.
- **Shared-photo privacy**: token-gated public images acceptable as-is (default: unguessable hashed token + revoke, no expiry), or want expiry from day one?

## Verification (end-to-end, per milestone)

- **M0**: `pnpm install` + `turbo build` green; `turbo typecheck`/`lint`/`test` pass (vitest harness wired, even if coverage is thin); `vite` dev runs the app identically; existing IndexedDB data still loads. No backend yet.
- **M1**: `wrangler dev` + `vite` (proxied). Sign up → Resend verification email → verify; password reset works. Logged **out**, the app still works fully locally. `wrangler d1 execute … "select * from user"` shows the row.
- **M2**: **(a) Unit tests:** round-trip `Car → flatten → tables → join → Car` deep-equals over generated cars incl. nulls/`0`/`false`/`''`/dangling cover + per-row currency tags + canonical-mileage; **(b) DO storage test:** assert **per-cell storage behavior** (many cell rows, not one JSON-blob row — confirm the actual table names against the pinned source, don't hard-code); **(c) #268 ceiling test (gate) — exercise the empty-DO first-sync path specifically:** seed a *large synthetic local garage* (e.g., 20 cars × years of history) into an **empty** `wrangler dev` fragmented DO via the chunked `seedGarage` RPC (stamped mergeable content), **then attach the synchronizer and assert it produces NO large reconcile `setPersisted`** (only genuine deltas) — i.e. the seed actually prevented the un-chunkable write, not just "the RPC completed." Also simulate a **fresh second device** syncing a large existing DO. Confirm no DO-reset timeout and record the measured single-changeset ceiling; **(d) idempotency:** run first-run import and units backfill twice → no double-import, no ×100; sentinels are in the local store; **(e) merge:** populate local + a divergent DO, sign in → Merge/Keep-cloud/Keep-local fires, the losing side is cleared *before* attach, no unexpected duplicates. **(f) E2E:** two browser profiles, add/edit a car → appears in the other; offline edits in both → reconnect → converge; deletes propagate; first login migrates the local garage; backup v1 & v2 both import (v1 amounts/mileage tagged with the device's current settings).
- **M3**: Add a photo → Network shows presigned `PUT` to R2 (not base64 in the store) → row holds `r2Key` → renders via `/img/...`; second device loads it; parked base64 migrates once; orphan sweep removes a tombstoned photo's R2 object.
- **M4**: Create a share link → open logged-out incognito → read-only car with images, no edit controls; revoke → 410/404; confirm only `sha256(token)` is in D1.
- **M5**: `apps/mobile` Expo app builds and boots with `@chudbox/shared`; `createGarageStore()` runs with the expo-sqlite persister; smoke test adds a car offline.

## Cost (directly addresses the "no surprise bill" goal)

| Item | Cost | Notes |
|---|---|---|
| Domain | ~$10/yr | one-time annual |
| Workers + Durable Objects | **$0 to start** | SQLite-backed DOs run on the **Free** plan (100k req/day cap). Move to **Workers Paid $5/mo** only when you want higher limits — *optional, not required* |
| R2 | ~$0 | 10 GB + 1M writes + 10M reads/mo free; **zero egress** — the scary bandwidth variable is eliminated |
| D1 | ~$0 | within free/included limits at this scale |
| Resend | ~$0 | free tier ~3k emails/mo |
| **Total** | **~$0–5/mo + ~$10/yr** | flat and predictable; set a budget alert **and** store-size monitoring (set below the M2-measured #268 ceiling, not the irrelevant 2 MB). No Vercel-style egress blowup — R2 egress is free; DO/Workers usage at low scale stays free or inside the $5 Paid base |

## Review & hardening (adversarial pass, 2026-06-09)

A db-engineer and a skeptic reviewed iteratively (two rounds) against the plan and the live repo; both **independently** confirmed the items below. Incorporated:

### Round 1
- **BLOCKER — DO persister storage mode** (both): default JSON mode = whole store in one 2 MB row → silent sync break. (Round 2 revised the fix — see below.) Base64 kept out of the synced store.
- **Factual correction — Workers Paid is *not* required** for SQLite-backed DOs (skeptic): they run on Free. Cost section and kickoff note updated; infra can start at ~$0.
- **Merge duplication on first sign-in** (both): explicit Merge/Keep-cloud/Keep-local flow + deterministic `Values` precedence; "LWW is fine" narrowed to same-row edits.
- **Strict null handling, no nullable defaults, round-trip property test** (db-engineer).
- **Migration idempotency sentinels** (`idbMigrated`, `unitsSchemaVersion`) — units double-apply is ×100 corruption (db-engineer).
- **Units → store-as-entered + display-time conversion**, ISO-4217 exponents, preserve raw mileage, document unrecoverable pre-migration history (db-engineer).
- **share_links**: hashed-at-rest token credential, `(user_id, car_id)` index, `user_id` FK cascade (D1 enforces FKs), integer-epoch timestamps + CHECK constraints, DO-check-before-D1-insert, lazy-revoke (db-engineer).
- **carId indexes + lightweight garage-list selector** to avoid O(cars × rows) renders (db-engineer).
- **R2 orphan reconciliation; coverPhoto resolve-with-fallback** (db-engineer).
- **Reword the auth seam** — TinyBase has no official auth feature; ours is a custom server-controlled-path pattern (skeptic).
- **Pin Better Auth, verify `cookieCache`/#4203; M2 reframed as highest-risk; per-colo cache caveat** (skeptic).
- **`db/schema.md`** created to document both schemas + the soft-ref/no-userId/unrecoverable-units gaps (db-engineer).
- **Held up under attack (kept as-is):** same-origin WS cookie auth, hibernation-backed cost model, Static Assets `run_worker_first` SPA routing, TinyBase v8 + DO module stability, Expo/Metro viability.

### Round 2 (re-review of the revised plan — caught issues the Round-1 fixes introduced)
- **Fragmented mode is NOT a clean win — TinyBase #268** (skeptic): fragmented persister DO-resets at **~200 KB bulk writes** (open, unfixed v8.4). Revised to **fragmented + chunked bulk writes + migrate-before-attach**, an empirical M2 ceiling test, monitoring retargeted to the ~150 KB zone, and pre-decided fallbacks. Neither stock mode is unconditionally safe — now stated plainly.
- **Per-amount currency/unit tags were missing from the schema** (db-engineer): added `*Currency` columns + canonical-miles/raw-string for distance, so "store-as-entered" and the migration's verify step actually have columns to land in. (Money can't canonicalize — FX is time-varying; distance can — mi↔km is exact.)
- **Migration sentinels were in the *synced* store** (db-engineer): moved `idbMigrated`/`unitsSchemaVersion` to a **local-only** store; unified the fix as "finish migrate/backfill/merge **before** the synchronizer attaches," which also makes Keep-cloud/Keep-local implementable (clear losing side first).
- **Minors:** assert DO storage by *behavior* not hard-coded table names; softened "verified in source" phrasing; pin share-link epoch unit (seconds) + optional one-active-link partial-unique index; note `ON DELETE CASCADE` + `user`-table-rebuild cascade; state the M2 photo read-path falls back to the local base64 side-store.
- **Held up on re-attack:** the Workers-Free correction, merge UX, auth-seam wording, and all Round-1 caveats verified consistent across the doc.

### Round 3–4 (both reviewers re-read source; both reached green after these)
- **#268 mechanism corrected** (both): the timeout appears to scale with **a single save's changeset**, not total store size (source inspection of the fragmented `setPersisted` indicates per-cell writes) — so "chunk the *local* migration" did **not** bound the write that matters, the synchronizer's **un-chunkable first full-store reconciliation into an empty DO** (and new-device sync). Fixed: **populate/clear the DO via chunked RPCs *before* attaching, seeding stamped mergeable content (not plain values) so attach is delta-only**; M2 gate targets the empty-DO/new-device path **and asserts no large post-seed reconcile write**. The threshold is treated as a **single ~200 KB+ report → measure it**, not asserted as a constant. My earlier "off the DO path" claim was wrong and is removed.
- **`mileageMiles` vs free-text mileage** (both): `mileageRaw` is the authoritative free-text value; `mileageMiles` is present **iff** the raw parses numerically; nullable inventory + verify rule corrected accordingly.
- **Green:** db-engineer — "data model is green," persistence green with the seed-RPC (stamped-content) tightening; skeptic — headline #268 risk resolved, architecture sound, adequate to proceed; remaining items were claim-precision fixes (seed-via-stamps; source-or-soften the #268 basis), now applied. No architectural changes; all backstopped by the M2 empirical gate + pre-decided fallbacks.

## References (verified 2026-06-09)

- TinyBase × Durable Objects: https://tinybase.org/guides/integrations/cloudflare-durable-objects/ ; DO-SQL persister (note `mode: 'fragmented'`): https://tinybase.org/api/persister-durable-object-sql-storage/functions/creation/createdurableobjectsqlstoragepersister/ ; MergeableStore: https://tinybase.org/guides/synchronization/using-a-mergeablestore/
- **TinyBase #268 — fragmented-mode DO timeout at ~200 KB (OPEN):** https://github.com/tinyplex/tinybase/issues/268
- D1 foreign keys (enforced by default): https://developers.cloudflare.com/d1/sql-api/foreign-keys/
- Better Auth 1.5 native D1: https://better-auth.com/blog/1-5 ; on Cloudflare/Hono: https://hono.dev/examples/better-auth-on-cloudflare
- DO limits (2 MB row; Free-plan SQLite DOs) / pricing: https://developers.cloudflare.com/durable-objects/platform/limits/ , /pricing/
- R2 pricing + presigned URLs: https://developers.cloudflare.com/r2/pricing/ , /api/s3/presigned-urls/
- Workers Static Assets SPA routing (`run_worker_first`): https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/
