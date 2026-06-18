import { defineConfig, devices } from '@playwright/test'

import { BASE_URL } from './e2e/harness/config'

/**
 * Mode 1 — E2E against a LOCAL `wrangler dev` (emulated D1/R2/DO, dev-fallback
 * email). `webServer` runs e2e/harness/devServer.mjs, which builds the SPA,
 * applies D1 migrations to an isolated persistence dir, and boots wrangler dev
 * WITHOUT a RESEND_API_KEY (so verification emails are logged, never sent).
 * Playwright waits on /api/health before the suite runs.
 *
 * Single-worker + non-parallel: every spec drives ONE shared local server
 * (shared D1/DO/R2). Tests stay isolated via unique accounts and fresh browser
 * contexts; serial execution keeps the shared dev server unstressed and the
 * shared email log unambiguous.
 */
export default defineConfig({
  testDir: './e2e/tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Keep artifacts under e2e/ (gitignored there).
  outputDir: './e2e/test-results',
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: './e2e/playwright-report' }]]
    : [['list']],
  use: {
    baseURL: BASE_URL,
    // Deterministic number formatting (mileage grouping uses toLocaleString).
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node e2e/harness/devServer.mjs',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    // Covers the SPA build + migrations + wrangler boot on a cold run.
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
