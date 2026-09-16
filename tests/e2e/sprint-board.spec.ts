import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('manages active and past Jira sprints with worklog contributors', async () => {
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
    await expect(sprintPage.getByRole('textbox', { name: 'Scrum board' })).toHaveCount(0)
    await expect(sprintPage.getByText('Jira project', { exact: true })).toHaveCount(0)
    await expect(sprintPage.getByRole('textbox', { name: 'Sprint' })).toHaveValue(
      'Active · VDA Sprint 12'
    )
    await expect(sprintPage.locator('[data-issue-key="VDA-600"]')).toHaveAttribute(
      'data-column',
      'backlog'
    )
    await expect(sprintPage.locator('[data-issue-key="VDA-601"]')).toHaveAttribute(
      'data-column',
      'indeterminate'
    )
    await expect(
      sprintPage.getByLabel('Dror Rahamim reported 1h 30m')
    ).toBeVisible()
    await expect(
      sprintPage.getByLabel('Vitaly Shechtman reported 30m')
    ).toBeVisible()
    await expect(sprintPage.locator('[data-issue-key="VDA-601"]')).toContainText('6h remaining')
    const sprintSelect = sprintPage.getByRole('textbox', { name: 'Sprint' })
    await sprintSelect.click()
    await sprintPage.getByRole('option', { name: 'Active · LSM Sprint 3' }).click()
    await expect(sprintSelect).toHaveValue('Active · LSM Sprint 3')
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

    await sprintSelect.click()
    await sprintPage.getByRole('option', { name: 'Past · VDA Sprint 11' }).click()
    await expect(sprintSelect).toHaveValue('Past · VDA Sprint 11')
    await expect(sprintPage.getByText('Past sprint · Read only')).toBeVisible()
    await expect(sprintPage.getByText('Backlog', { exact: true })).toHaveCount(0)
    const pastIssue = sprintPage.locator('[data-issue-key="VDA-590"]')
    await expect(pastIssue).toContainText('Dror Rahamim')
    await expect(pastIssue).toContainText('2h remaining')
    await expect(pastIssue).toHaveAttribute('draggable', 'false')

    await Promise.all([
      sprintPage.waitForEvent('close'),
      sprintPage.getByRole('button', { name: 'Close Sprint Board' }).click()
    ])
  } finally {
    await app.close()
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
})
