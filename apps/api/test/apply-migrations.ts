import { applyD1Migrations, env } from 'cloudflare:test'

// Runs once per test file (isolated storage): bring the D1 schema up to date.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
