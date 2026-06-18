/**
 * Better Auth (1.6.18) configured for Cloudflare Workers + D1 via the drizzle
 * adapter. Option names verified against the installed
 * @better-auth/core/dist/types/init-options.d.mts.
 */
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { drizzle } from 'drizzle-orm/d1'

import * as schema from './db/schema'
import { renderAuthEmail, sendAuthEmail } from './email'

export interface AuthEnv {
  DB: D1Database
  BETTER_AUTH_SECRET?: string
  BETTER_AUTH_URL?: string
  RESEND_API_KEY?: string
  AUTH_EMAIL_FROM?: string
}

const DEV_BASE_URL = 'http://localhost:8787'

export function createAuth(env: AuthEnv) {
  const baseURL = env.BETTER_AUTH_URL ?? DEV_BASE_URL
  const isLocalDev = baseURL.startsWith('http://localhost')
  // Fail fast outside local dev: without these, Better Auth would silently
  // run with an insecure default secret and localhost cookie/origin behavior.
  if (!isLocalDev && !env.BETTER_AUTH_SECRET) {
    throw new Error('BETTER_AUTH_SECRET must be set when BETTER_AUTH_URL is not localhost')
  }
  const db = drizzle(env.DB, { schema })

  return betterAuth({
    appName: 'Chudbox',
    baseURL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    // The Vite dev server (5173) proxies /api -> 8787 but the browser still
    // sends Origin: http://localhost:5173. Trust it in local dev only.
    trustedOrigins: isLocalDev ? ['http://localhost:5173'] : [],
    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema,
      // D1 has no interactive transactions; execute operations sequentially.
      transaction: false,
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await sendAuthEmail(env, {
          to: user.email,
          url,
          ...renderAuthEmail('reset', url),
        })
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendAuthEmail(env, {
          to: user.email,
          url,
          ...renderAuthEmail('verification', url),
        })
      },
    },
    // Defense-in-depth: Better Auth's default in-memory limiter is per-isolate
    // on Workers (near-useless against distributed abuse). Back it with the
    // D1 `rate_limit` table. `enabled: true` forces it on outside production
    // too, so the behavior is testable locally.
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'rateLimit',
      window: 10,
      max: 100,
    },
    // On Workers the client IP arrives in Cloudflare's `cf-connecting-ip`
    // header; Better Auth's `getIp` only reads `x-forwarded-for` by default, so
    // it found no IP and keyed EVERY rate_limit row on the constant
    // `no-trusted-ip` — one shared per-path bucket that a single client could
    // saturate to lock out all users. Pointing it at `cf-connecting-ip` makes
    // the limiter per-IP again. Option path verified against
    // @better-auth/core 1.6.18 init-options.d.mts: advanced.ipAddress.ipAddressHeaders.
    advanced: {
      ipAddress: {
        ipAddressHeaders: ['cf-connecting-ip'],
      },
    },
    telemetry: { enabled: false },
  })
}

export type Auth = ReturnType<typeof createAuth>
