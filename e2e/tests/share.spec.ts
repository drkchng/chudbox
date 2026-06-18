/**
 * Flow 5 — share links. Sign in, sync a car (+mod) to the owner's Durable
 * Object, create a public share link, and open it in a FRESH logged-out context:
 *   • curated link  → read-only build showcase, no edit controls, no private sections
 *   • "Everything"  → adds the Wishlist / To-Do / Issues sections (still read-only)
 *
 * This is the heaviest flow: it exercises the full pipeline (auth → WebSocket
 * sync → seed/verify-seed into the DO → D1 share row → public snapshot). The
 * `waitForSynced` gate (verify-seed) is what guarantees the car is in the DO
 * before a link is created.
 */
import { expect, test } from '@playwright/test'
import type { Browser, Page } from '@playwright/test'
import { addCar, addMod, openCar, signUpAndVerify, uniqueEmail, waitForSynced } from '../harness/actions'

const CAR = { year: '2020', make: 'Toyota', model: 'Supra', mileage: '100000' }

test('curated + "Everything" share links render read-only for a logged-out visitor', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000) // full auth + sync + sharing pipeline

  // --- Local-first: a car with a mod, while logged out ---
  await page.goto('/')
  await addCar(page, CAR)
  await openCar(page, CAR)
  await addMod(page, 'Coilover Kit')
  await page.goto('/')

  // --- Account + sync (verify-seed guarantees the car reached the DO) ---
  await signUpAndVerify(page, { name: 'Ada Lovelace', email: uniqueEmail('share'), password: 'correct-horse-battery-staple' })
  await waitForSynced(page)

  await openCar(page, CAR)

  // --- Curated link → read-only showcase ---
  const curatedToken = await createShareLink(page, 'curated')
  await assertCuratedView(browser, curatedToken)

  // --- "Everything" link → adds the private sections (still read-only) ---
  const fullToken = await createShareLink(page, 'full')
  await assertFullView(browser, fullToken)
})

/** Open the Share dialog, create a link of `scope`, return its token, close the dialog. */
async function createShareLink(page: Page, scope: 'curated' | 'full'): Promise<string> {
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Share build' })).toBeVisible()

  if (scope === 'full') await page.getByRole('radio', { name: /Everything/ }).click()
  await page.getByRole('button', { name: 'Create link' }).click()

  // The freshly-created link is shown once in a read-only input.
  const input = page.getByLabel('Share link URL')
  await expect(input).toBeVisible()
  const url = await input.inputValue()
  const token = url.split('/share/')[1]
  expect(token, 'created share URL should contain a /share/:token').toBeTruthy()

  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Share build' })).toBeHidden()
  return token
}

async function assertCuratedView(browser: Browser, token: string): Promise<void> {
  const context = await browser.newContext() // fresh, logged-out
  try {
    const guest = await context.newPage()
    await guest.goto(`/share/${token}`)

    await expect(guest.getByText('Read-only shared build')).toBeVisible()
    await expect(guest.getByRole('heading', { name: '2020 Toyota Supra' })).toBeVisible()

    await guest.getByRole('button', { name: 'Mods', exact: true }).click()
    await expect(guest.getByText('Coilover Kit', { exact: true })).toBeVisible()

    // No owner/edit controls…
    await expect(guest.getByRole('button', { name: 'Edit' })).toHaveCount(0)
    await expect(guest.getByRole('button', { name: 'Add Mod' })).toHaveCount(0)
    await expect(guest.getByRole('button', { name: 'Settings' })).toHaveCount(0)
    // …and none of the private "Everything" sections.
    await expect(guest.getByRole('button', { name: 'Wishlist' })).toHaveCount(0)
    await expect(guest.getByRole('button', { name: 'Issues' })).toHaveCount(0)
  } finally {
    await context.close()
  }
}

async function assertFullView(browser: Browser, token: string): Promise<void> {
  const context = await browser.newContext() // fresh, logged-out
  try {
    const guest = await context.newPage()
    await guest.goto(`/share/${token}`)

    await expect(guest.getByText('Read-only shared build')).toBeVisible()
    await expect(guest.getByRole('heading', { name: '2020 Toyota Supra' })).toBeVisible()

    // The extra sections the curated view withholds are present in 'full'…
    await expect(guest.getByRole('button', { name: 'Wishlist', exact: true })).toBeVisible()
    await expect(guest.getByRole('button', { name: 'To-Do', exact: true })).toBeVisible()
    await expect(guest.getByRole('button', { name: 'Issues', exact: true })).toBeVisible()
    // …but it is still strictly read-only.
    await expect(guest.getByRole('button', { name: 'Edit' })).toHaveCount(0)
    await expect(guest.getByRole('button', { name: 'Add Mod' })).toHaveCount(0)
  } finally {
    await context.close()
  }
}
