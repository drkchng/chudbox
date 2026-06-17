/**
 * Better Auth (1.6.18) configured for Cloudflare Workers + D1 via the drizzle
 * adapter. Option names verified against the installed
 * @better-auth/core/dist/types/init-options.d.mts.
 */
import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { drizzle } from 'drizzle-orm/d1'

import * as schema from './db/schema'
import { sendAuthEmail } from './email'

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
          subject: 'Reset your Chudbox password',
          url,
          text: `Click the link to reset your Chudbox password: ${url}\n\nIf you didn't request this, you can ignore this email.`,
        })
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendAuthEmail(env, {
          to: user.email,
          subject: 'Verify your Chudbox email',
          url,
          text: `Welcome to Chudbox! Verify your email address by clicking: ${url}`,
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
    telemetry: { enabled: false },
  })
}

export type Auth = ReturnType<typeof createAuth>
