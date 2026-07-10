# Chudbox — confidentiality incident plan (Law 25 ss.3.5–3.8)

> Internal one-pager. Owner: Felix Rouleau (person responsible for the protection of personal
> information). A "confidentiality incident" is any unauthorized access, use, or communication of
> personal information, or its loss, including a leaked secret, a compromised account, or a bug
> exposing another user's data.

## 1. Contain (immediately)

- Rotate exposed secrets: `wrangler secret put BETTER_AUTH_SECRET` (invalidates sessions),
  `RESEND_API_KEY`, Cloudflare API tokens (dash → API Tokens).
- Revoke affected sessions (delete rows from D1 `session`) / disable the affected route or, if
  needed, the whole Worker (`wrangler delete` or disable the custom-domain route).
- Fix the bug before re-enabling. Preserve logs and a timeline while they exist (Workers logs are
  short-retention, capture them first).

## 2. Assess: "risk of serious injury"

Consider sensitivity of the PI, apparent malicious intent, and likelihood of misuse. Guide:

- **Likely serious**: password hashes or session tokens exfiltrated; email list dumped; private
  garages (VIN/plate) exposed at scale.
- **Likely not serious**: a single public-share over-exposure of non-opt-in fields, quickly
  fixed; transient logs seen by no one.

When in doubt, treat as serious.

## 3. Notify (when risk of serious injury)

- **CAI**: incident report form at cai.gouv.qc.ca, promptly.
- **Affected users**: email each affected account: what happened, when, what data, what we did,
  what they should do (e.g. change password), contact privacy@chudbox.com.
- **GDPR overlay** (EEA/UK users affected): notify within **72 hours** of becoming aware;
  practically, the CAI notification content works for both.
- **CSAM found in uploads**: report to **Cybertip.ca** (Canadian operator), preserve evidence,
  do not merely delete. (See docs/COMPLIANCE.md moderation notes.)

## 4. Register (keep even for non-serious incidents)

Append one row per incident below; retain at least 5 years.

| Date detected | What happened | PI involved | People affected | Serious-injury assessment | Containment / fixes | Notifications (CAI / users / other) |
|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |
