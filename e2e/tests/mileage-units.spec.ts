/**
 * Flow 3 — the Settings distance-unit toggle CONVERTS the displayed mileage,
 * not just its label. 100,000 mi (canonical miles) must re-render as 160,934 km
 * (100000 × 1.609344, rounded). Asserts the NUMBER changes.
 */
import { expect, test } from '@playwright/test'
import { addCar, openCar, openSettings } from '../harness/actions'

const CAR = { year: '2020', make: 'Toyota', model: 'Supra', mileage: '100000' }

// The car-profile subline mileage span, e.g. "· 100,000 mi". The digit-then-unit
// shape is unique on the page (the Settings unit buttons read "Miles (mi)" with
// no leading number, so they never match).
const MILEAGE = /\b[\d,]+\s(mi|km)\b/

const digitsOf = (text: string): string => text.replace(/\D/g, '')

test('toggling km/mi converts the displayed mileage number', async ({ page }) => {
  await page.goto('/')
  await addCar(page, CAR)
  await openCar(page, CAR)

  const mileage = page.getByText(MILEAGE)
  await expect(mileage).toContainText('100,000 mi')
  const before = digitsOf(await mileage.innerText()) // "100000"

  // Switch the distance unit to kilometers.
  await openSettings(page)
  await page.getByRole('button', { name: /Kilometers/ }).click()

  // The same canonical mileage now displays as a DIFFERENT number in km.
  await expect(mileage).toContainText('160,934 km')
  await expect(mileage).not.toContainText('100,000 mi')

  const after = digitsOf(await mileage.innerText()) // "160934"
  expect(after).toBe('160934')
  expect(after).not.toBe(before) // the value converted, not merely the unit label
})
