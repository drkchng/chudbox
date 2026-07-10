# Chudbox — EFVP: cross-border transfer assessment (Law 25 s.17)

> Internal record; keep on file, not filed with the CAI. Assessment date **2026-07-09**, by
> Felix Rouleau (person responsible for the protection of personal information). Re-run on any
> trigger in §6. Not legal advice.

Law 25 s.17 requires assessing, before communicating personal information (PI) outside Quebec,
whether the information would receive **adequate protection** given its sensitivity, purposes,
protection measures, and the destination's legal framework. Chudbox stores and processes all
account-holder PI outside Quebec through two providers.

## 1. The transfers

| Provider | Role | Destination | PI involved |
|---|---|---|---|
| **Cloudflare, Inc.** (Workers, D1, Durable Objects, R2, logs) | Host / processor | United States (global edge; storage primarily US) | Email, display name, password hash, Terms-acceptance version; session IP + user-agent; rate-limit IP counters; synced garage data incl. opt-in VIN/plate; uploaded images; share-link token hashes + view counts; short-retention operational logs |
| **Resend, Inc.** (transactional email API) | Email delivery / processor | United States | Recipient email address, message content (verification / password-reset links), delivery metadata |

No other recipients. No analytics, ads, or data sales. Local-only (logged-out) usage transfers
nothing.

## 2. Sensitivity

Low to moderate. Hobby-vehicle records and photos; identifiers limited to email, hashed
credentials (scrypt via Better Auth), session IP/user-agent, and **opt-in** VIN / licence plate.
No financial, health, biometric, or minors-directed data; the privacy policy asks users to keep
sensitive PI out of notes. Uploaded images are **re-encoded client-side before upload**
(`apps/web/src/utils/image.ts`: createImageBitmap → canvas → toBlob), which drops camera
metadata (EXIF, including GPS).

## 3. Purposes

Strictly service delivery: authentication, account recovery, cross-device sync, image storage,
user-initiated public shares, rate limiting / abuse protection. Proportional: each item maps to
a feature; nothing is collected for secondary purposes.

## 4. Protection measures

- TLS in transit everywhere; Cloudflare encrypts stored data at rest (D1/DO/R2).
- R2 bucket private; images served only via authed owner routes or token-scoped share routes.
- Uploads authed, size-capped, magic-byte validated. Share tokens stored hashed (sha256).
- Least-privilege operator access (scoped API tokens); secrets via `wrangler secret`.
- Account deletion purges D1 + DO + R2 immediately; provider recovery snapshots expire ≤ 30 days.
- Contractual: **Cloudflare** incorporates a DPA with EU SCCs into its self-serve subscription
  terms and is certified under the EU-US Data Privacy Framework (verify current listing at
  dataprivacyframework.gov). **Resend** publishes its DPA at resend.com/legal/dpa (accept and
  keep a copy; note its subprocessors, incl. AWS for delivery).

## 5. Destination legal framework

US law allows government access in defined cases (CLOUD Act, FISA 702). Given the low sensitivity
and volume of this data, the technical measures above, and the providers' contractual safeguards
(SCC-based DPAs, DPF participation), that residual risk is acceptable.

**Conclusion: the information receives adequate protection.** The transfers proceed; the privacy
policy discloses them (chudbox.com/privacy → "Where your data is processed").

## 6. Re-assessment triggers

Payment processor (paid tier), mobile push provider, any analytics, marketing email, moving off
Cloudflare/Resend, or a provider materially changing its DPA/subprocessors.

## 7. File

- [ ] Cloudflare DPA copy saved (auto-incorporated; download from the dashboard/legal page)
- [ ] Resend DPA accepted + copy saved
- [x] This assessment (2026-07-09)
