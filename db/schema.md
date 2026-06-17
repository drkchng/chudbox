# Chudbox schemas — source of truth (both stores) + documented gaps

Two databases, deliberately split:

| Store | Engine | Holds | Defined in |
|---|---|---|---|
| Per-user garage | TinyBase `MergeableStore` → Durable Object SQLite, **fragmented** (per-cell) mode | All garage content (cars + child tables + settings Values) | `packages/shared/src/schema.ts` (consumed by `store.ts`, `flatten.ts`) |
| Relational/auth | D1 (SQLite) via Drizzle | Better Auth tables, `rate_limit`, `share_links` — **never garage content** | `apps/api/src/db/schema.ts` → migration `apps/api/drizzle/0000_init.sql` |

Keep this doc in sync with those files; on conflict, **the code wins**.

---

## 1. TinyBase per-user DO store

One `MergeableStore` per user, living in `GarageDO` (`apps/api/src/durable/GarageDO.ts`), persisted with `createDurableObjectSqlStoragePersister(store, ctx.storage.sql, { mode: 'fragmented' })` — one SQL row per cell stamp, never one JSON blob (Cloudflare's 2 MB row limit). **Ownership is the DO identity**: the Worker routes `/sync` and `/api/sync/*` to `GARAGE_DO.idFromName(verified userId)` after session validation, so there is **no `userId` column anywhere in the store**. The nested `Car` aggregate (`packages/shared/src/types.ts`) normalizes into one parent table + six child tables keyed by `carId`; `flattenCar`/`joinCar` (`flatten.ts`) are the only mapping seam.

The client store is schema-applied via `createGarageStore()` (`store.ts`); **the DO store is deliberately schema-less** (a dumb replica — a schema there could drop incoming cells while their merged stamps survive, and Values defaults would fabricate server-stamped settings).

### Strict null rule (round-trip correctness — MAJOR)

- A cell is **omitted iff the value is strictly `null`/`undefined`** — never merely falsy. `0` (a real price/cost), `false` (`todos.done`), and `''` (e.g. `cars.mileageRaw`) are valid values and are always written explicitly.
- Nullable cells declare a type but **NO TinyBase `default`** (a default would resurrect a value where the user meant blank). Non-nullable cells also carry no default — `flattenCar` always writes them, so a default could only fabricate data on a partially-synced row.
- `joinCar` maps **absent → `null`**. `null` and `''` are distinct round-trippable states (e.g. `maintenance.mileageRaw`).
- Enforced/tested in `flatten.ts` + the fast-check round-trip property in `flatten.test.ts`.

### Values (synced settings)

| Key | Type | Default | Nullable |
|---|---|---|---|
| `themeId` | string | `'garage'` | no |
| `customAccent` | string | — | **yes** (hex accent when `themeId === 'custom'`; absent ⇔ null) |
| `currency` | string | `'USD'` | no (ISO-4217 code amounts are tagged with at entry time) |
| `distanceUnit` | string | `'mi'` | no (`'mi' \| 'km'` — the unit the user enters distances in) |

> Caveat (measured, `docs/M2_GATE.md` finding B): the client schema **fabricates these defaults as freshly-stamped values**, so an untouched new device would clobber cloud settings under LWW. The M2 adapter must resolve Values cloud-wins (or avoid syncing schema-defaulted Values) before attaching the synchronizer.

### Tables (7)

Nullable cells are **bold** — these are exactly the optional properties of the `*Row` types in `schema.ts`.

| Table | rowId | Cells |
|---|---|---|
| `cars` | carId | year, make, model, trim, color, mileageRaw, **mileageMiles**, nickname, purchaseDate, saleDate, status, salePrice, **salePriceCurrency**, tradeFor, **coverPhoto**, createdAt |
| `photos` | photoId | carId, **r2Key**, caption, uploadedAt, **width**, **height** |
| `wishlist` | itemId | carId, name, link, **price**, **priceCurrency**, category, notes, status, addedAt |
| `mods` | modId | carId, name, category, description, **cost**, **costCurrency**, installedDate, shop, link, addedAt |
| `maintenance` | recId | carId, service, date, **mileageRaw**, **mileageMiles**, **cost**, **costCurrency**, shop, notes, nextDueDate, nextDueMileageRaw, **nextDueMileageMiles**, createdAt |
| `todos` | todoId | carId, text, priority, done (boolean — `false` written explicitly), createdAt |
| `issues` | issueId | carId, title, description, severity, status, createdAt, **resolvedAt** |

Notes:

- `cars.mileageRaw` is non-nullable (source `Car.mileage` is a plain string, `''` is a real cell); `maintenance.mileageRaw` **is** nullable (source `MaintenanceRecord.mileage` is `string | null` — omit iff null, write `''` explicitly). `nextDueMileageRaw` is a non-nullable string.
- Each child table gets a TinyBase `Index` on `carId`, id `` `${tableId}ByCarId` `` (`store.ts: carIdIndexId`/`defineCarIdIndexes`), so per-car reads are O(rows-for-this-car).
- Enum-ish string cells (`cars.status`, `wishlist.status`, `todos.priority`, `issues.severity`/`status`) are typed at the TS layer (`CarStoredStatus` etc. from `types.ts`), not constrained in the store.

### Distance: `mileageRaw` / `mileageMiles`

- **`mileageRaw` is the authoritative display value** — free text, stored exactly as entered ("unknown", "~120k", "TMU" are all valid).
- **`mileageMiles` is derived, for comparison/aggregation only, present iff the raw parses numerically** (`flatten.ts: parseMileageMiles`): strip locale group separators (comma, spaces incl. NBSP/narrow/thin, apostrophes — never `.`), then require a plain non-negative decimal for the *whole* string (rejects `parseFloat` prefix traps like `'120k' → 120`; `'12,000' → 12000`, never 12). When `distanceUnit === 'km'`, canonicalize with the exact factor: miles = km / 1.609344 (`KM_PER_MILE`).
- Stored values are **never** rewritten when the user flips `distanceUnit` (display-time conversion only).

### Money: `*Currency` tagging

- Store-as-entered: every **non-null** amount (`wishlist.price`, `mods.cost`, `maintenance.cost`) is tagged at flatten time with the device `currency` (ISO-4217) into its sibling `*Currency` cell; the tag is omitted when the amount is null. FX is time-varying ⇒ amounts are never canonicalized to one currency; conversion is display-only (`money.ts` knows per-currency structure only — minor-unit exponents JPY=0/most=2/KWD=3, never a blanket ×100).
- `cars.salePrice` stays a **string** as in the legacy model (`''` when blank — a real cell); `salePriceCurrency` is written **iff `salePrice !== ''`**.
- Caveat (`flatten.ts` header): `joinCar` drops the tags (the nested `Car` has no currency fields), so re-flattening under a different device currency would re-tag — the web adapter must write cells directly rather than round-tripping through `Car` when only a setting changes.

---

## 2. D1 schema (auth + share links — never garage content)

Source: `apps/api/src/db/schema.ts` (hand-written to match better-auth@1.6.18's expected model/field names; drizzle maps camelCase TS ↔ snake_case SQL) → `apps/api/drizzle/0000_init.sql`.

### Timestamp units — deliberate difference, pinned

- **Better Auth tables** (`user`, `session`, `account`, `verification`): integer **epoch MILLISECONDS** (drizzle `timestamp_ms` — the adapter passes `Date` objects through and re-hydrates on read).
- **`share_links`**: integer **epoch SECONDS** (pinned repo-wide per the plan's DDL; `expires_at > now` must compare like-for-like). Share API contract types (`contracts.ts`) document seconds too.

### Tables

| Table | Columns (nullable in *italics*) | Indexes / constraints |
|---|---|---|
| `user` | id PK, name, email, email_verified (bool, default false), *image*, created_at, updated_at | `user_email_unique` |
| `session` | id PK, expires_at, token, created_at, updated_at, *ip_address*, *user_agent*, user_id | `session_token_unique`, `session_user_id_idx`; FK user_id → user.id **ON DELETE CASCADE** |
| `account` | id PK, account_id, provider_id, user_id, *access_token*, *refresh_token*, *id_token*, *access_token_expires_at*, *refresh_token_expires_at*, *scope*, *password*, created_at, updated_at | `account_user_id_idx`; FK user_id → user.id **ON DELETE CASCADE** |
| `verification` | id PK, identifier, value, expires_at, created_at, updated_at | `verification_identifier_idx` |
| `rate_limit` | id PK, key, count, last_request | `rate_limit_key_unique`. Backs Better Auth's rate limiter with `storage: "database"` (the in-memory limiter is per-isolate on Workers, useless there) |
| `share_links` | token_hash PK (= sha256(rawToken); raw shown once at creation), user_id, car_id, created_at, *expires_at* (null = no expiry), *revoked_at* (null = active) — **epoch seconds** | `share_links_user_car (user_id, car_id)`; FK user_id → user.id **ON DELETE CASCADE**; CHECK `expires_at IS NULL OR expires_at > created_at`; CHECK `revoked_at IS NULL OR revoked_at >= created_at` |

D1 enforces foreign keys by default; the three FKs all cascade on user deletion. Caveat: `ON DELETE CASCADE` fires even under `defer_foreign_keys` — a migration that *rebuilds* `user` (drop/recreate) would cascade-delete `share_links`; use additive migrations on `user`.

---

## 3. Documented gaps & caveats

- **`share_links.car_id` is a SOFT reference.** The car lives in the owner's DO, so no FK is possible. Enforced procedurally (M4): **DO-check-then-insert** at create time (RPC the caller's own DO to confirm the car exists, then insert into D1 — D1↔DO is not atomic, so check first), and **lazy revoke** when `getCarSnapshot` later returns "not found" (set `revoked_at`, serve 410/404).
- **No `userId` inside the DO store.** Ownership = DO identity (`idFromName(verified userId)`, server-controlled, validated before any DO call). Garage rows can never leak across users via a column mix-up because the column doesn't exist.
- **Pre-migration units history is unrecoverable.** The legacy Zustand store (`src/store/useGarageStore.ts` at HEAD `19e470d`: `setCurrency`/`setDistanceUnit`) rewrote stored amounts/mileage in place through approximate FX rates on every setting change (`convertPrice`/`convertDistance`, rounded — the helpers survive in `packages/shared/src/units.ts` for display-time conversion only). Migration therefore **tags values with the device's *current* settings as the baseline and never back-converts** (back-conversion compounds the loss). This applies to both the legacy IndexedDB blob import and **v1 backup imports** — the v1 export (`{ version: 1, exportedAt, cars, themeId, customAccent }`) carries no `currency`/`distanceUnit`, so a v1 import tags with the importing device's current settings, which may differ from the settings at export time. Verify rule: every non-null amount has a currency tag; `mileageRaw` mirrors the source (cars: always; maintenance: iff source non-null); `mileageMiles` present iff the raw parses numerically.
- **Photos are local-only until M3.** `photos` rows are metadata only; `r2Key` is absent until upload lands in M3. The base64 `dataUrl` **never** enters a cell — `flattenCar` routes it to a `photoPayloads` side map (photoId → dataUrl) backed by a local-only, non-mergeable store. Consequence: photos do not cross-device sync in M2 (not a regression). `joinCar` gives a missing payload `dataUrl: ''`; callers then resolve from `r2Key`.
- **Migration sentinels are local-only, never synced.** `idbMigrated` and `unitsSchemaVersion` are per-device state and are deliberately absent from the Values schema (`schema.ts` header). If they synced, cloud-wins Values resolution could clear them from a fresh DO → re-import → duplicate garage; per-cell LWW can't express "once-true". They live alongside the photo-payload side store.
- **`cars.coverPhoto` is a soft pointer** to a `photoId` and can dangle after a merge (device A deletes the photo, device B's pointer survives). Resolve with fallback: missing → first photo → placeholder. The UI must never assume it resolves.
- **R2 orphans + account-deletion lifecycle (M3+/known gaps).** Tombstoned/duplicate photos will not auto-delete their R2 objects — a reconciliation sweep (or delete-on-tombstone hook) is a known intentional gap. Account deletion is the sibling gap: D1 cascades `share_links`, but DO SQLite and R2 have **no** cascade — user deletion must also clear the user's DO storage and delete the R2 prefix `u/<uid>/`, or remain a recorded gap.
- **#268 / fragmented-mode bulk-write numbers — measured, see `docs/M2_GATE.md` (PASSED 2026-06-12, local).** All bulk DO population/clearing goes through chunked **stamped** RPCs (`/api/sync/seed`, `/api/sync/clear`; `DEFAULT_SEED_CHUNK_CELLS = 256`, server cap `MAX_SEED_CHUNK_CELLS = 2048`, body cap 1 MiB — `contracts.ts`) **before** the synchronizer attaches. Headline measurements: a 9,543-cell synthetic garage (~590 KB serialized) seeded in 40 chunks / 389 ms with DO hashes identical to the client's; post-seed attach wrote **0 rows / 96 B** (hash negotiation only); a naive plain-values control re-shipped the store repeatedly and, when applied, produced one un-chunkable 2,872-cell save — both #268 failure directions observed. Local ceiling probe: linear to 50,000 cells / 2.4 MB in one save, **no cliff locally** — but local workerd proves nothing about production limits, so the production single-save ceiling is **still unmeasured** (staging probe required before cutover). Store-size budget: **alert at 15,000 cells, hard review/shard at 20,000** (~1 MiB WS receive cap and the wake-time full-store save both bite near there). Persistence nuance: stamp-only merges and never-live tombstones are not persisted by the fragmented autosave (in-memory stamp map only) — post-restart attaches re-exchange exactly those cells; bounded and convergent.
