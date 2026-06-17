/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare namespace Cloudflare {
  interface Env {
    // Injected via vitest.config.ts (miniflare.bindings) for the test setup.
    TEST_MIGRATIONS: import('cloudflare:test').D1Migration[]
  }
}
