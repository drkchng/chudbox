/**
 * Flow 4 — modal dismissal (AddCarModal, via the shared useModalDismiss hook):
 * Escape and an OUTSIDE (backdrop) click close it; an INSIDE click does not.
 */
import { expect, test } from '@playwright/test'

const heading = (page: import('@playwright/test').Page) =>
  page.getByRole('heading', { name: 'Add car' })

async function openAddCar(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Add Car', exact: true }).click()
  await expect(heading(page)).toBeVisible()
}

test('Escape closes the Add Car modal', async ({ page }) => {
  await page.goto('/')
  await openAddCar(page)

  await page.keyboard.press('Escape')
  await expect(heading(page)).toBeHidden()
})

test('a backdrop click closes the Add Car modal', async ({ page }) => {
  await page.goto('/')
  await openAddCar(page)

  // Click the backdrop's top-left corner — clear of the centered modal content,
  // so the dismiss handler fires (event.target === the backdrop).
  await page.locator('.modal-backdrop').click({ position: { x: 5, y: 5 } })
  await expect(heading(page)).toBeHidden()
})

test('clicking inside the modal content does NOT close it', async ({ page }) => {
  await page.goto('/')
  await openAddCar(page)

  // A click that originates on the content (an input) must not bubble to a close.
  await page.getByPlaceholder('2020').click()
  await expect(heading(page)).toBeVisible()
})
