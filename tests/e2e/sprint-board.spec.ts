import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('manages active and past Jira sprints with Supabase contributors', async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hrs-sprint-board-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      HRS_E2E: '1',
      HRS_SPRINT_E2E: '1',
      E2E_USE_FILE: '1'
    }
  })

  try {
    const trayPage = await app.firstWindow()
    await trayPage.waitForLoadState('domcontentloaded')
    await expect(
      trayPage.locator('.tray-sprint-preloaded-panel [data-issue-key="VDA-601"]')
    ).toHaveCount(1)
    await trayPage.getByRole('button', { name: 'Jira Sprint Board' }).click()
    await expect(trayPage.getByText('Jira Sprint Board', { exact: true })).toBeVisible()
    await expect(trayPage.getByRole('button', { name: 'Expand' })).toBeVisible()
    await expect(trayPage.getByText(/Loading Supabase contributors/i)).toHaveCount(0)
    expect(app.windows()).toHaveLength(1)
    const sprintPagePromise = app.waitForEvent('window')
    await trayPage.getByRole('button', { name: 'Expand' }).click()
    const sprintPage = await sprintPagePromise
    await sprintPage.waitForLoadState('domcontentloaded')

    await expect(sprintPage.getByText('Jira Sprint Board', { exact: true })).toBeVisible()
    await expect(sprintPage.getByRole('textbox', { name: 'Scrum board' })).toHaveCount(0)
    await expect(sprintPage.getByText('Jira project', { exact: true })).toHaveCount(0)
    await expect(sprintPage.getByRole('textbox', { name: 'Sprint' })).toHaveValue(
      'Active · VDA Sprint 12'
    )
    await expect(sprintPage.getByText('Start 01 Sept 2026')).toBeVisible()
    await expect(sprintPage.getByText('End 14 Sept 2026')).toBeVisible()
    await expect(sprintPage.locator('[data-issue-key="VDA-600"]')).toHaveAttribute(
      'data-column',
      'backlog'
    )
    await expect(sprintPage.locator('[data-issue-key="VDA-601"]')).toHaveAttribute(
      'data-column',
      'indeterminate'
    )
    await expect(
      sprintPage.getByLabel('Dror Rahamim reported 1h 30m from Supabase')
    ).toBeVisible()
    await expect(
      sprintPage.getByLabel('Vitaly Shechtman reported 30m from Supabase')
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

    const sprintWindow = await app.browserWindow(sprintPage)
    await sprintPage.getByRole('button', { name: 'Close Sprint Board' }).click()
    await expect.poll(() => sprintWindow.evaluate(window => window.isVisible())).toBe(false)
  } finally {
    await app.close()
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
})

test('employees can view the in-app sprint board but cannot mutate Jira', async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hrs-sprint-employee-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      HRS_E2E: '1',
      HRS_SPRINT_E2E: '1',
      HRS_SPRINT_E2E_ROLE: 'employee',
      E2E_USE_FILE: '1'
    }
  })

  try {
    const trayPage = await app.firstWindow()
    const mainPagePromise = app.waitForEvent('window')
    await trayPage.evaluate(() => window.hrs.openSprintWindow())
    const mainPage = await mainPagePromise
    await expect(mainPage.getByText('Jira Sprint Board', { exact: true })).toBeVisible()
    await expect(mainPage.getByText('Employee view · Read only')).toBeVisible()
    await expect(mainPage.locator('[data-issue-key="VDA-600"]')).toHaveAttribute(
      'draggable',
      'false'
    )
    const mutationError = await mainPage.evaluate(async () => {
      try {
        await window.hrs.moveJiraIssuesToSprint({ sprintId: 1001, issueKeys: ['VDA-600'] })
        return null
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    })
    expect(mutationError).toContain('Only managers can edit')
  } finally {
    await app.close()
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
})
