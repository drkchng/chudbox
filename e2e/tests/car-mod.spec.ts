/**
 * Flow 2 — add a car, open its profile (/car/:id), log a mod, and confirm the
 * mod renders. Fully local-first: no account required.
 */
import { expect, test } from '@playwright/test'
import { addCar, addMod, openCar } from '../harness/actions'

const CAR = { year: '2020', make: 'Toyota', model: 'Supra', mileage: '45000' }

test('add a car, open it on /car/:id, and log a mod that appears', async ({ page }) => {
  await page.goto('/')

  // Empty state first.
  await expect(page.getByRole('heading', { name: 'Nothing here yet' })).toBeVisible()

  await addCar(page, CAR)

  // The new car shows as a card in the garage.
  await expect(page.getByRole('heading', { name: 'Toyota Supra', exact: true })).toBeVisible()

  // Opening the card navigates to the clean /car/:id route.
  await openCar(page, CAR)
  await expect(page.getByRole('heading', { name: '2020 Toyota Supra' })).toBeVisible()

  // Log a mod; it appears in the Mods list.
  await addMod(page, 'Coilover Kit')
  await expect(page.getByText('Coilover Kit', { exact: true })).toBeVisible()
})
