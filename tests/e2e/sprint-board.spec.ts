import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

async function launch(role?: string) {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hrs-sprint-tray-'))
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDir}`],
    env: { ...process.env, HRS_E2E: '1', HRS_SPRINT_E2E: '1', HRS_SPRINT_E2E_ROLE: role, E2E_USE_FILE: '1' }
  })
  return { app, userDataDir }
}

test('Sprint board remains inside Tray and cannot open the large Main page', async () => {
  const { app, userDataDir } = await launch()
  try {
    const tray = await app.firstWindow()
    await tray.waitForLoadState('domcontentloaded')
    await tray.getByRole('button', { name: 'Jira Sprint Board' }).click()
    await expect(tray.getByText('Jira Sprint Board', { exact: true })).toBeVisible()
    await expect(tray.getByRole('button', { name: 'Expand' })).toHaveCount(0)
    const opening = await tray.evaluate(async () => ({
      main: await window.hrs.openMainWindow(),
      sprint: await window.hrs.openSprintWindow(),
      reports: await window.hrs.openReportsWindow(),
      settings: await window.hrs.openSettingsWindow(),
      meetings: await window.hrs.openMeetingsWindow(),
      floating: await window.hrs.openFloatingTimer()
    }))
    expect(opening).toEqual({ main: true, sprint: false, reports: false, settings: false, meetings: false, floating: false })
    await tray.waitForTimeout(150)
    expect(app.windows()).toHaveLength(1)
    expect(new URL(tray.url()).searchParams.get('tray')).toBe('1')
  } finally {
    await app.close()
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
})

test('employee can read the Tray Sprint board without seeing edit controls', async () => {
  const { app, userDataDir } = await launch('employee')
  try {
    const tray = await app.firstWindow()
    await tray.waitForLoadState('domcontentloaded')
    await tray.getByRole('button', { name: 'Jira Sprint Board' }).click()
    await expect(tray.getByText('Jira Sprint Board', { exact: true })).toBeVisible()
    await expect(tray.getByRole('button', { name: 'Expand' })).toHaveCount(0)
    expect(app.windows()).toHaveLength(1)
  } finally {
    await app.close()
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
})
