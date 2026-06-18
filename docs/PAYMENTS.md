# Chudbox — Payments / Billing (future paid tier)

> **NOT FINANCIAL / TAX / LEGAL ADVICE.** Research synthesis 2026-06-18; fees, tax rules, and app-store
> policies move fast. Confirm live numbers and the Quebec GST/QST mechanics with a Quebec CPA before
> building. Two items were actively in flux at research time (Apple's US external-link fee at SCOTUS;
> Stripe Managed Payments in preview).

## Recommendation

**Web paid tier (build first): a Merchant of Record (MoR)** — it becomes the legal seller and offloads
essentially all global sales-tax/VAT/GST compliance ("lazy mode"). Two real choices, both **5% + 50¢**:

| | **Polar.sh** | **Paddle** |
|---|---|---|
| Lean | Best DX, Stripe-native, fits the Workers stack, free to start | Most mature, tax-certain |
| **Quebec QST** | docs name only "Canadian GST" — **QST NOT mentioned → confirm in writing** | **GST/HST/PST/QST explicitly named** |
| CAD payout | Yes (Stripe Connect Express; not native CAD) | Yes, **native CAD** |
| Catches | young (~$10M seed); 7-day hold for new orgs; some payout-hold complaints | approval-gated onboarding; **under-$10 products = custom pricing**; FTC settlement Jun 2025 |
| RevenueCat (native, later) | needs a small custom webhook bridge | **turnkey integration** |

**Lean: start with Polar** (lazy + solo + DX) **only after confirming QST remittance in writing**; if
they can't confirm QST, or you want maximum tax-certainty + the RevenueCat path, **Paddle**. (Polar's
famous 4%+40¢ is now grandfathered to pre-~May-2026 orgs; new sellers pay 5%+50¢.)

## The lazy-tax reality — what an MoR does and doesn't offload

- **Offloads (the win):** US 50-state sales tax (no *Wayfair* nexus tracking), EU VAT (owed from the
  first sale for a non-EU seller), 100+ other jurisdictions, AND charging Canadian GST/QST to your
  customers. Collapses dozens of foreign registrations → one income-tax return at home.
- **You still handle:** your own **Canada + Quebec income tax** (always — federal T1/T2125 + Quebec
  TP-1); and **possibly your own GST/QST registration once payouts cross CAD $30k** — but you'd remit
  ~$0 on MoR sales (zero-rated export; the $30k threshold still counts them). → **the #1 ask-your-CPA item.**
- Fee premium vs a self-remit Stripe stack is ~1.3–4.9 points — that delta *is* the price of never
  registering/remitting tax anywhere. Worth it for a solo lazy-tax operator.

## Native app (defer, but plan) — the payment split is FORCED

- In-app digital subscriptions on iOS/Android **must** use Apple IAP (15–30%) / Google Play (15% subs).
  No web stack escapes this.
- **The clean play: web-purchase + app-login (Netflix/Spotify model).** Sell on chudbox.com via the
  MoR; users just **log in** on the app to unlock premium — permitted (Apple Guideline 3.1.3), no IAP,
  no store cut. Don't show in-app prices or "subscribe on our site" links (anti-steering).
- **RevenueCat** (free under $2,500/mo tracked revenue, then 1%) when the native app ships — manages
  IAP + unifies entitlements across web + iOS + Android keyed to your user id. Paddle has a turnkey RC
  integration; Polar needs a custom bridge. (RevenueCat's own "Web Billing" is NOT an MoR.)
- **Don't** architect around Apple's US 0% external-link window — it's at the Supreme Court (conference
  2026-06-25) and may revert to a "reasonable" fee within weeks.
- One stack serves web + native **only at the auth/entitlement layer** (your Workers backend), never
  at payments.

## Build now vs later

- **Now (when the paid tier lands):** an MoR (Polar/Paddle) + a simple **entitlement check in the
  Workers backend** keyed to user id + the MoR webhook. Favor **annual** plans or a price meaningfully
  above ~$5 (the fixed 50¢ guts a $5 ticket — ~10–15% to fees).
- **Later:** RevenueCat for native IAP; decide the MoR→RC bridge then; watch **Stripe Managed Payments**
  (the Lemon Squeezy successor) as it reaches GA.
- **Don't:** self-host Stripe + Stripe Tax (makes YOU the global taxpayer — defeats the goal);
  Chargebee/Recurly (not MoRs, don't solve tax); Lemon Squeezy (Stripe-owned dead-end); Gumroad/Creem/
  Dodo (weak subs / very young / Dodo has no CAD payout).

## Open items to verify before relying

1. **Polar QST coverage** — explicitly named only by Paddle + FastSpring; confirm directly with Polar.
2. **Your own GST/QST registration at the $30k threshold** while on an MoR (likely register-but-remit-$0,
   zero-rated export) — fact-dependent → Quebec CPA.
3. **Apple US 0% link-out** (SCOTUS conference 2026-06-25) and **Stripe Managed Payments** GA pricing
   (Stripe's page says ~6.4% all-in vs the marketed 5%+50¢).
