import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'

test('renders KPIs and calendar shell', async () => {
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      HRS_E2E: '1',
      E2E_USE_FILE: '1'
    }
  })

  try {
    const window = await app.firstWindow()
    await window.setViewportSize({ width: 1280, height: 800 })
    await window.waitForLoadState('domcontentloaded')

    const loginButton = window.getByRole('button', { name: /login to hrs/i })
    if (await loginButton.isVisible()) {
      await loginButton.click()
    }

    const overview = window.getByText('HRS overview', { exact: false })
    await expect(overview).toBeVisible()

    const statCards = window.locator('.stat-card')
    if ((await statCards.count()) === 0) {
      const expandButton = window.getByRole('button', { name: /^expand$/i })
      if (await expandButton.isVisible()) {
        await expandButton.click()
      }
    }

    await expect(window.locator('.stat-card')).toHaveCount(3)

    const calendar = window.locator('.calendar-card')
    await expect(calendar).toBeVisible()
    const dayCount = await calendar.locator('.calendar-day').count()
    expect(dayCount).toBeGreaterThan(20)
  } finally {
    await app.close()
  }
})
