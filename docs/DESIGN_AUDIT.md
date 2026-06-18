# Chudbox — Design / UX Audit

Read-only audit of the whole app against the brand in `PRODUCT.md` (dark/dense/enthusiast,
"the tool disappears into the task", functional orange accent, dark load-bearing, WCAG AA floor,
reduced-motion respected). Grounded in the components/pages as they exist on `master`.

**User / context / goal (from PRODUCT.md):** a car enthusiast who knows their car, on a desktop
browser, mid-build, wanting to log a mod/maintenance/issue in under ~10s and review history later.
An account is strictly additive (sync + cloud backup); it must never gate the local experience.

Severity legend:
- **Critical** — broken or inaccessible; must fix.
- **Major** — clear usability/CX problem; should fix.
- **Minor** — polish or judgment call; discretionary.

Each item is tagged **[broken]** / **[suboptimal]** / **[judgment]** so obligation is unambiguous.

---

## Top 5 highest-impact

1. **Primary-button label fails WCAG AA** — white text on the brand orange `#f97316` is **~2.8:1**
   (AA needs 4.5:1). This is the single most-used control and the load-bearing brand color, so it is
   the highest-leverage fix in the app. *(Critical — §H1)*
2. **"Add car" doesn't drop you on the car** — after `addCar` the modal just closes back to the grid,
   and the profile's default tab is **Photos**, not a log. The core "add → start logging in 10s" loop
   is broken on both ends. *(Major — §B1, §B2)*
3. **Currency switch lies** — Settings says prices are "converted automatically," but the toggle only
   swaps the symbol; a `$100` mod reads `€100` after switching. Car price fields are also hardcoded to
   `$`. Trust/correctness problem in the money layer. *(Major — §E1)*
4. **Photos: set-cover and delete are hover-only** — the action overlay is `opacity-0
   group-hover:opacity-100`, so on touch and via keyboard you cannot set a cover or delete a photo.
   *(Critical — §D1)*
5. **Share links are reveal-once with no re-copy** — the URL shows once after create; the manage list
   shows only the opaque token id with no copy action, so a link you didn't copy in time is a dead-end
   (revoke + recreate). Wrong pattern for an artifact whose purpose is to be re-shared. *(Major — §G1)*

---

## A. First-run / empty state (`pages/Garage.tsx`)

**A1. [judgment] Backup icons are cryptic on an empty garage — Minor.**
The header always renders Download/Upload (JSON backup/restore) as bare icon buttons with only a
`title`. On first run, with zero cars, "download/upload arrow" reads as ambiguous (import a car? a
photo?) and competes with the one action that matters — **Add Car**. *Principle:* orange marks what
matters; the header should lead with the primary action and de-emphasize backup until there's data
to back up. *Fix:* on the empty state, collapse Download/Upload into a single overflow ("⋯") or hide
them until `cars.length > 0`; keep **Add Car** as the only accent control. Cheap (conditional render).

**A2. [suboptimal] Empty-state copy slightly undersells the model — Minor.**
"Everything stays in your browser — no account, no sync, no cloud." is reassuring but reads as
"there is no cloud," which contradicts the optional-account story surfaced elsewhere. *Fix:* "…stays
in your browser. Want sync across devices? Add an account later — never required." Keeps local-first
primary while not foreclosing the additive account. Copy-only.

The empty state itself (icon lockup, "Nothing here yet", single accent CTA) is on-brand and good.

---

## B. Add a car → land on it → start logging

**B1. [broken] Adding a car does not navigate to it — Major.** `AddCarModal.handleSubmit`
(`components/AddCarModal.tsx:44`) calls `addCar(form); onClose()` and returns to the Garage grid.
The user must now visually re-find the new card and click it before they can log anything. For the
stated 10-second goal this is pure dead weight. *Fix:* navigate to `/car/:id` on create. Feasibility
note: `addCar` is currently `(data: CarDetails) => void` (`store/adapter.ts:111`) — it returns no id,
so this needs a one-line change to return the new id (it already mints one via `newId`), then
`navigate(\`/car/${id}\`)` in the modal. Small, high-payoff.

**B2. [suboptimal] Default tab is Photos, the slowest path to logging — Major.**
`CarProfile` opens on `useState<TabId>('photos')` (`pages/CarProfile.tsx:54`) and the tab order is
Photos → Wishlist → Mods → Maintenance → To-Do → Issues. The two highest-frequency build actions
(Mods, Maintenance) sit 3rd–4th, behind Photos (often empty on a brand-new car) and Wishlist.
*Principle:* IA ordered by task frequency; the tool should put the log one click away. *Fix:* default
to **Mods**, and reorder tabs to log-first: Mods → Maintenance → Issues → To-Do → Wishlist → Photos.
If you prefer to keep Photos for visual identity, at minimum change the default tab to Mods. Cheap.

**B3. [judgment] No "Current" status affordance for the just-added car — Minor.**
Covered under §F-adjacent status flow in §C7 (Mark-as-Sold only appears for `for-sale`). Not specific
to the add flow but first felt here.

---

## C. Per-tab logging (Mods / Maintenance / Issues / To-Do / Wishlist)

**C1. [suboptimal] Three different "add an item" interaction models — Major (consistency).**
For the same conceptual action ("add a row to this list") the app uses three patterns:
- **Toggle inline form** behind an "Add X" button — Mods, Maintenance, Wishlist, Issues
  (`ModsTab.tsx:219`, `MaintenanceTab.tsx:137`, `WishlistTab.tsx:189`, `IssuesTab.tsx:81`).
- **Always-visible inline form** — To-Do (`TodoTab.tsx:44`) and Photos upload card (`PhotosTab.tsx:48`).
- **Modal** — the cross-flows (Log-to-Maintenance, Move-to-Mods) and all car-level forms.

The toggle-vs-always-visible split is the jarring one: To-Do silently behaves differently from its
siblings. *Principle:* consistent mechanics reduce the cognitive cost of a dense tool. *Fix:* pick one
model for "add a list item." Recommended: keep the toggled inline form everywhere (it matches the
dense, in-context brand and avoids modal context-switches), and make To-Do match — an "Add task"
button that reveals the same single-row form. If you'd rather keep To-Do's always-on quick-add, then
make Mods/Maintenance/Wishlist/Issues quick-add inputs always-visible too. Either way, converge.

**C2. [suboptimal] "Add X" button is a toggle with no toggle affordance — Minor.**
`setShowForm((v) => !v)` means clicking "Add Mod" again silently closes the open form, but the button
label/visual never changes (no pressed state, no "Cancel"). With a separate Cancel inside the form,
there are two non-obvious ways to dismiss. *Fix:* when the form is open, swap the header button to a
secondary "Cancel" (or show an active/pressed state). Keeps the dense layout, removes the surprise.

**C3. [broken] Car price fields hardcode `$` regardless of currency — Major.**
`AddCarModal` (lines 106, 117) and `MarkAsSoldModal.tsx:48` render a literal `$` prefix on
sale/asking price, while Mods/Maintenance/Wishlist cost fields correctly use the active `sym`
(`CURRENCIES[currency].symbol`). A user on EUR sees `€` everywhere except car prices, which show `$`.
*Fix:* use the active currency symbol in those three inputs (read `sym` exactly as the tabs do). Note
this interacts with §E1 — even the symbol is currently the only currency signal, so getting it right
matters more.

**C4. [suboptimal] Field-set / label drift between add and edit, and across tabs — Minor.**
- Mods duplicates its add and edit forms instead of sharing them (Maintenance correctly shares
  `FormFields`): the add form labels the field "Shop / Installer" (`ModsTab.tsx:253`) while the inline
  edit labels it "Shop" (`ModsTab.tsx:295`).
- "Next Due Mileage" shows the unit suffix in the Log-to-Maintenance modal (`ModsTab.tsx:118`,
  `…({distShort})`) but **omits** it in the main Maintenance form (`MaintenanceTab.tsx:61`).
*Principle:* dense tools live or die on scannable, predictable labels. *Fix:* extract Mods' fields into
one shared component (as Maintenance does) and standardize the unit suffix on every mileage label.

**C5. [judgment] Cross-flow actions are powerful but under-explained — Minor.**
"Log to Maintenance" (per mod) and "Move to Mods" (per installed wishlist item) are genuinely good,
but "Log to Maintenance" is a small accent text-link floated bottom-right of each mod row
(`ModsTab.tsx:319`) and its purpose (turn a wear-item mod into a recurring service record) is
non-obvious. *Fix:* keep the action, but move it into the row's action cluster (next to edit/delete)
with an icon + tooltip, and reserve the accent for it only on hover — a passive utility shouldn't
hold standing accent against the brand's "accent = what matters" rule.

**C6. [suboptimal] Three different "mark done/advance" patterns for status — Major (consistency).**
Completion/▶ semantics differ per tab:
- **To-Do:** a checkbox (`TodoTab.tsx:71`).
- **Issues:** one status icon that **cycles** open → in-progress → resolved on click, titled "Cycle
  status" (`IssuesTab.tsx:152`).
- **Wishlist:** forward-only icon buttons, and crucially two visually identical `CheckCircle2` icons
  mean different things — green = "mark installed (+ opens Move-to-Mods)" (`WishlistTab.tsx:277`),
  gray = "move back to wanted" (`WishlistTab.tsx:283`).
The duplicated `CheckCircle2` is the real trap; the cross-tab inconsistency is the broader one.
*Principle:* never signal different meaning with the same shape; keep one progression pattern.
*Fix:* give each wishlist transition a distinct icon (e.g., cart→box→wrench forward; a small "undo"/
rotate-ccw for revert) and reuse Issues' single-affordance "advance status" pattern across Wishlist
so the mental model is "click the state chip to advance" everywhere status cycles.

**C7. [judgment] "Mark as sold" quick action only exists for `for-sale` cars — Minor.**
The hero's green Sold button renders only when `status === 'for-sale'` (`CarProfile.tsx:111`). A
`current` car you just sold has no quick path — you go Edit → Status → Sold → (re-enter date/price).
*Fix:* either always show "Mark sold" in the hero overflow, or surface the MarkAsSold modal from the
status badge. Low effort; closes a common real-world gap.

**C8. [suboptimal] DD/MM/YYYY segment order for a US-default audience — Minor.**
`DateInput` is ordered Day → Month → Year (`components/DateInput.tsx`). The app defaults to USD +
miles (US-leaning), where MM/DD/YYYY is expected; day-first invites silent mis-entry (03/04 ambiguity
becomes a wrong date with no validation). The control is otherwise excellent (fast, keyboard
auto-advance, on-brand). *Fix:* order segments by the user's locale (or at least MM/DD/YYYY for the
US-default build), and label each segment for assistive tech (see §H4).

---

## D. Photos (`components/tabs/PhotosTab.tsx`)

**D1. [broken] Set-cover and delete are pointer-hover-only — Critical (a11y + touch).**
The per-photo action overlay is `opacity-0 group-hover:opacity-100` (`PhotosTab.tsx:94`), and the grid
tile is a `div` with `onClick` (not a focusable control). Consequences: on touch devices there is **no
way to set a cover photo or delete a photo** (tap opens the lightbox instead), and keyboard users can't
reach the actions at all. This also strands cover selection — the first photo is only the *implicit*
cover (`car.photos[0]` fallback) until someone explicitly sets one, which touch users can't do.
*Principle:* nothing reachable by pointer-hover only; ~44px targets; keyboard path for every action.
*Fix:* make each tile a real focusable element and show the Star/Delete affordances persistently
(small, bottom-corner, dense) rather than on hover — or add an always-visible "⋯" menu per tile.
Keep the lightbox on the image tap, but put cover/delete on explicit buttons. Also surface a
**Set as cover** action inside the lightbox so it's reachable there too.

**D2. [broken] Lightbox close button has no handler and no Escape — Minor→Major.**
The lightbox `X` button has no `onClick` (`PhotosTab.tsx:126`); it "works" only because the click
bubbles to the backdrop's `onClick`. There's no `aria-label`, and **Escape doesn't close the lightbox**
(every other overlay in the app closes on Esc via `useModalDismiss`). *Fix:* give the X an explicit
`onClick={() => setLightbox(null)}` + `aria-label="Close"`, and add an Escape handler (reuse
`useModalDismiss`) so lightbox dismissal matches the rest of the app.

**D3. [judgment] Upload card is always-on; fine, but note the inconsistency — Minor.**
The persistent upload dropzone is reasonable for Photos, but it's the same "always-visible vs toggled"
split called out in §C1. If you converge add-forms on the toggled pattern, leave Photos' dropzone
always-on (uploading is the tab's primary verb) and document the deliberate exception.

The upload → preview → caption → save flow itself is clear and on-brand.

---

## E. Settings (`components/SettingsPanel.tsx`)

**E1. [broken] "Converted automatically" is true for distance, false for currency — Major.**
Per `store/adapter.ts` (header: "setCurrency / setDistanceUnit are Values writes ONLY … amounts keep
the currency they were entered in"), switching currency does **not** convert stored amounts; the read
model returns the raw number and the UI just swaps the symbol. So a `$100` mod displays as `€100`
after switching to EUR — numerically wrong and silently mislabeled (each amount even carries a
`costCurrency` entry tag that the display ignores). Meanwhile distance **does** convert on display via
the canonical `mileageMiles`, so that copy is accurate. The Settings strings claim both convert:
"All prices will be converted automatically." (`SettingsPanel.tsx:40`) / "All mileage values will be
converted automatically." (`SettingsPanel.tsx:65`). The first is false. *Principle:* the tool must not
lie about the user's data. *Fix (pick one):*
   - **Cheapest, honest:** change the currency copy to describe reality — "Sets the symbol for new and
     displayed amounts. Existing entries keep the value you typed." and (better) render each amount with
     *its own* entry-currency symbol from the stored `*Currency` tag, so a USD-entered cost still shows
     `$` after you switch. This is display-only and matches the "unit toggle is display-only" intent.
   - **Fuller:** actually convert on display using the stored entry-currency tag + `convertPrice`
     (already implemented in `shared/units.ts` but unused in the UI), so amounts re-express in the active
     currency at the stored rates. More work; only worth it if real conversion is a promised feature.
   Whichever you choose, also fix §C3 so car prices stop hardcoding `$`.

**E2. [broken] Custom accent has no contrast floor — Major (a11y).**
The theme picker lets the user choose any color (`SettingsPanel.tsx:139` color input → `setCustomAccent`),
which becomes `--accent` for filled primary buttons (white text), active tabs, badges, and accent text
on dark. A dark pick (say `#333`) makes primary buttons and `text-accent` fail AA or vanish; a pale
pick blows out on the dark surface. *Principle:* WCAG AA is the floor, and dark is load-bearing.
*Fix:* clamp/validate the chosen accent and **derive the button label color from accent luminance**
(white vs near-black, whichever yields ≥4.5:1) — the same mechanism that fixes the default button in
§H1. Optionally warn ("low contrast on dark") when a pick can't reach the floor with either label.

**E3. [judgment] Sync status is only visible buried in Settings → Account — Minor.**
The only place to see "Synced / Sync offline / Sync error" is the Account block at the bottom of the
Settings panel (`auth/AccountSection.tsx:71`). This is *correctly* low-key for an additive feature, but
a silent `error`/`disconnected` state gives the user no ambient signal that backup stopped. *Fix:* keep
the account UI tucked away, but when (and only when) sync is in `error`/`disconnected`, show a small
non-blocking indicator near the garage header (dot + text, dismissible). Don't add anything for the
healthy/offline-by-choice states — that would violate "no empty state waiting for an account."

**E4. [suboptimal] Settings panel isn't announced as a dialog — Minor (a11y/consistency).**
`SettingsPanel` is a slide-over with no `role="dialog"`/`aria-modal`/labelled title, while `ShareDialog`
sets all three (`ShareDialog.tsx:118`). *Fix:* mirror ShareDialog's dialog semantics and focus
management here (and trap focus — see §H3).

---

## F. Account / auth (`auth/*`, `pages/AuthReset.tsx`, `pages/AuthVerified.tsx`, `components/SyncGate.tsx`, `components/SyncMergeModal.tsx`)

The local-first contract is well honored: the session is probed only when the Account section opens /
at the SyncGate level, a failed probe renders as plain signed-out, and Share is simply hidden when
logged out. Sign-up/verify/reset terminal states ("Check your inbox", "Password updated", "Email
verified", invalid-link) are all present and friendly. Good.

**F1. [broken] Auth modals can't be dismissed by Escape or backdrop — Major (consistency + keyboard).**
`SignInModal`, `SignUpModal`, `ForgotPasswordModal` render a backdrop with **no** `onClick` and **no**
Escape handler — only the in-form Cancel/X closes them. Meanwhile AddCar/EditCar/Sold/Confirm dismiss
on Esc *and* backdrop (`useModalDismiss`), and ShareDialog dismisses on Esc only. So the app has three
different dismiss contracts. A keyboard user expecting Esc to back out of sign-in is stuck.
*Principle:* one predictable dismissal contract; every overlay keyboard-dismissible. *Fix:* route every
overlay through `useModalDismiss` (Esc always; backdrop where a misclick-cancel is safe). Intentional
exception: `SyncMergeModal` must stay non-dismissible (a choice is required) — document that.

**F2. [suboptimal] Post-verify copy reads as "sync isn't live yet" — Minor.**
`AuthVerified` says sync/backup "will switch on as they roll out" (`pages/AuthVerified.tsx:44`), which
undercuts the signed-in state that `AccountSection` presents as already syncing. If sync is live, this
is stale and confusing. *Fix:* align the copy with the actual rollout state.

**F3. [judgment] "Create account" vs "Sign in" are two equal-weight outline buttons — Minor.**
In the signed-out Account block both are `btn-outline` of equal weight (`AccountSection.tsx:124`).
That's defensible (neither is *the* primary action in an optional flow), so this is a judgment call —
if data shows most users sign in rather than register, give Sign in the slight emphasis. No accent
needed; keep it quiet to respect local-first.

---

## G. Sharing (create/manage **flow + IA** — public viewer pixels are out of scope per the brief)

`ShareDialog` is the strongest-built surface in the app: real radiogroup semantics with `aria-checked`,
a color+icon+text warning for "full" scope (not color-alone), reveal-once messaging, loading/empty/error
states, and a ConfirmModal for revoke. The findings are about flow/IA, not pixels.

**G1. [broken] Reveal-once link with no re-copy from the manage list — Major.**
After create, the full URL is shown once with "won't be shown again" (`ShareDialog.tsx:203`). The
"Existing links" rows then show only the opaque `link.id` (`ShareDialog.tsx:245`) with **no copy
action and no URL**. A share link's entire purpose is to be re-shared; treating it like a write-once
API secret means "closed the dialog before copying → revoke and recreate." *Principle:* match the
affordance to the artifact's purpose. *Fix:* let each active row reconstruct and copy its URL (the
clean-URL work in flight gives you a deterministic `origin + path + id`), with the same Copy button as
the fresh-create card. If there's a genuine secret component that truly can't be reshown, split it:
show the shareable URL always, and only hide the secret part. This is an IA fix, independent of the
viewer redesign.

**G2. [suboptimal] Links are unlabeled and indistinguishable — Minor.**
Two links for the same car (e.g., a curated forum link and a full buyer link) differ only by scope
badge + date; the visible handle is a truncated token id. *Fix:* allow an optional short label/nickname
per link, shown as the row title with the id demoted. Helps the realistic "I made several links"
case and makes revoke targets unambiguous.

**G3. [judgment] View count wears the only accent in the row — Minor (brand).**
The view counter is the single `text-accent` element in each list row (`ShareDialog.tsx:263`), pulling
the eye to a vanity metric over the row's real action (revoke). *Principle:* accent marks actions/
status, not passive data. *Fix:* render the count in a neutral gray (it's information, not an action);
if anything deserves standing emphasis here it's the link's Active/Expired/Revoked state, which already
uses appropriately colored badges.

**G4. [suboptimal] Scope radios aren't arrow-key navigable — Minor (a11y).**
The two scope options use `role="radio"` but are buttons without roving-tabindex/arrow-key handling, so
they behave like two tab stops rather than one native radiogroup. *Fix:* implement arrow-key selection
(or use native radios visually styled). Low effort; completes the otherwise-correct ARIA.

The create flow itself (scope default = curated/safer, optional expiry, explicit "full" warning) is
well-judged and on-brand. Keep it.

---

## H. Cross-cutting — accessibility & the visual system

These recur across many components; fixing them at the token/shared-component level is cheapest.

**H1. [broken] Primary button text fails AA — Critical.**
`.btn-primary` is `bg-accent text-white` (`index.css:44`). Computed contrast of `#ffffff` on the brand
orange `#f97316` is **~2.8:1**; the hover fill `--accent-dim #ea580c` is **~3.6:1** — both below the
4.5:1 needed for the 14px semibold label (and below 3:1 large-text too at default size). This is the
app's most-used control and the brand's load-bearing color, so it's the top fix. *Constraint:* keep the
orange identity. *Fix options:*
   - Keep white labels, render **filled** primary buttons on a darker orange (≈ `#c2410c`, white ≈ 4.5:1)
     via a dedicated `--accent-strong` token — while keeping bright `--accent` for borders, icons,
     active tabs, and accent **text on dark** (`#f97316` on `#1a1a1a` ≈ 6.2:1, already AA). This
     preserves the vivid accent everywhere it already passes and only deepens the filled chip.
   - Or keep the vivid `#f97316` fill and switch the label to near-black (`#0f0f0f` on `#f97316` ≈
     **7.5:1**). Higher contrast, but a slightly different "feel."
   Recommend option 1 (least visible change, keeps white-on-orange). Either choice should drive the
   custom-accent label logic in §E2.

**H2. [broken] Secondary/tertiary text colors fall below AA — Major.**
On the `--surface #1a1a1a` card background:
   - `text-gray-400 #9ca3af` ≈ **6.9:1** — passes.
   - `text-gray-500 #6b7280` ≈ **3.6:1** — fails body (4.5:1); OK only for large text / non-text UI.
   - `text-gray-600 #4b5563` ≈ **2.3:1** — fails everything except decorative.
`gray-500`/`gray-600` are used for *real content*, not just placeholders: card footer stats
(`CarCard.tsx:122`), mod meta date/shop line (`ModsTab.tsx:310`, `text-gray-600`), the maintenance
"Next:" line (`MaintenanceTab.tsx:181`), many `text-xs text-gray-500` count/meta rows, and the section
labels. *Principle:* AA floor for body text. *Fix:* establish a typographic color ramp with an AA floor
on surface — promote content currently at `gray-500`→`gray-400`, and `gray-600`→`gray-500`; reserve
`gray-600` strictly for non-essential decoration and input placeholders (where exemptions apply). This
keeps the dense, muted look while clearing the floor. Token-level change; broad payoff.

**H3. [broken] Modals don't trap or restore focus — Major (a11y).**
No overlay (AddCar, EditCar, Sold, Confirm, Share, the auth modals) traps Tab focus or restores focus
to the trigger on close — Tab walks out of the dialog into the page behind it. `useModalDismiss` handles
Esc/backdrop only. *Principle:* keyboard users must stay within an open dialog and land back where they
were. *Fix:* add focus-trap + initial-focus + return-focus to a shared modal wrapper (or extend
`useModalDismiss` into a `useModal` hook) and adopt it everywhere. One shared fix covers every overlay.

**H4. [broken] Icon-only buttons lack accessible names — Major (a11y).**
Many icon-only controls expose only a `title` (a tooltip), which is not a reliable accessible name:
Garage header Download/Upload/Settings (`Garage.tsx:88–103`), CarProfile hero Export/Settings/Delete
(`CarProfile.tsx:100–124`), the per-row edit/delete `btn-ghost` icons across all tabs, the wishlist
status icons (`WishlistTab.tsx:271–288`), and the photo Star/Delete (`PhotosTab.tsx:95–102`).
`ShareDialog` already does this right (`aria-label` on its icon buttons) — apply that pattern
everywhere. *Fix:* add `aria-label` to every icon-only button (keep `title` for the sighted tooltip).
Also give each `DateInput` segment an `aria-label` (Day/Month/Year) — currently three unlabeled
textboxes.

**H5. [suboptimal] No consistent focus-visible style on custom buttons — Minor (a11y).**
`.input` has a clear accent focus ring (`index.css:75`), but `.btn-primary/outline/ghost/tab-btn` define
no `focus-visible` style and rely on the UA default outline, which is faint on the dark palette and
inconsistent across browsers. *Fix:* add a shared `focus-visible` ring (reuse the input's
`ring-accent/40`) to the button classes so keyboard focus is always visibly tracked on dark.

**H6. [judgment] Accent used as decoration in a few spots — Minor (brand).**
Nickname is rendered in accent on cards and the hero (`CarCard.tsx:106`, `CarProfile.tsx:153`) and the
share view count in accent (§G3). Per "orange marks what matters — never decoration," a nickname is
identity, not action/status. *Fix:* render nicknames in a neutral/italic gray and keep accent for
actions, current state, and alerts. Minor, but it sharpens the signal the brand depends on.

---

## What is broken vs suboptimal vs judgment (index)

- **Broken (must fix):** B1, C3, D1, D2, E1, E2, F1, G1, H1, H2, H3, H4.
- **Suboptimal (should fix):** A2, B2, C1, C2, C4, C6, E3, E4, F2, G2, G4, H5.
- **Judgment (discretionary):** A1, C5, C7, C8, D3, F3, G3, H6.

## Notable strengths (keep)
- Local-first contract is honored end-to-end (probe-on-demand, account strictly additive, Share hidden
  when logged out, no boot spinner).
- `ShareDialog`, `SyncMergeModal`, and the auth terminal states model their unhappy paths well
  (loading/empty/error/expired/revoked, destructive confirms, color+icon+text signaling).
- `DateInput` is a genuinely fast, keyboard-first control that fits the dense brand (modulo segment
  order + labels).
- Reduced-motion is respected globally (`index.css:149`); animations are scoped to what changes.

## Open design questions for the owner
1. Is currency meant to *convert* (full §E1 fix) or just *label* (cheap §E1 fix)? Determines the money
   layer's scope.
2. For the primary button (§H1): keep white-on-orange by darkening the fill, or move to near-black
   labels on the vivid orange? Drives the custom-accent label rule too.
3. Tab order (§B2): is Photos-first a deliberate "show off the build" stance, or can we go log-first
   (Mods default) to serve the 10-second goal?
4. Share links (§G1): is there a true secret component that must stay reveal-once, or can active links
   be re-copyable from the manage list once clean URLs land?
