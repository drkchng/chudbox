/**
 * Legal / consent constants shared by the web app (renders the documents,
 * sends the accepted version at sign-up) and the API (requires the accepted
 * version before creating an account; see `user.additionalFields` in
 * apps/api/src/auth.ts).
 *
 * Bump TOS_VERSION only for material Terms changes that require fresh
 * consent; update the matching effective date in the same commit.
 */
export const TOS_VERSION = 1

export const TERMS_EFFECTIVE_DATE = '2026-07-09'
export const PRIVACY_EFFECTIVE_DATE = '2026-07-09'

/**
 * Published contact for privacy rights requests and content reports, and
 * the Law 25 s.3.1 contact for the person responsible for the protection of
 * personal information. Delivery relies on a Cloudflare Email Routing rule
 * forwarding this address (see docs/DEPLOY.md).
 */
export const LEGAL_CONTACT_EMAIL = 'privacy@chudbox.com'
