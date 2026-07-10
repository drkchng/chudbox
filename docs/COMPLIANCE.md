# Chudbox — Privacy Compliance (Quebec Law 25)

> **NOT LEGAL ADVICE.** Research synthesis (2026-06-18), general information only. Confirm with the
> **CAI** (cai.gouv.qc.ca) or Quebec privacy counsel before relying on it — especially the "enterprise"
> threshold and the cross-border wording. Statute: *Act respecting the protection of personal
> information in the private sector* (CQLR c **P-39.1**), as amended by **Law 25** (S.Q. 2021, c. 25).
> Section numbers are corroborated across law-firm summaries but were not machine-verified against the
> primary consolidation (LégisQuébec/CanLII blocked automated retrieval) — verify before pin-citing.

## Bottom line

- **Law 25 almost certainly applies.** The trigger is *"carrying on an enterprise"* (an organized
  economic activity — incorporation / commercial intent NOT required), and there is **no small-business,
  revenue, headcount, or "it's free" exemption.** The only off-ramp is "purely personal, non-organized
  hobby" — genuinely unsettled in the case law, but a public service with optional accounts + a planned
  **paid tier** + **for-sale listings** looks like an enterprise, and monetizing weakens the hobby
  argument over time.
- **"Too small to matter" is not legally defensible**, but enforcement today is light and
  **complaint-driven** (one disgruntled user → CAI). That cushion shrinks as the paid tier / mobile app /
  public listings arrive. AMPs reach **$50k for a natural person**, but ability-to-pay + remediation +
  giving the CAI an undertaking are real cushions at small scale.
- **No cookie banner required** for our setup — one essential session cookie + IP used only for
  rate-limiting/security, no analytics/trackers. (s.9.1 expressly exempts browser cookies; security-only
  IP use is covered by s.12(3).) **But disclose both in the privacy policy.** Adding any analytics/ad
  tracker later flips this (needs consent, off-by-default).

## Status (2026-07-09, compliance pass shipped)

| Obligation (item below) | State |
|---|---|
| 1. Person responsible named + published | ✅ chudbox.com/privacy (Felix Rouleau, privacy@chudbox.com) |
| 2. Privacy policy published | ✅ `/privacy` page; Terms at `/terms`; pointers in `PRIVACY_POLICY.md` |
| 3. Deletion purges all stores | ✅ shipped in the Phase 4 pass (D1+DO+R2, `account-delete.test.ts`) |
| 4. 30-day response process | ✅ committed in the policy; manual handling via privacy@ |
| 5. Cross-border EFVP + DPAs | ✅ `EFVP.md` written · ⬜ **accept + file the two DPAs (account-side)** |
| 6. Breach plan + register | ✅ `BREACH_PLAN.md` |
| 7. Privacy by default | ✅ shares opt-in; opt-in fields off by default |
| 8. Consent hygiene | ✅ sign-up checkbox (never pre-checked), version recorded server-side (`user.tos_accepted_version`, enforced) |
| Portability (was DO LATER) | ✅ already live: Settings → Backup & data JSON export |
| privacy@chudbox.com delivery | ⬜ **create the Cloudflare Email Routing rule (account-side, DEPLOY.md)** |

## DO NOW — minimal baseline before marketing / real users (cheap, mostly one-time)

1. **Name yourself the "person responsible for the protection of PI"** (s.3.1) and **publish your title
   + a contact email** (e.g. `privacy@chudbox.com` via free Cloudflare Email Routing).
2. **Publish a privacy policy** in clear language covering: each data type (email, password hash,
   car/maintenance data, uploaded images, **IP for rate-limiting/security**, share view counts); the
   purpose of each; that data is **hosted/processed outside Quebec (Cloudflare – US, Resend – US)**; the
   rights (access, rectification, **deletion/de-indexing**, withdraw consent, portability) + how to
   exercise them + your contact; retention; the essential cookie.
3. **Account deletion that purges ALL stores** — D1 rows + R2 images + Durable Object state + any caches,
   with a stated backup-retention window. *Highest-value technical control; also closes backend gap G4.*
4. **30-day response** process for access/deletion requests (s.32 — failure to reply in 30 days is
   deemed a refusal). A simple manual process is fine at this scale.
5. **Cross-border (s.17 — the obligation most clearly engaged, regardless of scale):** write a short
   internal **EFVP** for **Cloudflare** and **Resend** (assess sensitivity, purposes, protection
   measures, destination legal framework → conclude "adequate protection") and **accept/sign each
   vendor's DPA.** Keep both on file (not filed with the CAI).
6. **One-page breach plan + incident register** (s.3.5–3.8): how you would assess "serious risk of
   injury" and notify the CAI + affected users.
7. **Privacy by default (s.9.1):** share links stay **opt-in**; any visibility setting defaults to
   most-private.
8. **Consent hygiene (s.14):** collect only what's needed, per-purpose, plain language, no pre-checked
   boxes; avoid collecting sensitive PI entirely.

## DO LATER — scales with growth / paid tier / mobile / social

- **Data-portability export** (s.27, in force): a structured JSON/CSV export when demand warrants.
- **Re-run the EFVP** when adding a **payment processor** (paid tier), the **mobile app**, or public
  **listings** — and add specific consent for making PI public on for-sale listings + a takedown path.
- **GDPR** only if you target/serve the EU (mere accessibility ≠ in scope); **PIPEDA** once cross-border
  commercial activity is clearly live (monitor Bill C-36, tabled 2026-06-15 — not yet law).
- Retention/destruction schedule + a processor/DPA register as vendors multiply; a one-time review by
  Quebec privacy counsel once monetization is material.

## Key sources

CAI (cai.gouv.qc.ca) · LégisQuébec CQLR c P-39.1 · CAI EFVP Guide v3.1 (Apr 2024) · law-firm summaries
(McCarthy, Osler, BLG, BCLP, Fasken, Greenberg Traurig). Penalty regime in force 2023-09-22; portability
in force 2024-09-22.
