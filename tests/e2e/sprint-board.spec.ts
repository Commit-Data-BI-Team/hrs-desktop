import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('manages VDA and LSM Jira sprint issues with drag and drop', async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hrs-sprint-board-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      HRS_E2E: '1',
      E2E_USE_FILE: '1'
    }
  })

  try {
    const trayPage = await app.firstWindow()
    await trayPage.waitForLoadState('domcontentloaded')
    const sprintPagePromise = app.waitForEvent('window')
    await trayPage.evaluate(() => window.hrs.openSprintWindow())
    const sprintPage = await sprintPagePromise
    await sprintPage.waitForLoadState('domcontentloaded')

    await expect(sprintPage.getByText('Jira Sprint Board', { exact: true })).toBeVisible()
    await expect(sprintPage.getByRole('textbox', { name: 'Scrum board' })).toHaveValue(
      'VDA Scrum'
    )
    await expect(sprintPage.getByRole('textbox', { name: 'Sprint' })).toHaveValue(
      '● VDA Sprint 12'
    )
    await expect(sprintPage.locator('[data-issue-key="VDA-600"]')).toHaveAttribute(
      'data-column',
      'backlog'
    )
    await expect(sprintPage.locator('[data-issue-key="VDA-601"]')).toHaveAttribute(
      'data-column',
      'indeterminate'
    )

    await sprintPage.getByText('LSM', { exact: true }).click()
    await expect(sprintPage.getByRole('textbox', { name: 'Scrum board' })).toHaveValue(
      'LSM Scrum'
    )
    await expect(sprintPage.getByRole('textbox', { name: 'Sprint' })).toHaveValue(
      '● LSM Sprint 3'
    )
    const backlogIssue = sprintPage.locator('[data-issue-key="LSM-30"]')
    await expect(backlogIssue).toHaveAttribute('data-column', 'backlog')

    await backlogIssue.dragTo(sprintPage.locator('[data-sprint-column="indeterminate"]'))
    await expect(sprintPage.locator('[data-issue-key="LSM-30"]')).toHaveAttribute(
      'data-column',
      'indeterminate'
    )
    await expect(sprintPage.getByText('LSM-30 moved from Backlog to In Progress.')).toBeVisible()

    await sprintPage.getByRole('button', { name: 'Undo LSM-30 move' }).click()
    await expect(sprintPage.locator('[data-issue-key="LSM-30"]')).toHaveAttribute(
      'data-column',
      'backlog'
    )
  } finally {
    await app.close()
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
})
