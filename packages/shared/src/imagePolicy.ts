// Single source of truth for the image pipeline's quality/archival policy
// (BACKEND_PLAN.md "Image pipeline"; milestone M3). Quality is TIERED BY PLAN —
// only the FREE tier exists today, and EVERY quality/archival knob is routed
// through this one ImagePolicy seam so a future paid tier flips the policy
// without re-architecting the pipeline. Do NOT add plan-detection / billing /
// entitlement logic here — that is unplanned scope; the policy is a plain
// constant the encoder and upload route both read.
//
// RN-safe: pure data + arithmetic/string helpers, NO DOM/canvas/Node imports
// (the browser encoder in apps/web reads these constants; this file itself
// never touches a canvas), so the eslint no-restricted-globals guard stays green.

/**
 * Image formats the canvas encoder may produce. Safari/iOS silently ignores the
 * WebP request and falls back to PNG/JPEG, so the pipeline MUST feature-detect
 * the actually-produced Blob.type and store THAT (see extForContentType). AVIF
 * canvas encode is Chrome-only — deliberately excluded.
 */
export type ImageContentType = 'image/webp' | 'image/jpeg'

/** File extension matching an ImageContentType (used in the r2Key suffix). */
export type PhotoExt = 'webp' | 'jpg'

export type ImagePolicy = {
  /** Longest edge (px) the stored image is downscaled to. Source is NEVER upscaled. */
  maxEdgePx: number
  /** Lossy encode quality (0..1) passed to canvas.toBlob. */
  quality: number
  /** Whether to also archive the pristine original (FREE: false — downscaled-only). */
  keepOriginals: boolean
  /**
   * Formats the encoder tries, in order, feature-detecting each (attempt WebP,
   * keep it iff the produced Blob.type === 'image/webp'; otherwise fall through
   * to JPEG). The ACTUAL produced format — never this preference — decides the key.
   */
  preferredFormats: readonly ImageContentType[]
}

/**
 * The ONLY policy that exists today. FREE tier: 1600px long edge, q≈0.78,
 * downscaled-only (no pristine archive). A future paid tier is simply a
 * different ImagePolicy constant read through the same seam.
 */
export const FREE_IMAGE_POLICY = {
  maxEdgePx: 1600,
  quality: 0.78,
  keepOriginals: false,
  preferredFormats: ['image/webp', 'image/jpeg'],
} as const satisfies ImagePolicy

/**
 * Target pixel size for the downscale: preserves aspect ratio with the long edge
 * clamped to policy.maxEdgePx, and NEVER upscales (returns the source size when
 * it already fits). Pure — the caller feeds {w,h} to createImageBitmap's
 * resizeWidth/resizeHeight. Non-finite / non-positive inputs collapse to a 1px
 * floor so the result is always a usable positive integer size.
 */
export function computeTargetSize(
  srcW: number,
  srcH: number,
  policy: ImagePolicy,
): { w: number; h: number } {
  const w0 = Number.isFinite(srcW) && srcW > 0 ? srcW : 1
  const h0 = Number.isFinite(srcH) && srcH > 0 ? srcH : 1
  const longEdge = Math.max(w0, h0)
  if (longEdge <= policy.maxEdgePx) {
    // Already within the cap — never upscale.
    return { w: Math.round(w0), h: Math.round(h0) }
  }
  const scale = policy.maxEdgePx / longEdge
  return {
    w: Math.max(1, Math.round(w0 * scale)),
    h: Math.max(1, Math.round(h0 * scale)),
  }
}

/**
 * Extension for an actually-produced content type. WebP → 'webp'; everything
 * else (i.e. the JPEG fallback path) → 'jpg'. Callers pass the produced
 * Blob.type, so the key extension always reflects what was REALLY encoded.
 */
export function extForContentType(type: string): PhotoExt {
  return type === 'image/webp' ? 'webp' : 'jpg'
}

/** Inverse of extForContentType: 'webp' → image/webp; 'jpg'/'jpeg'/other → image/jpeg. */
export function contentTypeForExt(ext: string): ImageContentType {
  return ext === 'webp' ? 'image/webp' : 'image/jpeg'
}
