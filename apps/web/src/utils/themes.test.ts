// Theme capture/restore guardrails for the public share viewer. The web test
// runner is `node` (no DOM), so the theme helpers take an injectable
// ThemeStyleTarget — here an in-memory map standing in for
// `document.documentElement.style`. These tests assert the property the
// SharePage effect relies on: applying a shared car's theme is fully UNDONE on
// the way out, so it never persists into the rest of the app.
import { describe, expect, it } from 'vitest'
import {
  THEME_VAR_NAMES,
  applyThemeFromSettings,
  captureThemeVars,
  restoreThemeVars,
} from './themes'
import type { ThemeStyleTarget } from './themes'

/** An in-memory CSSStyleDeclaration stand-in (only the 3 methods the helpers use). */
function fakeStyle() {
  const map = new Map<string, string>()
  const style: ThemeStyleTarget = {
    getPropertyValue: (prop: string) => map.get(prop) ?? '',
    setProperty: (prop: string, value: string | null) => {
      map.set(prop, value ?? '')
    },
    removeProperty: (prop: string) => {
      const prev = map.get(prop) ?? ''
      map.delete(prop)
      return prev
    },
  }
  return { style, map }
}

describe('theme capture/restore (share viewer cleanup)', () => {
  it('restores the prior theme vars after a transient apply', () => {
    const { style } = fakeStyle()
    // The app's own theme is active first.
    applyThemeFromSettings('racing', undefined, style)
    const prior = captureThemeVars(style)

    // SharePage applies the SHARED car's theme while mounted...
    applyThemeFromSettings('midnight', undefined, style)
    expect(captureThemeVars(style)).not.toEqual(prior)

    // ...and the effect cleanup restores the prior theme on unmount/navigation.
    restoreThemeVars(prior, style)
    expect(captureThemeVars(style)).toEqual(prior)
  })

  it('removes theme vars that had no prior value on restore (no stale pin)', () => {
    const { style, map } = fakeStyle()
    // Nothing set yet → capture is all-empty.
    const prior = captureThemeVars(style)
    for (const name of THEME_VAR_NAMES) expect(prior[name]).toBe('')

    // Transient apply sets the vars...
    applyThemeFromSettings('midnight', undefined, style)
    expect(map.size).toBeGreaterThan(0)

    // ...restore wipes them back to nothing set (not a stale theme).
    restoreThemeVars(prior, style)
    for (const name of THEME_VAR_NAMES) expect(style.getPropertyValue(name)).toBe('')
    expect(map.size).toBe(0)
  })

  it('captures + restores a custom-accent theme too', () => {
    const { style } = fakeStyle()
    applyThemeFromSettings('custom', '#ff8800', style)
    const prior = captureThemeVars(style)
    expect(prior['--accent']).not.toBe('')

    applyThemeFromSettings('garage', undefined, style)
    restoreThemeVars(prior, style)
    expect(captureThemeVars(style)).toEqual(prior)
  })

  it('falls back to the default theme for an unknown id, and is still restorable', () => {
    const { style } = fakeStyle()
    applyThemeFromSettings('emerald', undefined, style)
    const prior = captureThemeVars(style)

    applyThemeFromSettings('no-such-theme', undefined, style)
    const fallback = captureThemeVars(style)
    // Unknown id resolves to the first built-in (garage) — a real theme, not blank.
    expect(fallback['--accent']).not.toBe('')

    restoreThemeVars(prior, style)
    expect(captureThemeVars(style)).toEqual(prior)
  })
})
