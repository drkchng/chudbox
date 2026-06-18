/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // `font-mono` had no custom mapping, so it resolved to Tailwind's
        // default system-mono stack and the CDN's JetBrains Mono never
        // actually rendered. Map it explicitly to the self-hosted family
        // (registered as 'JetBrains Mono' by @fontsource) with the standard
        // mono fallback chain so it no longer silently falls back.
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Monaco',
          'Consolas',
          'Liberation Mono',
          'Courier New',
          'monospace',
        ],
      },
      colors: {
        accent:      'rgb(var(--accent)    / <alpha-value>)',
        'accent-dim':'rgb(var(--accent-dim)/ <alpha-value>)',
        dark:        'rgb(var(--dark)      / <alpha-value>)',
        surface:     'rgb(var(--surface)   / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        border:      'rgb(var(--border)    / <alpha-value>)',
      },
    },
  },
  plugins: [],
}
