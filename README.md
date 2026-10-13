# Chudbox

A local-first car management app for enthusiasts. Track each build's mods, maintenance, mileage, parts wishlist, to-dos, and issues, and share a build with anyone through a link.

**Live:** https://chudbox.com

Everything lives in your browser and the full app works with no account and no connection. An optional account adds cross-device sync and cloud photo storage on top, so an unreachable server never blocks you from logging a mod.

## Features

**Tracking**
- **Multiple cars**, each with a status: Current, For Sale, For Trade, Sold, or Totaled (a past sale date marks a car as Sold automatically)
- **Mods log**, grouped by category, with cost and link tracking
- **Maintenance log** with next-due dates and mileage-based reminders
- **Mileage check-ins**, in km or miles, with overdue maintenance flagged from the latest reading
- **Parts wishlist** that moves a part from Wanted to Ordered to Installed, and then into Mods
- **To-dos** with priorities, and an **issues tracker** with severity and resolution
- **Photos**: attach images to individual items, browse a gallery, and pick a cover and banner photo
- Sorting and grouping on Mods, Maintenance, and Issues

**Sharing**
- **Share links** for any car, revocable and optionally expiring, with three levels of detail: curated, listing, or full. Private fields such as costs and notes are only included at the levels that allow them.
- **Link previews**: shared links carry Open Graph metadata, so they render as a card when pasted into chat or social apps. Previews always use the curated view only.
- **Watching**: save other people's shared builds and follow them.

**Data**
- **Markdown export** per car (YAML frontmatter and tables) for tracking in Obsidian
- **JSON backup and restore** of all your data
- Metric or imperial units, a currency setting, six theme presets, and a custom accent color

**Accounts (optional)**
- Email and password sign-up with email verification and password reset
- Sync across devices, and photo storage in the cloud
- Account deletion that removes your data from the database, sync storage, and image storage
- Privacy policy and terms pages, with the Terms version you accepted recorded at sign-up

## Architecture

A pnpm monorepo, built with Turborepo.

```
apps/web         React single-page app (the UI and the local data store)
apps/api         Cloudflare Worker: Hono API, auth, sync, uploads, share links
packages/shared  Types, zod contracts, and logic shared by web and api
e2e              Playwright end-to-end tests
db, docs         Data-model notes and design/deploy/compliance docs
```

How the pieces fit together:

- **Local-first data.** The web app keeps its data in a TinyBase mergeable store persisted to IndexedDB. It is fully usable offline and signed out.
- **Sync.** When signed in, the app syncs over a WebSocket to a per-user Durable Object (SQLite-backed) that holds that user's garage.
- **Auth.** [Better Auth](https://www.better-auth.com/) with email and password and required email verification, stored in Cloudflare D1 through Drizzle ORM. Verification and reset emails go out through Resend.
- **Images.** Uploads go through the Worker into a private R2 bucket, with authentication, size limits, and file-type checks on the bytes. Images are served only through authenticated or share-token routes.
- **Sharing.** Share tokens are stored hashed in D1. The public share page is served by the Worker so it can add Open Graph tags before the app loads.
- **Hosting.** One Worker serves the app's static assets and all API routes on a custom domain (chudbox.com).

## Tech stack

- **Front end:** React 19, TypeScript (strict), Vite, Tailwind CSS v4, Base UI, React Router, TanStack Query, Zustand, TinyBase
- **Back end:** Cloudflare Workers, Hono, Durable Objects, D1 with Drizzle ORM, R2, Better Auth, zod
- **Tooling:** pnpm workspaces, Turborepo, ESLint, Vitest, fast-check, Playwright
- **CI/CD:** GitHub Actions

## Running locally

Requires [Node.js](https://nodejs.org/) (CI uses 24) and [pnpm](https://pnpm.io/) (the version is pinned in `package.json`).

```bash
git clone https://github.com/drkchng/chudbox.git
cd chudbox
pnpm install

# Local API config: set BETTER_AUTH_SECRET (generate one with `openssl rand -base64 32`)
cp apps/api/.dev.vars.example apps/api/.dev.vars

# Build once: the Worker serves apps/web/dist, and the apps import the built shared package
pnpm build
pnpm --filter api exec wrangler d1 migrations apply chudbox --local

# Terminal 1: the API (Worker with local D1, R2, and Durable Objects)
pnpm --filter api exec wrangler dev --var BETTER_AUTH_URL:http://localhost:8787

# Terminal 2: the web app
pnpm --filter web dev
```

Open http://localhost:5173. The dev server proxies `/api` and `/sync` to the Worker on port 8787. The `--var` override is needed because `wrangler.jsonc` pins `BETTER_AUTH_URL` to the production domain, which would reject sign-ins from localhost. With no `RESEND_API_KEY` set, verification and password-reset links are printed to the `wrangler dev` console instead of being emailed. The app also works without an account, so the API is only needed for sign-in, sync, photos, and sharing.

After changing `packages/shared`, rebuild it with `pnpm --filter @chudbox/shared build`, or run `pnpm --filter @chudbox/shared dev` to rebuild on change.

## Testing

```bash
pnpm typecheck     # TypeScript, all packages
pnpm lint
pnpm test          # unit and API tests (Vitest)
pnpm test:e2e      # Playwright end-to-end suite against a local wrangler dev server
```

## Deployment

Every push to `master` runs the GitHub Actions workflow in `.github/workflows/deploy.yml`: install, typecheck, lint, build, test, apply pending D1 migrations, then deploy the Worker to Cloudflare. See [docs/DEPLOY.md](docs/DEPLOY.md) for the setup runbook, including the required secrets and Cloudflare resources.

## Docs

Design and planning notes live in [`docs/`](docs/), including the [data model](docs/DATA_MODEL.md), [roadmap](docs/ROADMAP.md), [privacy policy](docs/PRIVACY_POLICY.md), and [compliance notes](docs/COMPLIANCE.md). Product direction is in [PRODUCT.md](PRODUCT.md).
