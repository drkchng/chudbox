/**
 * To-Do + Wishlist EDIT flows (the bug-report fix): both tabs historically had
 * add/toggle/delete but no edit affordance, so a typo'd task or a changed part
 * price was stuck forever. Fully local-first: no account required.
 */
import { expect, test } from '@playwright/test'
import { addCar } from '../harness/actions'

const CAR = { year: '2019', make: 'Mazda', model: 'MX-5', mileage: '60000' }

test('edit a to-do task text + priority in place', async ({ page }) => {
  await page.goto('/')
  await addCar(page, CAR)

  await page.getByRole('tab', { name: 'To-Do' }).click()
  await page.getByLabel('New task').fill('Replace break pads')
  await page.getByLabel('Priority').selectOption('low')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByText('Replace break pads')).toBeVisible()

  // Fix the typo and bump the priority via the pencil. (The add form stays on
  // screen, so the edit form's Task/Priority controls need disambiguation.)
  await page.getByRole('button', { name: 'Edit task: Replace break pads' }).click()
  await page.getByLabel('Task', { exact: true }).fill('Replace brake pads')
  await page.getByLabel('Priority').last().selectOption('high')
  await page.getByRole('button', { name: 'Save' }).click()

  const row = page.locator('.card', { hasText: 'Replace brake pads' })
  await expect(row).toBeVisible()
  await expect(page.getByText('Replace break pads')).toHaveCount(0)
  await expect(row.getByText('High', { exact: true })).toBeVisible()
})

test('edit a wishlist part name + price in place', async ({ page }) => {
  await page.goto('/')
  await addCar(page, CAR)

  await page.getByRole('tab', { name: 'Wishlist' }).click()
  await page.getByRole('button', { name: 'Add part' }).click()
  await page.getByLabel('Part name *').fill('Coilover Kit')
  await page.getByLabel('Price').fill('499.99')
  await page.getByRole('button', { name: 'Add part' }).last().click()
  await expect(page.getByText('Coilover Kit', { exact: true })).toBeVisible()

  // Rename + reprice via the pencil.
  await page.getByRole('button', { name: 'Edit part: Coilover Kit' }).click()
  await page.getByLabel('Part name *').fill('Öhlins Coilover Kit')
  await page.getByLabel('Price').fill('1299')
  await page.getByRole('button', { name: 'Save' }).click()

  await expect(page.getByText('Öhlins Coilover Kit', { exact: true })).toBeVisible()
  await expect(page.getByText('$1,299.00', { exact: true })).toBeVisible()
})
