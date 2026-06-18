# Chudbox — Master Design Review

Consolidated, read-only design audit of the whole app against the brand in `PRODUCT.md`
(dark/native, dense-by-default, functional-orange accent, WCAG AA floor, keyboard-navigable with
visible focus, reduced-motion respected; anti-references: generic SaaS dashboards, blue accent, soft
shadows everywhere, airy spacing).

**This document supersedes and consolidates `docs/DESIGN_AUDIT.md`** (the earlier single-pass audit).
That file's items are folded in here and cross-referenced by their original IDs (H1, B1, C6, …). Five
design advisors audited in parallel — Visual/Brand, Components/Controls, UX/IA, Accessibility, and
Content/States. Where multiple advisors independently flagged the same thing it's marked
**(flagged ×N)** — that convergence is the strongest signal in this report.

**User / context / goal (unchanged):** a car enthusiast who knows their car, on a desktop browser,
mid-build, wanting to log a mod/maintenance/issue in under ~10s and review history later. An account
is strictly additive (sync + cloud backup) and must never gate the local experience.

Severity: **Critical** (broken or inaccessible — must fix) · **Major/High** (clear usability or CX
problem — should fix) · **Minor** (polish or judgment call — discretionary). Tags: `[broken]` /
`[a11y]` / `[inconsistent]` / `[suboptimal]` / `[judgment]`.

Counts after dedup: **6 Critical · 22 High · 22 Medium · 23 Low** (73 findings).

---

## Already decided (do not re-litigate)

- **DEC-1 — Money is per-currency, store-as-entered.** No auto-conversion. Each amount keeps the
  currency it was typed in (`costCurrency`/`priceCurrency`/`salePriceCurrency` already persisted). The
  Settings "converted automatically" copy is wrong and must change. All money findings assume this model.
- **DEC-2 — Primary buttons move to DARK text on the orange fill.** White-on-orange (~2.80:1) is an
  AA failure; near-black `#0f0f0f` on `#f97316` = 6.84:1. This is the chosen fix everywhere an accent
  fill carries a label.
- **DEC-3 — Themes are accent-only on ONE fixed dark ramp** (owner decision, 2026-06-18). Drop the
  full-ramp per-theme recolors and the blue "Midnight" anti-reference; a theme changes only the accent
  hue, and every accent is AA-floored via the derived `--on-accent` token. Resolves V13/A6 + open Q1.
- **DEC-4 — Core loop is log-first** (open Q2). `addCar` returns the id → navigate to `/car/:id`;
  default the car profile tab to **Mods**; auto-focus the first add-form field. Applies to the OWNER
  profile only (see DEC-8 for share).
- **DEC-5 — Destructive deletes: optimistic + undo for low-stakes rows** (open Q3). Mods, maintenance,
  issues, todos delete instantly with an Undo toast; deleting a whole car keeps a hard confirm.
- **DEC-6 — Photo model is a UNIFIED GALLERY, two ways in** (owner decision, new feature). A photo
  attaches to the car (general) OR to a specific loggable item — **mods, maintenance, issues, todos**.
  The Photos tab is the filterable gallery of ALL photos (by source: General · Mods · Maintenance ·
  Issues · Todos); photos are also added/viewed inline on each item and surface in the gallery tagged
  with their source. The cover/banner is EXPLICITLY pickable from any photo (today's hover-only
  set-cover is finding A3). Built as its own focused pass; Wave 1/2 components must be shaped to fit it.
- **DEC-7 — Mixed-currency totals show a per-currency breakdown** (open Q4). No blended total —
  conversion is banned by DEC-1, so a single-currency total would be meaningless.
- **DEC-8 — The public share view leads with PHOTOS** (showcase), even though the owner profile is
  log-first (DEC-4). Different surfaces, different defaults.
- **DEC-9 — Share page gets real nav** (owner + friend feedback, 2026-06-18): logo-as-home (→ the
  visitor's garage if logged in, the landing if not) + a soft "make your own garage" CTA. Doubles as a
  discovery/growth hook off public shares.
- **DEC-10 — Owner display name on shares.** We have a display NAME (the account `name`, editable in
  Settings anytime, NEVER the email) — there is no username/handle concept. Shown on shares by DEFAULT
  with an opt-out toggle. This deliberately reverses today's anonymous-by-default posture (worthwhile
  for the for-sale case).
- **DEC-11 — Follow/save shared builds** (new feature). A visitor can save a shared build; because the
  share page re-fetches the curated snapshot live, a saved link auto-follows the build. LOCAL-FIRST
  (works logged-out, in the local store like the garage), syncs once there's an account; personal
  nicknames per saved build; a "Watching" surface. Grows the product from "my garage" to "my garage +
  builds I watch" (also the buyer/for-sale angle).
- **DEC-12 — Export/import relocates to Settings → Backup & data.** Account sync is the primary backup
  now, so the local export/import becomes a power-user / no-account fallback. Stays available
  logged-out (it is the only backup without an account).
- **DEC-13 — VIN field on the car** (owner). Optional, light 17-char validation. PRIVATE by default in
  shares (VIN enables cloning/fraud); exposed only on a For-Sale listing (buyers run history checks).
  Future nicety: VIN-decode to prefill year/make/model — not now.
- **DEC-14 — Shares have a PURPOSE** (presets, not à-la-carte): **Showcase** (default — nickname, mods
  count, status, mileage; anonymous unless DEC-10 is on) vs **For-Sale Listing** (adds price + seller
  name + VIN, emphasizes status/mileage). The purpose drives the OG embed AND the page content, and
  gates which currently-private fields (price, VIN, seller) get exposed. A listing is a deliberate,
  per-share opt-in to reveal those; Showcase preserves the leak-audit's curated/anonymous posture by
  default. Relates to the curated/full scope (DEC/#14): a listing = curated + the listing fields.
- **DEC-15 — Component/stack direction** (2026-06-18): behavioral primitives use **Base UI** (headless —
  the modern Radix successor the MUI/ex-Radix folks build; shadcn is moving toward it), styled 100% with
  our tokens — NOT Radix, NOT shadcn's default skin (the generic-SaaS anti-reference). Hand-roll the
  trivial visual primitives (Button/Badge/Card). Migrate to **Tailwind v4 NOW** (its CSS-first `@theme`
  IS our token layer; cheapest at the foundation, greenfield). Keep **react-router v7** (just shipped —
  no TanStack Router). **TanStack Query** comes LATER, scoped to the share/follow READ surfaces only
  (DEC-11) — never the garage (TinyBase owns that local+sync state). NOTE Base UI is WEB-ONLY; a future
  native app gets its own primitives (see DEC-17).
- **DEC-16 — Mileage is a TIME SERIES, not a static field** (owner/friend insight). Replace the single
  `mileage` field with dated **mileage check-ins** ({ value, date — default today }); the car's current
  odometer = the latest check-in. Removes mileage from the edit modal (it isn't a fixed attribute) — it
  becomes a quick "log mileage" action. Unlocks a **mileage-over-time** view AND real mileage-based
  maintenance-due: pairs with maintenance.mileage (at-service) + nextDueMileage to compute "due/overdue
  by mileage" and surface it (finding U2). Maintenance entries feed the same timeline. Migration: the
  existing single mileage value becomes the first check-in; per-unit handling follows the existing
  distanceUnit/mileageRaw approach (DEC-1-style store-as-entered).
- **DEC-17 — Future React Native (Expo) app; design tokens are a platform-agnostic source of truth**
  (owner, 2026-06-18). A native mobile app is a goal. Web and RN share the LOGIC layer (packages/shared:
  types, TinyBase store+sync, helpers) and the design-TOKEN VALUES — NOT the UI layer (Base UI is
  web-only; RN gets its own primitives). So tokens live as a plain TS module in packages/shared that web
  feeds into Tailwind v4 `@theme` (GENERATED from the TS tokens via a small ~50-line codegen — no turnkey
  Style-Dictionary→`@theme` tool exists yet) and RN imports the SAME TS object directly (RN has no CSS-var
  runtime, so tokens must be plain JS values anyway). RESEARCH CONCLUSION (2026-06-18, cited): TW4-on-web
  is confirmed fine for a future RN app — the NativeWind/TW4 lag (stable NativeWind 4.x = Tailwind 3.4;
  TW4 only in NativeWind v5 PREVIEW, not production) only bites teams sharing one Tailwind config + the UI
  layer, which we explicitly don't. RN styling when we build it: **Unistyles 3** (recommended — dense/
  custom/dark fit, native JSI perf, consumes the TS token object directly; needs New Arch, now default in
  Expo SDK 55; single-maintainer caveat); **Uniwind** (stable 1.x, TW4, Expo-endorsed) as the alt for
  Tailwind class-name parity on native; skip NativeWind (v5 preview-only). The RN choice is DEFERRABLE
  with zero impact on the web stack.
- **DEC-18 — Proactive maintenance reminders + push notifications** (owner). Recurring maintenance
  SCHEDULES per car/type: time-interval (every N months / annually / seasonal), mileage-interval (every
  N km), or one-off. Compute next-due and surface in-app — the proactive version of finding U2. KEY
  SYNERGY with DEC-16: mileage-interval reminders are feasible by deriving a USAGE RATE from the mileage
  check-ins → predict the calendar date the threshold is crossed → schedule a time-based nudge, refined
  as new check-ins arrive ("based on your usage, X km ≈ Y date"). Seasonal/templated presets (motorcycle:
  winterize / run-in-winter / spring oil; car: oil every N months). DELIVERY: native push (Expo →
  APNs/FCM) is the real experience (reinforces DEC-17); web gets in-app due-surfacing + optional Web Push
  (weaker, esp. iOS Safari). INFRA fits the stack: a Cloudflare **Cron Trigger** on the Worker computes
  due reminders + sends pushes; needs stored schedules + synced device push tokens. Downstream of DEC-16
  + accounts/sync.
- **DEC-19 — License plate field on the car** (owner). Optional Car field. PRIVATE by default in shares
  (plates enable lookups/identification), but with an OWNER opt-in "show my plate" toggle — roughly the
  INVERSE of VIN (DEC-13): sellers typically HIDE plates on for-sale listings, while enthusiasts want to
  FLAUNT vanity/custom plates on a showcase. So plate exposure is OWNER-CHOICE (a toggle), not
  purpose-gated. Uses the same private-field snapshot-exposure mechanism as VIN/owner-name (DEC-13/10).

## Constrained (a real limit, design around it)

- **CON-1 — Share links are reveal-once.** The raw token is stored only as a sha256 hash and genuinely
  cannot be re-shown. The fix is a *copy-once UX done well* + per-link labels, **not** re-copyable
  storage. Do not propose reshowing the secret.

---

## Cross-cutting themes

1. **No shared semantic token layer.** A real but partial system exists — 6 CSS custom properties
   (`--accent`, `--accent-dim`, `--dark`, `--surface`, `--surface-2`, `--border`) wired correctly
   through Tailwind so opacity modifiers work. Everything *else* is ad-hoc utility strings: text color,
   status/semantic color, radius, elevation, icon size, type scale, and card density are each reinvented
   per component with small drifts. The fix is **consolidation on the existing var layer, not a rebuild.**

2. **AA contrast failures are systemic, not incidental.** The most-used control (primary button) fails
   on *every* theme; ~100 uses of `gray-500`/`gray-600` carry real content below the 4.5:1 floor; the
   one custom focus ring is 1.97:1; placeholders are 2.05:1; the user-selectable accent has no floor at
   all. Contrast is being chosen per-value instead of floored at the token.

3. **The functional-orange contract is broken in both directions.** Brand accent *leaks* onto passive
   data (every price, nickname, view-count), AND Tailwind-orange is used for unrelated *status*
   (totaled, unverified, sync-offline). Orange no longer reliably means "action / current state /
   alert" — the exact signal the brand is built on.

4. **Interactive elements are built as non-semantic `div`s and are missing their interaction states.**
   Primary navigation (CarCard) and photo actions are `<div onClick>` with no keyboard path; no custom
   button/tab has a focus-visible style; modals don't trap/restore focus or declare dialog semantics;
   actions hide behind hover-only overlays. Keyboard and assistive-tech users are blocked from core tasks.

5. **One concept, many dialects.** "Add an item" has 4 implementations, "advance status" has 5,
   "dismiss a modal" has 7, money is formatted 2 ways, dates 3 ways. Each divergent copy is usually the
   *less* accessible one, and the user pays a relearning tax on every tab/modal switch — in a tool whose
   first principle is "the tool disappears into the task."

6. **The core loop is broken and the core signal is hidden.** The "open mid-build, log in <10s" loop
   takes ~8 steps across 3 screens (add doesn't navigate to the car, the default tab is the slowest and
   empty, no field auto-focuses), and *overdue maintenance* — the one time-critical fact a maintenance
   tracker exists to raise — is never surfaced outside its own tab.

---

## TOP 10 highest-impact fixes

1. **Dark-on-orange accent-fill label (DEC-2), tokenized once.** Add an `--on-accent` token derived
   from accent luminance and apply it to `.btn-primary`, the tab count badge, the photo Cover badge, and
   the Settings live-preview. Fixes the app's most-used control on every theme in one rule. *(A1 — Critical)*
2. **Make CarCard and photo tiles real focusable controls.** `<a>`/`<button>` with the existing dense
   visuals; restores the only keyboard path *into* the app and the only touch/keyboard path to set-cover
   and delete. The correct `<button>` pattern already ships in `ShareCarView`. *(A2 + A3 — Critical)*
3. **Semantic text-color ramp with an AA floor.** Promote `gray-600`/`gray-500` body content to
   `gray-400` (6.86:1); reserve the darker grays for disabled/decorative only. One token migration clears
   ~100 AA failures and keeps the muted dense look. *(V1 — Critical)*
4. **Give every control an accessible name.** Associate every `.label` with its input via `htmlFor`/`id`
   (or wrap), and add `aria-label` to every icon-only button. Today most fields and the destructive row
   actions announce as unnamed. *(A4 + A5 — Critical)*
5. **One shared `<Modal>` wrapper.** Esc-always dismiss + focus trap + initial focus + focus-restore +
   `role="dialog"`/`aria-modal`/`aria-labelledby` + a shared focus-visible ring. Collapses the 7-way
   dismiss chaos and the missing focus management into a single fix. *(A7 + A8 + A9 — High)*
6. **Route all money through `formatMoney()` with each row's own currency tag (DEC-1).** Kills the
   `{sym}{toFixed(2)}` pattern (which invents cents for JPY), the symbol-relabeling bug, the
   mixed-currency totals, and the markdown export's hardcoded `$`. The helper already ships on the public
   page. *(M1 — High)*
7. **Surface overdue maintenance on the CarCard and CarHero.** A red "N due" chip beside the
   open-issues chip, computed once via a shared `getDueMaintenance(car)`. This is the product's reason to
   exist. *(U2 — High)*
8. **Fix the add→land→log loop.** `addCar` returns the new id → `navigate('/car/:id')`; default the
   profile to **Mods**; auto-focus the first add-form field. Turns ~8 steps into "add → land on Mods →
   type." *(U1 — High)*
9. **Reclaim orange.** Prices → `--text-primary` (weight, not hue); nicknames → italic
   `--text-secondary`; move status-orange (totaled/unverified/sync-offline) onto named status tokens.
   Build the `--status-*` token set so the five ad-hoc maps converge. *(V3 + V4 + V5 — High)*
10. **Drop soft-shadow elevation; gate accents behind a contrast floor.** Elevate via the surface ramp +
    border (one `--elevation` token instead of `shadow-2xl` ×16); run every built-in theme and the
    custom accent through the `--on-accent` AA rule so no preset ships an illegible button. *(V2 + A6 — High)*

---

## Master findings

Grouped by area; within each, ordered by severity. Each item: **severity · tag · location · fix**.

### Area 1 — Design tokens & visual system

**V1 · Critical · `[a11y]` — Sub-AA text-color ramp used for real content (flagged ×3: Visual ×2, A11y; prior H2).**
`text-gray-500 #6b7280` = 3.60:1 on `--surface`, 3.21:1 on `--surface-2`; `text-gray-600 #4b5563` =
2.30:1 — both below the 4.5:1 body floor, used ~55× and ~47× respectively for *content*, not
decoration: mod date/shop (`ModsTab.tsx:310`), maintenance "Next:" (`MaintenanceTab.tsx:181`), issue
date + status word (`IssuesTab.tsx:159,162`), todo "Completed" (`TodoTab.tsx:83`), card stats
(`CarCard.tsx:101,122,134`), settings helper copy, and it has already propagated into the public share
viewers (`ShareCarViewFull.tsx:114,177,304`). **Fix:** define a semantic ramp —
`--text-primary` (#e5e5e5, 11.8:1), `--text-secondary` (gray-400 #9ca3af, 6.86:1),
`--text-tertiary` (gray-500, large/non-body only); migrate body content up one step; reserve gray-600
strictly for disabled/placeholder.

**V2 · High · `[inconsistent]` — Soft-shadow elevation is the named brand anti-reference (flagged ×2: Visual, Components).**
`.card:hover` raises `box-shadow: 0 24px 40px -8px rgb(0 0 0/.45)` (`index.css:39`) and 16 overlays use
`shadow-2xl` (every modal + `SettingsPanel.tsx:27`, `Garage.tsx:158`, `ConfirmModal.tsx:18`,
`ShareDialog.tsx:122`). PRODUCT.md explicitly lists "soft shadows everywhere" as anti-reference. The
hover-lift is also reused by static list rows (`ModsTab.tsx:303`, `MaintenanceTab.tsx:167`,
`WishlistTab.tsx:239`, `TodoTab.tsx:70`, `IssuesTab.tsx:151`), implying they're clickable when only
their inner buttons are. **Fix:** elevate via the surface ramp + `--border`; cards lift on hover via
`border-color → accent/30` (already present) — drop the box-shadow. For modals, a thin `--border` ring +
darker backdrop + at most `0 8px 24px -12px`. Define one `--elevation` token. Reserve any lift for
genuinely clickable cards; static rows use a flat `hover:bg-surface-2`.

**V3 · High · `[inconsistent]` — No semantic status-color tokens; 5 ad-hoc maps + 6-file badge drift (flagged ×2: Visual, Components).**
Independent color maps in `carStatus.ts:8-14`, `WishlistTab.tsx:11-15`, `IssuesTab.tsx:9-19`,
`TodoTab.tsx:8-12`, plus inline badges, each hand-roll `bg-{c}-900/{op} text-{c}-300 border-{c}-700/{op}`.
Opacities drift (red appears at /40, /50, /60, /80; borders /40–/70) and neutral gray text drifts
gray-300 vs gray-400. Red is overloaded: Sold = Critical = Open = Revoked = error, so a sold car alarms
like a critical fault. **Fix:** define `--status-danger / -warning / -success / -info / -neutral`, each a
fixed bg/text/border triple chosen once at AA (the `-300` text colors already pass: green-300 9.9:1,
red-300 9.2:1, yellow-300 13.2:1, blue-300 9.7:1). Re-map **Sold** off danger onto neutral. This is also
where the `.badge` primitive's variants live.

**V4 · High · `[inconsistent]` — Two oranges collide (Visual).**
`--accent` is orange `#f97316`, and the app *also* uses Tailwind-orange for status: Totaled
(`carStatus.ts:13`), pending-todos hero badge (`CarProfile.tsx:172`), Unverified
(`AccountSection.tsx:89`), sync-offline dot (`AccountSection.tsx:19`). Two near-identical oranges with
different meanings co-exist, so orange stops reading as "the functional accent." The same pending-todos
concept is Tailwind-orange in the hero but accent in the tab count (`CarProfile.tsx:199`) — inconsistent
with itself. **Fix:** orange = accent only. Totaled → `--status-neutral`; Unverified/sync-offline →
`--status-warning` (amber, distinct from accent); pending-todos badge → accent token in both places.
Resolving V3 largely does this.

**V5 · High · `[judgment]` — Accent leaks onto passive data (flagged ×2: Visual, Content; prior H6/G3).**
Every price is `text-accent font-semibold` (`ModsTab.tsx:307`, `MaintenanceTab.tsx:171`,
`WishlistTab.tsx:249`, `ShareCarViewFull.tsx:110,162,216`); every nickname is accent (`CarCard.tsx:106`,
`CarProfile.tsx:153`, `MarkAsSoldModal.tsx:37`, `ShareCarViewFull.tsx:376`); also the pending-todo count
(`CarCard.tsx:128`) and share view-count (`ShareDialog.tsx:263`). A price is passive data; a nickname is
identity — neither is action/state/alert. With orange spent on dozens of passive values per screen, the
genuine signals (Add button, active tab, overdue alert) no longer stand out. **Fix:** prices →
`--text-primary` with `font-semibold` (weight, not hue, carries "this number matters" in a dense table);
nicknames → italic `--text-secondary`; view-count → neutral gray. Find-and-replace on those sites.

**V6 · Medium · `[inconsistent]` — Surface ramp duplicated across 4 sources (Visual).**
The same dark/surface/surface-2/border values live in `:root` (`index.css:5-12`), the `garage` theme
(`themes.ts:24-29`), the custom-accent path re-hardcoded as raw channels (`themes.ts:181-186`), the
scrollbar rules as literal hex (`index.css:141-143`), and the `#f97316` fallback twice in
`SettingsPanel.tsx:127,143`. Any ramp tweak must be made in all of them. **Fix:** single source of
truth — derive the garage theme + custom fallback from one constant, reference `var(--surface)`/
`var(--border)` in the scrollbar rules, replace the `#f97316` fallbacks with the default theme constant.

**V7 · Medium · `[inconsistent]` — Radius scale is ad-hoc (Visual).**
`rounded` (4), `rounded-lg` (8, ×16), `rounded-xl` (12, cards), `rounded-2xl` (16, modals),
`rounded-full` all in play with no rule — cards are xl but modals are 2xl, and "badge" is sometimes
`rounded`, sometimes `rounded-full`. **Fix:** `--r-sm` (4) chips/inner, `--r-md` (8) buttons/inputs,
`--r-lg` (12) cards, `--r-xl` (16) modals, `--r-pill` (full) count badges; one radius per component type.

**V8 · Medium · `[inconsistent]` — Two parallel chip systems, mismatched padding (Visual).**
A `.badge` primitive (`index.css:80`, `px-2 py-0.5`) AND hand-rolled `border border-border rounded
px-N py-0.5` chips that disagree on padding: `px-2` (`CarCard.tsx:110`) vs `px-1.5`
(`WishlistTab.tsx:243`, `ShareCarViewFull.tsx:207`). **Fix:** make `.badge` the single chip primitive
with `solid-status` / `outline-meta` variants at one fixed padding.

**V9 · Medium · `[inconsistent]` — Icon-size sprawl: 15 sizes (Visual).**
lucide icons appear at 10/11/12/13/14/15/16/18/20/24/28/32/36/40/64, drifting within identical roles —
Wishlist row actions are `size=15` (`WishlistTab.tsx:289`) while every other tab's are `14`; inline meta
is sometimes 10, sometimes 11. **Fix:** icon-size scale bound to role — 12 inline meta, 14 row
actions/button glyphs, 18 modal/section, 24 upload, 36–64 empty-state art.

**V10 · Medium · `[inconsistent]` — Card density rhythm: 4 vertical paddings for one component (Visual).**
`.card` is `p-5` (20px) but real usages override to `py-3` (`TodoTab.tsx:70`), `py-2.5`
(`ShareDialog.tsx:241`), `p-4` (`CarCard.tsx:98`), `p-0`. **Fix:** make density a token, not an override —
`.card` (comfortable, p-5) for forms/standalone, `.card-row` (dense, px-4 py-3) for list rows; pick
deliberately per surface.

**V11 · Medium · `[suboptimal]` — No type scale (Visual).**
Almost entirely `text-xs` (116×) and `text-sm` (77×) — fine for density — but no defined ramp: `sm`
jumps to `lg` skipping `base`, headings cherry-pick lg/2xl/3xl per file (`CarHero.tsx:58` 3xl,
`Garage.tsx:132` 2xl), and there are no line-height/weight tokens. Heavy 12px reliance compounds the
sub-AA gray risk (small AND low-contrast). **Fix:** compact ramp with roles — `--text-meta` 12/16,
`--text-body` 14/20, `--text-subhead` 16/22 semibold, `--text-title` 20/24 bold, `--text-hero` 30/34
bold; pair size with the V1 color ramp so small text never lands on sub-AA gray.

**V12 · Low · `[inconsistent]` — Add-form highlight border inconsistent + accent-as-decoration (Visual).**
The "New X" inline form is `border-accent/30` in Mods/Maintenance/Wishlist/Share but `border-red-800/40`
in Issues (`IssuesTab.tsx:91`); standing accent on a form container is decoration. **Fix:** one neutral
"editing" treatment (a 1px brighter `--border` or a left accent rule) for all inline forms; drop the red
exception.

**V13 · Low · `[judgment]` — Theme picker ships the brand's own anti-reference (Visual).**
PRODUCT.md's #1 anti-reference is "generic SaaS dashboards (blue accent)"; the switcher offers exactly
that — "Midnight," blue accent on a blue surface (`themes.ts:42-52`) — plus five full-ramp recolors that
treat the load-bearing orange as a cosmetic preference (contra "dark is native, not a preference"). See
A6 for the contrast angle. **Fix:** decide the stance — if themes stay, vary *accent only* on one fixed
dark ramp (a curated warm/enthusiast set) and gate each through the `--on-accent` floor; reconsider
shipping the literal blue-SaaS look. If deliberate, document it as an explicit exception.

**V14 · Low · `[judgment]` — Always-on grain overlay at z-9999 (Visual).**
A full-screen fractal-noise texture (`index.css:128-138`, opacity 0.03) paints at the top z-index over
*everything* including modals and the accent focus rings. Defensible tactile touch, wrong layer.
**Fix:** drop it behind interactive chrome (low z-index / `pointer-events-none` under modals), allow
disable under reduced-motion/contrast, confirm it doesn't reduce effective text contrast.

**V15 · Low · `[judgment]` — font-mono "data" treatment applied unevenly (Visual).**
Mono is a nice instrument-cluster signal for numbers/ids but inconsistent: the card shows year + mileage
in mono (`CarCard.tsx:101,134`) while the hero shows the same fields in sans (`CarProfile.tsx:145,150`).
**Fix:** decide which data classes get mono (years, mileages, prices, ids) and apply via a `.numeric`
utility everywhere — or nowhere.

### Area 2 — Accessibility (contrast, keyboard, semantics)

**A1 · Critical · `[a11y]` — Primary accent-fill label fails AA on ALL themes + 4 components (flagged ×4: Visual, Components, A11y; prior H1). DEC-2.**
`.btn-primary` is `bg-accent text-white` (`index.css:44-45`). White-on-accent: garage 2.80:1, racing
3.76:1, midnight 2.14:1, emerald 2.54:1, violet 3.96:1, ghost 1.23:1 — *none* reaches 4.5:1, and the
hover fill `#ea580c` is 3.56:1. The same white-on-accent recurs in the tab unread-count badge
(`CarProfile.tsx:199`), the photo Cover badge (`PhotosTab.tsx:87`), and the Settings live-preview
(`SettingsPanel.tsx:150`). **Fix (DEC-2):** add an `--on-accent` token = near-black when the accent is
light/mid, white only when the accent is dark enough to clear 4.5:1. Apply to `.btn-primary` + all three
badges. Verified dark-on-accent: garage 6.84:1, racing 5.09:1, midnight 8.95:1, emerald 7.56:1, violet
4.84:1, ghost 15.55:1. Note: mid-luminance accents (violet, racing) clear 4.5:1 only just — add an
`--accent-strong` (~15–20% darker fill) behind the label for those. Keep bright `--accent` for
borders/icons/active-tab/text-on-dark (those already pass).

**A2 · Critical · `[broken]` — CarCard is a non-focusable `<div onClick>`; no keyboard path into the app (flagged ×3: Components, UX, A11y).**
`CarCard.tsx:27-29` navigates from a `<div>` with no role/tabindex/key handler. Cars are the only way
into a build from the home screen, so keyboard/AT users cannot enter the app past the grid (WCAG 2.1.1,
4.1.2). The hover affordance (title → accent) has no focus equivalent. **Fix:** render the card root as
`<a href="#/car/:id">` (HashRouter-compatible) or `<button>`, keeping the dense visuals; add the shared
focus-visible ring (A7); keep `onClick` for mouse so Enter/Space work for free.

**A3 · Critical · `[broken]` — Photo tiles + cover/delete are hover-only & non-focusable (flagged ×2: Components, A11y; prior D1).**
Each tile is `<div onClick={setLightbox}>` and the Set-cover/Delete buttons live in an
`opacity-0 group-hover:opacity-100` overlay (`PhotosTab.tsx:82-103`). Keyboard users can't open the
lightbox or reach cover/delete; touch users (no hover) can't set a cover or delete at all (WCAG 2.1.1,
1.4.13). `ShareCarView.tsx:50` already renders tiles as real `<button>`s — the owner view regressed from
it. **Fix:** mirror ShareCarView — tile = `<button aria-label={caption||'Open photo'}>`; render Star/
Trash as always-visible dense corner buttons (≥24px, `aria-label`ed); expose "Set as cover" in the
lightbox too.

**A4 · Critical · `[broken]` — Form inputs are not programmatically associated with their labels (A11y).**
`.label` (`index.css:79`) is a styled `<label>` used as a *sibling* with no `htmlFor`/`id` and not
wrapping the field, e.g. `AddCarModal.tsx:62`. Every input/select/textarea therefore has an empty
accessible name across AddCar/EditCar/MarkAsSold, all five tabs' add+edit forms, Log-to-Maintenance, and
Move-to-Mods — a screen reader announces "edit text" with no field name (WCAG 1.3.1, 4.1.2). The auth
forms do it correctly (htmlFor/id). **Fix:** give every control an `id` and point the label via
`htmlFor` (or wrap), ideally inside shared field components (Maintenance already centralizes
`FormFields`; extract the same for Mods and the car modals).

**A5 · Critical · `[broken]` — Icon-only buttons: no accessible name + sub-24px target + 3 divergent treatments (flagged ×2: A11y, Components; prior H4).**
*No name:* hero Delete (`CarProfile.tsx:122-124`), every row edit/delete (`ModsTab.tsx:329-330`,
`MaintenanceTab.tsx:190-191`, `IssuesTab.tsx:165-166`, `WishlistTab.tsx:288-290`, `TodoTab.tsx:75,90`),
modal close X in AddCar/EditCar/MarkAsSold/LogToMaintenance/MoveToMods, and the Garage header
Download/Upload/Settings (which expose only `title` — unreliable for AT, invisible on touch). *Target:*
`.btn-ghost` is `px-2 py-1` around a 14px icon ≈ 30×22px, under the 24px WCAG 2.2 SC 2.5.8 floor, and
row clusters sit `gap-1` (4px) so the spacing exception doesn't apply. *Treatment:* the same "icon
button" is built three ways — `.btn-ghost`, `.btn-outline` icon-only (Garage header, hero), and bespoke
`rounded-full p-1.5` (photo tiles, ~24px). **Fix:** one `.btn-icon` (square, ≥40–44px hit area via
padding, ghost fill, accent on hover, shared focus ring, **required** `aria-label`); reserve
`.btn-outline` for labeled buttons. `ShareDialog` is the correct `aria-label` reference.

**A6 · High · `[a11y]` — Custom accent and all themes have no contrast floor (flagged ×2: Visual[critical], A11y; prior E2).**
The color input writes any hex straight to `--accent` (`SettingsPanel.tsx:139-145` → `themes.ts:172`)
with no validation, and `.btn-primary` is fixed `text-white`. A light pick → ~1.2:1 (invisible button);
a dark pick → `text-accent`/active-tab vanish on dark. The custom path also re-hardcodes the surface ramp
(see V6). **Fix:** reuse the `--on-accent` luminance rule for the label; enforce a minimum accent
luminance so accent-as-text on `#1a1a1a` stays ≥4.5:1; when neither label color clears 4.5:1, auto-deepen
the fill OR show an inline "low contrast on dark" warning (text + icon, not color alone) in the existing
preview block (`SettingsPanel.tsx:147-160`). Apply the same derivation to the built-in themes.

**A7 · High · `[a11y]` — No focus-visible style on custom controls; the one input ring is 1.97:1 (flagged ×3: Visual, Components, A11y; prior H5).**
Only `.input` (`index.css:75`) and DateInput define a focus ring; `.btn-primary/.btn-outline/.btn-ghost/
.btn-danger/.tab-btn` rely on the faint UA outline on `#0f0f0f`. And the input ring itself —
`ring-1 ring-accent/40` over `--surface-2` — computes to 1.97:1 (border 2.83:1), below the 3:1
focus-indicator floor (WCAG 2.4.7, 1.4.11). DateInput signals the focused segment by `focus:text-accent`
color alone (`DateInput.tsx:87`). **Fix:** a shared `focus-visible` ring at solid ≥3:1 —
`ring-2 ring-[--accent]` full opacity (garage on surface-2 ≈ 5.4:1) + `ring-offset-2 ring-offset-surface`
— baked into every button/tab base class and the input; add a non-color cue (underline/bg) to the date
segment.

**A8 · High · `[a11y]` — Modals don't trap/restore focus and lack dialog semantics (flagged ×2: Components, A11y; prior H3/E4).**
No overlay except ShareDialog sets `role="dialog"`/`aria-modal`/`aria-labelledby`, traps Tab, or restores
focus to the trigger — Tab walks into the page behind. Affected: AddCar/EditCar/MarkAsSold, ConfirmModal,
Garage import-confirm, LogToMaintenance, MoveToMods, SignIn/SignUp/Forgot, SyncMergeModal, SettingsPanel,
both lightboxes. Initial focus is also uneven (auth modals `autoFocus`; the rest none). ConfirmModal
(`ConfirmModal.tsx:16-31`) sets no focus and leaves the destructive Delete equal-weight. **Fix:** the
shared `<Modal>` (Top-10 #5) — `role="dialog"` + labelled title + focus trap + initial focus (first
field / **Cancel** for destructive confirms) + focus-restore. SyncMergeModal stays non-dismissible but
still traps and is labelled.

**A9 · High · `[a11y]` / `[inconsistent]` — Seven modal-dismiss contracts; keyboard users get stuck (flagged ×3: Components[critical], UX, A11y; prior F1/E4).**
Dismiss behavior: (A) Esc+backdrop via `useModalDismiss` — ConfirmModal/AddCar/EditCar/MarkAsSold; (B)
Esc only — ShareDialog; (C) backdrop only, no Esc — SettingsPanel; (D) neither, X/Cancel only — SignIn/
SignUp/Forgot/LogToMaintenance/MoveToMods/Garage import-confirm; (E) backdrop-via-bubbling with a dead X
and no Esc — both lightboxes; (F) intentionally none — SyncMergeModal. A keyboard user hitting Esc in
sign-in or log-to-maintenance is stuck. **Fix:** route every overlay through the shared `<Modal>` /
`useModalDismiss` (Esc always; backdrop where misclick-cancel is safe). Keep SyncMergeModal as the single
*documented* non-dismissible exception.

**A10 · High · `[a11y]` — DateInput diverges from `.input` and is under-labeled (flagged ×2: Components, A11y; prior C8/H4).**
Re-implements the `.input` look but only changes border on `focus-within`, lacking the input's ring, so
two fields in one row focus differently; the focused segment is signaled by color alone; the three
segments (`DateInput.tsx:91-127`) are bare textboxes with no `aria-label` and no group name. Used in
every car/mod/maintenance/expiry form. **Fix:** reuse the `.input` focus ring on `focus-within`; add a
non-color focus cue; `aria-label` each segment (Day/Month/Year); wrap in `role="group"` named via
`aria-labelledby` to the field label; order segments by locale (see M3).

**A11 · High · `[a11y]` — TodoTab checkbox is 16px with an unassociated label (A11y).**
A bare 16px `<input type="checkbox">` with task text in a separate `<span>` (`TodoTab.tsx:71-73`, repeated
at the completed list line 87) — fails the 24px target (SC 2.5.8), the text isn't a tap target, and the
checkbox has no accessible name (4.1.2). `MoveToModsModal.tsx:120` does it right (checkbox inside
`<label>`). **Fix:** wrap checkbox + text in a `<label>` so the whole row toggles and the text names the
control; give the label ≥24px padding.

**A12 · High · `[a11y]` — No live regions for async/sync feedback (flagged ×2: A11y, Content).**
The import-error toast (`Garage.tsx:112`) is a plain `<div>` — silent to screen readers; ShareDialog's
createError/loadError, "Link created" card, and Copy→"Copied" are unannounced; the AccountSection sync
state isn't announced. Auth forms correctly use `role="alert"`. **Fix:** `role="alert"` (assertive) on
errors, `aria-live="polite"` on success/"Copied," via a shared status-region; visual treatment unchanged.

**A13 · Medium · `[a11y]` — Placeholder text is 2.05:1 when it's the only hint (A11y).**
`.input` sets `placeholder-gray-600` = 2.05:1 on surface-2 (`index.css:75`), and several fields rely on
the placeholder as the only format hint (Link `https://…`, price `25000`, mileage, todo text). **Fix:**
raise to gray-400 (6.1:1 on surface-2) *or* move format hints into persistent helper text / the
now-associated label so the placeholder is non-essential.

**A14 · Medium · `[a11y]` — Missing landmarks + tab/select groups lack semantics (flagged ×3: A11y, Components, UX).**
CarProfile, ShareCarView, ShareCarViewFull wrap content in `<div>` with no `<main>`/`<nav>` (Garage does
use them). The tab bars (`CarProfile.tsx:185`, `ShareCarView.tsx:220`, `ShareCarViewFull.tsx:385`) are
`<button>` groups with no `role="tablist/tab/tabpanel"`, `aria-selected`, or arrow-key roving; the Issues
Open/Resolved filter (`IssuesTab.tsx:86`) and the Settings currency/distance/theme selectors are
single-select groups that should be radiogroups (as ShareDialog's scope already is). **Fix:** add
`<main>`; convert tab strips to tablist/tab/tabpanel with `aria-selected` + roving arrow keys; make the
Settings selectors radiogroups (reuse ShareDialog's `aria-checked`, add the arrow-key roving ShareDialog
itself still lacks — prior G4).

**A15 · Medium · `[broken]` — Lightbox close button is non-functional and Esc-less in both copies (flagged ×2: Components, A11y; prior D2).**
The owner lightbox X has no `onClick`/`aria-label` and only "works" via backdrop bubbling
(`PhotosTab.tsx:124-129`); Esc doesn't close it. `ShareCarView.tsx:70-71` added `aria-label` but still no
`onClick`/Esc — so even the newer copy is half-fixed and the two now differ. **Fix:** one shared
`<Lightbox>` — explicit `onClick`, `aria-label="Close"`, Esc via `useModalDismiss`, focus trap + restore
to the originating tile.

**A16 · Low · `[a11y]` — Decorative cover uses a meaningful alt; captionless tiles get empty alt in non-focusable divs (A11y).**
`CarHero.tsx:44` renders `<img alt="cover">` for a purely decorative image (should be `alt=""`); in
PhotosTab captionless photos get `alt=""` inside a non-focusable div, so those tiles are invisible to AT.
**Fix:** `alt=""` on the hero cover; once tiles are `<button>`s (A3), name the button (caption or
"Photo N").

**A17 · Low · `[a11y]` — Smooth scrolling isn't disabled under reduced-motion (A11y).**
`html { scroll-behavior: smooth }` (`index.css:16`); the reduced-motion block (`:149`) only neutralizes
animation/transition durations. **Fix:** add `html { scroll-behavior: auto; }` inside that media block.

**A18 · Low · `[suboptimal]` — Document title is static across every route (A11y).**
`index.html:8` hardcodes "Chudbox — My Garage," never updating for car/share/auth views. **Fix:** set
`document.title` per route (e.g. `${year} ${make} ${model} — Chudbox`).

### Area 3 — Components & controls consistency

**CC1 · High · `[inconsistent]` — Garage import-confirm is a hand-rolled, less-accessible ConfirmModal duplicate (Components).**
Restoring a backup (destructive, irreversible) is rebuilt inline (`Garage.tsx:156-183`) instead of using
`ConfirmModal` — and the rebuilt copy has no Esc/backdrop/X and signals danger with a yellow AlertTriangle
while ConfirmModal uses red. The more dangerous action is the *less* dismissible. **Fix:** replace with
`<ConfirmModal title="Restore backup?" confirmLabel="Restore">`; if the yellow distinction is wanted, add
an optional `tone` prop rather than forking.

**CC2 · High · `[inconsistent]` — Single-select controls built 5 ways (flagged ×3: Components, A11y, UX).**
Currency/distance/theme (`SettingsPanel.tsx:46-101`), share scope (`ShareDialog.tsx:142-177`), sync-merge
(`SyncMergeModal.tsx:60-64`) all converge on "selected = `bg-accent/10` + accent border + accent text" but
border opacity drifts (/50, /60, full) and only ShareDialog has radiogroup ARIA. The Issues filter reuses
`.tab-btn`, borrowing the nav-tab affordance for a filter. **Fix:** extract a `Segmented` control — one
accent-selected token + built-in `role="radiogroup"` + roving arrow keys — for currency/distance/theme/
scope/sync-merge; give the Issues filter its own filter-chip styling distinct from nav tabs (see U10).

**CC3 · High · `[inconsistent]` — Required/optional marking redundant + no themed validation feedback (Components).**
Forms use a gray `*` on required labels AND an `(optional)` tag on some optional fields (the `(optional)`
marker is `text-gray-600`, 2.3:1 — AA fail), with no asterisk legend. Validation is uneven: auth modals
show a themed red box with `role="alert"` + `aria-invalid`, but car/mod/maintenance/wishlist/issue forms
fall back to native browser bubbles (light-themed, clash) or silent `return`, and `aria-invalid` appears
in only two forms. **Fix:** mark required fields only (accent `*` + one "Required" legend), drop
`(optional)`; lift any remaining marker to gray-400; provide a shared inline field-error pattern (the auth
red box) for data forms; apply `aria-invalid` consistently.

**CC4 · Medium · `[inconsistent]` — Money input built two ways (flagged ×2: Components, Content). DEC-1.**
Car prices use an in-field `$` glyph prefix (`pl-7`, `AddCarModal.tsx:106,117`; `MarkAsSoldModal.tsx:48`)
while mod/maintenance/wishlist costs put the symbol in the label as `Cost ({sym})`. Plus the hardcoded-`$`
bug (DEC-1) means a EUR user sees `€` everywhere except car prices. **Fix:** one `MoneyInput` component
taking the active `sym` — recommend the in-field prefix glyph (keeps the amount self-describing) — driven
by `CURRENCIES[currency].symbol` everywhere; render with `formatMoney()` (M1).

**CC5 · Low · `[inconsistent]` — Inline-edit Cancel diverges from add-form Cancel (Components).**
Within a tab, the add Cancel is `btn-outline` (no icon) but the edit Cancel is `btn-ghost` + `<X>`, and
edit Save adds a `<Check>` the add submit lacks (`ModsTab.tsx:258` vs `:298`; same in Maintenance/Issues).
The ghost Cancel is also gray-500 (3.6:1). **Fix:** one shared `FormActions` row — `btn-outline` Cancel +
`btn-primary` Save — used identically by add and edit.

**CC6 · Low · `[inconsistent]` — Modal shell micro-divergences (Components).**
Titles mix `<h2 text-lg>` / `<h2 text-base>` / `<h2 font-semibold>` / `<h3 font-semibold>` — both a visual
and a heading-order issue; close X is 16 in some headers, 18 in others; modal radius is `rounded-2xl`
while inner cards are `rounded-xl`. **Fix:** one modal-header pattern (one heading level+size, one X size
with `aria-label="Close"`) via the shared `<Modal>`; normalizes radius too.

**CC7 · Low · `[inconsistent]` — Disabled primary button has no disabled styling (Components).**
Auth submits use `disabled:opacity-60`, but ShareDialog's "Create link" is `disabled={creating}` with no
disabled class — it looks enabled while creating (`ShareDialog.tsx:191`). `.btn-primary` defines no base
`:disabled`. **Fix:** add a base `:disabled` rule (reduced opacity + `cursor-not-allowed`, hover/active
suppressed) to `.btn-primary/.btn-outline/.btn-danger`.

**CC8 · Low · `[inconsistent]` — Hover/press feedback fires inconsistently on touch (Components).**
`.btn-primary/.btn-outline/.btn-danger/.card` hovers are gated by `@media (hover:hover)`, but
`.btn-ghost:hover` and `.tab-inactive` hover utilities are NOT — so ghost buttons and tabs show sticky
hover on touch. `.btn-ghost` also has no `:active` scale. **Fix:** gate every interactive class; add the
shared `:active` press to `.btn-ghost`.

**CC9 · Low · `[suboptimal]` — Control label casing mixes Title and Sentence case (Components).**
Tab/grid actions are Title Case ("Add Mod," "Log Service," "Add Car") while modal/auth actions are
Sentence case ("Save changes," "Create link," "Sign in"); a modal title is "Add car" while its trigger is
"Add Car." **Fix:** one casing rule for all interactive labels — sentence case fits the understated tone
and dominates the modals already — and align trigger labels with destination titles. (Pairs with M8.)

### Area 4 — UX flows & information architecture

**U1 · High · `[broken]` — The add→land→log loop is broken end-to-end (flagged ×2: UX, prior B1/B2).**
`addCar(form); onClose()` (`AddCarModal.tsx:44-49`) drops the user back on the *grid*, not the new car;
CarProfile then opens on `useState('photos')` (`CarProfile.tsx:54`) — the slowest tab, empty on a new car,
so the first thing shown is a dropzone, not a log; and opening any add-form leaves focus on the trigger
(`ModsTab.tsx:222`). ~8 interactions across 3 screens for a <10s task. **Fix, together:** (1) `addCar`
returns the new id (it already mints one via `newId()`) → `navigate('/car/'+id)` on create; (2) default
CarProfile to **Mods** (and reorder log-first: Mods → Maintenance → Issues → To-Do → Wishlist → Photos);
(3) auto-focus + select the first add-form field. The auth modals already auto-focus — reuse the pattern.

**U2 · High · `[suboptimal]` — Overdue maintenance is never surfaced outside its tab (UX, net-new — strongest IA miss).**
`isOverdue` is computed only inside MaintenanceTab and shown only there (`MaintenanceTab.tsx:126`). The
CarHero badge cluster surfaces open issues + pending todos but not overdue service (`CarProfile.tsx:163-178`);
the CarCard surfaces mods/todos/open-issues but never a due signal (`CarCard.tsx:122-138`). The single
most decision-driving fact in a maintenance app is invisible until you open the right tab on the right
car. **Fix:** a shared `getDueMaintenance(car)` (mirroring `getCarStatus`); add a red "N due" chip to the
CarCard beside open-issues and an overdue badge to the CarHero cluster. This is the brand's red/orange
alert role, not decoration.

**U3 · High · `[suboptimal]` — Back-to-garage and car identity scroll away; the sticky bar carries neither (UX).**
The "Garage" back button and the car title live in the non-sticky `h-56` hero
(`CarProfile.tsx:88-96`); the only sticky element is the tab bar (`:182`), which shows no back affordance
and no car name. Deep in a long list the user loses both "which car" and "how to get out." **Fix:** put a
compact back-chevron + truncated year/make/model into the sticky tab bar, appearing once the hero scrolls
under it. Reuse the existing ArrowLeft + tab-bar container.

**U4 · High · `[inconsistent]` — Three+ "add an item" interaction models (flagged ×2: UX, prior C1).**
(a) toggled inline form — Mods/Maintenance/Wishlist/Issues; (b) always-on inline form — To-Do; (c)
always-on preview→caption→save card — Photos; (d) modal — cross-flows + car-level forms. The
toggle-vs-always-on split (To-Do behaves unlike its four siblings) is the jarring one. **Fix:** converge
on the toggled inline form everywhere (matches the dense in-context brand); To-Do's "New Task" becomes an
"Add task" button revealing the same single-row form. Keep two *documented* exceptions: Photos' always-on
dropzone and the cross-flow modals (they transform one record into another).

**U5 · High · `[inconsistent]` / `[a11y]` — Five "advance status" models + 2 silent-mutation traps + a color-alone violation (flagged ×3: UX, A11y, prior C6).**
To-Do = checkbox; Issues = one icon cycling open→in-progress→resolved→open; Wishlist = forward-only icons
*plus a gray check that reverts*; car status = a dropdown in Edit; Maintenance = computed overdue. Traps:
(1) clicking a resolved issue's check silently *reopens* it (`IssuesTab.tsx:64-68`); (2) Wishlist revert
jumps installed→wanted, skipping ordered. **Color-alone:** Wishlist uses the *same* `CheckCircle2` glyph —
green = "Mark installed," gray = "Move back to wanted" (`WishlistTab.tsx:277,283`) — distinguished by hue
only (WCAG 1.4.1). **Fix:** adopt Issues' single-affordance "click the state chip to advance" for
multi-state items; give every transition a *distinct* shape (cart→box→wrench forward; explicit
rotate-ccw "undo" for revert — never a second CheckCircle2); make reopen an explicit control, not the
advance gesture. Keep To-Do's checkbox as the documented binary case.

**U6 · High · `[broken]` — Wishlist "mark installed" couples a status change with a delete-by-default modal (UX, net-new).**
The ordered→installed check runs `markInstalled`, which sets status to installed AND pops the Move-to-Mods
modal whose "Remove from wishlist" checkbox defaults ON (`WishlistTab.tsx:170-173,119-128`). So the
default outcome of marking a part installed is that it *leaves* the wishlist; Cancel leaves it stranded in
a half-vestigial "installed" state, and there's no plain "just mark installed" path. **Fix:** decouple —
marking installed only changes status; offer "Move to Mods" as the separate existing row action (`:261`).
If an auto-prompt stays, default "Remove from wishlist" OFF and make the destructive variant the
deliberate choice.

**U7 · High · `[suboptimal]` — Share manage-list is a write-once-secret UI, not a re-shareable-artifact UI (flagged ×2: UX, Content; prior G1/G2). CON-1.**
The full URL shows once ("won't be shown again"), then each existing-link row shows only the opaque
`link.id` hash with no URL and no copy (`ShareDialog.tsx:196-285`). A share link exists to be re-shared.
The token genuinely can't be reshown (CON-1) — which argues for a *copy-once UX done well*, not a dead-end
list. **Fix:** keep the freshly-created card pinned and dominant until the user explicitly copies or
dismisses; auto-select the URL; require an "I've copied this" acknowledgement before it collapses. In the
manage list, say per row "Link copied at create — not recoverable; revoke & recreate for a new one"
instead of a bare hash, and let the owner attach an optional nickname ("Forum thread," "Buyer — Mike") as
the row title with the id demoted to mono caption (see M14).

**U8 · Medium · `[suboptimal]` — "Add X" toggle gives no open-state feedback + two non-obvious dismissals (UX, prior C2).**
`setShowForm(v => !v)` (`ModsTab.tsx:219`, etc.) means re-clicking the header button silently closes the
form, but the button never changes label/state; combined with the form's own Cancel there are two
invisible dismissals. **Fix:** when open, swap the header button to a clearly-secondary "Cancel" (or a
pressed state) so the toggle is legible and there's one obvious dismiss.

**U9 · Medium · `[inconsistent]` — To-Do (and Wishlist) can't be edited; the only list tabs missing edit (flagged ×2: UX, Components).**
Mods/Maintenance/Issues expose inline edit; To-Do offers only toggle-done + delete (`TodoTab.tsx:69-95`),
and Wishlist has only status-advance + delete (no way to correct a part's name/price/link/notes except
delete or move-to-mods). A typo forces delete-and-re-add. **Fix:** add the existing inline-edit pattern to
To-Do and Wishlist (at minimum Wishlist, which holds price/link/notes worth correcting).

**U10 · Medium · `[inconsistent]` — Issues Open/Resolved filter is rendered identically to the main tab bar (flagged ×2: UX, A11y).**
The in-tab filter uses the exact `.tab-btn`/`.tab-active`/`.tab-inactive` classes as the page-level tab
bar (`IssuesTab.tsx:85-88` vs `CarProfile.tsx:185-204`), so two IA levels look identical a few px apart —
"tabs inside tabs." **Fix:** render Open/Resolved as a small inset segmented control / pill toggle with
counts, distinct from page tabs; this also clarifies that resolving moves an issue between scopes (U11).

**U11 · Medium · `[suboptimal]` — Resolving/advancing an item makes it vanish with no feedback or undo (UX).**
With the Issues filter on "Open," cycling an issue to resolved makes the row blink out (it moved scopes)
with no toast/undo — reads as data loss (`IssuesTab.tsx:64-72`); Wishlist's move-to-mods default has the
same abrupt-vanish quality. **Fix:** briefly keep the row in place with a resolved treatment
(strikethrough + green check, already used) before it filters out, or show a 2–3s "Resolved · Undo"
affordance; at minimum show the existing "No open issues — all clear!" empty state when the last open
issue resolves, so the change reads as success.

**U12 · Medium · `[suboptimal]` — First-run empty state offers no "restore backup" path for returning users (UX, expands prior A1).**
The empty garage offers only "Add your first car" (`Garage.tsx:122-140`); a returning user on a new
device with a backup file finds restore only behind a bare Upload-arrow icon next to an equally bare
Download icon (`:88-103`). The most important first-run action for that user is hidden behind an
unlabeled glyph. **Fix:** on the empty state present two paths — primary "Add your first car," quiet
secondary "Restore from backup" text-button triggering the existing file input; in the populated state,
give Download/Upload `aria-label`s + text or a single "Backup" overflow.

**U13 · Low · `[judgment]` — Share is invisible/undiscoverable when signed out (UX).**
The Share button renders only when `signedIn` (`CarProfile.tsx:106-110`). Correct local-first intent, but
a logged-out enthusiast gets no hint sharing exists. **Fix (optional):** a quiet non-accent "Share"
affordance that, on click, explains "Sharing needs an account" and offers sign-in — de-emphasized so it
never nags. Leave as-is if zero account-surface is preferred.

**U14 · Low · `[suboptimal]` — Wishlist isn't grouped by status, unlike Mods by category (UX).**
Wishlist rows render in insertion order with Wanted/Ordered/Installed interleaved
(`WishlistTab.tsx:238-293`), while Mods groups by category. **Fix:** group by status (Wanted → Ordered →
Installed) with the same uppercase section headers Mods uses, or add a status sort.

**U15 · Low · `[judgment]` — "Export" means two different things in two places (UX).**
On a car, Export = per-car Markdown (`CarProfile.tsx:100-102`); in the garage, Export = all-cars JSON
backup (`Garage.tsx:88-90`). Same umbrella idea, different icons, no per-car JSON or all-cars Markdown.
**Fix:** label them — "Export build (Markdown)" vs "Back up (JSON)" (tooltip/aria-label at minimum);
optionally offer both formats in both scopes.

**U16 · Low · `[judgment]` — "Mark as sold" quick action only exists for for-sale cars (UX, prior C7).**
The hero Sold button renders only when `status === 'for-sale'` (`CarProfile.tsx:111-118`); a "current"
car you just sold has no fast path. **Fix:** surface "Mark as sold" for any non-sold car (hero cluster or
a status-badge menu) opening the existing focused MarkAsSoldModal.

### Area 5 — Content, microcopy & state coverage

**M1 · High · `[broken]` — Money is formatted two ways; the owner UI is numerically wrong for some currencies (flagged ×2: Content, prior C3/E1). DEC-1.**
Owner tabs render `{sym}{Number(cost).toFixed(2)}` (`ModsTab.tsx:307`, `MaintenanceTab.tsx:171`,
`WishlistTab.tsx:250`) while the public full share viewer uses the ISO-4217-aware `formatMoney(amount,
currency)` (`ShareCarViewFull.tsx:62`). A 1500-yen mod reads `¥1500.00` to the owner (invented cents,
no grouping) but `¥1,500` to a viewer. Three compounding bugs: (a) the per-row `*Currency` tag
(`schema.ts:64/87/100/115`, written by `flatten.ts`) is *ignored*, so a `$100` cost shows `€100` after a
currency switch; (b) totals `reduce` across mixed entry-currencies and stamp one symbol — "100 USD + 100
EUR = €200," silently wrong (`ModsTab.tsx:202`, `MaintenanceTab.tsx:125`, `WishlistTab.tsx:175`); (c) the
markdown export hardcodes `$${val.toFixed(2)}` (`exportMarkdown.ts:13-14,64`), corrupting a persisted
artifact. **Fix (DEC-1):** route *all* owner-side money through `formatMoney(row.cost, row.costCurrency ??
activeCurrency)`; group totals by entry-currency and render one per currency (or only when all rows share
the active currency); thread currency into `generateMarkdown` (as `distanceUnit` already is). The helper
already ships — adopt it.

**M2 · Medium · `[broken]` — Currency picker label truncates the name to its first word (Content).**
`{code} — {name.split(' ')[0]}` (`SettingsPanel.tsx:53`) yields "GBP — British," "CHF — Swiss," "MXN —
Mexican," "USD — US" (drops "Dollar"). The symbol is already shown adjacent, so the truncated name is
redundant *and* misleading. **Fix:** drop `.split(' ')[0]` (full names are short and fit), or show just
the code since the symbol is adjacent.

**M3 · Medium · `[inconsistent]` — Dates: entry order contradicts display order; three formats; duplicated formatter (flagged ×2: Content, prior C8).**
DateInput collects Day→Month→Year (`DateInput.tsx:91-127`) but every display calls bare
`toLocaleDateString()`, which on the US-default audience renders M/D/Y — so "04/03" (4 March) displays as
"3/4/2026" (March 4). Across surfaces dates render three ways: bare numeric (tabs/hero), "Jun 18, 2026"
(`ShareDialog.tsx:21-26`), and hardcoded `en-CA` (`exportMarkdown.ts:6-11`); `fmtDay` is copy-pasted in
both share views; issue timestamps use local tz while date-only fields are noon-anchored (`+ 'T12:00:00'`).
**Fix:** one shared `formatDate(value, style)` used at every call site (app + share + export); pick a
single locale convention and make DateInput entry order match display; fold issue timestamps into it.

**M4 · Medium · `[inconsistent]` — Empty-state copy and treatment are inconsistent (flagged ×2: Content, Components).**
Five tabs share an icon-lockup empty state (36px icon at opacity-40, `py-16`), but Photos is a bare
`<p className="text-gray-600 py-10">No photos yet.</p>` — no icon, off-pattern, on the *default* tab a new
car lands on, and the copy is 2.3:1. Voice also drifts: four tabs end "…yet" but Issues breaks the terse
register with "No open issues — all clear!" **Fix:** give Photos the shared icon-lockup; extract a
`<EmptyState icon msg>` so the six can't drift; standardize the copy pattern (pick one register); lift
copy off gray-600.

**M5 · Medium · `[inconsistent]` — Shipped copy contradicts the now-live sync feature (flagged ×2: Content, prior A2/F2).**
The empty garage says "no account, no sync, no cloud" (`Garage.tsx:135`) — reads as "there is no cloud,"
contra `AccountSection.tsx:70` ("your garage syncs across devices"); AuthVerified says sync/backup "will
switch on as they roll out" (`AuthVerified.tsx:44`), implying not-live; the README still claims "Nothing
is sent to a server" (`README.md:18-25`). **Fix:** additive-account framing — "Everything stays in your
browser — no account needed. Want it on every device? Add an account later (optional)"; AuthVerified
states sync/backup are *now active*; flag the README to the owner (product asset — not edited here).

**M6 · Medium · `[suboptimal]` — Sync-offline signal is buried + "reload to reconnect" contradicts auto-resume (Content, expands prior E3).**
The only offline/error signal lives at the bottom of Settings (`AccountSection.tsx:13-21`) and instructs
"reload to reconnect," even though photo upload auto-resumes on the browser `online` event
(`photoUpload.ts:192`). **Fix:** when (and only when) sync is `error`/`disconnected`, show a small
non-blocking indicator near the garage header (dot + "Sync paused — changes saved locally"); replace the
copy with "Reconnecting when you're back online — your data is safe on this device." Nothing for healthy/
offline-by-choice states.

**M7 · Medium · `[a11y]` — Import error isn't announced; a successful restore gives no confirmation (flagged ×2: Content, A11y — see A12).**
The "Invalid backup file…" toast is a styled `<div>` with no `role="alert"` and no dismiss
(`Garage.tsx:112-118`); a *successful* full-replace restore closes the modal and shows nothing
(`:49-54`). **Fix:** `role="alert"` + dismiss on the error (match the auth pattern); after a successful
restore show "Restored N cars from <date>" via the same slot.

**M8 · Medium · `[inconsistent]` — "Add" vs "Log" drift, and a button whose label ≠ its form's submit (flagged ×3: Content, UX, Components).**
"Add Mod" / "Log Service" / "Add Part" / "Log Issue" / "Add" for one action; worse, Maintenance's header
says "Log Service" but the submit says "Save Record" (`MaintenanceTab.tsx:137,146`). **Fix:** one
convention per semantic — e.g. "Log" for time-stamped events (Log Service, Log Issue), "Add" for
collection items (Add Mod, Add Part, Add Task) — and make each form's submit match its trigger. (Pairs
with CC9 casing.)

**M9 · Low · `[inconsistent]` — Same field labeled and prefixed inconsistently (Content, prior C4).**
Mods' add form labels it "Shop / Installer" (`ModsTab.tsx:253`) while its own edit form says "Shop"
(`:295`) — because Mods duplicates add/edit instead of sharing fields; display preposition differs too:
"by {shop}" (`ModsTab.tsx:312`) vs "at {shop}" (`MaintenanceTab.tsx:178`, share view). **Fix:** extract
Mods' fields into one shared component (like Maintenance's `FormFields`); pick one preposition ("at").

**M10 · Low · `[inconsistent]` — "Next Due Mileage" omits the unit suffix (Content, prior C4).**
The main Maintenance form's label drops the `({distShort})` that every sibling mileage label carries
(`MaintenanceTab.tsx:61` vs `ModsTab.tsx:118`). **Fix:** add `({distShort})` in the shared `FormFields`.

**M11 · Low · `[inconsistent]` — Noun drift for the same entity (Content).**
"Mods" (tab) vs "Modifications" / "New Modification" (`ModsTab.tsx:214,224`); "Wishlist" (tab) vs "Parts
Wishlist" (`WishlistTab.tsx:182`). **Fix:** use "Mods" / "New mod" to match the tab; match the wishlist
heading to its tab. Keep Part→Mod as the deliberate lifecycle.

**M12 · Low · `[suboptimal]` — For-sale price unlabeled; sold price hidden on cards (Content).**
The badge renders "For Sale · $25,000" with no "Asking" qualifier (the markdown export *does* label it),
and the price is gated on `status === 'for-sale'`, so a sold car shows no `salePrice` figure
(`CarCard.tsx:68,85`; `CarProfile.tsx:131`). **Fix:** "For Sale · Asking $25,000" and "Sold · $24,000,"
reusing per-row `formatMoney`.

**M13 · Low · `[suboptimal]` — Mouse/jargon copy on a touch-reachable UI (Content).**
"Click to upload a photo" (`PhotosTab.tsx:70`) — wrong verb on touch; "Cycle status" (`IssuesTab.tsx:152`)
— mechanism jargon that doesn't say the next state. **Fix:** "Add a photo"; an accessible name stating the
next state ("Mark in progress" / "Mark resolved" / "Reopen").

**M14 · Low · `[suboptimal]` — Managed share links are identified only by an opaque token id (flagged ×2: Content, UX; prior G2). CON-1.**
Each row's primary identifier is the raw `link.id` (`ShareDialog.tsx:245`), so two links for one car
differ only by scope badge + date. Pure labeling, independent of the reveal-once constraint. **Fix:**
optional per-link nickname at create time, shown as the row title with the id demoted to mono caption.

**M15 · Low · `[judgment]` — No undo for destructive actions; confirm-message grammar varies (Content).**
Every delete is gated by a ConfirmModal saying "permanently deleted" — safe but heavy for high-frequency,
low-stakes rows (a todo, a resolved issue) in a "disappears into the task" tool; messages also vary
('…from your mods list.' vs '…permanently deleted.'). **Fix (judgment):** for low-stakes rows, optimistic
delete + a 4s "Deleted — Undo" toast; keep explicit confirms for high-stakes deletes (a car, a restore);
standardize the message grammar.

---

## Design system / tokens recommendation

The brand depends on discipline the current ad-hoc utility strings don't enforce. Extend the existing
6-var layer (don't rebuild) with these token sets, in CSS custom properties wired through Tailwind exactly
as the accent/surface vars already are:

| Token set | Why it's needed | Proposed tokens (roles, AA-floored) |
|---|---|---|
| **Text color ramp** (V1) | ~100 sub-AA gray uses on real content | `--text-primary` #e5e5e5 (11.8:1) · `--text-secondary` gray-400 (6.86:1) · `--text-tertiary` gray-500 (large/non-body only) · `--text-disabled` gray-600 (exempt) |
| **`--on-accent`** (A1, A6, DEC-2) | label color on accent fills, derived from accent luminance | near-black when accent light/mid, white when accent clears 4.5:1; `--accent-strong` (~15–20% darker) for mid-luminance fills |
| **Status colors** (V3, V4) | 5 ad-hoc maps, drifting opacity, red overloaded | `--status-danger / -warning / -success / -info / -neutral`, each a fixed bg/text/border triple at AA; Sold → neutral; status-orange → warning |
| **Elevation** (V2) | `shadow-2xl` ×16 = anti-reference | one `--elevation` (thin border ring + minimal `0 8px 24px -12px`); hover lift = `border-color → accent/30`, no soft shadow |
| **Radius scale** (V7) | 5 radii, no rule | `--r-sm` 4 · `--r-md` 8 · `--r-lg` 12 · `--r-xl` 16 · `--r-pill` full |
| **Icon-size scale** (V9) | 15 sizes | 12 meta · 14 row/glyph · 18 modal/section · 24 upload · 36–64 empty-state |
| **Type scale** (V11) | no ramp, no line-height/weight | `--text-meta` 12/16 · `--text-body` 14/20 · `--text-subhead` 16/22 · `--text-title` 20/24 · `--text-hero` 30/34 |
| **Density** (V10) | 4 paddings for one card | `.card` (p-5) · `.card-row` (px-4 py-3) |
| **Focus ring** (A7) | invisible on dark, 1.97:1 | one `.focus-ring`: `ring-2 ring-[--accent]` solid (≥3:1) + `ring-offset-2 ring-offset-surface` |

**Shared components to extract** (each collapses a divergent pattern): `<Modal>` (dismiss + focus trap +
dialog semantics, A8/A9/CC6), `<IconButton>` (name + 44px + focus, A5), `<Segmented>` (radiogroup +
roving keys, CC2/A14), `<EmptyState>` (M4), `<MoneyInput>`/`formatMoney` adoption (CC4/M1),
`<Lightbox>` (A15), `<FormActions>` (CC5), `.badge` variants (V3/V8). Single source of truth for the
surface ramp (V6).

---

## Phased implementation roadmap

Scoped so waves don't churn each other. Wave 1 is mostly attribute/token swaps with no structural risk;
Wave 2 builds the shared layer everything else leans on; Wave 3 restructures flows on top of it.

### Wave 0 — Lock the settled spec (no debate)
- DEC-1 per-currency money · DEC-2 dark-on-orange · CON-1 share copy-once. Record as decisions so Waves
  1–3 build against them.

### Wave 1 — Quick wins (low effort, high impact; ship first)
- **A1/DEC-2:** dark-on-orange label via `--on-accent` on button + count badge + cover badge + preview.
- **V1:** migrate `gray-600`/`gray-500` body content → `gray-400` (token find-and-replace).
- **A4 + A5:** `htmlFor`/`id` on every field label; `aria-label` on every icon-only button.
- **A2 + A3:** CarCard → `<a>`/`<button>`; photo tiles → `<button>` with persistent corner actions.
- **U1:** `addCar` returns id → navigate to car; default tab → Mods; auto-focus first add-form field.
- **M1/DEC-1:** swap `{sym}{toFixed(2)}` → `formatMoney(row, row.*Currency)`; fix totals + markdown export.
- **A7:** shared `focus-visible` ring on all buttons/tabs/input.
- **V5:** prices → `--text-primary`; nicknames → italic `--text-secondary`; view-count → neutral.
- Misc low-risk: M2 currency label, M5 stale copy, A17 reduced-motion scroll, A18 doc titles, A16 alt
  fixes, A15 lightbox close handler, M13 copy.

### Wave 2 — Token & component system (the shared layer)
- Build the token sets above (text ramp, `--status-*`, `--on-accent`, elevation, radius, icon, type,
  density, focus). Single-source the surface ramp (V6).
- Extract `<Modal>` (A8/A9/CC6/CC7) and adopt in all overlays; `<IconButton>` (A5); `<Segmented>`
  (CC2/A14); `<EmptyState>` (M4); `<Lightbox>` (A15); `<MoneyInput>` (CC4); `<FormActions>` (CC5);
  `.badge` variants (V3/V8).
- Apply: V2 elevation, V3/V4 status tokens, A6 accent floor + theme gating, A13 placeholder contrast,
  CC3 validation pattern, A11 todo checkbox, A12 live regions, V12 form border.

### Wave 3 — Larger UX/IA restructures
- **U1 (reorder) + U3:** log-first tab order + sticky identity/back bar.
- **U2:** `getDueMaintenance` → overdue chips on card + hero.
- **U4 + U5 + U6:** unify add-item model; unify status-advance to one chip-advance pattern with distinct
  icons; decouple wishlist install from the destructive modal.
- **U7 + M14:** copy-once share UX + per-link nicknames; manage-list explanatory per-row copy.
- **A14:** tablist/tabpanel semantics + landmarks across CarProfile/share views; U10 Issues filter restyle.
- **U9 grouping/edit parity · U11 vanish/undo · U12 restore path · U8 toggle feedback · M3 dates ·
  M6 sync indicator · M8/CC9 verb+casing · remaining Lows.**

---

## What is broken vs suboptimal vs judgment (index)

- **Broken / inaccessible (must fix):** A1, A2, A3, A4, A5, V1 (critical); A9, A12, A15, CC1, U1, U5,
  U6, M1, M7 (`[broken]`/`[a11y]` high–medium).
- **Suboptimal (should fix):** V2, V3, V4, A6, A7, A8, A10, A11, CC2, CC3, U2, U3, U4, U7, V6–V11,
  A13, A14, CC4, U8–U12, M2–M6, M8.
- **Judgment (discretionary):** V5, V12, V13, V14, V15, A16, A18, CC5–CC9, U13–U16, M9–M15.

## Notable strengths (keep)
- Local-first contract honored end-to-end (probe-on-demand, account strictly additive, Share hidden when
  logged out, no boot spinner).
- `ShareDialog` is the model surface — real radiogroup ARIA, color+icon+text "full" warning, reveal-once
  messaging, loading/empty/error states, ConfirmModal revoke. The public share viewer already uses
  `formatMoney()` and real `<button>` tiles — the patterns the owner views should adopt already exist.
- `DateInput` is a fast keyboard-first control that fits the dense brand (modulo focus ring, segment
  labels, and order).
- Reduced motion is respected globally (`index.css:149`); animations are scoped to what changes.
- The accent/surface var layer is the right foundation — every recommendation here extends it rather than
  replacing it.

## Open design questions for the owner
1. **Themes (V13/A6):** keep the full-ramp recolors (including the blue "Midnight" anti-reference), or
   narrow to accent-only variation on one fixed dark ramp, all gated by the `--on-accent` floor?
2. **Tab order (U1):** is Photos-first a deliberate "show the build" stance, or can we go log-first
   (Mods default)?
3. **Destructive deletes (M15):** keep confirm-everywhere, or optimistic-delete + undo for low-stakes rows?
4. **Mixed-currency totals (M1):** show per-currency breakdowns, or restrict totals to a single display
   currency?
