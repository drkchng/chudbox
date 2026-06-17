# M2 empirical gate — TinyBase #268 fragmented-persister measurements

> Status: **PASSED** (2026-06-12, local). Suite: `apps/api/test/m2-gate.test.ts`
> (7 tests, ~20 s) against the real `GarageDO` + fragmented DO-SQLite storage
> under `@cloudflare/vitest-pool-workers` (workerd 1.20260611.1,
> tinybase 8.4.2 pinned). Re-run with:
> `pnpm --filter api exec vitest run test/m2-gate.test.ts --disable-console-intercept`
> (the `[M2:*]` console lines are the measurement reports; passing-test output
> is hidden without that flag).
>
> **Read this with one caveat in mind, stated up front and repeated where it
> matters: local workerd enforces neither production CPU/wall-clock limits nor
> the 1 MiB WebSocket receive cap, and its SQLite throughput is not
> Cloudflare's. "No reset locally" is NOT evidence of production safety. The
> gate's strength is the measured WRITE-SHAPE CONTRAST (zero-row attach after
> stamped seeding vs full-store rewrite after naive seeding), which is
> runtime-independent.**

## What was measured (mapping to plan Verification M2 (b)/(c) and Risk #1)

Synthetic garage, deterministically generated (20 cars × years of history:
20 maintenance + 8 mods + 10 todos + 6 issues + 6 wishlist + 4 photo rows per
car, realistic text lengths, nulls/`0`/`false`/`''`, dangling cover, deleted
rows as tombstones):

| metric | value |
|---|---|
| live cell stamps | **9,543** (+ 25 tombstones + 4 values) |
| serialized mergeable content | **590,455 B** (~62 B/cell) — ~3× the ~200 KB single-save zone reported in #268 |
| SQL footprint after seed | 10,769 rows / 1,693,361 B (~158 B/cell incl. HLC + hash) |

### (c) THE GATE — empty-DO first sync via chunked stamped RPCs

Path exercised end-to-end through the real session-authed routes
(`POST /api/sync/seed` with a Better Auth session minted through the real
sign-up/sign-in flow, then a real `WsSynchronizer` on `/sync`). Direct-DO
access (`runInDurableObject`) is used only by the control/ceiling probes,
where the route's `MAX_SEED_CHUNK_CELLS` cap would defeat the point and auth
adds nothing — the authed path is already proven by the gate itself.

| step | measured |
|---|---|
| seed, 40 chunks @ `DEFAULT_SEED_CHUNK_CELLS` = 256 | 7–14 ms/chunk (median 10), **389 ms total**, max HTTP body 15,981 B |
| post-seed stamp fidelity | DO `getMergeableContentHashes()` **identical** to the client store's (slices reassemble exactly — the named seed-slicing validity sub-item) |
| re-applying ALL 40 chunks (idempotency) | **0 rows added, 0 removed**, hashes unchanged — per-cell LWW no-op, autosave never fires |
| **synchronizer attach after stamped seed** | **0 rows written**, 6 messages, **96 B** total payload (hash negotiation only), max message 23 B |
| genuine deltas after attach (1 cell edit + 1 new 5-cell row) | 14 rows added / 1 replaced — the cells themselves + parent-stamp rows for 2 bounded saves |
| fresh second device (empty store) full down-sync | **103 ms**, 9 messages, ~472 KB down, **0 rows written on the DO** (read-only negotiation), content deep-equals the first device's incl. post-seed edits and tombstones |

The attach exchanged *only* hash messages because the seed carried the
original per-cell HLC stamps; nothing was divergent. This is the entire #268
mitigation, observed directly against real DO storage.

### (b) Storage behavior — per-cell rows, not a JSON blob

Asserted over tables *discovered* from `sqlite_master` (no hard-coded names):
10,769 small rows, largest single row **218 B** while the store serializes to
590 KB — i.e. fragmented mode demonstrably stores one row per cell stamp.
(For reference the discovered tables are `tinybase_tables` /
`tinybase_values`; the assertions do not depend on that.)

### (4) Premise falsification — control DO seeded with PLAIN values

Same generator at 6 cars (2,862 cells, **179,673 B — right at the reported
#268 zone**), written into a second DO as plain `setRow`/`setValues` (fresh
server-minted stamps — what a naive "POST the cars as JSON" migration would
do), then a client with newer stamps and per-cell divergent values attached:

| observation (5 s window) | measured |
|---|---|
| convergence | **never** (see drop-window finding below) |
| wire traffic | 30 messages, **681 KB** (~3.8× the store re-shipped in repeated full-store diff rounds), max single message **143,918 B** |
| DO writes | 0 rows, 0 transactions (every apply silently dropped) |

Then the write the synchronizer performs when its apply *does* land
(demonstrated directly on the same DO): the negotiated full-store diff is
applied as **one `applyMergeableChanges` → one transaction → one fragmented
save: 2,872 cells, 3,211 rows added + 2,872 replaced, in a single
un-chunkable save** (45 ms locally; production behavior at this size is
exactly the #268 unknown). Contrast with the stamped attach's **zero** rows.
Both failure directions of the premise are therefore observed: naive seeding
produces (a) unbounded repeated full-store wire exchanges and (b) when
applied, the single giant save the chunked seed exists to prevent.

### (5) Ceiling probe — one `applyMergeableChanges` save of N cells

Direct store apply inside the DO (bypasses the route's 2,048-cell cap on
purpose), one chunk per N, fresh DO per step. `applyMs` is in-DO; `totalMs`
is measured across the await from the test runner; `coldStartMs` is a forced
`state.abort()` then first touch (constructor `load()` + the **unconditional
initial full-content save** — see finding E):

| cells in ONE save | chunk size | apply | total | cold start |
|---|---|---|---|---|
| 1,000 | 47 KB | 12 ms | 20 ms | 19 ms |
| 5,000 | 238 KB | 57 ms | 77 ms | 79 ms |
| 20,000 | 959 KB | 232 ms | 297 ms | 309 ms |
| 50,000 | 2,405 KB | 634 ms | 792 ms | 822 ms |

**No cliff observed locally up to 50,000 cells / 2.4 MB in one save** —
clean linear scaling at ~13 µs/cell. This does NOT clear production: the
#268 report cites resets at ~200 KB on real Cloudflare, far below what local
workerd happily absorbs. Treat the production ceiling as still unmeasured;
see "Residual unknown" below.

## Recommended defaults and budgets

- **`maxCellsPerChunk` default: keep `DEFAULT_SEED_CHUNK_CELLS` = 256.**
  Measured 7–14 ms and ≤16 KB per chunk; a full heavy garage seeds in
  ~0.4 s over 40 requests. 256 cells ≈ 16 KB per save = **12× margin** below
  the reported ~200 KB zone; nothing is gained by raising it. The
  server-enforced `MAX_SEED_CHUNK_CELLS` = 2,048 (~130 KB worst case) also
  stays below the zone.
- **Store-size monitoring budget (cell count is the unit):**
  - **Alert at 15,000 cells (~0.95 MB serialized at the measured 62 B/cell).**
  - **Hard review/shard trigger at 20,000 cells (~1.25 MB).**
  Rationale: (i) the heaviest realistic garage measured 9.5 k cells, so 15 k
  alerts before users approach the risk zone, not after; (ii) at 20 k cells a
  full-store WS message ≈ 0.8× serialized ≈ 1 MB — the production **1 MiB cap
  on messages a DO RECEIVES** starts to bite for any client→DO full-diff
  (divergence repair), independent of #268; (iii) the cold-start full save
  (finding E) is a whole-store single save on *every DO wake*, so total store
  size — not just migration chunks — must stay inside whatever the production
  single-save ceiling turns out to be. Implementation: `getMeta` already
  returns per-table live row counts; emit cell counts from the same place.

## Fallback ladder (pre-decided, with triggers)

1. **Smaller chunks** (halve 256 → 128 → 64).
   Trigger: seed-chunk RPC p95 > 5 s, any DO reset during seeding, or
   production wake/save telemetry showing stress at chunk scale.
2. **Stamp-authority inversion** — seed the DO with *plain values* via the
   same chunked RPCs, then have the client adopt the DO's mergeable content
   wholesale into local IndexedDB *before* attaching, so the one bulk
   stamped write lands client-side (IndexedDB, no DO limits).
   Triggers (mechanical, checked by the production seed flow):
   - post-seed hash check fails — client compares its
     `getMergeableContentHashes()` against the DO's after the last chunk
     (the gate proves equality holds today; an upstream change breaking
     slice-validity shows up here first), or
   - the post-seed attach produces a server-side reconcile transaction
     larger than ~2× the chunk budget (instrumentable from `getMeta`-style
     row counts before/after attach), or
   - any #268-style reset observed on the seed/attach path in production.
3. **JSON mode behind a hard size guard** — single-row persistence with a
   refusal above ~1.5 MB serialized (2 MB DO row limit headroom).
   Trigger: fragmented saves reset DOs even at 64-cell chunks.
4. **Shard the store** (per-table or per-car-cluster DOs).
   Trigger: legitimate garages exceeding the 20 k-cell budget, or guard
   refusals in mode 3.

## Findings beyond the gate (verified against installed tinybase@8.4.2 source + measured)

**A. `WsServerDurableObject` cold-start apply-drop window (~1 s).** The
server-side synchronizer registers its apply listener (`persisterListener`)
only after its constructor-time `load()` resolves, and that load blocks on a
`GetContentHashes` request — broadcast when no client is connected — for the
hardcoded `requestTimeoutSeconds = 1`. Until then, **incoming reconciles and
deltas are silently dropped** (`persisterListener?.()` on `undefined`;
confirmed by tracing: zero server transactions while full cell-diff responses
were delivered). In the deterministic same-isolate test environment a
divergent attach then settles into a repeating full-diff exchange that never
applies (the control's measured live-lock). Production has the same ~1 s
window after **every DO wake**. Implications for the M2 adapter: attach only
after seeding (already the golden rule), and treat sync as live only after
the first server-originated `ContentHashes` broadcast (sent by the server's
initial save, i.e. after listener registration). Worth filing upstream.

**B. Values schema defaults are fabricated as STAMPED values — a blank
device clobbers cloud settings.** `createGarageStore()` materializes
`themeId`/`currency`/`distanceUnit` defaults as real stamped values at store
creation. A fresh device's fabricated stamps are wall-clock NEWER than the
cloud's user-chosen settings, so under LWW the blank device wins: measured —
cloud `themeId` went `'midnight' → 'garage'` after a fresh schema-applied
client attached (and the device never adopts the user's setting). This is
plan Risk #10 ("HLC vs wall-clock skew — prefer explicit precedence for
Values") made concrete and automatic. **The M2 web adapter MUST NOT let an
untouched schema-defaulted store sync its Values**: either move display
defaults out of the synced values schema (`GarageDO` is already deliberately
schema-less for exactly this fabrication reason) or resolve Values
cloud-wins before attach. Flagged to the adapter workstream
(`packages/shared/schema.ts` / `apps/web` — outside this task's scope).

**C. Stamp-only merges are not persisted.** The fragmented persister's
autosave saves the *transaction's raw-store changes*; a merge that replaces
only a cell's HLC stamp (same value) or seeds a tombstone for a never-live
cell changes no raw cell, so the new stamp lives **in memory only**. After a
DO restart the SQL-loaded stamps regress and the next attach re-exchanges
exactly those cells from the client — bounded and convergent (the client
retains them), but it means hash equality across restarts is not guaranteed
for tombstones/stamp-only adoptions, and monitoring should expect small
post-wake delta exchanges. (Already noted for tombstones in `GarageDO`'s
docblock; the same mechanism measured here for same-value merges.)

**D. Parent-stamp rows accumulate per save.** The fragmented schema keys
parent stamps with SQL `NULL`s inside the PK (and `tinybase_values` has no PK
at all); SQLite treats NULL PK components as distinct, so `INSERT OR REPLACE`
*appends* parent rows on every save: measured 1,222 overhead rows (11.4%)
after the 41-save seed; steady-state ~4–6 extra rows per edit-save, never
compacted (loads fold duplicates via max-HLC, so correctness is unaffected).
Slow unbounded storage/load growth — schedule a compaction sweep (safe: keep
max-timestamp row per parent key) in a later milestone.

**E. Every DO wake performs a full-store save.** `WsServerDurableObject`'s
constructor runs `persister.load()` then `startAutoSave()`, whose initial
`save()` writes the ENTIRE store back, cell by cell (verified in source;
measured: 309 ms @ 20 k cells, 822 ms @ 50 k locally — and +2 duplicate
parent rows per wake, see D). On production this is the largest recurring
single save in the whole design — size equals total store size — which is the
strongest reason the monitoring budget above is a *store-size* budget, not a
migration-chunk budget. If production telemetry shows wake-time stress, a
custom persister wiring that skips the initial save is the fix (upstream
issue material).

**F. WS message sizes.** Full down-sync of the 590 KB garage arrives as one
~472 KB message (DO→client: outgoing, not subject to the DO's 1 MiB receive
cap; browsers don't cap). Client→DO messages stay at delta scale under
stamped discipline (96 B attach); only divergence repair can approach store
size (control: 144 KB for a 180 KB store) — capped at 1 MiB in production,
which the 20 k-cell budget respects.

## Residual unknown / acceptance before cutover

The production single-save ceiling remains unmeasured (local linearity to
2.4 MB notwithstanding — the #268 report is from real Cloudflare at
~200 KB). Before flipping M2 on for real users, run a one-off staging probe
against deployed infrastructure: seed a 10–15 k-cell garage through
`/api/sync/seed`, force a DO restart (deploy bump), reconnect, and confirm
(a) no reset during wake (finding E is the bulk write under test),
(b) zero-row attach, (c) full down-sync to a fresh client. That is this
suite's scenario 1 replayed against the real runtime, and it converts the
remaining risk into a measured number.
