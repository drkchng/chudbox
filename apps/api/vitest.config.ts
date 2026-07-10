import { fileURLToPath } from 'node:url'
import {
  cloudflareTest,
  readD1Migrations,
} from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

// NOTE: @cloudflare/vitest-pool-workers 0.16.x (Vitest 4) replaced
// `defineWorkersConfig` with the `cloudflareTest()` Vite plugin — verified
// against the installed package's exports.
// fileURLToPath (not `.pathname`) so this resolves correctly on Windows,
// where `.pathname` yields a leading-slash form (e.g. /C:/...) that
// fs.readdirSync mishandles.
const migrationsDir = fileURLToPath(new URL('./drizzle', import.meta.url))

export default defineConfig(async () => {
  const migrations = await readD1Migrations(migrationsDir)
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            // Exposed to tests so the setup file can apply D1 migrations.
            TEST_MIGRATIONS: migrations,
            // wrangler.jsonc's `vars` set the production BETTER_AUTH_URL, which
            // would flip createAuth()'s isLocalDev check to false and make it
            // throw for lack of a real BETTER_AUTH_SECRET. Override back to the
            // dev URL so tests exercise the local-dev auth path, same as before
            // production vars were added.
            BETTER_AUTH_URL: 'http://localhost:8787',
          },
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
