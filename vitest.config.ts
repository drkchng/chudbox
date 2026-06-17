import { defineConfig } from 'vitest/config'

// Workspace-root vitest runner: discovers each package's vitest.config.ts.
// `pnpm test` (root) runs every project; `turbo run test` runs them per-package.
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
  },
})
