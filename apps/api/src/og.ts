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
 * Inject a meta block immediately before the first `</head>`. Defensive: if the
 * shell has no `</head>` (it always does), the HTML is returned unchanged so the
 * SPA still loads.
 */
export function injectIntoHead(html: string, block: string): string {
  const idx = html.indexOf('</head>')
  if (idx === -1) return html
  return `${html.slice(0, idx)}    ${block}\n  ${html.slice(idx)}`
}
