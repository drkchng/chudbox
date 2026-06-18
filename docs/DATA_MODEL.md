# Chudbox data model — AS-IS map (entity structure)

Authoritative as-built description of **where every entity lives, how the nested
`Car` flattens into storage, and where the public/private boundary sits**. This
is the stable substrate the design phases (DEC-1/6/10/11/13/14/16) build on; it
documents ENTITY STRUCTURE, not the UI/store-signature churn the foundation
build is making concurrently.

Companion doc `db/schema.md` is the per-store "source of truth + documented
gaps" reference; **on any conflict, the code wins** (cited inline as
`file:line`). Where `db/schema.md` has drifted from the code, this doc flags it
(see "Doc drift" at the end) but does **not** edit it.

Verified against the tree at branch `master` (read-only; no code touched).

---

## 0. The four stores at a glance

| # | Store | Engine | Holds | Synced? | Ownership key |
|---|---|---|---|---|---|
| 1 | **Garage** (TinyBase `MergeableStore`) | client: IndexedDB persister · server: Durable Object SQLite, **fragmented** mode | All garage content (cars + 6 child tables) **+** synced display settings (Values) | **Yes** — CRDT merge | DO identity `idFromName(userId)`; **no `userId` column** |
| 2 | **Local side store** (TinyBase `Store`, non-mergeable) | client: IndexedDB (separate) | Photo base64 payloads + per-device sentinels | **No — never leaves the device** | n/a (per device) |
| 3 | **Relational/auth** (D1 SQLite, Drizzle) | Cloudflare D1 | Better Auth (`user`/`session`/`account`/`verification`) · `rate_limit` · `share_links` | server-only | `user.id` (FK), `user_id` columns |
| 4 | **Image bytes** | Cloudflare R2 (`BUCKET`) | Downscaled photo blobs | server-only | key prefix `u/<userId>/…` |

Bindings (`apps/api/wrangler.jsonc`): `DB` (D1), `BUCKET` (R2), `GARAGE_DO`
(Durable Object, `new_sqlite_classes`). The Worker serves SPA + API on one apex
origin; `/api/*`, `/sync`, `/img/*`, `/share/*` are worker-first.

**Golden split:** stores 1+2 are the local-first garage (exists before any
account; an account is purely additive sync). Stores 3+4 are server-only and
exist only once signed in. Garage content **never** lands in D1; auth data
**never** lands in the DO.

---

## 1. The nested `Car` aggregate (the domain entity)

Defined in `packages/shared/src/types.ts`. This is the in-memory shape the React
components read; it is **assembled on demand** from the flat tables (§3) — it is
NOT how data is stored or synced.

```
Car (extends CarDetails)
├─ id: string                  // crypto.randomUUID() — the carId, parent key
├─ year, make, model, trim, color: string
├─ mileage: string             // raw as entered (CarDetails)
├─ nickname: string
├─ purchaseDate, saleDate: string
├─ status: CarStoredStatus     // 'current'|'for-sale'|'for-trade'|'totaled'|'sold'
├─ salePrice: string           // string (legacy), '' when blank
├─ tradeFor: string
├─ coverPhoto?: string | null  // SOFT pointer to a photoId (can dangle)
├─ createdAt: string           // ISO-8601
├─ photos:      Photo[]         // {id, dataUrl, caption, uploadedAt}
├─ wishlist:    WishlistItem[]  // {id, name, link, price|null, category, notes, status, addedAt}
├─ mods:        Mod[]           // {id, name, category, description, cost|null, installedDate, shop, link, addedAt}
├─ maintenance: MaintenanceRecord[] // {id, service, date, mileage|null, cost|null, shop, notes, nextDueDate, nextDueMileage, createdAt}
├─ todos:       Todo[]          // {id, text, priority, done, createdAt}
└─ issues:      Issue[]         // {id, title, description, severity, status, createdAt, resolvedAt?|null}
```

Enum unions (TS-level only, not constrained in the store):
`WishlistStatus` = `wanted|ordered|installed`; `TodoPriority` = `low|medium|high`;
`IssueSeverity` = `minor|moderate|critical`; `IssueStatus` = `open|in-progress|resolved`.

All entity ids (carId, photoId, modId, recId, itemId, todoId, issueId) are
`crypto.randomUUID()` via `newId()` (`id.ts`) — globally collision-safe so rowIds
can't clash across devices/merges.

**The nested `Car` is LOSSY** (this matters for the design phases): `joinCar`
drops the per-row `*Currency` tags, the canonical `mileageMiles`, and the photo
`r2Key`/`width`/`height`. Those live only on the flat rows. The web read model
re-attaches them onto enriched `StoredCar`/`StoredPhoto`/`StoredMaintenance`
shapes after the join (`apps/web/src/store/adapter.ts:308-327`). **The flat rows
are the source of truth; the nested `Car` is a derived view.**

---

## 2. Storage topology & ownership

- **One Durable Object per user**, addressed `GARAGE_DO.idFromName(verifiedUserId)`
  *after* Better Auth session validation, in every route that touches it
  (`/sync`, `/api/sync/*`, `/api/cars/:carId/share`, `/api/share/*` server-side).
  The DO namespace has no other ingress.
- Because ownership IS the DO identity, **there is no `userId`/owner column
  anywhere in the garage store** — a garage row physically cannot leak across
  users via a column mix-up. (`db/schema.md` §3; `GarageDO.ts:1-4`.)
- The DO store is deliberately **schema-less** (`GarageDO.ts:28-32`): it is a dumb
  replica. A schema there could drop incoming cells while their merged HLC stamps
  survive (raw store and stamp map diverge), and Values defaults would fabricate
  server-stamped settings. The **client** store is schema-applied via
  `createGarageStore()` (`store.ts:40-44`).

---

## 3. Flatten mapping — nested `Car` ⇆ TinyBase rows

The one mapping seam: `flattenCar(car, settings)` → rows, `joinCar(flat)` → `Car`
(`packages/shared/src/flatten.ts`). `FlattenedCar` (`flatten.ts:51-65`):

```
FlattenedCar
├─ carId: string
├─ car:         CarsRow                       // the single parent row
├─ photos:      Record<photoId,   PhotosRow>  // child rows, keyed by entity id
├─ wishlist:    Record<itemId,    WishlistRow>
├─ mods:        Record<modId,     ModsRow>
├─ maintenance: Record<recId,     MaintenanceRow>
├─ todos:       Record<todoId,    TodosRow>
├─ issues:      Record<issueId,   IssuesRow>
└─ photoPayloads: Record<photoId, dataUrl>     // base64 → LOCAL side store ONLY
```

### Keys & relations

- `cars` rowId **= carId** (the parent row).
- Every child row's rowId **= that child's own entity id** (photoId, modId, …),
  and every child row carries a **`carId` cell** = the parent's id. That `carId`
  cell is the **only** parent link (FK-equivalent) — there is no nesting in the
  store.
- Relationship is strictly **1 car → N children** per table. Children reference
  exactly one car; orphaning a child (deleting its car) is done by the
  adapter/DO deleting all rows whose `carId` matches (`adapter.ts:503-521`).
- `photoPayloads` is keyed by **photoId** and lives in the **local side store**,
  never the mergeable store (see §4).

### Strict null rule (round-trip correctness — MAJOR)

`flatten.ts:5-9`, enforced by a fast-check round-trip property in
`flatten.test.ts`:

- A cell is **omitted IFF its value is strictly `null`/`undefined`** — never
  merely falsy. `0` (a real price/cost), `false` (`todos.done`), and `''` (e.g.
  `cars.mileageRaw`) are real values, written explicitly.
- `joinCar` maps **absent → `null`**. `null` and `''` are **distinct**
  round-trippable states (the canonical case is `maintenance.mileage`:
  `string | null`).
- Schema declares nullable cells with a type but **NO TinyBase `default`** — a
  default would resurrect a value where the user meant blank (`schema.ts:5-12`).

### Money — store-as-entered, per-row currency tag (DEC-1)

- Every **non-null** amount (`wishlist.price`, `mods.cost`, `maintenance.cost`)
  is tagged at flatten time with the device `currency` (ISO-4217) into a sibling
  `*Currency` cell (`priceCurrency`/`costCurrency`); tag omitted when amount is
  null (`flatten.ts:150-153,169-172,195-198`).
- `cars.salePrice` stays a **string** (legacy), `''` when blank; its
  `salePriceCurrency` is written **iff `salePrice !== ''`** (`flatten.ts:123`).
- FX is time-varying ⇒ amounts are **never** canonicalized to one currency;
  conversion is display-only. `money.ts` knows only per-currency *structure*
  (minor-unit exponents: JPY 0, most 2, KWD/BHD 3) — never a blanket ×100.
- **Re-tagging hazard:** `joinCar` drops the tags, so round-tripping a row
  through `Car` under a different device currency would re-tag old amounts. The
  adapter therefore writes cells directly and only re-tags when the **amount
  field itself** is in the patch (`adapter.ts:18-26,407-421`). Setting the
  currency is a Values-only write — stored amounts keep their entry tag
  (`adapter.ts:451-456`).

### Mileage — raw + derived canonical (DEC-16 baseline)

- `mileageRaw` (and `nextDueMileageRaw`) is the **authoritative display value**:
  free text exactly as entered (`"unknown"`, `"~120k"`, `"TMU"` are all valid).
- `mileageMiles` (and `nextDueMileageMiles`) is **derived, present IFF the raw
  parses numerically** (`parseMileageMiles`, `flatten.ts:81-91`): strip locale
  group separators (comma, NBSP/narrow/thin spaces, apostrophes — never `.`),
  require a plain non-negative decimal for the *whole* string (rejects
  `'120k' → 120`; `'12,000' → 12000`). km canonicalizes with the exact factor
  `KM_PER_MILE = 1.609344`.
- Stored values are **never** rewritten when the user flips `distanceUnit`;
  display converts from canonical miles (`mileageDisplay.ts`). Note today's
  mileage is a **single value on the car** — DEC-16 (dated check-ins) is a
  future structural change this doc deliberately maps the *current* state of.

---

## 4. TinyBase garage store — schema (synced)

Source of truth: `packages/shared/src/schema.ts`. Nullable cells in **bold**
(exactly the optional props of the `*Row` types).

### Values (synced display settings) — `GARAGE_VALUES_SCHEMA`

| Key | Type | Default | Nullable |
|---|---|---|---|
| `themeId` | string | `'garage'` | no |
| `customAccent` | string | — | **yes** (hex accent when `themeId === 'custom'`) |
| `currency` | string | `'USD'` | no (ISO-4217 code amounts are tagged with) |
| `distanceUnit` | string | `'mi'` | no (`'mi'|'km'`) |

> Caveat (`db/schema.md` §1, `M2_GATE.md` finding B): the client schema
> *fabricates* these defaults as freshly-stamped values, so a fresh device would
> clobber cloud settings under naive LWW. Sync resolves Values **cloud-wins**
> before attach (`apply-cloud-values` step, §6).

### Tables (7) — `GARAGE_TABLES_SCHEMA`

| Table | rowId | Cells (nullable **bold**) |
|---|---|---|
| `cars` | **carId** | year, make, model, trim, color, mileageRaw, **mileageMiles**, nickname, purchaseDate, saleDate, status, salePrice, **salePriceCurrency**, tradeFor, **coverPhoto**, createdAt |
| `photos` | photoId | carId, **r2Key**, caption, uploadedAt, **width**, **height** |
| `wishlist` | itemId | carId, name, link, **price**, **priceCurrency**, category, notes, status, addedAt |
| `mods` | modId | carId, name, category, description, **cost**, **costCurrency**, installedDate, shop, link, addedAt |
| `maintenance` | recId | carId, service, date, **mileageRaw**, **mileageMiles**, **cost**, **costCurrency**, shop, notes, nextDueDate, nextDueMileageRaw, **nextDueMileageMiles**, createdAt |
| `todos` | todoId | carId, text, priority, done (boolean), createdAt |
| `issues` | issueId | carId, title, description, severity, status, createdAt, **resolvedAt** |

Key per-cell notes:

- `cars.mileageRaw` is **non-nullable** (`Car.mileage` is a plain string, `''`
  real); `maintenance.mileageRaw` **is nullable** (source is `string | null`).
  `nextDueMileageRaw` is a non-nullable string.
- `photos.r2Key`/`width`/`height` are nullable because they are **absent until
  the bytes are uploaded to R2** (a photo added offline/logged-out has none yet).
  See §7.
- `photos` rows are **METADATA ONLY** — the base64 `dataUrl` must never land in a
  synced cell (`schema.ts:70-71`); it goes to the local side store (§4a).
- Enum-ish cells (`cars.status`, `wishlist.status`, `todos.priority`,
  `issues.severity`/`status`) are typed in TS only, not constrained in the store.

### Indexes

One TinyBase `Index` per child table on its `carId` cell, id
`` `${tableId}ByCarId` `` (`store.ts:46-63`, `defineCarIdIndexes`). The **client**
builds them so per-car joins are O(rows-for-this-car) (`adapter.ts:214,297`). The
**DO does NOT** build indexes — its one-shot snapshot reads scan + filter on the
`carId` cell instead (`GarageDO.ts:310-324`; a one-shot read builds no index more
cheaply than it scans).

Child-table display ordering is by a timestamp cell, tie-broken by rowId
(`adapter.ts:171-179`): photos→`uploadedAt`, wishlist/mods→`addedAt`,
maintenance/todos/issues→`createdAt`.

### 4a. Local side store (NEVER synced)

A second, non-mergeable TinyBase `Store` on the client (`adapter.ts:70-86`):

- **`photoPayloads` table** — `photoId → { dataUrl }`. The base64 staging/offline
  buffer and the logged-out path. Resolved into joined photos when no `r2Key`
  exists (`''` when missing, e.g. another device's not-yet-fetched photo).
- **Per-device sentinel Values** (deliberately NOT in the synced Values schema,
  `schema.ts:24-25` + `migrate.ts:1-17` — if they synced, a cloud-wins Values
  merge could clear them and re-fire imports → duplicate garage):
  - `idbMigrated` — legacy Zustand blob imported.
  - `unitsSchemaVersion` — units-backfill version (guards re-tagging).
  - `pairedUserId` — userId this device finished sync negotiation with.
  - `needsReseed` — local data was wholesale-replaced (backup import) → re-seed.
  - `photosMigratedToR2` — base64 backlog fully uploaded (cleared when a new
    offline/failed photo creates a backlog).

---

## 5. The Durable Object replica + its RPCs

`apps/api/src/durable/GarageDO.ts` — `GarageDO extends WsServerDurableObject`,
holding the user's whole garage as a `MergeableStore` persisted with
`createDurableObjectSqlStoragePersister(store, ctx.storage.sql, { mode: 'fragmented' })`.

- **Fragmented mode is mandatory** (`GarageDO.ts:6-11`): one SQL row **per cell
  stamp**, never one JSON blob — the default JSON mode serializes the whole store
  into one SQLite row and silently breaks sync at Cloudflare's ~2 MB row limit.
- RPCs (reachable only through the session-authed Worker routes):
  - `seedGarage(encodedChunk)` — apply one bounded stamped chunk (§6).
  - `clearGarage(request)` — tombstone the whole garage in bounded batches.
  - `getMeta()` — live row counts per table + emptiness (tombstone-aware).
  - `getCarSnapshot(carId, scope)` — read-only **curated or full** snapshot of
    one car, built DO-side (§8). Returns null when the car is absent/tombstoned.
  - `resolveSharePhotoKey(carId, photoId)` — the R2 key for a token-scoped
    image, only if the photo lives under that car AND has an `r2Key` (§7/§8).

---

## 6. Sync / mergeable (CRDT) model

TinyBase `MergeableStore` = per-cell HLC (hybrid logical clock) stamps; merge is
**per-cell LWW** keyed on HLC. Tombstones are stamps whose value slot is
`undefined` (distinct from a legal `null` cell). Client persists to IndexedDB +
syncs over WebSocket (`/sync`, same-origin so the session cookie rides the
upgrade); the DO is the server peer.

### The golden rule — seed/clear/merge BEFORE attach

All bulk DO population/clearing goes through **chunked, HLC-stamped RPCs BEFORE
the WS synchronizer attaches**, so attach exchanges only genuine deltas and never
the un-chunkable full-store reconcile of TinyBase **issue #268** (`sync.ts:1-7`,
`seed.ts:1-9`).

- **Chunk transport** (`seed.ts`): `chunkMergeableContent` slices
  `getMergeableContent()` into `MergeableChanges`-form chunks carrying the
  **original** per-cell HLCs (never re-stamped); `encodeSeedChunk` JSON-encodes
  with a sentinel (`￼`) for `undefined` tombstones. Idempotent: re-applying
  a chunk is a per-cell LWW no-op. One chunk = one transaction = one bounded
  fragmented persister save.
- **Budgets** (`contracts.ts:147-155`): `DEFAULT_SEED_CHUNK_CELLS = 256`, server
  hard cap `MAX_SEED_CHUNK_CELLS = 2048`, request body cap 1 MiB.
- **Endpoints** (`contracts.ts`, `apps/api/src/routes/sync.ts`): `POST
  /api/sync/seed`, `POST /api/sync/clear`, `GET /api/sync/meta` — all
  session-authed, addressing the DO via `idFromName(userId)`.

### Decision matrix — `decideSyncPlan` (`sync.ts:96-122`, pure/unit-tested)

| cloud rows | local rows | plan |
|---|---|---|
| no | no | `attach` |
| no | yes | `seed → verify-seed → attach` |
| yes | no | adopt cloud values → `attach` (download) |
| yes | yes | **user choice** required |

User-choice branches (both sides have data):
- **Merge** (default): adopt cloud values → `seed → attach` (union; same-id rows
  resolve per-cell LWW; distinct ids may duplicate).
- **Keep cloud**: `reset-local` (data + stamp map) → `attach`.
- **Keep local**: `clear-cloud` → `restamp-local` → `seed → verify-seed →
  attach`.

Supporting steps: `apply-cloud-values` drops local Value stamps so the DO's
settings win on attach (settings never decided by wall-clock); `restamp-local`
re-mints local stamps to out-stamp the clear's fresh tombstones, with a
clock-skew guard that waits until the device clock passes the server `Date`
header; `verify-seed` re-reads `/api/sync/meta` and compares live row counts
before attaching. `pairedUserId` lets an already-paired device skip negotiation
and attach directly (`sync.ts:388-403`).

### Store-size ceiling (#268)

`M2_GATE.md` (PASSED 2026-06-12, local): **alert at 15,000 cells, hard
review/shard at 20,000**. The production single-save ceiling is **still
unmeasured** (staging probe required before cutover). Relevant to any design
phase that grows per-car cell counts (e.g. unified photos, dated mileage
check-ins).

---

## 7. R2 image pipeline & keying

- **Key:** `u/<userId>/<carId>/<photoId>.<ext>` (`contracts.ts:56-58`,
  `buildPhotoKey`). `<userId>` is derived **server-side** from the session, never
  trusted from the client; `<ext>` ∈ {`webp`,`jpg`} reflects the **actually
  encoded** format (Safari falls back from WebP to JPEG — feature-detected, not
  hardcoded; `imagePolicy.ts`). `parsePhotoKey` rejects any malformed/traversal
  key before authorizing.
- **Upload** (`POST /api/uploads`, `apps/api/src/routes/uploads.ts`):
  session-authed binding-proxy upload (no presigned PUT, no bucket CORS).
  Content-type is **sniffed from magic bytes**, not trusted from the client; size
  bounded before buffering; the row records the client's intended downscale
  `width`/`height` (the Worker has no decoder). Response = the exact cells written
  to the synced `photos` row (`r2Key`, `width`, `height`, `contentType`).
- **Lifecycle** (local-first): photo added → renders instantly as base64 in
  `photoPayloads` → if signed-in+online, uploads and swaps in `r2Key` in the
  background; logged-out/offline it stays base64 (no network). First signed-in
  run sweeps the backlog (`migratePhotosToR2`), gated by the local-only
  `photosMigratedToR2` sentinel. Display precedence: `r2Key` (served via
  owner-only `/img/<r2Key>`) → local base64 → placeholder.
- **Delete-on-replace:** `POST /api/uploads/delete` ownership-checks every key
  against the session prefix, then R2 batch-deletes (idempotent).
- **Image policy** (`imagePolicy.ts`): FREE tier = 1600 px long edge, q≈0.78,
  downscaled-only (no archived originals). All quality/archival knobs are routed
  through the `ImagePolicy` seam so a future paid tier flips a constant.

---

## 8. D1 relational schema (auth + share links)

Source: `apps/api/src/db/schema.ts` → migrations `apps/api/drizzle/0000_init.sql`
(`0001` adds `view_count`, `0002` adds `scope`). Better Auth tables hand-written
to match better-auth@1.6.18; drizzle maps camelCase TS ↔ snake_case SQL.

### Timestamp units — deliberate, pinned

- **Better Auth tables** (`user`/`session`/`account`/`verification`): integer
  epoch **MILLISECONDS** (drizzle `timestamp_ms`).
- **`share_links`**: integer epoch **SECONDS** (pinned repo-wide;
  `contracts.ts:201`). `expires_at`/`created_at`/`revoked_at` all compare
  like-for-like.

### Tables

| Table | Columns (nullable *italic*) | Indexes / constraints |
|---|---|---|
| `user` | id PK, name, email, email_verified (bool, default false), *image*, created_at, updated_at | `user_email_unique` |
| `session` | id PK, expires_at, token, created_at, updated_at, *ip_address*, *user_agent*, user_id | `session_token_unique`, `session_user_id_idx`; FK user_id → user **ON DELETE CASCADE** |
| `account` | id PK, account_id, provider_id, user_id, *access_token*, *refresh_token*, *id_token*, *access_token_expires_at*, *refresh_token_expires_at*, *scope*, *password*, created_at, updated_at | `account_user_id_idx`; FK user_id → user **CASCADE** |
| `verification` | id PK, identifier, value, expires_at, created_at, updated_at | `verification_identifier_idx` |
| `rate_limit` | id PK, key, count, last_request | `rate_limit_key_unique` (backs Better Auth's DB rate limiter; in-memory limiter is per-isolate on Workers) |
| `share_links` | **token_hash PK**, user_id, car_id, created_at, *expires_at* (null=no expiry), *revoked_at* (null=active), **view_count** (NOT NULL default 0), **scope** (`'curated'|'full'` NOT NULL default `'curated'`) — epoch **seconds** | `share_links_user_car (user_id, car_id)`; FK user_id → user **CASCADE**; CHECK `expires_at IS NULL OR expires_at > created_at`; CHECK `revoked_at IS NULL OR revoked_at >= created_at` |

`user.id` is the only entity all server-side data hangs off. D1 enforces FKs;
all three FKs cascade on user deletion. (`ON DELETE CASCADE` fires even under
`defer_foreign_keys`, so rebuild-`user` migrations would cascade-delete
`share_links` — use additive migrations on `user`.)

### `share_links` — the share boundary row (M4)

`apps/api/src/routes/share.ts` (owner + public routes) + `GarageDO.getCarSnapshot`
/ `resolveSharePhotoKey`. Two surfaces:

- **Owner (session-authed):** `POST`/`GET /api/cars/:carId/share`,
  `DELETE /api/cars/:carId/share/:id`. DO addressed only via
  `idFromName(verifiedUserId)`.
- **Public (NO session):** `GET /api/share/:token` (snapshot),
  `GET /api/share/:token/img/:photoId` (token-scoped image),
  `POST /api/share/:token/view` (record one view). Owner/car/scope and every R2
  key are derived **server-side from the validated row** — never from the
  request.

Row mechanics:

- **`token_hash` = `sha256(rawToken)` (lowercase hex) ONLY.** The raw token is 24
  bytes from `crypto.getRandomValues` → URL-safe base64 (32 chars, no padding,
  ≥128-bit entropy), embedded in the share URL and returned **exactly once** at
  creation (`share.ts:145-152`). Lookups are by hash; the raw token never
  persisted.
- **`ShareLinkMeta.id` = a 24-hex-char (96-bit) prefix of `token_hash`**
  (`SHARE_LINK_ID_MIN_LEN`, `contracts.ts:308`). Owner list/revoke key off this
  prefix — enough to dedupe/revoke, useless as a credential (it's a slice of the
  public hash, not the token).
- **`car_id` is a SOFT reference** (no FK — the car lives in the DO). Enforced
  procedurally: **DO-check-then-insert** at create (RPC `getCarSnapshot` first;
  null → 404, no row written), and **lazy-revoke** when a later snapshot read
  finds the car gone (set `revoked_at`, serve 410).
- **`scope`** (`'curated'|'full'`, default `'curated'`) is chosen by the
  authenticated owner at create and read back **server-side** from the row — the
  public route never derives it from the request. The route re-narrows the stored
  value to the two known scopes, defaulting unknown → `'curated'`
  (`share.ts:86-88`), so an out-of-band write can never silently expose `'full'`.
- **`view_count`** is a SOFT, public hit counter. `POST /api/share/:token/view`
  (UNCACHED) atomically increments it for **valid links only**, kept separate
  from the edge-cached snapshot GET (which would undercount). It counts browser
  sessions, is publicly POSTable, and the response is content-free either way
  (never leaks link validity/owner) — the UI labels it "views", not "visitors".
- **Serveable iff** `revoked_at IS NULL AND (expires_at IS NULL OR expires_at >
  now)` (seconds, `isLinkActive`). Unknown hash → 404; revoked/expired → 410.
  Active responses are edge-cached `s-maxage≈60`, browser `max-age≤5` (a revoke
  is bounded at the edge; private cache can't be revoked).

---

## 9. Public/private boundary — the curated snapshot

The leak-safety boundary lives in `packages/shared/src/publicSnapshot.ts`. It is
a **strict, explicit, key-by-key ALLOWLIST (deny-by-default)** — output objects
are built field-by-field, never spread-and-delete, so any field added to the
domain model later stays private until it is named. The curation runs **DO-side**
in `getCarSnapshot` (`GarageDO.ts:264-295`), so raw private cells only leave the
DO when the link's stored scope says so. Exhaustively asserted in
`publicSnapshot.test.ts`.

Two scopes (`ShareScope`):

| Group | `curated` — `PublicCarSnapshot` (showcase, default) | `full` — `FullCarSnapshot` adds | Always withheld (both scopes) |
|---|---|---|---|
| car header | year, make, model, trim, color, nickname, mileageRaw, *mileageMiles*, status, *purchaseDate*, *saleDate*, createdAt, *coverPhotoId* (resolved cover → first photo → none) | *salePrice*, *tradeFor* | userId, email, other cars, internal row ids (beyond photoId) |
| photos[] | photoId, caption, *width*, *height* — **no URL** (viewer derives token-scoped) | (same) | raw `r2Key`, base64 `dataUrl` |
| mods[] | name, category, description, installedDate, link, addedAt | *cost*, *shop* | — |
| maintenance[] | service, date, *mileageRaw*, *mileageMiles*, *nextDueDate*, *nextDueMileageRaw*, *nextDueMileageMiles*, createdAt | *cost*, *shop*, *notes* | — |
| wishlist / todos / issues | **excluded entirely** | full arrays (no internal ids) | internal ids |
| settings | themeId, *customAccent*, distanceUnit | + `currency` (money is shown in `full`) | — (curated shows **no** money: `currency` read DO-side but never placed in the snapshot) |

Net guarantee for **curated** (asserted in tests): no money amount or
`*Currency` tag, no `shop`, no `notes`, no wishlist/issues/todos, no
`tradeFor`/`salePrice`, no raw `r2Key`/`dataUrl`.

### Enforcement layers (defense in depth)

1. **Build-time allowlist** (DO-side, `buildPublicSnapshot`/`buildFullSnapshot`)
   — private cells never cross the RPC boundary unless scope = full.
2. **Scope is server-authoritative** — read from the stored row, re-narrowed,
   never from the request (`share.ts:330-331`).
3. **Response validator** (`contracts.ts:434-564`) — a strict
   (`z.strictObject`) zod schema, discriminated on `scope`, that the **public
   viewer** runs over the untrusted network body before rendering. An extra key
   (a field the curator started leaking) **fails validation** instead of reaching
   the page; a `curated` body can never be rendered as `full` or vice-versa.
4. **Status allowlist** (`PUBLIC_STATUS_ALLOWLIST`, `contracts.ts:385-398`) — the
   `Record` is keyed by the full `CarStatus` union, so adding a status fails the
   build until it is explicitly allowlisted.
5. **Token-scoped images** (`SHARE_IMG_ROUTE`) — the snapshot carries **photoIds
   only**; the viewer composes `/api/share/:token/img/:photoId`; the route
   resolves the R2 key server-side via `resolveSharePhotoKey` (only photos under
   the link's `car_id` with an `r2Key`) and re-checks the key's embedded userId
   == link owner before streaming. The raw key and owner-only `/img` path never
   leave the server.

The **Open Graph** crawler path (`lookupCuratedShareSnapshot`, `share.ts:262`)
**always** requests `curated` regardless of stored scope — link previews never
expose `full` private data.

---

## 10. Entity / id catalog (relationships)

```
user (D1, id PK)
├─1:N─ session       (user_id FK, cascade)
├─1:N─ account       (user_id FK, cascade)
├─1:N─ share_links   (user_id FK, cascade) ──soft ref──> cars.<carId> (in the user's DO)
└─1:1─ GarageDO      (idFromName(user.id); NO user_id column inside)
        └─ MergeableStore
           ├─ cars         (rowId = carId)
           │   └─1:N (carId cell)─ photos | wishlist | mods | maintenance | todos | issues
           │       └─ photos.r2Key ──> R2 object  u/<userId>/<carId>/<photoId>.<ext>
           │       └─ cars.coverPhoto ──soft pointer──> photos.<photoId> (may dangle)
           └─ Values: themeId, customAccent?, currency, distanceUnit

local side store (per device, never synced)
├─ photoPayloads (photoId → dataUrl)
└─ sentinels: idbMigrated, unitsSchemaVersion, pairedUserId, needsReseed, photosMigratedToR2
```

Soft references the design phases must treat as possibly-dangling:
- `cars.coverPhoto → photos.<photoId>` (resolve: cover → first photo →
  placeholder; never assume it resolves — `db/schema.md` §3,
  `publicSnapshot.ts:159-164`).
- `share_links.car_id → cars.<carId>` (no FK; DO-check-then-insert + lazy-revoke).

---

## 11. Known gaps relevant to the design phases

- **Account deletion is incompletely cascaded.** D1 cascades `session`/`account`/
  `share_links` on `user` delete, but **DO SQLite and R2 have no cascade** — user
  deletion must also clear the user's DO storage and purge the `u/<userId>/` R2
  prefix, or stay a recorded gap. Bears on Privacy/Law-25 (task #36).
- **R2 orphans:** the server delete endpoint is correct + tested, but the web
  client's delete-on-delete hook currently targets `DELETE /img/<r2Key>` rather
  than the implemented `POST /api/uploads/delete` batch endpoint and swallows
  errors — so client-driven deletes don't yet reach the server endpoint. A
  periodic reconciliation sweep for missed orphans is deferred (`db/schema.md`
  §3; `uploads.ts:49-54`).
- **Pre-migration units history is unrecoverable** — the legacy store rewrote
  amounts/mileage in place via approximate FX; migration tags with the **current
  device settings** and never back-converts. v1 backup imports carry no
  currency/distanceUnit, so they tag with the importing device's settings
  (`db/schema.md` §3, `migrate.ts`).
- **Mileage is a single value today** (DEC-16 will restructure to dated
  check-ins); **photos attach only to the car** today (DEC-6 will let a photo
  attach to a mod/maintenance/issue/todo). **No VIN field** exists (DEC-13).
  **No owner display name** on `user` beyond `name` (DEC-10). **No follow/saved
  builds** entity exists yet (DEC-11). This doc maps the current state these
  phases extend.

---

## 12. TARGET DESIGN — DEC-11: Follow / Saved Builds (saved-shares)

Lets a visitor **save a shared build** (by its share token/URL), give it a
**personal nickname**, watch it in a **Watching** list, and **live-refetch** the
build from its curated snapshot. LOCAL-FIRST (works logged-out, in the local
store like the garage) and SYNCS once there is an account. Net-new entity; this
section is the TARGET design (the code in §§1–11 is unchanged today).

### 12.0 Where it lives — and why

| Candidate home | Verdict |
|---|---|
| **Synced garage `MergeableStore` (new top-level table)** | **CHOSEN** for the durable follow record. Reuses the entire local-first + CRDT-sync stack (IndexedDB persister, the DO replica, seed/merge/attach, decideSyncPlan) with **zero new infra**; logged-out it is plain IndexedDB, on sign-in it seeds + merges to the DO exactly like cars. Account-deletion DO purge (gap §11) already covers it — **no new server cascade surface**. |
| D1 table | **Rejected** as primary: D1 only exists once signed in → not local-first, breaks the logged-out requirement. (Also adds a new `user`-cascade surface.) |
| Local-only side store (non-mergeable) | **Rejected** as primary: works logged-out but never syncs (DEC-11 requires sync). **Kept for the heavy snapshot cache only**, see below. |

**The split (mirrors the existing photos pattern — synced metadata row +
local-only heavy payload):**

1. **`savedBuilds`** — the durable, user-authored **follow intent** plus a
   **small denormalized showcase header** (the "cached snapshot for the list
   view"). Lives in the **synced garage `MergeableStore`** → follower's DO. Small
   and bounded (one row per followed build, ~16 cells), so it renders the
   Watching list instantly on any device, offline, before any network refetch.
2. **`savedBuildSnapshots`** — the **full curated snapshot** cache (all photos /
   mods / maintenance) for offline *detail* view. Lives in the **local-only side
   store** (non-mergeable, never synced), keyed by the same rowId. It is fully
   re-fetchable and would otherwise blow the #268 cell ceiling, so it stays out
   of the synced store (the pressure-relief valve, exactly like `photoPayloads`).

### 12.1 Keys & content-addressed rowId (merge-idempotent)

**rowId of both tables = `sha256(rawToken)` (lowercase hex).** Content-addressed,
which buys three things the garage's UUID rowIds cannot here:

- **Merge-idempotent across devices** — saving the *same* link on two devices
  yields the *same* rowId, so the CRDT unions them into one row (per-cell LWW on
  `nickname`) instead of the "distinct ids duplicate" hazard (§6). Re-saving is a
  per-cell no-op.
- **Dedup for free** — "already following this link?" is `getRow('savedBuilds',
  sha256(token))`, O(1), no scan, no secondary index.
- **The structural key is the *hash*, not the bearer credential** — symmetric
  with the OWNER side, where `share_links.token_hash = sha256(token)` is the PK.

The **raw token is stored as a cell** (`token`), because the follower *must* hold
it to refetch `GET /api/share/<token>` and to compose token-scoped image URLs
`shareImgPath(token, photoId)` and the view ping — the follower has no other
handle on someone else's car (ownership is the owner's DO; there is no shared
`carId`). The hash derivation is **async** (`crypto.subtle`), so unlike the pure
sync `flattenCar`, the rowId is computed by the *save action* (which is already
doing network IO), not inside a pure flatten.

### 12.2 `savedBuilds` — synced table (add to `GARAGE_TABLES_SCHEMA` + `GARAGE_TABLE_IDS`; NOT `CHILD_TABLE_IDS`)

rowId = `sha256(token)` hex. Nullable cells in **bold** (declared with a type but
**NO TinyBase `default`**, per the strict null rule — a default would resurrect a
value where the user/cache meant absent).

| Cell | Type | Nullable | Meaning |
|---|---|---|---|
| `token` | string | no | RAW bearer token — refetch + image URLs + view ping. Held only in the follower's own local + DO store. |
| `savedAt` | string | no | ISO-8601 first-saved time (the `createdAt` analog; sort fallback). |
| `nickname` | string | **yes** | Follower's PERSONAL label (DEC-11). Absent ⇔ never set (UI falls back to `cachedNickname` → `year make model`). `''` is a distinct, real "cleared" state. |
| `sortOrder` | number | **yes** | Optional manual Watching order; default order is `savedAt` desc. Reserved now so reordering needs no migration later. |
| `cachedYear` | string | **yes** | Showcase header cache (DEC-14 card fields: nickname · mods count · status · mileage). |
| `cachedMake` | string | **yes** | " |
| `cachedModel` | string | **yes** | " |
| `cachedNickname` | string | **yes** | The build's OWN nickname (the owner's), distinct from the follower's `nickname`. |
| `cachedOwnerName` | string | **yes** | Owner display name (DEC-10). Null until DEC-10 exposes it in the snapshot. |
| `cachedStatus` | string | **yes** | Car status, for the chip. |
| `cachedMileageRaw` | string | **yes** | Current mileage, as the curated snapshot exposes it. |
| `cachedModsCount` | number | **yes** | Mods count for the card. |
| `cachedCoverPhotoId` | string | **yes** | Resolved cover photoId (cover → first → none, already done by the curated builder) → image via `shareImgPath(token, cachedCoverPhotoId)`. |
| `cachedScope` | string | **yes** | `'curated' \| 'listing' \| 'full'` (REVISED per review — the merge adds the third scope `'listing'`, §14.1/§15.7, so a followed For-Sale link's scope is representable). Informational badge only; **never widens what is cached** (the cached header stays curated-equivalent even for a `listing`/`full` link). The Watching-list badge logic must handle the `'listing'` value. |
| `lastRefreshedAt` | string | **yes** | ISO-8601 of last successful live-refetch (cache-freshness stamp; "as of …"). Set at save (the page already has the snapshot). |
| `unavailableSince` | string | **yes** | ISO-8601 set on a 404/410 refetch (revoked / expired / car gone). Absent ⇔ active. Mirrors `share_links.revoked_at` semantics; the row is KEPT (last-good header) so the user can see "no longer available" and dismiss — never auto-deleted. |

**Non-nullable:** `token`, `savedAt`. **No `carId`, no carId Index, no secondary
index** — `savedBuilds` is NOT a child of `cars`; the Watching list IS the whole
(bounded) table, read with `getRowIds('savedBuilds')` and sorted client-side by
`sortOrder ?? savedAt desc`. Zero new indexes ⇒ zero index write cost.

### 12.3 `savedBuildSnapshots` — local-only cache (side store, never synced)

rowId = `sha256(token)` hex (same id → trivial 1:1 join to the list row).
`{ snapshot: string (JSON of the curated PublicCarSnapshot), fetchedAt: string }`
— one JSON-blob cell, exactly like `photoPayloads` holds one base64 string. Add
the table-name constant next to `PHOTO_PAYLOADS_TABLE`. Freely pruneable
(LRU/cap) — it is a cache, not a source of truth.

### 12.4 Flatten mapping

`savedBuilds` is **outside the nested `Car` aggregate**, so it does **NOT** pass
through `flattenCar`/`joinCar`. A `SavedBuild` is already flat (no children), so
the mapping is a trivial identity pair `flattenSavedBuild(b) → SavedBuildRow` /
`joinSavedBuild(rowId, row) → SavedBuild`, applying the **same strict null rule**
(omit a nullable cell IFF strictly null/undefined; `''`/`0`/`false` are real).
The rowId is supplied by the caller (= `sha256(token)`), not derived inside the
(pure, sync) flatten. No money/`*Currency` tags and no mileage canonicalization
live here — the cached fields are copied verbatim from the already-curated public
snapshot (money is never in a curated snapshot anyway).

### 12.5 Migration (mergeable-safe · local-first · backfill)

**Purely additive — net-new feature, no existing follow data to backfill.**

- **Up:** add `savedBuilds` to `GARAGE_TABLES_SCHEMA` + `GARAGE_TABLE_IDS` (NOT
  `CHILD_TABLE_IDS`); add the `savedBuildSnapshots` constant to the local side
  store. `setTablesSchema` on an existing `MergeableStore` is a **superset add** —
  it removes nothing and does NOT trigger a full-store reconcile; existing
  devices simply gain an empty table. **No sentinel, no re-seed, no HLC restamp.**
- **DO needs no migration** — it is deliberately schema-less (§2), a dumb replica;
  the new table's cells flow through the existing seed/merge/attach machinery as
  ordinary deltas. Because `savedBuilds ∈ GARAGE_TABLE_IDS`, follows created while
  **logged-out** are picked up by the same chunked seed-before-attach path as cars
  on first sign-in (golden rule, §6), and the both-sides "merge" branch unions
  follows by their content-addressed rowId (12.1) — no duplicates.
- **Incremental saves are ordinary deltas, not a bulk seed.** One save = one
  `setRow` = one tiny transaction = one bounded fragmented DO save, far under any
  chunk budget; the WS synchronizer carries it like any cell edit. The golden
  rule (seed/clear *before* attach) governs BULK migration only — it does not
  constrain a single follow write on the attached store.
- **Down (reversible):** drop `savedBuilds` from the schema and tombstone its rows
  (a clear scoped to that table); drop the local `savedBuildSnapshots` table. No
  data destroyed beyond a re-fetchable cache, so the down is loss-free for any
  irreplaceable data (the only authored field, `nickname`, is the only thing a
  user would miss).
- **#268 ceiling:** `savedBuilds` adds ~16 cells per followed build to the SHARED
  garage store (the 15k-alert / 20k-shard budget, §6). A user-curated Watching
  list is modest (even 500 follows ≈ 8k cells), but it is additive to the garage —
  hence the deliberate choice to keep the heavy full-snapshot cache
  (`savedBuildSnapshots`) **out** of the synced store.

### 12.6 Relations (target)

```
follower user (D1, id PK)
└─1:1─ GarageDO (idFromName(follower.id))
        └─ MergeableStore
           └─ savedBuilds  (rowId = sha256(token))
               ├─ .token ──SOFT, CROSS-USER, CROSS-STORE──> some OTHER owner's
               │     share_links.token_hash = sha256(token) (D1) + that owner's
               │     DO car. NO FK possible. Dangles on revoke/expire/delete →
               │     refetch 404/410 → set unavailableSince. (Follow analog of
               │     the existing cars.coverPhoto / share_links.car_id soft refs.)
               └─ .cachedCoverPhotoId ──> image via /api/share/<token>/img/<id>

local side store (per device, never synced)
└─ savedBuildSnapshots (rowId = sha256(token)) ──1:1 (same id)──> savedBuilds row
```

### 12.7 Snapshot / leak-safety impact

- **The public allowlist (§9) is UNCHANGED.** The follower consumes the EXISTING
  curated snapshot; the feature widens nothing. The cached header/snapshot is the
  curated public output (already money/notes/VIN/owner-email/`r2Key`-free), so
  storing it in the follower's own store leaks nothing about the followed owner.
- **INVARIANT to preserve:** `savedBuilds` is OUTSIDE the `Car` aggregate and MUST
  NEVER enter any share snapshot. `getCarSnapshot` / `buildPublicSnapshot` /
  `buildFullSnapshot` build key-by-key from the Car only and never read
  `savedBuilds` — keep it that way (a follower's saved tokens must never appear in
  what the follower *themselves* shares).
- **Follower's saved tokens are bearer credentials at rest** in the follower's
  own DO (addressed `idFromName(followerUserId)`) — same confidentiality class as
  garage data. Saving a link is not a new exposure (the token was in the URL the
  follower already holds); owners can still revoke. Treat `savedBuilds` with
  garage-grade confidentiality; never surface it cross-user.
- **Keep the synced cache CURATED even for `full` links.** A follower may
  legitimately hold a `full`-scope link, but the Watching LIST cache should store
  only curated-equivalent header fields — never sync another owner's money / notes
  / VIN into the follower's store. The full view is fetched live when the follower
  opens the build detail.

### 12.8 Cross-feature interactions (FLAGGED)

1. **Curated card projection needed (NEW server requirement).** The list
   live-refetch wants a lightweight, curated "card" of the snapshot, but today the
   only public read is `GET /api/share/:token` returning the FULL-or-curated
   snapshot at the link's *stored scope*. Options: (a) the follower refetches and
   **down-projects** full→header client-side before caching; (b) add a public
   curated **card** projection (e.g. `?view=card`) reusing `buildPublicSnapshot` /
   `lookupCuratedShareSnapshot` for less bandwidth and a guaranteed-curated list
   cache. Recommend (b). *(Data model is unaffected either way.)*
2. **View-count (DEC/share):** a BACKGROUND auto-refetch must NOT POST
   `/api/share/:token/view` — only a real page open counts. Keep the existing
   sessionStorage-guarded human-visit semantics; background follow refreshes use
   the GET (or the card projection) only.
3. **DEC-10 owner name:** `cachedOwnerName` is populatable only once DEC-10 adds
   the owner display name to the snapshot; null until then.
4. **DEC-14 share purpose / DEC-13 VIN / DEC-19 plate:** listing/private fields
   are `full`-scope or owner-opt-in and stay OUT of the curated header → never
   cached in `savedBuilds`. The buyer/for-sale angle (DEC-11) sees price/VIN/seller
   only in the LIVE detail view of a listing link, not in the Watching list cache.
5. **DEC-15 TanStack Query:** the live-refetch read layer is TanStack Query, scoped
   to the share/follow READ surface (per DEC-15) — TinyBase owns the durable follow
   state (`savedBuilds`) + the offline caches; TanStack Query owns the network
   refetch/staleness lifecycle. They meet at one write: on a successful refetch,
   update `cachedX` + `lastRefreshedAt` (and `savedBuildSnapshots`), or set
   `unavailableSince` on 404/410.
6. **DEC-16 mileage / DEC-6 photos:** structurally inert for follows —
   `cachedMileageRaw` stores whatever current value the curated snapshot exposes
   (latest check-in under DEC-16); `cachedCoverPhotoId` stores a resolved photoId
   regardless of DEC-6's attach-to-item changes.
7. **Account deletion (gap §11):** a PLUS of the DO-over-D1 choice — follows live
   in the follower's DO, already covered by the (still-open) "purge DO on user
   delete" gap; the feature adds **no** new D1 rows and **no** new R2 keys, so no
   new cascade and no new orphan surface.

---

## 13. TARGET DESIGN — DEC-16: Mileage as dated check-ins (forward-looking)

> A **target** (not as-built) section. Designs the entity structure for DEC-16 —
> *mileage is a time series, not a static field*. No code edited (SPEC task); the
> feature build implements it. Verified against the same `master` tree as the
> AS-IS map above.

### 13.1 The shape change in one line

`cars.mileageRaw` (a single odometer scalar) → a **`mileage` child table of dated
check-ins**; the car's **current odometer = the latest check-in**; maintenance
at-service mileages **feed the same timeline as a computed union, not a copy**.

### 13.2 New entity — `mileage` (a check-in = one dated odometer reading)

Lives in the **TinyBase garage `MergeableStore`** (synced; client IndexedDB + DO
SQLite fragmented) — it is garage content, so **never** D1, **never** R2, **never**
the local side store. It is the 7th child table; ownership stays implicit (DO
identity), so **no `userId` column**, only a `carId` cell.

| Cell | Type | Nullable | Meaning |
|---|---|---|---|
| `carId` | string | no | parent link (the only FK-equivalent), `= cars.<carId>` |
| `valueRaw` | string | no | odometer reading **exactly as entered** (store-as-entered); free text tolerated for migration fidelity (`'unknown'`, `'~120k'`) but normal entries are numeric |
| `valueMiles` | number | **yes** | canonical miles, present **iff `valueRaw` parses** under `unit` (`parseMileageMiles`, exact ×1.609344). Absent ⇔ non-numeric reading → excluded from timeline math |
| `unit` | string | no | `'mi'｜'km'` — the unit this reading was **entered in, frozen at entry**. The distance analogue of the per-amount `*Currency` tag (DEC-1) |
| `date` | string | no | ISO-8601 **date the odometer was at this value** (default today) — the timeline x-axis |
| `source` | string | no | provenance: `'manual'｜'initial'｜'import'｜'legacy-edit'` (TS union, store-unconstrained like the other enum-ish cells) |
| `createdAt` | string | no | ISO-8601 row-creation timestamp — ordering tiebreak + audit |

- **rowId = `checkInId` = `newId()` (`crypto.randomUUID`)** for user-created
  check-ins — globally collision-safe, same as every other entity id. **Sole
  exception:** the migration-seeded `initial` reading uses a **deterministic**
  rowId `` `${carId}::initial` `` (§13.5) — a *deliberate* clash so independent
  offline backfills collapse on merge instead of duplicating.
- Add `mileage` to `CHILD_TABLE_IDS` → it gets the `mileageByCarId` client Index
  (per-car timeline join is O(rows-for-this-car)); the DO builds no index and
  scans+filters on `carId` like the other six. Justified by `useCar(id)` and
  `getCarSnapshot` reading all check-ins for one car; write cost = one index
  entry per insert (negligible).
- **Display order is by `date` then `createdAt`** (a timeline), unlike the other
  child tables whose order is by their single add/created timestamp — sorted
  in-memory after the carId slice (no composite index; per-car sets are bounded).

**Normalization:** BCNF — `checkInId` is the sole candidate key and determines
every cell. `valueMiles` is a *documented materialized derivation* of
`(valueRaw, unit)` (a transitive dep that would otherwise break 3NF) — kept as a
first-class cell exactly as `cars.mileageMiles`/`maintenance.mileageMiles` are,
because the mergeable store needs the canonical comparison value to **merge per
cell**; recomputing on read can't merge. Same trade, same precedent.

**Why `unit` per row (the headline improvement):** today mileage canonicalizes
with the *global* `distanceUnit` at flatten time and keeps only `mileageMiles`;
the entry unit is **not** frozen, so re-deriving miles after a units flip would
use the wrong unit, and a raw string can't be redisplayed in its own unit. The
check-in freezes its entry unit per row — bringing mileage to **parity with
money's store-as-entered discipline** (DEC-1) and making `valueMiles`
losslessly re-derivable.

### 13.3 Changed entities

- **`cars.mileageRaw` / `cars.mileageMiles` → transition-only, deprecated.**
  Expand-contract: they are **retained** through the transition as a mirror of
  the latest check-in (so un-upgraded clients and the *existing* snapshot path —
  which reads `cars.mileageRaw` — keep working unchanged), kept consistent by the
  new "log mileage" write path (`cars.mileageRaw := latest-check-in raw`). They
  are **dropped in a later contract migration** (§13.5), which is the only
  destructive step and must state its blast radius + confirm a backup first.
- **Nested `Car` aggregate:** add `mileageLog: MileageCheckIn[]`; keep the legacy
  scalar `mileage: string` during transition (a *new* field name avoids a
  type-collision rename while both coexist), remove `mileage` in the contract
  phase. New shared type:

  ```ts
  export interface MileageCheckIn {
    id: string
    value: string            // → valueRaw (store-as-entered)
    unit: DistanceUnitCode   // 'mi' | 'km' — frozen at entry
    date: string             // ISO-8601, default today
    source: MileageSource    // 'manual' | 'initial' | 'import' | 'legacy-edit'
    createdAt: string
  }
  ```
- **`maintenance` is UNCHANGED.** Its `mileageRaw`/`mileageMiles` (at-service) and
  `nextDueMileageRaw`/`nextDueMileageMiles` stay where they are and remain the
  single source of truth for themselves (see §13.4).

### 13.4 Maintenance "feeds the same timeline" — computed union, NOT a copy

- **Rejected — materialize:** writing a derived `mileage` row per maintenance
  at-service mileage. A denormalization with no query-perf evidence, and
  **unsafe under CRDT**: the maintenance row and its derived check-in merge
  *independently* across devices with no cross-row transaction, so an edit/delete
  on one device can leave an orphaned/stale derived reading.
- **Chosen — derived `OdometerTimeline` (read-model view):** a pure
  `buildOdometerTimeline(car)` that unions, per car:
  1. each `mileage` row with `valueMiles != null` → `{ miles, date, valueRaw, unit, source, refId: checkInId }`
  2. each `maintenance` row with `mileageMiles != null` → `{ miles, date: maintenance.date, source: 'maintenance', refId: recId }`

  sorted by `(date asc, createdAt asc)`. **Current odometer** = greatest-`date`
  point across the union (a more-recent maintenance reading correctly advances it;
  check-ins usually win because logging is the explicit action). **Usage rate**
  (DEC-18 input) = slope over the numeric points (endpoints / robust regression),
  defined only with ≥2 dated numeric points. Zero extra storage, zero cell-budget
  growth, CRDT-safe, BCNF. The tables meet **only** in the read model.

**Intentionally NOT enforced:** odometers are monotonic non-decreasing, but the
mergeable store can express **no cross-row CHECK**. Monotonicity is a *soft,
advisory* property (UI flags "reading lower than a previous one"); the usage-rate
math tolerates non-monotonic noise rather than assume a constraint that can't
exist here.

### 13.5 Migration (mergeable-safe · local-first · expand-contract)

Follows the golden rules: **seed/backfill BEFORE the WS synchronizer attaches**,
sentinel-gated + idempotent, chunked one-car-per-transaction (one bounded
fragmented persister save each), tag with the device's **current** settings,
reuse `parseMileageMiles`.

1. **Expand (non-destructive):** add the `mileage` table + `mileageByCarId`
   index. No existing cell touched.
2. **Backfill the first check-in** (sentinel `mileageBackfillVersion`, a new
   **local-only** side-store value — never synced, same reason as
   `unitsSchemaVersion`: a cloud-wins Values merge could clear a synced sentinel
   and re-fire it). For each car with `mileageRaw.trim() !== ''`:
   - `checkInId` = deterministic `` `${carId}::initial` `` → **independent offline
     backfills on two devices produce the SAME rowId, so per-cell LWW collapses
     them into one row instead of duplicating** (the central mergeable-safety
     move; deterministic id = belt, sentinel = suspenders).
   - **Delete-safety gate (REVISED per review — the deterministic id that prevents
     duplicates is exactly what enables *resurrection*).** If a user deletes the
     seeded `initial` check-in (tombstone at HLC `T1`) and the local-only
     `mileageBackfillVersion` sentinel is later cleared on that device (a
     backup/restore or `needsReseed`-style path), a naive re-run would re-write
     `` `${carId}::initial` `` with a fresh `T2 > T1`, **out-stamping the tombstone
     and resurrecting the deleted reading.** So **do not gate on the sentinel
     alone**: also require that the car has **no `mileage` stamp at all — live OR
     tombstoned** (inspect the per-row stamp map, not just live rows), or persist a
     **per-car backfilled marker that survives a restore**. Once *any* check-in
     stamp exists for the car, the seed never re-fires.
   - `valueRaw = cars.mileageRaw`; `valueMiles = cars.mileageMiles` **if present**
     (preserve the entry-time canonical verbatim — do **not** recompute), else
     `parseMileageMiles(valueRaw, currentUnit)`; `unit = current distanceUnit`;
     `source = 'initial'`; `date = cars.purchaseDate` if a valid date else
     `cars.createdAt` (legacy scalar carries no date — flagged approximate via
     `source`); `createdAt = now`.
   - Blank `mileageRaw` → **no** check-in (empty timeline). Non-parsing text
     (`'unknown'`) → check-in with `valueMiles` absent (preserved for display,
     excluded from math).
   - *Carried-over ambiguity:* if `distanceUnit` changed since entry,
     `(valueRaw, unit)` vs the preserved `valueMiles` can be mildly inconsistent —
     the **pre-existing** "units history unrecoverable" gap (§11), not new loss.
3. **Switch reads (app, not schema):** edit modal drops the mileage field; a quick
   **"log mileage"** action writes check-ins; read model derives current odometer
   from the timeline. During the window the log path **mirrors the latest check-in
   back into `cars.mileageRaw`/`mileageMiles`** so old clients + the unchanged
   snapshot path stay correct. *Optional safeguard:* lazy-absorb an old client's
   `cars.mileageRaw` edit (HLC-later than the latest check-in) as a
   `source: 'legacy-edit'` check-in; or gate contract on all devices upgraded
   (`pairedUserId` + version sentinel).
4. **Contract (only destructive step — needs blast radius + backup
   confirmation):** once all readers use the timeline, drop
   `cars.mileageRaw`/`mileageMiles` + the legacy `Car.mileage` field. Reversible
   down = re-add the cells and re-mirror from the latest check-in.

**Backup/export (DEC-12):** `backup.ts` v2 export + the markdown export must
round-trip the table and **honor each check-in's own `unit`** (cf. task #18's
hardcoded-`'mi'` bug). v1/v2 files predate the table → import seeds zero
check-ins, then the backfill re-creates `initial` from `cars.mileage`. Bump
export to **v3** (additive: include `mileageLog`).

### 13.6 Snapshot / leak-safety impact

- **Adding the table leaks nothing.** The curated/full builders are a strict
  deny-by-default allowlist, so `mileage` check-ins are **withheld from both
  scopes until explicitly named** — the safe default works for free.
- **Current odometer:** repoint the snapshot's existing `mileageRaw`/`mileageMiles`
  from `cars.mileageRaw` to the **derived current odometer** (latest timeline
  point). Net semantics unchanged ("the car's current mileage"); only the source
  moves scalar → derived. The dual-write keeps the *unchanged* builder correct, so
  this can land in the contract phase. The DO builder (`getCarSnapshot`) must add
  `collectChildRows('mileage', carId)` and `joinCar` must reattach mileage rows so
  the timeline is computable server-side (still server-authoritative).
- **Timeline exposure is opt-in, purpose-gated (DEC-14):** a *single* current
  mileage is low-sensitivity → fine for **curated/showcase** (as today). The
  *full dated series* reveals usage patterns → gate to **`full` / for-sale**
  scope, never the anonymous default. If exposed, add a NEW named
  `mileageHistory: { valueMiles?, valueRaw, unit, date }[]` to the builder **AND**
  the strict `zod` response validator **together** (an unvalidated extra key is
  rejected before render); never expose internal ids (`checkInId`/`carId`),
  matching how maintenance/mods expose no row ids.
- **Due/overdue-by-mileage is already publicly computable, no new leak:**
  `maintenance.nextDueMileageRaw/Miles` are curated-exposed today, so a viewer with
  the current odometer renders "due by mileage" client-side.

### 13.7 Cross-feature interactions (FLAGGED)

- **DEC-18 (reminders + usage-rate prediction) — primary downstream consumer.**
  The `OdometerTimeline` is its input; DEC-18's own entities (recurring schedules,
  synced push tokens) are **not** designed here. The timeline lives in the
  per-user DO, so DEC-18's Cron-Trigger predictor needs a **new DO RPC** to read
  it. Cold start = one `initial` point → usage rate undefined → DEC-18 falls back
  to time-interval only.
- **DEC-1 (per-currency money).** `unit` is the **distance analogue of the
  `*Currency` tag**; this feature completes the store-as-entered pattern (mileage
  reaches parity with money).
- **DEC-14 (share purpose).** Mileage exposure granularity is **purpose-driven**:
  showcase → current value only; for-sale listing → may include the dated series
  (buyer provenance), owner opt-in. `source` lets a buyer weight `'manual'`/
  `'maintenance'` readings over approximate `'initial'`.
- **DEC-6 (unified photos).** An **odometer photo** (proof-of-reading; for-sale
  provenance) is a natural future attach target — DEC-6's attach-target union
  should stay **open** so `mileage` can be added later. Out of scope now.
- **#268 store-size ceiling.** Check-ins are the **most cell-prolific new entity**
  (logged frequently, ~7 cells each, unlike one-time mods). Envelope: 10 cars ×
  50 × 7 ≈ 3.5k cells (fine); 50 cars × 200 × 7 ≈ 70k (**over** the 20k shard
  budget). Heavy loggers approach the ceiling → include in the staging single-save
  probe; the timeline read can downsample for display without deleting history.
- **maintenance ↔ mileage (finding U2).** Joined **only at the read layer** (the
  union); maintenance stays the single source of its own at-service mileage — no
  dual-write, CRDT-safe.

---

## 14. TARGET DESIGN — Share feature: PURPOSE / VIN / owner name (DEC-14 / DEC-13 / DEC-10)

Scope: the **share** feature only — share PURPOSE (DEC-14), VIN (DEC-13), owner
display name (DEC-10), and the snapshot/allowlist gating that keeps it leak-safe.
Mapped onto §8 (D1 `share_links`/`user`), §3-4 (garage `cars`), and §9 (the
curated boundary). Aligns with §12 (DEC-11 follow caches only the curated header,
so listing/private fields never land in `savedBuilds`) and §13 (DEC-16 supplies
the "current odometer" the listing emphasizes). No code edited (spec).

### 14.0 Functional dependencies first (where each new fact belongs)

| New fact | Determinant | ⇒ lives on | Why not elsewhere |
|---|---|---|---|
| VIN | `carId` | `cars` row (garage/DO) | Attribute of the car; per-car, owner-private. |
| share PURPOSE | `token_hash` | `share_links` row (D1) | Per-link choice; co-located with scope/expiry/owner. |
| "show my name on shares" consent | `user.id` | `user` row (D1) | Fact about the **user**, not the link. Per-link would duplicate → update anomaly. |
| owner display NAME | `user.id` | `user.name` (existing) | DEC-10: reuse the account name; **no** username/handle entity. |

All single-determinant → BCNF holds; **no new table**. Net: **2 new columns**
(one D1 `user`, one garage `cars` cell), **1 new value** on an existing D1 enum
column, **1 new snapshot shape**.

### 14.1 DEC-14 — PURPOSE as a third value of the existing `scope` discriminant

DEC-14 says presets, not à-la-carte, and "a listing = curated + the listing
fields" — so purpose is **not** a second orthogonal column; it is a **third value
of `share_links.scope`**, mutually exclusive per link:

| `scope` | Preset (UI) | Snapshot shape | Adds beyond curated |
|---|---|---|---|
| `curated` (default) | **Showcase** | `PublicCarSnapshot` | — (+ ownerName, §14.3) |
| `listing` **(new)** | **For-Sale Listing** | `ListingCarSnapshot` **(new)** | `salePrice`+`salePriceCurrency`+`tradeFor`+`vin` (+ ownerName) |
| `full` (unchanged) | Full read-only | `FullCarSnapshot` | full owner view; **no** vin |

Why extend `scope` (not rename → `purpose`, not add a 2nd column): the security
boundary IS the response discriminated union keyed on `scope` (`contracts.ts:551`).
Keep the key → the listing is one more `z.literal` branch; no rename of a live
leak-critical column, no 2×2 with meaningless cells ("full listing"). One enum →
one stored value → one snapshot shape → one validator branch.

**`share_links.scope` — D1, NO DDL.** The column is already `text NOT NULL DEFAULT
'curated'` with **no SQL CHECK** (`db/schema.ts`; the enum is TS-only). Adding
`'listing'` is pure code:
- `db/schema.ts`: `enum: ['curated','listing','full']`.
- `zod.ts:138`: `z.enum(['curated','listing','full']).default('curated')`.
- `share.ts:86` `normalizeScope`: add the `=== 'listing'` arm; unknown → `'curated'`.
- **Intentionally no DB CHECK** — `CHECK scope IN (...)` can't be added by `ALTER`
  on SQLite (forces a `share_links` table rebuild, which re-touches the FK-to-
  `user` cascade, §8). The closed TS enum + `normalizeScope` deny-by-default is
  the net: a stray value serves as the harmless showcase, never `listing`/`full`.

### 14.2 DEC-13 — VIN: a PRIVATE `cars` cell (garage/DO), listing-only exposure

VIN is per-car → a new **nullable cell on `cars`** (synced via the DO), private by
default, surfaced publicly **only** under `scope='listing'`.

| Where | Change |
|---|---|
| `GARAGE_TABLES_SCHEMA.cars` (`schema.ts`) | add `vin: { type: 'string' }` — **nullable, NO default** (strict-null rule, §3) |
| `CarsRow` | add `vin?: string` |
| `CarDetails` (`types.ts`) | add `vin: string` (`''`=none; matches `salePrice`/`tradeFor` being plain strings) |
| `flattenCar` | `if (car.vin !== '') carRow.vin = car.vin` — omit when blank; VIN-less cars cost **0** cells |
| `joinCar` | `vin: row.vin ?? ''` — absent (legacy rows) ⇒ `''` |

`''` and absent are intentionally **not** distinguished (unlike
`maintenance.mileage`): both mean "no VIN", so absent→`''` is correct and needs
**no backfill**. Validation is **app-layer only** (TinyBase has no CHECK): a
`vinSchema` in `zod.ts`, "light 17-char" (DEC-13) → trim+upper, soft-check
`^[A-HJ-NPR-Z0-9]{17}$` (ISO-3779 charset, excludes I/O/Q), **warn not block**.
VIN is stored verbatim as untrusted free text; snapshots render it as text (no
injection surface). Emitted **only** by `buildListingSnapshot`; `full` **omits VIN
on purpose** (DEC-13: listing-only; a forwarded "show-a-friend" link must not
carry a fraud-enabling identifier — see 14.7).

### 14.3 DEC-10 — owner display name (D1 `user`), consent-gated, NAME-only

No new name storage: the display name **is** `user.name` (DEC-10: no
username/handle, NEVER the email). Only new column = the consent toggle, on `user`
(per-user, editable in Settings):

```
ALTER TABLE user ADD COLUMN show_owner_name integer NOT NULL DEFAULT 1;  -- 1 = shown (DEC-10 opt-out default)
```

- `integer` boolean, **NOT NULL DEFAULT 1** → "shown by default, opt-out"; DEFAULT
  backfills every existing user at ALTER time (no data pass).
- **Additive ALTER only** — rebuilding `user` fires the `ON DELETE CASCADE` chain
  and wipes `session`/`account`/`share_links` (§8).
- Register as a Better-Auth user **`additionalFields`** entry in `auth.ts` (so the
  settings/account update path writes it) **or** write directly via drizzle from a
  settings route. Harmless to Better Auth's own selects.

**CROSS-STORE injection (must flag):** the snapshot is built **DO-side** from
garage data, but `user.name`/`show_owner_name` live in **D1**, unreachable from
the DO (golden split, §0). So `ownerName` is **injected by the share route**, not
the DO builders: after `getCarSnapshot`, the route does a **narrow** `SELECT name,
show_owner_name FROM user WHERE id = row.userId` (it already holds `row.userId`)
and sets `snapshot.ownerName = name` **iff** `show_owner_name && name !== ''`.
This keeps `user.name` out of the garage store and keeps the injection
deny-by-default (two columns selected, exactly one field set — never
`select().from(user)` spread into the body).

**Consent rule (single, auditable):** `ownerName` exposed **iff
`user.show_owner_name = true`**, uniformly across `curated`/`listing`/`full`. A
listing does **not** override consent (name = PII; one master consent is the only
leak-safe, auditable rule). The For-Sale UI **nudges** "turn on your name to list",
not forces it. (Alternative "listing forces name" rejected for safety, 14.7;
future per-link override is the escape hatch.)

### 14.4 Snapshot shapes + validators (the leak boundary) — exact deltas

All edits are **strict, key-by-key allowlist** (deny-by-default preserved);
`publicSnapshot.ts` + the `contracts.ts` validator move in lockstep
(`contracts.test.ts`).

- `ShareScope` (`publicSnapshot.ts:47`): `'curated' | 'listing' | 'full'`.
- `ownerName?: string` added to the **base** `PublicCarSnapshot` (so `Listing*`
  and `Full*` inherit it). Route-injected; absent ⇒ no name.
- `ListingCarSnapshot extends PublicCarSnapshot { salePrice?; salePriceCurrency?;
  tradeFor?; vin? }` — each omitted when blank; **no** wishlist/todos/issues, **no**
  per-item cost/shop/notes, **no** r2Key/dataUrl/userId/internal ids.
- `buildListingSnapshot(car, settings)` (new, DO-side): reuses
  `buildPublicSnapshot` as base (byte-identical curated fields, like
  `buildFullSnapshot`), then appends the four listing fields key-by-key.
- **DEC-1 fidelity (listing AND full — REVISED per review):** `joinCar` drops
  `*Currency` tags, so — exactly as the DO re-attaches photo `width`/`height` — add
  `salePriceCurrency?: string|null` to `SnapshotCarInput`; `getCarSnapshot` sets it
  from `carRow` before `buildListingSnapshot` **and `buildFullSnapshot`**. Both the
  listing and the full view then show the price in its **entered** currency, not the
  viewer's `settings.currency`. Add `salePriceCurrency?` to **`FullCarSnapshot`** +
  **`fullCarSnapshotSchema`** and have `buildFullSnapshot` emit it whenever
  `salePrice !== ''` (it already emits `salePrice` there — `publicSnapshot.ts:386` —
  so this is a near-free, same-pass fix that closes the pre-existing full-scope
  currency imprecision noted in 14.7). `curated` carries no money, so it is
  untouched.
- `GarageDO.getCarSnapshot` switch: `full→buildFull`, **`listing→buildListing`**
  (set `input.salePriceCurrency` from `carRow`), else `buildPublic`.
- Validator (`contracts.ts`): new `listingCarSnapshotSchema =
  publicCarSnapshotSchema.extend({ salePrice?, salePriceCurrency?, tradeFor?, vin? })`
  as a **`z.strictObject`**; add `ownerName: z.string().optional()` to the curated,
  listing, **and** full schemas; `shareSnapshotResponseSchema` gains the
  `{ scope: z.literal('listing'), car: listingCarSnapshotSchema, expiresAt }`
  branch. A `curated` body can never carry `vin`/`salePrice` (strict, unnamed);
  a `listing` link can never render as `full`.

**OG crawler path (SECURITY-SENSITIVE — REVISED per review, MAJOR).** Today
`lookupCuratedShareSnapshot` (`share.ts:262`) is **hardcoded** to
`getCarSnapshot(row.carId, 'curated')`, and `shareMetaFromSnapshot` (`og.ts:63`)
reads only a **fixed allowlist** of the curated shape (`year`/`make`/`model`/
`nickname` + `mods.length`/`maintenance.length` + resolved `coverPhotoId`). So the
crawler/preview path — the **highest-exposure surface** (crawler-cached, fetched
with **no session**) — is **structurally** private-free: a VIN- or price-bearing
object *cannot* reach it. **Do NOT regress that to an allowlist-discipline promise.**
The earlier draft proposed making the lookup purpose-aware and feeding a
**`ListingCarSnapshot` (which carries `vin` + `salePrice`)** into the OG renderer,
trusting the renderer to emit price but omit VIN. **Rejected.** Instead, if For-Sale
previews want price, build a **dedicated minimal OG projection** that by
construction holds **no** `vin`/`notes`/`wishlist` fields — allowlist exactly
`{ year, make, model, nickname, salePrice, salePriceCurrency, coverPhotoId,
ownerName? (consent-gated) }`. Keep `full → buildPublic` (**downgrade, never
`buildFull`**). **Regression test (required):** assert `vin` never appears in the
rendered `/share/:token` HTML for a listing link. Net: the OG path **never holds a
private-bearing snapshot object** — the structural guarantee is preserved, not
downgraded to renderer discipline.

**Net leak-safety (target):**

| Field | curated | listing | full |
|---|:--:|:--:|:--:|
| money amounts / `*Currency` | ✗ | salePrice + its tag only | ✓ |
| `vin` (DEC-13) | ✗ | **✓** | ✗ |
| `ownerName` = `user.name` (DEC-10) | iff consent | iff consent | iff consent |
| wishlist/todos/issues, per-item cost/shop/notes | ✗ | ✗ | ✓ |
| `salePrice` / `tradeFor` | ✗ | **✓** | ✓ |
| email · userId · other cars · raw `r2Key` · `dataUrl` | **✗ always** | **✗ always** | **✗ always** |

The five §9 enforcement layers all still hold, each +1 value/branch: (1) build-time
allowlist gains `buildListingSnapshot`; `ownerName` is allowlisted at the **route**
(narrow 2-col select) since the DO has no D1; (2) `normalizeScope` recognizes
`listing`, unknown→`curated`; (3) validator gains the strict `listing` branch +
optional `ownerName`; (4) status allowlist unchanged; (5) token-scoped images
unchanged.

### 14.5 Where each change lives (one glance)

| # | Change | Store / file | Type | Null / default | Migration |
|---|---|---|---|---|---|
| 1 | `cars.vin` | garage `MergeableStore` · `schema.ts` | string cell | nullable, no default; omit iff `''` | additive cell, no backfill |
| 2 | `Car.vin`/`CarDetails.vin` | domain · `types.ts` | `string` (`''`=none) | join absent→`''` | — |
| 3 | `user.show_owner_name` | D1 `user` · `db/schema.ts` | integer bool | **NOT NULL DEFAULT 1** | `ALTER ADD COLUMN` |
| 4 | `share_links.scope` += `'listing'` | D1 `share_links` · `db/schema.ts` | text | NOT NULL default `'curated'` | **no DDL** (TS enum + route) |
| 5 | `ListingCarSnapshot` + `buildListingSnapshot` | `publicSnapshot.ts` | new type/fn | — | ship before any listing link |
| 6 | `ownerName?` on snapshots + validators | `publicSnapshot.ts`·`contracts.ts` | optional string | route-injected | ship with viewer |
| 7 | `listingCarSnapshotSchema` (3rd branch) | `contracts.ts` | new zod | strict | ship with viewer |

### 14.6 Migration — expand-contract, local-first, mergeable-safe (NO backfill)

**Expand (deploy schema/readers everywhere BEFORE any writer):**
1. **Garage `cars.vin`:** ship the `schema.ts` cell + flatten/join to **all**
   clients first, VIN form disabled, so every schema-applied client *accepts* an
   incoming `vin` cell. Writer-first would let a laggard's schema-applied store
   **drop** the cell while its HLC stamp survives (raw store vs stamp-map diverge —
   the §2 hazard the schema-less DO avoids). §6 golden rule for one cell: **schema
   before first cross-device write.** Mergeable-safe: a `vin` cell is an ordinary
   per-cell HLC LWW write — no full-store reconcile, no #268 exposure (+1 cell only
   for cars that actually have a VIN).
2. **D1 `user.show_owner_name`:** additive `ALTER ADD COLUMN … DEFAULT 1`. Single
   auto-committed DDL (no multi-statement DML → no txn wrapper). Verify after:
   `SELECT count(*) FROM user WHERE show_owner_name IS NULL` = 0 and
   `PRAGMA table_info(user)` shows NOT NULL/default. Register `additionalFields`
   in the same deploy.
3. **Snapshot/contracts:** ship `ListingCarSnapshot`, `buildListingSnapshot`, the
   `listing` validator branch, `ownerName?`, and the `normalizeScope`/`zod` enum
   widening. The **viewer must understand `listing` before any listing link
   exists** (its strict validator would reject a legit listing body otherwise).

**Switch (after Expand is everywhere):** enable the VIN form, the Settings name
toggle, and the Showcase/For-Sale/Full preset picker. Route injects `ownerName`
(consent-gated); `buildListingSnapshot` emits price/VIN; OG renders
listing/showcase (never full).

**Contract:** nothing removed. The old 2-value `scope` is a subset; no column drop.

**Reversibility — two hazards stated loudly:**
- `scope`/purpose: trivially reversible — reverting code makes every `'listing'`
  row `normalizeScope`→`'curated'` (price/VIN stop showing). **No leak on rollback.**
- **`user.show_owner_name` down = DROP COLUMN is DESTRUCTIVE TO CONSENT.** Dropping
  it discards every opt-**out**; because it re-adds with DEFAULT 1 (shown), a
  down-then-up cycle **silently re-exposes the names of users who opted out** — a
  privacy regression, not a neutral rollback. Mitigation: make the **down a no-op
  (leave the column)**, or **export the opt-out set before dropping**. Do not
  blind-DROP. Blast radius if run: `user`, one column, no row deletion, FK cascade
  NOT triggered by add/drop-column; confirm a D1 Time-Travel bookmark first.
- **`cars.vin` down ≈ "don't".** Removing a **synced** cell is the hard direction:
  schema-applied clients drop the now-unknown cell on read while the DO's HLC
  stamps persist → divergence. Treat `vin` as **additive-forever**; a real removal
  needs a tombstone-all-`vin`-cells clear (chunked, before attach, §6) across the
  DO *and* every device — not worth it for a free-text field.

### 14.7 Cross-feature interactions (flagged)

- **DEC-19 license plate** — same "private car field exposed in a snapshot"
  mechanism as VIN, but **owner-toggle, not purpose-gated** (hide-on-sale /
  flaunt-on-showcase). So plate = a `cars.plate` cell (mirrors `cars.vin`) **plus**
  a per-car `cars.showPlate` boolean feeding the builder, exposable even under
  `curated`. Argues for a **generalized "owner-exposed private field" gate** as a
  parameter to the builders/route injection rather than one-off `if`s — VIN
  (purpose-gated) and plate (toggle-gated) are the first two.
- **DEC-10 × DEC-14 consent tension** — resolved (14.3): master `show_owner_name`
  wins; listing nudges. If product later wants listings to force the seller name,
  add a **nullable per-link `share_links.show_seller`** override (NULL = fall back
  to user default) — keeps the user-level FD intact, stays additive.
- **DEC-16 mileage check-ins (§13)** — listing/showcase "current odometer" derives
  `mileageRaw`/`mileageMiles`; once mileage is a time series, the builders derive
  current = **latest check-in**. The listing's mileage emphasis depends on it.
- **DEC-11 follow/save (§12)** — followers cache only the **curated header**, so
  listing price/VIN/seller never enter `savedBuilds` (consistent with §12 note 4);
  they appear only in the **live** detail view of a listing link. `cachedOwnerName`
  (§12 note 3) becomes populatable once 14.3 lands. Live-refetch + 410 lazy-revoke
  (§8) bound staleness of a follower's cached listing.
- **DEC-1 currency fidelity** — the listing carries `salePriceCurrency` (the row
  tag). **RESOLVED (per review): carry it into `full` in the same pass too.**
  `buildFullSnapshot` emits `salePrice` as a bare string today
  (`publicSnapshot.ts:386`) and the viewer formats it against `FullSettings.currency`
  (the device setting) — so a price entered in a non-device currency renders with
  the wrong symbol in `full`. Since the merge already plumbs `salePriceCurrency` from
  `carRow` into the DO builder input, add `salePriceCurrency?` to `FullCarSnapshot` +
  `fullCarSnapshotSchema` and emit it when `salePrice !== ''` (§14.4, §15.7).
- **Account-deletion / Law-25 gap (§11)** — `share_links` cascades on `user` delete
  (D1 FK) and `show_owner_name` rides on `user` (cascades naturally). But **VIN
  lives in the DO** (no cascade) and is a vehicle identifier (personal-data-
  adjacent, consented per-listing): account deletion must purge the DO (existing
  gap, task #36); VIN raises its sensitivity for the privacy pass.
- **Better Auth `user` management** — `show_owner_name` must be additive (rebuild-
  `user` cascades to `share_links`); `timestamp_ms`-vs-seconds (§8) is moot for a
  boolean.

---

## 15. UNIFIED TARGET DATA MODEL (DEC-6 + DEC-16 + DEC-14/13/10 + DEC-11)

> **This section is the merge.** §§12–14 designed three features in isolation and
> DEC-6 (unified photos) had no section at all. §15 folds **all four** into one
> coherent, normalized target: it **documents DEC-6 for the first time** and, where
> a per-feature section made a local call that a cross-feature view overturns,
> **§15 is authoritative** (each such override is called out). Still a SPEC — no
> code edited; verified against `master`. The concurrent foundation build owns the
> `packages/shared` / `apps/web` edits; this is their **entity contract**, not a
> conflicting patch.

The whole merge touches **one new garage child table** (`mileage`), **one new
garage top-level table** (`savedBuilds`), **four new garage `cars`/`photos`
cells** (`photos.source`, `photos.sourceId`, `cars.bannerPhoto`, `cars.vin`),
**one new D1 `user` column** (`show_owner_name`), **one widened D1 enum**
(`share_links.scope += 'listing'`), **one new local-only cache table**
(`savedBuildSnapshots`) and **one new local sentinel** (`mileageBackfillVersion`).
Everything else is read-model derivation. **Net: nothing in the existing schema is
renamed or retyped; exactly one cell pair is eventually retired** (the DEC-16
mileage scalars, §15.8 Contract).

### 15.1 One id strategy (three justified regimes)

| Regime | Used by | Rule / why |
|---|---|---|
| **Random UUID** `newId()` (`crypto.randomUUID`) | every **user-authored** garage row: carId + all child rowIds incl. the new `mileage.checkInId` | Globally collision-safe so rowIds never clash across devices/merges. The default; **DEC-16 check-ins follow it** (a check-in is authored like a mod). |
| **Content-addressed** `sha256(rawToken)` hex | `savedBuilds` **and** its local cache `savedBuildSnapshots` (DEC-11) | The follow record is keyed by what it points at, not by an authored id. Buys **merge-idempotency** (same link saved on two devices → same rowId → CRDT unions, never duplicates), **O(1) dedup** with no secondary index, and keeps the **bearer token out of the structural key** — symmetric with the OWNER side `share_links.token_hash` (D1 PK). Computed by the (async) save action, not the pure flatten. |
| **Deterministic seed** `` `${carId}::initial` `` | the **one** DEC-16 migration-seeded `initial` check-in only | A *deliberate* clash so two devices that each backfill offline before syncing produce the **same** rowId and collapse per-cell LWW instead of duplicating. The single, documented exception to "random UUID"; **user** check-ins never use it. **Delete-safety (per review):** because the id is deterministic, a naive re-run would *resurrect* a deleted seed — so the backfill is gated on "this car has **no `mileage` stamp, live OR tombstoned**" (inspect the stamp map, not just live rows), never re-seeding once any check-in stamp exists for the car (§13.5 step 2, §15.8 Phase 2). |

This is internally consistent: **authored ⇒ random UUID; token-derived dedup ⇒
content hash; migration-seeded singleton that must converge ⇒ deterministic.**

### 15.2 The shared seam — "attach to a loggable item" (DEC-6, with the DEC-16/18 extension point)

The single most important cross-feature reconciliation. DEC-6 makes a photo
attach to the **car** *or* to exactly one **loggable item**; DEC-16 adds a new
loggable child (`mileage`); DEC-18 will add more (schedules). One polymorphic
pattern absorbs all of them.

**Functional dependencies (the schema falls out of these):**
- `photoId → {carId, source, sourceId?, r2Key?, caption, uploadedAt, width?, height?}` — `photoId` is the sole determinant ⇒ **BCNF**.
- The attachment is a **polymorphic association** = a `(source, sourceId)` pair:
  `source` is the parent **kind**, `sourceId` is the parent **rowId**. A photo has
  **exactly one** parent (1 parent → N photos) ⇒ a single-valued FK pair, **not** a
  junction table, **no** M:N.
- **Transitive FD (the normalization wrinkle):** for an item-attached photo,
  `sourceId → carId` (a mod/maintenance/issue/todo belongs to one car). Storing
  `carId` on the photo is therefore a **deliberate denormalization**, kept
  consistent by an **immutability invariant**: `carId` is set once at creation =
  the parent's carId and **never changes** (a photo never moves cars; items never
  move cars), so the redundant copy can't diverge. Justified anyway by (a) CRDT
  locality — the parent row may be on another device / not yet merged, so `carId`
  can't be resolved through the parent at read time; (b) the R2 key embeds carId;
  (c) the store joins every child by a direct `carId` cell (no joins in TinyBase);
  (d) the DO snapshot + delete-cascade + `photosByCarId` index all key on carId.

**`PhotoSource` = `'car' | 'mod' | 'maintenance' | 'issue' | 'todo'`** — a
**CLOSED** union equal to `{'car'} ∪ {the photo-bearing child tables}`. `'car'` maps
to the gallery's **General** filter; the others map 1:1 to their tables.

**THE coupling invariant (binds DEC-6 ↔ DEC-16 ↔ DEC-18):** the `PhotoSource` union
must stay in **lockstep** with the set of photo-bearing child tables, and **every**
such table's delete action must adopt the **re-parent-to-General cascade** (§15.10).
`mileage` is **NOT** a member yet (DEC-16 §13.7 + DEC-6 agree: keep the union closed
until a decision). Adding it later = (1) add `'mileage'` to the union, (2) give
`deleteMileageCheckIn` the re-parent cascade. That is the *entire* future change —
the seam is built to absorb it.

**Photo cells (added to `photos`):**

| Cell | Type | Nullable | Meaning |
|---|---|---|---|
| `source` | string | (intent: no) — but **NO TinyBase default** | discriminant `PhotoSource`, an **advisory denormalized hint** (see the coherence rule ▼). `flattenCar` always writes it; **read convention `absent ⇔ 'car'`** so legacy/partially-merged rows are correct with **zero** migration writes. **It is NOT the source of truth for the effective parent** — `sourceId` resolution is. |
| `sourceId` | string | **yes** | soft FK to the parent loggable's rowId — **the source of truth for attachment.** Set ⇔ the photo is attached to an item; absent ⇔ attached to the car (**General**). A General photo's parent IS the car and `carId` already holds it, so omitting `sourceId` respects strict-null AND saves a cell on the common case. May dangle after a merge/parent-delete; read path coalesces a dangling/absent `sourceId` → General. |

**▼ The (source, sourceId) coherence rule (REVISED per review — CRDT divergent
state).** `source` and `sourceId` are **two independently-merged cells**, so
per-cell LWW can land them in a state the naive invariant "`present(sourceId) ⇔
source ≠ 'car'`" forbids: device A re-attaches a photo to `mod2`
(`source='mod'`, `sourceId=mod2`) while device B deletes `mod1` and runs the
re-parent cascade (`source='car'`, `delCell sourceId`); the merge can land
`source='mod'` with `sourceId` **absent** (or, symmetrically, a stale `source`
beside a live `sourceId`). The photo is never lost (`photosByCarId` still lists
it), but a rule that buckets on `source` would **mis-file** it. **Resolution: the
effective parent is derived purely from `sourceId` resolution, and `source` is an
advisory cached hint repaired on read / next write.**

> **effective parent** = (`sourceId` present AND resolves to a **live, same-car**
> loggable item) ? that item : **General**.

So a `source='mod'` with absent or dangling `sourceId` resolves to General (not a
mod bucket); `source` is never consulted for filing — only for cheap UI
pre-grouping when it happens to agree. Any read that notices `source` disagreeing
with the resolved parent may rewrite `source` to match (self-healing), but
correctness never depends on it. This is the **fifth documented denormalization**
(§15.6): *`sourceId`-resolution is the source of truth; `source` is a cached hint.*
The gallery query plan below buckets by this **resolved** parent, not by the raw
`source` cell.

**Cover/banner stay POINTERS-ON-CAR, not flags-on-photo.** A per-car single-cell
pointer gives "exactly one cover" **for free** under per-cell LWW (concurrent
set-cover on two devices converges to one winner; a boolean `isCover` on photos
would yield two covers after a merge). Keep the existing cell **name** `coverPhoto`
(no CRDT cell rename, §15.11) — DEC-6 only widens its *UX* (pick from any photo).
Add `cars.bannerPhoto` (new soft pointer, DEC-8 hero); resolution chain
`bannerPhoto → coverPhoto → first photo → none`.

**Items do NOT embed their own `photos[]`.** `car.photos` stays the single flat
array = the unified gallery; an item's photos are **derived** by filtering
`car.photos` on `sourceId === item.id`. Photos stay normalized in one place; no
photo is duplicated under both the gallery and its item.

**R2 keying UNCHANGED** (`u/<userId>/<carId>/<photoId>.<ext>`) — `source`/`sourceId`
are deliberately **not** in the key. Payoff: re-attaching an existing photo
(General ↔ item, or item ↔ item within the same car) is a pure metadata cell change
with **zero byte movement, no re-upload**; `resolveSharePhotoKey` + the upload
pipeline need no change.

**Gallery query plan:** the existing `photosByCarId` index already answers the
unified gallery (`getSliceRowIds('photosByCarId', carId)` → sort by `uploadedAt` →
bucket by **resolved parent** per the coherence rule ▲: `sourceId` resolves to a
live same-car item → that item's bucket, else **General**; the raw `source` cell is
not the bucketing key). **Add one client-only index `photosBySourceId`** for the
inline per-item view + count badge (`getSliceRowIds('photosBySourceId', modId)`);
General photos (no `sourceId`) are simply absent from it, and a photo whose
`sourceId` dangles falls back to General on render. Write cost: one extra index
entry per photo that **has a `sourceId`** (General photos cost nothing);
**client-side only** — the DO builds no indexes.

### 15.3 Unified garage `MergeableStore` schema (target)

`GARAGE_TABLE_IDS = [cars, photos, wishlist, mods, maintenance, todos, issues,
**mileage**, **savedBuilds**]`. `CHILD_TABLE_IDS = [photos, wishlist, mods,
maintenance, todos, issues, **mileage**]` (**`savedBuilds` is NOT a child** — no
`carId`, no carId index). New/changed cells **in bold**.

**`cars`** (rowId = carId): year, make, model, trim, color, nickname, purchaseDate,
saleDate, status, salePrice, *salePriceCurrency*, tradeFor, *coverPhoto*,
***bannerPhoto*** (DEC-6, soft pointer), ***vin*** (DEC-13, nullable, omit iff
`''`), createdAt, and **transition-only** *mileageRaw* / *mileageMiles* (DEC-16 —
retained as the latest-check-in mirror through the transition, retired in Contract,
§15.8).

**`photos`** (rowId = photoId): carId, *r2Key*, caption, uploadedAt, *width*,
*height*, **`source`** (DEC-6), **`sourceId`** (DEC-6). Target `PhotosRow` gains
`source: PhotoSource` + `sourceId?: string`.

**`mileage`** (NEW 7th child, rowId = checkInId, DEC-16): carId, valueRaw,
*valueMiles*, unit (`'mi'|'km'`, **frozen at entry** — the distance analogue of the
`*Currency` tag, DEC-1), date (ISO-8601, the timeline x-axis), source
(`'manual'|'initial'|'import'|'legacy-edit'`), createdAt. Display order = `(date,
createdAt)`. Gets the `mileageByCarId` client index.

**`savedBuilds`** (NEW top-level, rowId = `sha256(token)`, DEC-11): token (raw
bearer, NOT NULL), savedAt (NOT NULL), *nickname*, *sortOrder*, the
*cached{Year,Make,Model,Nickname,OwnerName,Status,MileageRaw,ModsCount,
CoverPhotoId,Scope}* showcase-header cache, *lastRefreshedAt*, *unavailableSince*.
No carId, no index. (Full cell table in §12.2.)

Unchanged child tables: `wishlist`, `mods`, `maintenance`, `todos`, `issues` (their
own at-service / next-due mileage stays the single source of truth for itself —
DEC-16 does **not** touch `maintenance`).

### 15.4 Local side store + sentinels (target, NEVER synced)

- `photoPayloads` (existing) — base64 staging buffer.
- ***`savedBuildSnapshots`*** (NEW, DEC-11) — rowId = `sha256(token)`; one
  JSON-blob cell `{ snapshot, fetchedAt }` (the full **curated** snapshot cache for
  offline detail; the #268 pressure-relief valve, exactly like `photoPayloads`).
- Sentinels: existing (`idbMigrated`, `unitsSchemaVersion`, `pairedUserId`,
  `needsReseed`, `photosMigratedToR2`) **+ ***`mileageBackfillVersion`*** (NEW,
  DEC-16) — local-only because a cloud-wins Values merge could clear a *synced*
  sentinel and re-fire the backfill (same reason as `unitsSchemaVersion`).

### 15.5 Unified D1 schema (target)

- **`user` + `show_owner_name`** (DEC-10): `integer NOT NULL DEFAULT 1` (boolean;
  1 = shown, opt-out default). **Additive `ALTER ADD COLUMN`** — must NOT rebuild
  `user` (a rebuild fires the `ON DELETE CASCADE` chain into
  `session`/`account`/`share_links`, §8). The display **name** reuses the existing
  `user.name` — no username/handle entity, never the email.
- **`share_links.scope += 'listing'`** (DEC-14): **NO DDL** — the column is already
  `text NOT NULL DEFAULT 'curated'` with **no SQL CHECK**, so widening is pure code
  (TS enum `['curated','listing','full']` + `normalizeScope` `=== 'listing'` arm,
  unknown → `'curated'`). PURPOSE is a **third value of the existing discriminant**,
  not a second column, because the security boundary **is** the response
  discriminated-union keyed on `scope`.
- Everything else in §8 unchanged; timestamp units unchanged (boolean column is
  unit-agnostic).

### 15.6 Normalization ledger (no new redundancy the merge doesn't account for)

Every new fact lands on its sole determinant ⇒ **BCNF holds, no new table beyond
the two genuinely new entities**:

| New fact | Determinant | Lives on |
|---|---|---|
| photo attachment `(source, sourceId)` | photoId | `photos` |
| odometer reading | checkInId | `mileage` |
| VIN | carId | `cars` |
| banner pick | carId | `cars` (pointer) |
| share purpose | token_hash | `share_links` (D1) |
| "show my name" consent | user.id | `user` (D1) |
| owner display name | user.id | `user.name` (reused) |
| follow intent + nickname | sha256(token) | `savedBuilds` |

**Documented denormalizations (each with its consistency keeper):**
1. `photos.carId` — derivable from `sourceId`'s parent; kept consistent by the
   **immutability invariant** (§15.2). *Required* for CRDT locality / R2 key / index.
2. `mileage.valueMiles` — materialized derivation of `(valueRaw, unit)`; the
   mergeable store needs the canonical comparison value to **merge per cell**
   (recompute-on-read can't merge). Same trade/precedent as
   `cars.mileageMiles`/`maintenance.mileageMiles`.
3. `cars.mileageRaw`/`mileageMiles` as the **latest-check-in mirror** — a
   *transition* denormalization (DEC-16), consistency rule `cars.mileageRaw :=
   latest-check-in raw`, retired in Contract.
4. `savedBuilds.cached*` header — a materialized cache of a **remote** read model in
   another owner's DO that can't be referentially maintained (cross-DO soft ref);
   kept consistent by **live-refetch (overwrite-on-fetch)**, allowed stale, labeled
   `lastRefreshedAt`.
5. `photos.source` — a cached hint denormalizing the `sourceId`-resolved attachment
   kind (§15.2). Two independently-merged cells (`source`, `sourceId`) can diverge
   under per-cell LWW, so **`sourceId`-resolution is the source of truth and `source`
   is advisory**, repaired on read / next write. Keeper: *never bucket on `source`;
   derive the effective parent from `sourceId` and self-heal `source` opportunistically.*

**Rejected denormalization (kept for the record):** materializing a `mileage` row
per maintenance at-service mileage — no perf evidence and **unsafe under CRDT** (the
maintenance row and its derived check-in merge independently → orphan/stale risk).
Chosen instead: a **read-model union** `buildOdometerTimeline(car)` over `mileage`
rows (`valueMiles != null`) ∪ `maintenance` rows (`mileageMiles != null`); current
odometer = greatest-date point; usage rate = slope over ≥2 numeric points. The
tables meet **only** in the read model.

### 15.7 THE unified snapshot rule (ONE rule, purpose-gated)

> **Rule.** The public snapshot is a **strict, key-by-key allowlist
> (deny-by-default)**, built **DO-side**, **server-authoritative on the stored
> `share_links.scope`** (re-narrowed, never from the request), and **validated by a
> strict `z.strictObject` discriminated-union** the viewer runs before render. There
> are **three purposes = three scope values = three validator branches**; a field
> reaches a body **iff that scope's branch names it**. `ownerName` is the **one**
> field injected by the share **route** (not the DO), because the name + consent
> live in D1, unreachable from the DO.

**The three scopes are cross-cutting, NOT a simple chain** (state this explicitly —
it's the subtlety the merge surfaces): `vin` is **listing-only** (not in `full`);
`wishlist`/`todos`/`issues` + per-item `cost`/`shop`/`notes` are **full-only** (not
in `listing`). So `curated ⊂ listing` and `curated ⊂ full`, but **`listing ⊄ full`
and `full ⊄ listing`.**

| Field | `curated` (Showcase) | `listing` (For-Sale) | `full` (read-only) |
|---|:--:|:--:|:--:|
| car header (year…createdAt, resolved `coverPhotoId`) | ✓ | ✓ | ✓ |
| `ownerName` (= `user.name`, route-injected) | iff consent | iff consent | iff consent |
| **current** mileage (`mileageRaw`/`mileageMiles`, **derived = latest check-in**, DEC-16) | ✓ | ✓ | ✓ |
| **mileage history** (dated series, DEC-16) | ✗ | opt-in | opt-in |
| photos `photoId`/`caption`/`w`/`h` | ✓ (filtered, see ▼) | ✓ | ✓ (all) |
| photo `source` / `sourceId` (DEC-6) | **✗ always** | **✗ always** | **✗ always** |
| mods/maintenance curated fields | ✓ | ✓ | ✓ |
| `cost`/`shop`/`notes` | ✗ | ✗ | ✓ |
| `wishlist`/`todos`/`issues` | ✗ | ✗ | ✓ |
| `salePrice` + `salePriceCurrency` + `tradeFor` | ✗ | ✓ | ✓ |
| **`vin`** (DEC-13) | ✗ | **✓** | **✗** |
| `currency` setting | ✗ | ✗ | ✓ |
| email · userId · other cars · raw `r2Key` · `dataUrl` · internal row ids (beyond photoId) · `checkInId`/`carId` | **✗ always** | **✗ always** | **✗ always** |

Three cross-feature leak vectors the merge **must** close, all by *not naming* the
field in any branch (deny-by-default does the work for free):
- **photo `source`** — a `source='issue'`/`'todo'` photo would reveal the
  **existence** of a category `curated` deliberately hides. Withheld in **all**
  scopes.
- **photo `sourceId`** — an internal row id of a mod/maintenance/issue/todo;
  withholding upholds the standing "no internal row ids beyond photoId" invariant.
- **mileage `checkInId`/`carId`** — internal ids; the history series, when exposed,
  emits only `{valueMiles?, valueRaw, unit, date}`.

**▼ The one OPEN policy call (needs owner sign-off — §15.11).** DEC-6 gives the
curator a lever it lacks today: filter `car.photos` to `source='car'` (General) +
the chosen cover/banner for **curated/showcase**, so an accident/damage photo taken
in an **issue** context isn't surfaced on an anonymous public showcase; **listing**
may include maintenance/service photos as proof-of-care; **full** shows all.
**Recommended default:** curated = General + cover/banner; listing = General +
maintenance/mod; full = all — **and no scope ever emits `source`/`sourceId`.** This
is a one-line filter in the DO builder, needs **no** contract change, but **changes
which photos appear on already-issued shares**, so it ships only with explicit
DEC-14/DEC-8 sign-off. Until then, curated keeps today's "all photos" behavior.

**Mechanics that make the rule hold:** `buildListingSnapshot(car, settings)` reuses
`buildPublicSnapshot` as its curated base then appends
`salePrice`/`salePriceCurrency`/`tradeFor`/`vin` key-by-key; `buildFullSnapshot`
likewise emits `salePriceCurrency` next to `salePrice` (DEC-1 fidelity in full too,
per review — §14.4/§14.7). `getCarSnapshot` switches `listing→buildListing` /
`full→buildFull` / else `buildPublic`, and **for both `listing` and `full`** sets
`input.salePriceCurrency` from `carRow` (since `joinCar` drops the tag), and adds
`collectChildRows('mileage', …)` so the timeline is computable server-side. The route injects `ownerName` via a **narrow** `SELECT name,
show_owner_name FROM user WHERE id = row.userId` and sets it **iff
`show_owner_name && name !== ''`** (one master consent, uniform across scopes; a
listing **nudges**, never forces). The validator gains a strict `listing` branch +
optional `ownerName` on all three. **OG crawler (structural rule, §14.4):** the
preview path **never receives a private-bearing snapshot object** — `full →
buildPublic` (**downgrade, never full**) and a For-Sale preview is fed a
**dedicated minimal OG projection** (`{year, make, model, nickname, salePrice,
salePriceCurrency, coverPhotoId, ownerName?}`), **not** a `ListingCarSnapshot`, so
`vin` and every full-only field are absent by construction (a regression test pins
`vin` out of the rendered `/share/:token` HTML). This keeps the most-cached,
session-less surface private-free **structurally**, not by renderer discipline.

### 15.8 THE unified migration plan (one ordered Expand → Backfill → Switch → Contract)

Respects every rule at once: **migrate/backfill/merge BEFORE the WS synchronizer
attaches**, the **#268** cell ceiling, **D1 expand-contract**, and
**additive-/reader-first**. Crucially, **all garage schema additions are one
`setTablesSchema` superset add** — a single "schema-before-writer" coordination, no
full-store reconcile, no #268 exposure (a superset add removes nothing).

**Phase 0 — Pre-flight.** This doc lands as the foundation build's entity contract;
coordinate adapter signatures (`addPhoto` + `source`/`sourceId`; `setBannerPhoto`
mirroring `setCoverPhoto`; `setVin`; a `logMileage` action; follow/save actions).
Confirm a **D1 Time-Travel bookmark** and a **DO/garage export** exist before *any*
later destructive step.

**Phase 1 — EXPAND (additive; ship to ALL clients BEFORE any writer).** Reader-first
is mandatory: a laggard on the *old* schema would **drop** an unknown synced cell on
read while its merged HLC stamp survives (raw store vs stamp map diverge — the §2
hazard the schema-less DO avoids). One deploy carries:
- **Garage schema superset add:** `photos.source` + `photos.sourceId` (DEC-6);
  `cars.bannerPhoto` (DEC-6) + `cars.vin` (DEC-13); new tables `mileage` (DEC-16) +
  `savedBuilds` (DEC-11). Client indexes `photosBySourceId` + `mileageByCarId`
  (derived state, no migration writes).
- **Local side store:** `savedBuildSnapshots` table + `mileageBackfillVersion`
  sentinel.
- **D1:** `ALTER TABLE user ADD COLUMN show_owner_name integer NOT NULL DEFAULT 1`
  (single auto-committed DDL — no multi-statement DML, so no txn wrapper; **verify
  after**: `SELECT count(*) FROM user WHERE show_owner_name IS NULL` = 0 +
  `PRAGMA table_info(user)`). `share_links.scope += 'listing'` is **code-only, no
  DDL**.
- **Snapshot/contracts + integrity code (ship with the viewer):**
  `buildListingSnapshot` / `ListingCarSnapshot` / the strict `listing` validator
  branch / `ownerName?` on all three schemas / `normalizeScope` + zod widening / OG
  purpose-awareness with `full→curated` downgrade. **And — must ship WITH the photo
  source cells — the DEC-6 delete cascade** (§15.10); without it every item delete
  orphans photos.
- **No backfill in this phase.** Absent `source ⇔ 'car'`, absent `vin ⇔ ''`, absent
  `bannerPhoto ⇔ null`, empty `mileage`/`savedBuilds` are all correct → **zero
  migration writes, zero #268 pressure.**

**Phase 2 — BACKFILL (DEC-16 only — the ONLY backfill in the whole merge).**
Sentinel-gated (`mileageBackfillVersion`), idempotent, **chunked one-car-per-
transaction** (one bounded fragmented save each), run **BEFORE attach** (golden
rule). For each car with `mileageRaw.trim() !== ''`: write a `` `${carId}::initial`
`` check-in (`valueRaw = cars.mileageRaw`; `valueMiles = cars.mileageMiles` if
present else parse; `unit = current distanceUnit`; `source = 'initial'`; `date =
purchaseDate` if valid else `createdAt`; `createdAt = now`). Deterministic rowId =
belt, sentinel = suspenders → offline backfills on two devices collapse, no dup.
**Delete-safety gate (per review):** seed a car **only if it has no `mileage` stamp
live OR tombstoned** (inspect the stamp map, not just live rows), or a per-car
backfilled marker that survives restore — otherwise a cleared sentinel after a
restore would re-stamp `` `${carId}::initial` `` and *resurrect* a deleted reading
(§13.5 step 2). Blank → no check-in; non-parsing text → check-in with `valueMiles`
absent. DEC-6 / DEC-13 / DEC-11 contribute **no** backfill.

**Phase 3 — SWITCH (app behavior, after Expand is everywhere).** Enable writers: VIN
form, Settings owner-name toggle, Showcase/For-Sale/Full preset picker, the
"log mileage" action, the follow/save action, the DEC-6 attach-to-item + cover/banner
pickers. **DEC-16 transition dual-write:** the log path **mirrors** the latest
check-in into `cars.mileageRaw`/`mileageMiles` so un-upgraded clients **and the
still-scalar snapshot builder** stay correct; optionally lazy-absorb an old client's
`cars.mileageRaw` edit (HLC-later) as a `source='legacy-edit'` check-in. The
snapshot's current-odometer source moves scalar → derived (latest check-in); the
dual-write keeps the unchanged builder correct, so this is gradual. These are
**ordinary per-cell deltas / `setRow`s on the attached store** — the "before attach"
golden rule governs **bulk** migration only, not single edits.

**Phase 4 — CONTRACT (the ONLY destructive step; needs blast radius + backup
confirmation).** Gate on **all devices upgraded** (`pairedUserId` + version sentinel)
so no reader still depends on the scalar. **Cross-feature reconciliation
(overrides DEC-16 §13.5 step 4):** DEC-16 alone said "drop `cars.mileageRaw`/
`mileageMiles`", but §14.6 establishes that **removing a *synced* cell is the hard,
divergence-prone direction** (schema-applied clients drop the now-unknown cell while
DO HLC stamps persist). The 2 cells/car are **negligible** against the #268 budget
(the real growth driver is check-ins), so the unified call is a **logical contract**:
**stop reading** the scalars and treat them as **additive-forever inert** (still
written as the laggard mirror is harmless). A **physical** drop is *optional* and, if
ever done for cell reclamation, requires a **chunked tombstone-all-`mileageRaw`/
`mileageMiles` clear BEFORE attach across the DO and every device** + the
full-upgrade gate — not a one-shot `setTablesSchema` removal. Reversible down =
re-read + re-mirror.

**D1 reversibility hazards (stated loudly):**
- **`user.show_owner_name` down = `DROP COLUMN` is DESTRUCTIVE TO CONSENT** — it
  discards every opt-**out**, and re-adding with `DEFAULT 1` **silently re-exposes**
  the names of users who opted out (a privacy regression, not a neutral rollback).
  **Down = no-op (leave the column)**, or export the opt-out set first. Never
  blind-DROP. (Blast radius if forced: `user`, one column, no row deletion, FK
  cascade NOT triggered by add/drop-column.)
- **`share_links.scope` 'listing' reversal is SAFE-degrading** — reverted code makes
  every `'listing'` row `normalizeScope → 'curated'` (price/VIN stop showing, **no
  leak**).
- **`cars.vin` down ≈ "don't"** — same synced-cell-removal hazard as the mileage
  scalars; treat `vin` as **additive-forever**.

**#268 combined budget (the one number to watch).** Check-ins dominate (~7 cells
each, logged frequently): 10 cars × 50 × 7 ≈ 3.5k (fine); **50 cars × 200 × 7 ≈ 70k
— over the 20k shard budget.** Item-photo `source`+`sourceId` add ≤2 cells per
*item-attached* photo (General photos add at most `source`, and only if ever
materialized — recommend not); `bannerPhoto`/`vin` add ≤1 cell/car; `savedBuilds`
adds ~16 cells per **follow** (additive to the same garage store). **Production
single-save ceiling is still unmeasured** — the staging probe (§6) must include a
heavy-logger + heavy-follower envelope before cutover; the timeline read can
**downsample for display without deleting history**.

### 15.9 Unified relations / soft-ref catalog

```
user (D1, id PK)
├─1:N─ session / account / share_links        (user_id FK, CASCADE)
│         └─ share_links.scope ∈ {curated, listing, full}   (DEC-14)
│         └─ share_links.car_id ──soft──> owner's cars.<carId>
├─ .name ─────────────> ownerName (route-injected into snapshot, iff …)
├─ .show_owner_name ──> gates that injection                 (DEC-10)
└─1:1─ GarageDO (idFromName(user.id); NO userId column inside)
        └─ MergeableStore
           ├─ cars (rowId = carId)
           │   ├─1:N (carId cell)─ photos | wishlist | mods | maintenance |
           │   │                    todos | issues | **mileage**            (DEC-16)
           │   ├─ .coverPhoto  ──soft pointer──> photos.<photoId>
           │   ├─ .bannerPhoto ──soft pointer──> photos.<photoId>           (DEC-6)
           │   └─ .vin (private; listing-snapshot only)                     (DEC-13)
           ├─ photos.(source, sourceId) ──polymorphic soft FK──>            (DEC-6)
           │       sourceId ∈ {mods|maintenance|issues|todos}.<rowId>
           │       (same-car; dangling sourceId coalesces → General)
           │       photos.r2Key ──> R2  u/<userId>/<carId>/<photoId>.<ext>
           ├─ **savedBuilds** (rowId = sha256(token); NOT a child)          (DEC-11)
           │       .token ──soft, CROSS-USER, CROSS-STORE──> another owner's
           │              share_links.token_hash (D1) + their DO car
           │              (dangles on revoke/expire/delete → 404/410 →
           │               set unavailableSince)
           └─ Values: themeId, customAccent?, currency, distanceUnit

local side store (per device, never synced)
├─ photoPayloads (photoId → dataUrl)
├─ **savedBuildSnapshots** (rowId = sha256(token)) ─1:1 same id─> savedBuilds  (DEC-11)
└─ sentinels: …existing… + **mileageBackfillVersion**                        (DEC-16)
```

**All soft refs (may dangle ⇒ resolve-with-fallback, never assume):**
`cars.coverPhoto`, `cars.bannerPhoto`, `photos.sourceId`, `share_links.car_id`,
`savedBuilds.token`. None can be an enforced FK (cross-store / cross-DO / CRDT
locality), so each has an explicit resolution path.

### 15.10 Delete & integrity cascades (cross-feature; ships WITH DEC-6)

- **Item delete (mod/maintenance/issue/todo) → RE-PARENT its photos to General**
  (`delCell sourceId` — the authoritative move under §15.2's coherence rule — and
  set `source='car'` to keep the hint current; even if a concurrent merge keeps a
  stale `source`, the absent/dangling `sourceId` already resolves the photo to
  General); **never destroy the bytes** — they are
  valuable R2-backed photos, and this path **must NOT** route through
  `onPhotosDeleted` (that would wrongly delete R2 bytes for a merely re-tagged
  photo). This cascade is the §15.2 coupling invariant in code: **every**
  photo-bearing child's delete adopts it (and any future `mileage`/`schedule`
  source must too).
- **`deletePhoto` → clear `cars.bannerPhoto` AND `cars.coverPhoto`** when either
  equals the deleted photoId (today it clears only `coverPhoto`).
- **`deleteCar` is UNCHANGED and remains the only path that deletes R2 bytes** — it
  cascades all photos by `carId`.
- **Mileage:** `mileage` rows cascade with their car like any child; maintenance
  feeds the timeline by **computation, not a copy**, so deleting a maintenance row
  never orphans a derived reading.
- **Monotonicity is NOT enforced** (the mergeable store has no cross-row CHECK) — a
  soft, advisory UI flag only; the usage-rate math tolerates non-monotonic noise.

### 15.11 Open issues (consolidated, ranked: integrity → correctness → policy → perf)

1. **(integrity) Account-deletion / Law-25 gap (task #36) is now higher-stakes.**
   D1 still cascades `session`/`account`/`share_links` on user delete, and
   `show_owner_name` rides on `user` (cascades naturally) — the merge adds **no new
   D1 cascade surface**. But DO + R2 are **still not** purged on delete, and the new
   DO-resident data raises sensitivity: **`cars.vin`** is a vehicle identifier
   (personal-data-adjacent) and **`savedBuilds.token`** holds bearer credentials at
   rest. The DO-purge must land before/with the privacy pass.
2. **(integrity) R2-orphan gap (pre-existing).** The web delete hook targets the
   wrong endpoint (`DELETE /img/<r2Key>` vs `POST /api/uploads/delete`) and swallows
   errors. DEC-6 does **not** worsen it, but the new **re-parent** path must
   explicitly **not** call `onPhotosDeleted` (#1 above).
3. **(correctness) DEC-16 Contract: logical vs physical drop.** §15.8 recommends a
   **logical** contract (stop reading the scalar mirror; keep cells inert); a
   physical drop is deferred and, if ever taken, needs the full-upgrade gate +
   tombstone-before-attach sweep. Decide explicitly before retiring the cells.
4. **(policy — needs owner sign-off) Curated photo-set filter (§15.7 ▼).** Whether
   curated/showcase should filter to General + cover/banner (hiding issue/damage
   photos) **changes which photos appear on already-issued shares** — a DEC-14/DEC-8
   call, not the data model's. Default until signed off: curated keeps today's
   "all photos".
5. **(policy) DEC-10 × DEC-14 consent.** Resolved as **master `show_owner_name`
   wins** (listing nudges, not forces). If product later wants listings to *force*
   the seller name, add a **nullable per-link `share_links.show_seller`** override
   (NULL = fall back to user default) — additive, keeps the user-level FD intact.
6. **(policy/forward) DEC-8 banner + `bannerPhotoId` in the snapshot.** Keep the
   share hero on the **resolved `coverPhotoId`** for now (no contract change); add
   `bannerPhotoId` to the allowlist + zod **together** only when DEC-8 formally
   adopts a distinct banner.
7. **(forward) `coverPhoto → coverPhotoId` rename deliberately NOT done** — a
   single-step CRDT cell rename would break in-flight sync. If the foundation build
   wants it, that is a **separate expand-contract** they own; don't collide on the
   `cars` row.
8. **(perf) DEC-11 curated card projection.** The Watching list wants a
   guaranteed-curated lightweight card, but `GET /api/share/:token` returns the
   link's **stored** scope. Recommend a public `?view=card` projection reusing
   `buildPublicSnapshot`; data model unaffected either way. Background auto-refetch
   must **not** POST `/view` (only real page opens count).
9. **(perf) #268 combined ceiling** (§15.8) — production single-save ceiling
   unmeasured; staging probe must cover heavy-logger (check-ins) + heavy-follower
   (`savedBuilds`) envelopes before cutover.
10. **(forward) `PhotoSource` lockstep.** The union must track the photo-bearing
    child set; `mileage` (DEC-16) and schedules (DEC-18) are the next candidates and
    each must adopt the re-parent cascade (#1 / §15.10) on the day they join.

### 15.12 Review fixes applied (adversarial review → this revision)

The model survived adversarial review; the verdict was **needs-fixes** (one major
defense-in-depth regression + four minor CRDT/consistency edges), all folded into
the sections above. Recorded here for traceability — **each was verified against
`master`**, not asserted:

| # | Sev | Fix | Where | Verified against |
|---|---|---|---|---|
| 1 | **major** | **OG/crawler path stays STRUCTURALLY private-free.** Do not route a `vin`+`salePrice`-bearing `ListingCarSnapshot` into the OG renderer; build a **dedicated minimal OG projection** (`{year, make, model, nickname, salePrice, salePriceCurrency, coverPhotoId, ownerName?}`) + a regression test pinning `vin` out of the rendered `/share/:token` HTML; keep `full→buildPublic`. | §14.4, §15.7 | `lookupCuratedShareSnapshot` hardcodes `'curated'` (`share.ts:262,268`); `shareMetaFromSnapshot` reads a fixed allowlist (`og.ts:63-91`); wired at `index.ts:136-165`. The most-cached, session-less surface — its structural guarantee must not degrade to allowlist discipline. |
| 2 | minor | **`(source, sourceId)` coherence.** Effective parent = `sourceId` resolution (live, same-car) else **General**; `source` is an **advisory cached hint** repaired on read/next write. Added as the **5th denormalization**; gallery buckets on the resolved parent, not raw `source`; re-parent cascade's authoritative move is `delCell sourceId`. | §15.2, §15.6 (#5), §15.10 | Per-cell LWW can land `source≠'car'` with `sourceId` absent (re-attach on A vs delete-cascade on B); the prior "absent→car (bucket by source)" vs "absent sourceId ⇔ General" rules disagreed on that divergent state. |
| 3 | minor | **DEC-16 seed delete-safety.** Gate the `` `${carId}::initial` `` backfill on "no `mileage` stamp **live OR tombstoned**" (inspect the stamp map) or a restore-surviving per-car marker — not the local sentinel alone — so a cleared sentinel after a restore can't re-stamp and **resurrect** a deleted reading. | §15.1, §13.5 (step 2), §15.8 (Phase 2) | The deterministic id that prevents duplicates is exactly what enables resurrection: re-write at `T2 > T1` out-stamps the user's delete tombstone. |
| 4 | minor | **`savedBuilds.cachedScope` domain widened** to `'curated' \| 'listing' \| 'full'` (was `'curated' \| 'full'`), matching the third scope the merge introduces; Watching-list badge must handle `'listing'`. | §12.2 | §14.1/§15.7 add `'listing'`; the cell is unconstrained string (no runtime crash) but the doc was internally inconsistent. |
| 5 | minor | **DEC-1 currency fidelity in `full`.** Add `salePriceCurrency?` to `FullCarSnapshot` + `fullCarSnapshotSchema`; `buildFullSnapshot` emits it when `salePrice !== ''`, formatting against the entered tag (as `listing` already does). | §14.4, §14.7, §15.7 | `buildFullSnapshot` emits a bare `salePrice` string (`publicSnapshot.ts:386`); the viewer formats against `FullSettings.currency` (device setting) → wrong symbol for a non-device-currency price. The merge already plumbs `salePriceCurrency` from `carRow`, so it is a near-free same-pass fix. |

**Confirmed sound by the review (not changed):** the curated/full builders build
key-by-key and never spread the raw `Car` (`buildFullSnapshot` spreads only the
curated `base`), so new domain fields (`vin`, photo `source`/`sourceId`, `mileage`,
`savedBuilds`) **cannot auto-leak** (deny-by-default holds); `scope` is read
server-side from the stored row with `unknown→curated` (`share.ts:330`,
`lookupCuratedShareSnapshot`), so purpose-gating cannot be bypassed and degrades
safely across every Expand/Switch deploy ordering; `getCarSnapshot` never reads
`savedBuilds`, so a follower's bearer tokens can't leak via their own share;
`z.strictObject().extend()` preserves strict extra-key rejection in the installed
Zod 4.4.3 (so the `listing` branch is genuinely strict); normalization is BCNF; the
#268 arithmetic checks out and the over-budget heavy-logger case (~70k cells) is
flagged, not hidden; the additive `ALTER … ADD COLUMN show_owner_name` avoids the
FK-cascade rebuild and better-auth's drizzle adapter tolerates the defaulted column.

---

## Doc drift FIXED in `db/schema.md` (this task — docs only, no code touched)

Three AS-IS drifts in `db/schema.md` §2 were corrected in the same pass (they
described the *current* live schema wrongly, so fixing them is an AS-IS correction,
not a target change — those target additions stay here in §15, not in the AS-IS
schema doc):

- `share_links` column list **now lists `view_count`** (NOT NULL DEFAULT 0, added
  `drizzle/0001`) and **`scope`** (NOT NULL DEFAULT `'curated'`, TS enum
  `'curated' | 'full'`, no SQL CHECK, added `drizzle/0002`) — both present in
  `db/schema.ts` and the live DB.
- Share URL corrected from `#/share/<token>` to the clean path **`/share/<token>`**
  (BrowserRouter; `share.ts:240`).
- Token-scoped image cache header corrected from a static `public, max-age=60` to
  the dynamic `shareCacheControl` (`share.ts:114-118,410`): `public,
  max-age=<browser>, s-maxage=<edge>`, `edge = min(60, secs-until-expiry)`,
  `browser = min(edge, 5)`.
