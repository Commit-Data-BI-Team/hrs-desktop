import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'

test('expands mapped project and shows tasks/subtasks in tray reports', async () => {
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...process.env,
      HRS_E2E: '1',
      JIRA_E2E: '1',
      E2E_USE_FILE: '1'
    }
  })

  try {
    const window = await app.firstWindow()
    await window.setViewportSize({ width: 1280, height: 900 })
    await window.waitForLoadState('domcontentloaded')

    const loginButton = window.getByRole('button', { name: /login to hrs/i })
    if (await loginButton.isVisible()) {
      await loginButton.click()
    }

    await window.getByRole('button', { name: 'Reports' }).click()
    await expect(window.getByText('Mapped projects', { exact: false })).toBeVisible()

    const firstProjectToggle = window.locator('.tray-project-toggle').first()
    await expect(firstProjectToggle).toBeVisible()
    await firstProjectToggle.click()

    await expect(window.locator('.tray-project-task').first()).toBeVisible({ timeout: 20000 })
    await expect(window.locator('.tray-project-subtask').first()).toBeVisible({ timeout: 20000 })
  } finally {
    await app.close()
  }
})

