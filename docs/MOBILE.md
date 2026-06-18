# Mobile reuse of `@chudbox/shared`

How a future Expo / React Native app reuses the local-first sync core without a
rewrite. Every claim below points at the real file that backs it.

> **Status (decided 2026-06-17): the `apps/mobile` Expo stub is DEFERRED.**
> M5 was reduced to *locking and documenting* `packages/shared` for future RN
> reuse. There is intentionally **no `apps/mobile` directory** and **no
> `expo` / `react-native` dependency** in the workspace yet (`pnpm-workspace.yaml`
> globs `apps/*`, but none exists). This document is the contract a later mobile
> milestone builds against; the original plan lives in `docs/BACKEND_PLAN.md`
> (milestone **M5**).

---

## 1. Why `@chudbox/shared` is reusable as-is

The package ships **pure domain logic + the TinyBase sync core** with zero
DOM/Node/React coupling, so Vite (web), Cloudflare Workers (api) and Metro (RN)
all consume the *same* compiled output:

- **No platform globals or imports.** Every non-test module under `src/` is held
  to that by an eslint lockdown — `packages/shared/eslint.config.js`:
  - `no-restricted-globals` bans `window`, `document`, `localStorage`,
    `sessionStorage`, `navigator`, `location`, `process`, `Buffer`,
    `__dirname`, `__filename`, `require`.
  - `no-restricted-imports` bans `node:*` builtins, bare `fs`/`path`/`crypto`,
    `react`/`react-dom`/`react-native`, and the platform-specific TinyBase
    subpaths (`tinybase/persisters/*`, `tinybase/synchronizers/*`,
    `tinybase/ui-react*`).

  The guard runs over `src/**/*.ts` (tests excluded) and is part of the package's
  `lint` gate, so a platform leak fails CI rather than RN at runtime.

- **ESM-only dist for Metro.** `packages/shared/tsup.config.ts` emits
  `format: ['esm']`, `target: 'es2022'`, `dts: true` — no Node/DOM polyfills.
  `package.json` sets `"type": "module"` and `"sideEffects": false` (tree-shaking
  friendly).

Consumers always import the package by name and let the bundler resolve the dist
(`apps/web/src/store/useGarageStore.ts` does exactly this:
`import { createGarageStore } from '@chudbox/shared'`).

---

## 2. The store: `createGarageStore()` + injected persister/synchronizer

`packages/shared/src/store.ts` exports `createGarageStore(uniqueId?)`, which
returns a schema-applied **`MergeableStore`** and wires **neither a persister nor
a synchronizer** — both are platform concerns the *consumer* attaches after
creation (see the `@example` blocks in that file). This is the seam that makes
the core portable.

Proof the seam already works on two platforms today:

| Platform | Persister | Synchronizer |
| --- | --- | --- |
| **web** (`apps/web`) | `createIndexedDbPersister` (side store) + a custom mergeable IDB persister for the synced store — `apps/web/src/store/useGarageStore.ts`, `idbMergeablePersister.ts` | `createWsSynchronizer(store, ws)` then `startSync()` — `apps/web/src/store/sync.ts` |
| **api / Durable Object** (`apps/api`) | fragmented `persister-durable-object-sql-storage` — `apps/api/src/durable/GarageDO.ts` | the DO is the WS server endpoint (`/sync`) |
| **RN / Expo** (future) | `persister-expo-sqlite` (or `persister-react-native-sqlite`) | the **same** `synchronizer-ws-client` the web app uses |

RN wiring (documentation only — `@chudbox/shared` imports none of it):

```ts
import { createGarageStore, SYNC_PATH } from '@chudbox/shared'
import { createExpoSqlitePersister } from 'tinybase/persisters/persister-expo-sqlite'
import { createWsSynchronizer } from 'tinybase/synchronizers/synchronizer-ws-client'
import * as SQLite from 'expo-sqlite'

const store = createGarageStore()

// Offline-first persistence (works logged-out, exactly like web's local store).
await createExpoSqlitePersister(store, SQLite.openDatabaseSync('chudbox.db')).startAutoLoad()

// Sync only once signed in — same wire protocol as web (server endpoint = SYNC_PATH '/sync').
await createWsSynchronizer(store, new WebSocket(`wss://<host>${SYNC_PATH}`)).startSync()
```

API names verified against the installed `tinybase@8.4.2`:
`tinybase/persisters/persister-expo-sqlite` exports `createExpoSqlitePersister(store, db)`;
`tinybase/synchronizers/synchronizer-ws-client` exports `createWsSynchronizer(store, webSocket)`
(same factory `apps/web/src/store/sync.ts` calls). `expo-sqlite` is a TinyBase
peer dependency the RN app installs, never `@chudbox/shared`.

**Logged-out behavior matches web:** attach the persister only and skip the
synchronizer — the store is fully usable offline, sync turns on at sign-in.

---

## 3. Crypto polyfill for `newId()`

`packages/shared/src/id.ts` `newId()` mints ids with
`globalThis.crypto.randomUUID()`. Browsers, Workers, Node ≥ 19 and vitest all
expose a global WebCrypto, so web/api need nothing. **React Native's Hermes/JSC
runtime has no global `crypto`**, so the Expo app must install the polyfill once,
at app entry, **before the first `newId()` call**:

```ts
// index.js / App entry — must run before any store/id usage.
import 'react-native-get-random-values'
```

Without it `newId()` throws an explicit
`crypto.randomUUID is unavailable …` error (it never falls back to a weak id).
This is the only RN-specific runtime requirement of the core; `id.ts` carries
the same note inline.

---

## 4. Metro resolution of the dist (+ explicit-import backstop)

`packages/shared/package.json` exposes the build three compatible ways so any
Metro version resolves it:

- `"exports": { ".": { "types": …, "import": "./dist/index.js", "default": … } }`
  — modern Metro with package-`exports` support (improved on React Native ≥ 0.79,
  per `BACKEND_PLAN.md`) resolves `@chudbox/shared` → `dist/index.js`.
- `"main"` **and** `"module"` both point at `./dist/index.js` — the **backstop**:
  a resolver that ignores the `exports` field (older Metro, or
  `resolver.unstable_enablePackageExports` left off) still lands on the same ESM
  file.
- `"files": ["dist"]` ships only the compiled output; `"types": "./dist/index.d.ts"`
  gives the RN app full typings.

Practical notes for the future `apps/mobile`:

- The package is a workspace dependency; Metro must watch the monorepo root and
  resolve `packages/shared/dist`. **The dist must be built** — consumers resolve
  `dist`, not `src` (run `pnpm --filter @chudbox/shared build`, per the repo
  rule). `BACKEND_PLAN.md` (M5 row) records the same backstop:
  *"Metro resolution (improved on RN ≥0.79; tsup output + explicit import paths
  as backstop)."*
- If a Metro setup still fails to resolve the bare specifier, the explicit path
  `@chudbox/shared/dist/index.js` is the deterministic fallback (it is the exact
  file `main`/`module`/`exports` all point to).

---

## 5. What a later mobile milestone still owns

Everything platform-specific stays **out** of `@chudbox/shared` and lives in the
(deferred) `apps/mobile`:

- Expo project + Metro config + `react-native` / `expo` / `expo-sqlite` /
  `react-native-get-random-values` deps.
- The persister + synchronizer wiring from §2 and the polyfill from §3.
- UI (the web app's React components are not shared; only the data/sync core is).

The reduced M5 deliverable is this lock-down: the core is RN-safe, the seams are
injected, and this doc is the build sheet. Reviving `apps/mobile` requires no
change to `packages/shared`.
