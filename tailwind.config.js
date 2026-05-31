/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
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
