import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('shared Jira task can be logged without a customer Epic mapping', async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hrs-shared-no-epic-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    env: { ...process.env, HRS_E2E: '1', E2E_USE_FILE: '1' }
  })

  try {
    const tray = await app.firstWindow()
    await tray.waitForLoadState('domcontentloaded')
    await tray.evaluate(async () => {
      await window.hrs.upsertProjectMission({
        customerName: 'Acme Labs',
        projectName: 'Website revamp',
        name: 'Discovery shared task',
        jiraIssueKey: 'VDA-147',
        hrsTaskIds: ['101'],
        virtual: true,
        assignedEmployees: [],
        plannedHours: null,
        cappedHours: null,
        status: 'in_progress',
        dependencies: []
      })
    })
    await tray.reload()
    await tray
      .locator('.quicklog-recent-shortcut')
      .filter({ hasText: 'Acme Labs -> Design sync' })
      .click()
    await expect(tray.getByRole('textbox', { name: 'Customer', exact: true })).toHaveValue('Acme Labs')
    await expect(tray.getByRole('textbox', { name: 'Task' })).toHaveValue(/Discovery shared task/)
    await tray.getByLabel('HRS Comment').fill('Investigated the shared task')

    expect(await tray.evaluate(async () => (await window.hrs.getJiraMappings())['Acme Labs'])).toBeUndefined()
    await expect(tray.getByRole('textbox', { name: 'Jira work item' })).toHaveValue(/^VDA-147/)
    await expect(tray.getByRole('button', { name: 'Log work' })).toBeEnabled()
    await tray.getByRole('button', { name: 'Log work' }).click()
    await expect(tray.getByLabel('HRS Comment')).toHaveValue('')
  } finally {
    await app.close()
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
})
