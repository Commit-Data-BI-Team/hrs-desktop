import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('renders the current employee-project report without relying on an existing app profile', async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hrs-project-report-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
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
    await window.evaluate(() => window.hrs.setTrayPinned(true))
    const browserWindow = await app.browserWindow(window)
    await browserWindow.evaluate(current => {
      current.show()
      current.focus()
    })

    const loginButton = window.getByRole('button', { name: /login to hrs/i })
    if (await loginButton.isVisible()) {
      await loginButton.click()
    }

    await window.getByRole('button', { name: 'Reports' }).click()
    await expect(window.getByText('Employee projects', { exact: true })).toBeVisible()
    await expect(window.locator('.tray-employee-workload-employee').first()).toBeVisible()
    await expect(window.locator('.tray-employee-workload-task').first()).toBeVisible()
  } finally {
    await app.close().catch(() => undefined)
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
})
