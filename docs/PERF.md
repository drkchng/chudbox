# Performance — run guide & status

Lighthouse needs a browser, which the dev/automation environment doesn't have, so the
Lighthouse run is **yours to do** (commands below). react-doctor is a static analyzer
and *was* run + partially applied. This doc captures what's done, what to run, and what's
held for your review.

## Already done (measurement-free, deployed)

These are safe wins applied without needing a profiler:

- **Immutable caching for hashed assets** — `/assets/*` now serves
  `Cache-Control: public, max-age=31536000, immutable` (was `max-age=0, must-revalidate`).
  Safe because filenames are content-hashed. Fixes Lighthouse "efficient cache policy".
  index.html stays uncached so deploys are picked up. (`apps/web/public/_headers`)
- **Self-hosted fonts** — Inter + JetBrains Mono are bundled (`@fontsource`), dropping the
  render-blocking Google Fonts stylesheet + 2 cross-origin preconnects, and removing a
  *dead* JetBrains-Mono CDN download (it was loaded but never rendered — no `font-mono`
  Tailwind mapping). Improves FCP / removes render-blocking + third-party origins.
- **Security headers + tight CSP** on the document and assets (`_headers`) and Worker routes
  — helps the Lighthouse "best-practices" category.
- **Clean URLs (BrowserRouter)** + **Open Graph/Twitter meta** on `/share/:token` — SEO /
  shareability.
- **react-doctor** — ran (311 findings); the high-confidence, behavior-preserving
  Bug/Performance/Maintainability fixes were applied (full-suite-verified). The 163
  Accessibility findings were **deferred to the design wave** (they overlap
  `docs/DESIGN_REVIEW.md`).

## Lighthouse — run it (needs Chrome, your machine)

```bash
# Quick HTML report against production:
npx lighthouse https://chudbox.com --view

# Categories explicitly, save to file:
npx lighthouse https://chudbox.com \
  --only-categories=performance,accessibility,best-practices,seo \
  --output html --output-path ./lighthouse.html --view

# Or: Chrome DevTools → "Lighthouse" panel → Analyze page load.
# For a logged-in / local view, point it at `pnpm --filter web dev` or `wrangler dev`.
```

What to look at:
- **Core Web Vitals**: LCP, INP, CLS.
- **LCP element** — almost certainly a car cover photo. Consider `fetchpriority="high"` +
  eager-load it, and `loading="lazy"` on the *other* gallery thumbnails.
- **CLS from images** — add `width`/`height` to `<img>` tags. We already store photo
  dimensions, so this is cheap and kills layout shift.
- **Main JS bundle** (~358 KB gzip 104 KB) — if flagged, code-split the routes.
- **Accessibility** — will overlap `docs/DESIGN_REVIEW.md`; do those in the design wave.

## react-doctor — re-run / CI

```bash
npx react-doctor@latest --verbose          # list every finding
npx react-doctor@latest --verbose --diff   # before/after diff
npx react-doctor install --yes             # adds a `doctor` script + dev dep + CI wiring
```

Run on 2026-06-18: **311 findings** — 101 Bug, 29 Performance, 18 Maintainability, 163
Accessibility (score 50/100).

**Applied (10, committed):** all `deslop/unused-export` cleanups — 9 truly-internal
functions de-exported (`sync.ts` ×4, `themes.ts` ×3, `exportMarkdown.ts`, `testFixtures.ts`)
+ 1 dead `export { FREE_IMAGE_POLICY }` re-export removed from `utils/image.ts`. Each was
grep-confirmed unused outside its file; pure API-surface cleanup, zero runtime change,
full suite green, adversarially reviewed.

**Held for your call** (the ones worth a decision — the rest were false positives or
cosmetic):
- **`button-has-type` ×89** — react-doctor wants `type="button"` on every `<button>`.
  Real best-practice, but mass-applying risks breaking buttons currently relied on to
  submit a form. Do this *with* the design wave (overlaps form UX), button-by-button.
- **`js-tosorted-immutable` ×8** — prefers `Array.toSorted()` over `.slice().sort()`.
  Blocked: `tsconfig` lib is ES2022 and `toSorted` is ES2023 → would fail typecheck.
  Needs a deliberate lib bump to ES2023 first.
- **`unused-dependency: zustand`** — genuinely unused in `src` (store moved to TinyBase).
  Safe to drop from `package.json`, but it edits the lockfile on a live app for zero
  runtime benefit — left as a one-liner cleanup for you.
- **`unused-export` ×2** — `BACKUP_VERSION` (`backup.ts`) and `DEFAULT_THEME_ID`
  (`themes.ts`) are *fully* dead (not even used internally), so they can't just be
  de-exported (trips `noUnusedLocals`) — they'd need outright deletion. A named
  schema-version / default-theme anchor is a semantic call, so left for you.
- **163 Accessibility** — deferred wholesale to the design wave (`docs/DESIGN_REVIEW.md`).

## Held for your Lighthouse run (need real numbers before touching)

- **Image priority/lazy/dimensions** — needs the LCP element identified (above).
- **Route-level code-splitting** — only if the bundle is actually flagged.
- Anything else Lighthouse surfaces that touches layout/behavior — by request, only safe,
  non-functional perf fixes were applied unattended.
