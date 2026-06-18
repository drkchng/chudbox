// All color values are space-separated RGB channels (e.g. "249 115 22")
// so Tailwind's opacity modifiers like bg-accent/10 work correctly.

export interface ThemeColors {
  accent: string
  accentDim: string
  dark: string
  surface: string
  surface2: string
  border: string
}

export interface Theme extends ThemeColors {
  id: string
  name: string
  preview: string
}

export const THEMES: Theme[] = [
  {
    id: 'garage',
    name: 'Garage',
    preview: '#f97316',
    accent:    '249 115 22',
    accentDim: '234 88 12',
    dark:      '15 15 15',
    surface:   '26 26 26',
    surface2:  '36 36 36',
    border:    '45 45 45',
  },
  {
    id: 'racing',
    name: 'Racing Red',
    preview: '#ef4444',
    accent:    '239 68 68',
    accentDim: '220 38 38',
    dark:      '15 10 10',
    surface:   '28 18 18',
    surface2:  '40 24 24',
    border:    '58 30 30',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    preview: '#38bdf8',
    accent:    '56 189 248',
    accentDim: '14 165 233',
    dark:      '3 7 18',
    surface:   '15 23 42',
    surface2:  '26 38 64',
    border:    '30 50 80',
  },
  {
    id: 'emerald',
    name: 'Emerald',
    preview: '#10b981',
    accent:    '16 185 129',
    accentDim: '5 150 105',
    dark:      '10 15 10',
    surface:   '17 26 20',
    surface2:  '26 42 30',
    border:    '30 55 36',
  },
  {
    id: 'violet',
    name: 'Violet',
    preview: '#a855f7',
    accent:    '168 85 247',
    accentDim: '147 51 234',
    dark:      '12 8 18',
    surface:   '22 16 32',
    surface2:  '34 24 50',
    border:    '48 32 70',
  },
  {
    id: 'ghost',
    name: 'Ghost',
    preview: '#e2e8f0',
    accent:    '226 232 240',
    accentDim: '203 213 225',
    dark:      '10 10 10',
    surface:   '20 20 20',
    surface2:  '30 30 30',
    border:    '44 44 44',
  },
]

export const DEFAULT_THEME_ID = 'garage'

/** The CSS custom properties a theme drives (the only vars apply/capture touch). */
export const THEME_VAR_NAMES = [
  '--accent',
  '--accent-dim',
  '--dark',
  '--surface',
  '--surface-2',
  '--border',
] as const

/**
 * The subset of CSSStyleDeclaration the theme helpers use. Declared as a seam so
 * the pure capture/restore logic is unit-testable without a DOM (the web test
 * runner is `node`): tests pass a plain in-memory map of var → value.
 */
export type ThemeStyleTarget = Pick<
  CSSStyleDeclaration,
  'getPropertyValue' | 'setProperty' | 'removeProperty'
>

function documentRootStyle(): ThemeStyleTarget {
  return document.documentElement.style
}

function applyTheme(theme: ThemeColors, style: ThemeStyleTarget = documentRootStyle()): void {
  style.setProperty('--accent',     theme.accent)
  style.setProperty('--accent-dim', theme.accentDim)
  style.setProperty('--dark',       theme.dark)
  style.setProperty('--surface',    theme.surface)
  style.setProperty('--surface-2',  theme.surface2)
  style.setProperty('--border',     theme.border)
}

/**
 * Snapshot the current theme CSS variables so a transient theme change (e.g. the
 * public share viewer honoring the shared car's theme) can be UNDONE on the way
 * out. Captures the inline value of each var ('' when none is set).
 */
export function captureThemeVars(
  style: ThemeStyleTarget = documentRootStyle(),
): Record<string, string> {
  const snapshot: Record<string, string> = {}
  for (const name of THEME_VAR_NAMES) snapshot[name] = style.getPropertyValue(name)
  return snapshot
}

/**
 * Restore a snapshot from captureThemeVars: re-set each var to its prior inline
 * value, or remove it when it had none (so the document is left exactly as it
 * was before the transient apply, never pinned to a stale theme).
 */
export function restoreThemeVars(
  snapshot: Record<string, string>,
  style: ThemeStyleTarget = documentRootStyle(),
): void {
  for (const name of THEME_VAR_NAMES) {
    const value = snapshot[name]
    if (value) style.setProperty(name, value)
    else style.removeProperty(name)
  }
}

// Convert a hex color (#rrggbb) to space-separated RGB channels
function hexToRgbChannels(hex: string): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `${r} ${g} ${b}`
}

// Slightly darken an RGB channels string for the dim variant
function darkenChannels(channels: string, amount = 20): string {
  const [r, g, b] = channels.split(' ').map(Number)
  return `${Math.max(0, r - amount)} ${Math.max(0, g - amount)} ${Math.max(0, b - amount)}`
}

/**
 * Resolve + apply a theme from stored settings (a built-in theme id, or
 * `'custom'` + an accent hex). Shared by the App-level effect and the public
 * share viewer so both honor the same theming rules.
 */
export function applyThemeFromSettings(
  themeId: string,
  customAccent?: string | null,
  style: ThemeStyleTarget = documentRootStyle(),
): void {
  if (themeId === 'custom' && customAccent) {
    const accent    = hexToRgbChannels(customAccent)
    const accentDim = darkenChannels(accent, 25)
    applyTheme({
      accent, accentDim,
      dark:     '15 15 15',
      surface:  '26 26 26',
      surface2: '36 36 36',
      border:   '45 45 45',
    }, style)
  } else {
    const theme = THEMES.find((t) => t.id === themeId) ?? THEMES[0]
    applyTheme(theme, style)
  }
}
