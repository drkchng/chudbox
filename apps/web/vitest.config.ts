import { defineConfig } from 'vitest/config'

// Dedicated test config so vitest does not pull in the app's vite.config.ts
// (react plugin / base path). The M0 smoke tests are pure TS, so node is enough.
export default defineConfig({
  test: {
    name: 'web',
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
