/**
 * Open Graph / Twitter meta injection for the public /share/:token document
 * (M5 — link previews). Pure string helpers (no Hono/DO/D1) so they unit-test
 * standalone; the route that wires them to the assets binding + the curated
 * lookup lives in index.ts.
 *
 * SECURITY: every value injected here originates from a CURATED snapshot
 * (PublicCarSnapshot — the strict allowlist), so no private field can reach the
 * preview. On top of that, every interpolated value is HTML-attribute-escaped,
 * so an attacker-controlled make/model/nickname can't break out of the
 * `content="…"` attribute or inject markup into the served document.
 */
import { shareImgPath } from '@chudbox/shared'
import type { PublicCarSnapshot } from '@chudbox/shared'

const SITE_NAME = 'Chudbox'

/**
 * Escape a string for safe interpolation into a double-quoted HTML attribute.
 * Covers the five characters that could otherwise terminate the attribute or
 * the tag, or inject an entity: & < > " '.
 */
export function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Escape a string for safe interpolation as ELEMENT TEXT CONTENT (e.g. inside
 * `<title>…</title>`, which is RCDATA). Escaping `<` is what prevents a
 * `</title>` breakout from an attacker-controlled make/model/nickname; `&` and
 * `>` are escaped too for well-formedness. Quotes are left as-is — they are not
 * special in text content.
 */
export function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** The resolved preview fields for a shared build. */
export interface ShareMeta {
  title: string
  description: string
  /** Absolute, token-scoped, PUBLIC cover-photo URL — omitted when no photo. */
  image?: string
  /** Absolute canonical clean URL of the shared build. */
  url: string
}

/**
 * Derive the preview fields from a CURATED snapshot. Title is built from
 * year/make/model (plus the nickname when set); description is a count line.
 * The image is the public token-scoped cover URL (`/api/share/<token>/img/<id>`,
 * which a crawler fetches with NO session) and is only set when the snapshot
 * resolved a cover photo.
 */
export function shareMetaFromSnapshot(
  snapshot: PublicCarSnapshot,
  token: string,
  origin: string,
): ShareMeta {
  const titleParts = [snapshot.year, snapshot.make, snapshot.model]
    .map((part) => part.trim())
    .filter((part) => part !== '')
  let title = titleParts.join(' ')
  const nickname = snapshot.nickname.trim()
  if (nickname) title = title ? `${title} — ${nickname}` : nickname
  if (!title) title = 'Shared build'

  const mods = snapshot.mods.length
  const records = snapshot.maintenance.length
  const description =
    `${mods} mod${mods === 1 ? '' : 's'} · ` +
    `${records} maintenance record${records === 1 ? '' : 's'} — shared on ${SITE_NAME}`

  const meta: ShareMeta = {
    title,
    description,
    url: `${origin}/share/${encodeURIComponent(token)}`,
  }
  if (snapshot.coverPhotoId !== undefined) {
    meta.image = `${origin}${shareImgPath(token, snapshot.coverPhotoId)}`
  }
  return meta
}

/** Render the OG + Twitter `<meta>` block for a ShareMeta — every value escaped. */
export function renderShareMetaTags(meta: ShareMeta): string {
  const esc = escapeHtmlAttr
  const tags = [
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(SITE_NAME)}" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:url" content="${esc(meta.url)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(meta.title)}" />`,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`,
  ]
  if (meta.image !== undefined) {
    tags.push(`<meta property="og:image" content="${esc(meta.image)}" />`)
    tags.push(`<meta name="twitter:image" content="${esc(meta.image)}" />`)
  }
  return tags.join('\n    ')
}

/**
 * Override the shell's OWN `<title>` element and `<meta name="description">`
 * with the share-specific values. The og/twitter block (renderShareMetaTags)
 * only covers crawlers that read the og: and twitter: tags; this covers the
 * UNIVERSAL fallback — crawlers and unfurlers (and the symptom-reported ones) that read
 * the bare `<title>` and `<meta name="description">`. Without it the generic
 * defaults baked into index.html ("Chudbox — My Garage" + the site blurb) keep
 * winning the preview even though og:* was injected.
 *
 * Each replacement fires at most once and only when the tag exists (the shell
 * has exactly one of each). The `<title>` body is text-escaped (RCDATA) and the
 * description is attribute-escaped, preserving crawler-safety for an
 * attacker-controlled make/model/nickname. Neither regex spans past a `>`/the
 * closing tag, so they can't swallow adjacent markup. Anything not present is
 * left untouched (the og/twitter block still injects).
 */
export function overrideDocumentMeta(html: string, meta: ShareMeta): string {
  // Use replacer FUNCTIONS, not replacement strings: String.replace interprets
  // `$&`, `$$`, `$\``, `$'` and `$n` in a replacement STRING, so an escaped
  // title/description containing such a sequence (e.g. a `$` in a nickname like
  // "Ca$h" or "Big $& Deal") would corrupt the output. A function's return
  // value is inserted verbatim, so the already-escaped value lands exactly.
  const titleTag = `<title>${escapeHtmlText(meta.title)}</title>`
  const descTag = `<meta name="description" content="${escapeHtmlAttr(meta.description)}" />`
  return html
    .replace(/<title>[\s\S]*?<\/title>/i, () => titleTag)
    .replace(/<meta\s+name=(["'])description\1[^>]*>/i, () => descTag)
}

/**
 * Inject a meta block immediately before the first `</head>`. Defensive: if the
 * shell has no `</head>` (it always does), the HTML is returned unchanged so the
 * SPA still loads.
 */
export function injectIntoHead(html: string, block: string): string {
  const idx = html.indexOf('</head>')
  if (idx === -1) return html
  return `${html.slice(0, idx)}    ${block}\n  ${html.slice(idx)}`
}
