import { defineConfig } from 'drizzle-kit'

// Generate-only config: `pnpm --filter api exec drizzle-kit generate` emits
// SQL migrations into ./drizzle, and wrangler applies them to D1 (the
// `migrations_dir` in wrangler.jsonc points at the same directory).
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
})
