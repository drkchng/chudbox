// Design-token SSOT — the single, platform-agnostic source of truth for the
// Chudbox visual system (DEC-15 / DEC-17). PLAIN DATA + TYPES ONLY: no DOM, no
// Tailwind, no CSS, no Node. The web's Tailwind v4 `@theme` is GENERATED from
// this object (see apps/web/scripts/generate-theme-css.mjs) and a future React
// Native app imports the same values directly — neither side hand-duplicates.
//
// Colors are stored as space-separated RGB channel triples ("249 115 22") so the
// web can wrap them in `rgb(var(--x))` and keep Tailwind opacity modifiers
// (bg-accent/40) working; RN can split the triple into an rgb() string.

/** Space-separated RGB channels, e.g. "249 115 22". */
export type Rgb = string

/** A semantic status color, AA-paired (bg/text); `border` is a decorative tint. */
export interface StatusTriple {
  /** fill / background channel */
  bg: Rgb
  /** foreground text channel (>= AA on `bg`) */
  text: Rgb
  /** border tint channel */
  border: Rgb
}

/** Font size + its paired line-height, in px. */
export interface TypeStep {
  size: number
  leading: number
}

export const tokens = {
  /**
   * Theme channels — the palette vars themes.ts rewrites at runtime on
   * documentElement to switch presets (DEC-3, accent-only on a fixed dark ramp).
   * The web emits each as a `:root` channel (`--accent: r g b`) AND a Tailwind
   * color (`--color-accent: rgb(var(--accent))`), so bg-accent / text-accent /
   * bg-accent/40 stay both token-driven and runtime-swappable.
   *
   * onAccent (DEC-2): near-black label on the orange fill — white-on-orange
   * fails AA. accentStrong (~18% darker): for mid-luminance fills / hover.
   */
  themeChannels: {
    accent: '249 115 22',
    accentDim: '234 88 12',
    accentStrong: '202 76 14',
    onAccent: '15 15 15',
    dark: '15 15 15',
    surface: '26 26 26',
    surface2: '36 36 36',
    border: '45 45 45',
  },

  /** Foreground text ramp (static; each AA-floored on the dark surface ramp). */
  text: {
    /** #e5e5e5 — 11.8:1, body default */
    primary: '229 229 229',
    /** gray-400 #9ca3af — 6.86:1 */
    secondary: '156 163 175',
    /** gray-500 #6b7280 — large / non-body text only */
    tertiary: '107 114 128',
    /** gray-600 #4b5563 — disabled, exempt from AA */
    disabled: '75 85 99',
  },

  /**
   * Semantic status triples (DEC: Sold -> neutral, status-orange -> warning).
   * bg/text are AA-paired; border is decorative. Consumed by the .badge-*
   * classes and bg-danger / text-danger-fg / border-danger-border utilities.
   */
  status: {
    danger: { bg: '69 10 10', text: '252 165 165', border: '127 29 29' },
    warning: { bg: '67 26 3', text: '252 211 77', border: '146 64 14' },
    success: { bg: '5 46 22', text: '134 239 172', border: '22 101 52' },
    info: { bg: '8 47 73', text: '125 211 252', border: '7 89 133' },
    neutral: { bg: '38 38 38', text: '212 212 212', border: '64 64 64' },
  } satisfies Record<string, StatusTriple>,

  /** Corner radii (px). pill = fully rounded. */
  radius: { sm: 4, md: 8, lg: 12, xl: 16, pill: 9999 },

  /** Icon sizes (px) — for the `size` prop (lucide) / RN; not Tailwind utilities. */
  iconSize: { xs: 12, sm: 14, md: 18, lg: 24, xl: 36, '2xl': 48, '3xl': 64 },

  /** Type scale — font-size / line-height (px). Weight is applied per use. */
  type: {
    meta: { size: 12, leading: 16 },
    body: { size: 14, leading: 20 },
    subhead: { size: 16, leading: 22 },
    title: { size: 20, leading: 24 },
    hero: { size: 30, leading: 34 },
  } satisfies Record<string, TypeStep>,

  /** Font stacks (self-hosted via @fontsource). */
  font: {
    sans: "'Inter', system-ui, sans-serif",
    mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },

  /**
   * Elevation — one minimal drop, paired with a border ring (no soft-shadow
   * stacks; shadow-2xl is the named brand anti-reference). Hover lift is a
   * border-color change to accent/30, not an added shadow.
   */
  elevation: '0 8px 24px -12px rgb(0 0 0 / 0.5)',

  /** Card density (px) — informs .card (p-5) and .card-row (px-4 py-3). */
  density: { card: 20, cardRowX: 16, cardRowY: 12 },

  /** Focus ring (px) — informs the global .focus-ring (ring-2 + offset-2). */
  focus: { ringWidth: 2, ringOffset: 2 },
} as const

export type Tokens = typeof tokens
export type StatusRole = keyof typeof tokens.status
