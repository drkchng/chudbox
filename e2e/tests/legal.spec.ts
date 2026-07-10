/**
 * Legal pages + consent surface: the /terms and /privacy pages render and are
 * reachable from the garage footer, and the sign-up consent checkbox exists,
 * is required, and is never pre-checked (Law 25 s.14 consent hygiene).
 */
import { expect, test } from '@playwright/test'
import { openSettings } from '../harness/actions'

test('garage footer links to the legal pages and both render', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('link', { name: 'Terms of Service' }).click()
  await expect(page).toHaveURL('/terms')
  await expect(page.getByRole('heading', { name: 'Terms of Service', level: 1 })).toBeVisible()
  await expect(page.getByText(/Effective \d{4}-\d{2}-\d{2} · Version \d+/)).toBeVisible()

  // Cross-link in the legal header nav.
  await page.getByRole('navigation').getByRole('link', { name: 'Privacy' }).click()
  await expect(page).toHaveURL('/privacy')
  await expect(page.getByRole('heading', { name: 'Privacy Policy', level: 1 })).toBeVisible()
  // Law 25: the person responsible + contact are published.
  await expect(page.getByText('Felix Rouleau').first()).toBeVisible()
  await expect(page.getByText('privacy@chudbox.com').first()).toBeVisible()
})

test('sign-up consent checkbox is present, required, and never pre-checked', async ({ page }) => {
  await page.goto('/')
  await openSettings(page)
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Create account' })).toBeVisible()

  const consent = page.getByRole('checkbox', { name: /terms of service/i })
  await expect(consent).toBeVisible()
  await expect(consent).not.toBeChecked()
  await expect(consent).toHaveAttribute('required', '')

  // Its label links out to both documents.
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms')
  await expect(dialog.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy')
})
