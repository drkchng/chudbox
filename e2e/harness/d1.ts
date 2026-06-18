/**
 * Read the ISOLATED local D1 the harness boots, via `wrangler d1 execute
 * --local --persist-to <state> --json`. Used by specs for server-side ground
 * truth (e.g. asserting `email_verified` flipped) independent of the UI.
 *
 * Same `--persist-to` dir as devServer.mjs, so it reads exactly what wrangler
 * dev sees. Returns the `results` row array of the single command.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { API_DIR, STATE_DIR } from './config'

const execFileAsync = promisify(execFile)

interface D1CommandResult<T> {
  results: T[]
  success: boolean
}

/** Run one SQL statement against the local D1 and return its rows. */
export async function queryD1<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const { stdout } = await execFileAsync(
    'pnpm',
    [
      'exec',
      'wrangler',
      'd1',
      'execute',
      'chudbox',
      '--local',
      '--persist-to',
      STATE_DIR,
      '--json',
      '--command',
      sql,
    ],
    {
      cwd: API_DIR,
      env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
      maxBuffer: 16 * 1024 * 1024,
    },
  )
  // `--json` prints a JSON array of command results; tolerate any leading banner
  // text by slicing from the first '[' to the last ']'.
  const start = stdout.indexOf('[')
  const end = stdout.lastIndexOf(']')
  if (start === -1 || end === -1) {
    throw new Error(`unexpected wrangler d1 --json output: ${stdout.slice(0, 200)}`)
  }
  const parsed = JSON.parse(stdout.slice(start, end + 1)) as Array<D1CommandResult<T>>
  return parsed[0]?.results ?? []
}

/** The Better Auth user row for an email, or undefined. `email_verified` is 0/1. */
export async function getUserByEmail(
  email: string,
): Promise<{ email: string; email_verified: number } | undefined> {
  const escaped = email.replace(/'/g, "''")
  const rows = await queryD1<{ email: string; email_verified: number }>(
    `SELECT email, email_verified FROM user WHERE email = '${escaped}'`,
  )
  return rows[0]
}
