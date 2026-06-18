/**
 * Flow 2 — DEC-4 log-first: adding a car navigates STRAIGHT to its profile
 * (/car/:id, defaulting to the Mods tab) with the add-mod form open + focused;
 * log a mod and confirm it renders. Fully local-first: no account required.
 */
import { expect, test } from '@playwright/test'
import { addCar, addMod } from '../harness/actions'

const CAR = { year: '2020', make: 'Toyota', model: 'Supra', mileage: '45000' }

test('add a car, land on /car/:id (Mods), and log a mod that appears', async ({ page }) => {
  await page.goto('/')

  // Empty state first.
  await expect(page.getByRole('heading', { name: 'Nothing here yet' })).toBeVisible()

  // Creating a car navigates straight to the new car's clean /car/:id route
  // (the modal dismisses itself), landing on the Mods tab.
  await addCar(page, CAR)
  await expect(page).toHaveURL(/\/car\/[^/]+$/)
  await expect(page.getByRole('heading', { name: '2020 Toyota Supra' })).toBeVisible()

  // The Mods add-form is already open + focused (log-first); log a mod and it
  // appears in the Mods list.
  await addMod(page, 'Coilover Kit')
  await expect(page.getByText('Coilover Kit', { exact: true })).toBeVisible()
})
