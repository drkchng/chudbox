# Chudbox — Privacy Policy & Terms (pointers)

The **live legal documents are the app pages**, the single source of truth, so no copy drifts:

| Document | Page | Source |
|---|---|---|
| Privacy Policy | chudbox.com/privacy | `apps/web/src/pages/Privacy.tsx` |
| Terms of Service | chudbox.com/terms | `apps/web/src/pages/Terms.tsx` |

Shared constants (effective dates, Terms version, contact email) live in
`packages/shared/src/legal.ts`.

## Updating them

- **Privacy Policy edit:** update `Privacy.tsx` + bump `PRIVACY_EFFECTIVE_DATE`. Material changes
  also get an in-app notice (the policy promises this).
- **Terms edit:** update `Terms.tsx` + bump `TERMS_EFFECTIVE_DATE`. Bump `TOS_VERSION` **only for
  material changes needing fresh consent**; new sign-ups then record the new version
  (`user.tos_accepted_version`); deciding whether existing users must re-accept is a per-change
  call.
- Keep the pages truthful to the code: the collection table in `Privacy.tsx` mirrors what the API
  actually stores (Better Auth tables incl. session IP/user-agent, GarageDO garage data, R2 images,
  `share_links.view_count`, D1 `rate_limit`).

## Consent record

Sign-up requires ticking a never-pre-checked box; the client sends `tosAcceptedVersion` and the
API **refuses account creation without it** (required Better Auth additionalField,
`apps/api/src/auth.ts`). Acceptance version is stored on `user.tos_accepted_version`
(acceptance time = `created_at`). Pre-policy rows are `NULL`.

Obligations behind the documents: `COMPLIANCE.md`. Cross-border assessment: `EFVP.md`.
Incident response: `BREACH_PLAN.md`.
