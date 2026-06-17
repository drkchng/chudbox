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

export function applyTheme(theme: ThemeColors): void {
  const root = document.documentElement
  root.style.setProperty('--accent',     theme.accent)
  root.style.setProperty('--accent-dim', theme.accentDim)
  root.style.setProperty('--dark',       theme.dark)
  root.style.setProperty('--surface',    theme.surface)
  root.style.setProperty('--surface-2',  theme.surface2)
  root.style.setProperty('--border',     theme.border)
}

// Convert a hex color (#rrggbb) to space-separated RGB channels
export function hexToRgbChannels(hex: string): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16)
  const g = parseInt(clean.slice(2, 4), 16)
  const b = parseInt(clean.slice(4, 6), 16)
  return `${r} ${g} ${b}`
}

// Slightly darken an RGB channels string for the dim variant
export function darkenChannels(channels: string, amount = 20): string {
  const [r, g, b] = channels.split(' ').map(Number)
  return `${Math.max(0, r - amount)} ${Math.max(0, g - amount)} ${Math.max(0, b - amount)}`
}
