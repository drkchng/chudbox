/**
 * D1 schema: Better Auth core tables + share_links.
 *
 * The Better Auth tables are hand-written to match what better-auth@1.6.18
 * expects (verified against @better-auth/core/dist/db/get-tables.mjs and the
 * db/schema/*.d.mts zod schemas in the installed package):
 *   - user:         name, email (unique), emailVerified, image?, createdAt, updatedAt
 *   - session:      expiresAt, token (unique), createdAt, updatedAt, ipAddress?,
 *                   userAgent?, userId (FK -> user.id, cascade, indexed)
 *   - account:      accountId, providerId, userId (FK, indexed), accessToken?,
 *                   refreshToken?, idToken?, accessTokenExpiresAt?,
 *                   refreshTokenExpiresAt?, scope?, password?, createdAt, updatedAt
 *   - verification: identifier (indexed), value, expiresAt, createdAt, updatedAt
 *   - rateLimit:    key (unique), count, lastRequest — created because we run the
 *                   built-in rate limiter with `storage: "database"` (the in-memory
 *                   limiter is per-isolate on Workers and therefore useless).
 *
 * The drizzle adapter looks tables up by *model name* (`user`, `session`, ...)
 * and fields by *fieldName* (camelCase), so the exported const names and the TS
 * property keys below must not be renamed. SQL column names are snake_case;
 * drizzle maps between the two.
 *
 * Date fields use integer timestamp_ms: the adapter passes Date objects through
 * to drizzle (supportsDates defaults to true) and re-hydrates them on read.
 */
import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' })
    .notNull()
    .default(false),
  image: text('image'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_user_id_idx').on(t.userId)],
)

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', {
      mode: 'timestamp_ms',
    }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', {
      mode: 'timestamp_ms',
    }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('account_user_id_idx').on(t.userId)],
)

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
)

export const rateLimit = sqliteTable('rate_limit', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: integer('last_request').notNull(),
})

/**
 * share_links — exactly per docs/BACKEND_PLAN.md DDL.
 *
 * - token_hash is sha256(rawToken); the raw token is shown once at creation.
 * - car_id is a SOFT reference (the car lives in the owner's Durable Object,
 *   so no FK is possible).
 * - created_at / expires_at / revoked_at are epoch SECONDS (pinned repo-wide;
 *   distinct from the Better Auth tables above, which store ms because that is
 *   what the adapter writes).
 * - view_count is a soft, public hit counter: POST /api/share/:token/view bumps
 *   it for VALID links only. Additive column (added in drizzle/0001), NOT NULL
 *   DEFAULT 0 so every pre-existing row reads as 0.
 */
export const shareLinks = sqliteTable(
  'share_links',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    carId: text('car_id').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at'),
    revokedAt: integer('revoked_at'),
    viewCount: integer('view_count').notNull().default(0),
  },
  (t) => [
    index('share_links_user_car').on(t.userId, t.carId),
    check(
      'share_links_expires_after_created',
      sql`${t.expiresAt} IS NULL OR ${t.expiresAt} > ${t.createdAt}`,
    ),
    check(
      'share_links_revoked_not_before_created',
      sql`${t.revokedAt} IS NULL OR ${t.revokedAt} >= ${t.createdAt}`,
    ),
  ],
)
