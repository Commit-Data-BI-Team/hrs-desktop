import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('renders the tray reports KPIs and employee projects', async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hrs-smoke-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      HRS_E2E: '1',
      E2E_USE_FILE: '1'
    }
  })

  try {
    const window = await app.firstWindow()
    await window.waitForLoadState('domcontentloaded')
    await window.evaluate(() => window.hrs.setTrayPinned(true))
    const browserWindow = await app.browserWindow(window)
    await browserWindow.evaluate(current => {
      current.show()
      current.focus()
    })

    await expect(window.getByRole('button', { name: 'Reports' })).toBeVisible()
    await window.getByRole('button', { name: 'Reports' }).click()

    await expect(window.locator('.tray-report-kpi')).toHaveCount(3)
    const employeeProjects = window.locator('.tray-employee-workload-card')
    await expect(employeeProjects.getByText('Employee projects')).toBeVisible()
    await expect(employeeProjects).not.toContainText('1 people')
  } finally {
    await app.close().catch(() => undefined)
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
})
