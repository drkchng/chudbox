/**
 * Flow 4 — modal dismissal (AddCarModal, now built on the Base UI <Modal>):
 * Escape and an OUTSIDE click close it; an INSIDE click does not.
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

test('an outside click closes the Add Car modal', async ({ page }) => {
  await page.goto('/')
  await openAddCar(page)

  // Click the top-left corner — clear of the centered dialog popup — so Base UI's
  // outside-press dismissal fires. The popup is centered and never reaches there.
  await page.mouse.click(5, 5)
  await expect(heading(page)).toBeHidden()
})

test('clicking inside the modal content does NOT close it', async ({ page }) => {
  await page.goto('/')
  await openAddCar(page)

  // A click that originates on the content (an input) must not bubble to a close.
  await page.getByPlaceholder('2020').click()
  await expect(heading(page)).toBeVisible()
})
