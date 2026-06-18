/**
 * DEC-6 unified photos — local-first (no account): add a General photo through
 * the gallery uploader, open the keyboard-operable Lightbox (A15) and close it
 * with Escape, then pick that photo as the cover (DEC-6 explicit cover picker)
 * and confirm the persistent Cover badge appears. The upload pipeline stays
 * purely local when logged out (base64), so no network/account is needed.
 */
import { expect, test } from '@playwright/test'
import { addCar } from '../harness/actions'

const CAR = { year: '2018', make: 'Subaru', model: 'WRX' }

// A 1x1 transparent PNG (smallest valid image the picker/FileReader will accept).
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

test('add a General photo, open + Escape the lightbox, then set it as cover', async ({ page }) => {
  await page.goto('/')
  await addCar(page, CAR)

  // Go to the unified Photos gallery.
  await page.getByRole('tab', { name: 'Photos', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Add photo' })).toBeVisible()

  // Pick a file → the uploader shows the caption field; caption + save.
  await page.locator('input[type="file"]').setInputFiles({
    name: 'wrx.png',
    mimeType: 'image/png',
    buffer: PNG_1x1,
  })
  const caption = page.getByLabel(/Caption/)
  await expect(caption).toBeVisible()
  await caption.fill('Front three-quarter')
  await page.getByRole('button', { name: 'Save photo', exact: true }).click()

  // The tile renders in the gallery (button named by its caption, A3).
  const tile = page.getByRole('button', { name: 'Open Front three-quarter' })
  await expect(tile).toBeVisible()

  // A15: opening the tile shows the focus-trapped lightbox; Escape closes it.
  await tile.click()
  const lightbox = page.getByRole('dialog', { name: 'Front three-quarter' })
  await expect(lightbox).toBeVisible()
  await expect(lightbox.getByRole('button', { name: 'Set as cover' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(lightbox).toBeHidden()

  // DEC-6: pick the photo as cover via the persistent tile action; the Cover
  // badge appears (and CarCard/hero would resolve to it).
  await page.getByRole('button', { name: 'Set Front three-quarter as cover' }).click()
  await expect(page.getByText('Cover', { exact: true })).toBeVisible()
})
