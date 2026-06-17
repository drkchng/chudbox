import {
  cloudflareTest,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// NOTE: @cloudflare/vitest-pool-workers 0.16.x (Vitest 4) replaced
// `defineWorkersConfig` with the `cloudflareTest()` Vite plugin — verified
// against the installed package's exports.
const migrationsDir = new URL('./drizzle', import.meta.url).pathname

export default defineConfig(async () => {
  const migrations = await readD1Migrations(migrationsDir)
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          // Exposed to tests so the setup file can apply D1 migrations.
          bindings: { TEST_MIGRATIONS: migrations },
        },
      }),
    ],
    test: {
      name: 'api',
      include: ['test/**/*.test.ts'],
      setupFiles: ['test/apply-migrations.ts'],
    },
  }
})
