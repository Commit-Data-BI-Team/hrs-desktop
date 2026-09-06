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

    await expect(window.getByLabel('HRS Comment')).toBeVisible()
    await expect(
      window.getByRole('button', { name: 'Update Jira & Slack' })
    ).toBeVisible()
    await expect(window.getByRole('button', { name: 'Reports' })).toBeVisible()
    await window.getByRole('button', { name: 'Reports' }).click()

    await expect(window.locator('.tray-report-kpi')).toHaveCount(3)
    const employeeProjects = window.locator('.tray-employee-workload-card')
    await expect(employeeProjects.getByText('Employee projects')).toBeVisible()
    await expect(employeeProjects).not.toContainText('1 people')

    await browserWindow.evaluate(current => {
      current.webContents.send('app:updateState', {
        state: 'available',
        version: '9.9.9',
        currentVersion: '1.0.0'
      })
    })
    await expect(window.getByText('Update Available', { exact: true })).toBeVisible()

    await window.getByRole('button', { name: 'Quick Log' }).click()
    const quickLogFilters = window.locator('.tray-filters')
    await expect(quickLogFilters).toBeVisible()
    await expect.poll(() =>
      quickLogFilters.evaluate(element =>
        getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length
      )
    ).toBe(1)
    await window.getByRole('textbox', { name: 'Project' }).fill('Website revamp')
    await window.getByRole('option', { name: /Website revamp/ }).click()
    await expect(window.getByRole('textbox', { name: 'Customer', exact: true })).toHaveValue('Acme Labs')
    await window.getByRole('button', { name: 'Update Jira & Slack' }).click()
    const updatePanel = window.locator('.tray-communicate-panel')
    await expect(updatePanel.locator('p').filter({ hasText: /^Send update$/ })).toBeVisible()
    await expect(window.getByLabel('HRS Comment')).toBeVisible()
    await updatePanel.getByRole('textbox', { name: 'Customer' }).fill('Microsoft')
    await window.getByRole('option', { name: 'Microsoft', exact: true }).click()
    const jiraWorkItem = updatePanel.getByLabel('Jira work item')
    await expect(jiraWorkItem).toHaveValue(/^VDA-147/)
    await expect(
      updatePanel.getByText('Using the customer parent because no fictive task is selected.')
    ).toBeVisible()
    await expect(updatePanel.getByLabel('Slack channel')).toHaveValue('#microsoft-project')
    const jiraCommentsToggle = updatePanel.getByRole('button', { name: /Jira comments · 1/ })
    const slackMessagesToggle = updatePanel.getByRole('button', { name: /Slack messages · 1/ })
    await expect(jiraCommentsToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(slackMessagesToggle).toHaveAttribute('aria-expanded', 'false')
    await jiraCommentsToggle.click()
    await slackMessagesToggle.click()
    await expect(jiraCommentsToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(slackMessagesToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(updatePanel.getByText(/latest Jira update for VDA-147/)).toBeVisible()
    await expect(
      updatePanel.getByRole('button', { name: 'Open Jira attachment hrs-e2e-image.png' })
    ).toBeVisible()
    await expect(
      updatePanel.getByRole('button', { name: 'Open Jira attachment hrs-e2e-image.png' }).locator('img')
    ).toBeVisible()
    await expect(updatePanel.getByText(/latest Slack update in C0123456789/)).toBeVisible()
    await updatePanel.getByRole('button', { name: 'Reply to Vitaly Shechtman on Jira' }).click()
    await expect(
      updatePanel.locator('.integration-recent-message.is-replying .integration-inline-reply')
    ).toBeVisible()
    await expect(updatePanel.locator('.integration-main-composer')).toBeHidden()
    const jiraReply = updatePanel.getByRole('textbox', { name: 'Reply' })
    await expect(jiraReply).toHaveValue('@[Vitaly Shechtman] ')
    await expect(updatePanel.getByRole('button', { name: 'Reply in Jira' })).toBeVisible()
    await updatePanel.getByRole('button', { name: 'New message' }).click()
    await updatePanel.getByRole('button', { name: 'Reply to Vitaly Shechtman on Slack' }).click()
    const slackReply = updatePanel.getByRole('textbox', { name: 'Reply' })
    await slackReply.fill('@[Vitaly Shechtman] Thanks, I will review it.')
    await updatePanel.getByRole('button', { name: 'Reply in Slack' }).click()
    await expect(updatePanel.getByText('Slack reply posted.')).toBeVisible()
    await updatePanel.getByRole('button', { name: 'New message' }).click()
    const updateText = updatePanel.getByRole('textbox', { name: 'Update' })
    await updatePanel.getByRole('button', { name: 'Format update text' }).click()
    await expect(updateText).toHaveValue(/^\*Update\*/)
    await updatePanel.getByText('RTL', { exact: true }).click()
    await expect(updateText).toHaveAttribute('dir', 'rtl')
    await expect.poll(() =>
      window.evaluate(async () => (await window.hrs.getPreferences()).integrationTextDirection)
    ).toBe('rtl')
    await updatePanel.getByRole('button', { name: 'Insert image' }).click()
    await expect(updatePanel.getByRole('img', { name: 'hrs-e2e-image.png' })).toBeVisible()
    await expect(updateText).toHaveValue(/🖼️ hrs-e2e-image\.png/)
    const statusSelect = updatePanel.getByLabel('Status change (optional)')
    await expect(statusSelect).toBeEnabled()
    await statusSelect.click()
    await window.getByRole('option', { name: 'Done', exact: true }).click()
    await updateText.fill('Please check @Dr')
    await updateText.press('End')
    const addFavorite = window.getByRole('button', { name: 'Add Dror Rahamim to favorites' })
    await expect(addFavorite).toBeVisible()
    await addFavorite.click()
    await expect(
      window.getByRole('button', { name: 'Remove Dror Rahamim from favorites' })
    ).toBeVisible()
    await expect.poll(() =>
      window.evaluate(async () => (await window.hrs.getPreferences()).integrationFavoritePeople.length)
    ).toBe(1)
    await updateText.fill('Please check @')
    const favoritePerson = window.getByRole('option', { name: /Dror Rahamim/ })
    await expect(favoritePerson).toBeVisible()
    await favoritePerson.click()
    await expect(updateText).toHaveValue('Please check @[Dror Rahamim] ')
    await expect(updatePanel).not.toContainText('Requires Jira attachment permission')
    await updatePanel.getByRole('button', { name: 'Send update' }).click()
    await expect(
      updatePanel.getByText(
        'Jira comment posted, status updated, 1 file uploaded · Slack message and 1 file posted.'
      )
    ).toBeVisible()

    const projectPicker = window.locator('.tray-filters').getByRole('textbox', { name: 'Project' })
    await projectPicker.click()
    const hideProject = window.getByRole('button', { name: /^Hide / }).first()
    await expect(hideProject).toBeVisible()
    const visibleProjectDropdown = window.locator('.project-select-dropdown:visible')
    await expect.poll(() =>
      visibleProjectDropdown.evaluate(element => element.scrollWidth <= element.clientWidth + 1)
    ).toBe(true)
    const favoriteProjectButton = visibleProjectDropdown
      .getByRole('button', { name: /^Add .* to favorites$/ })
      .last()
    const favoriteProjectAriaLabel = await favoriteProjectButton.getAttribute('aria-label')
    const favoriteProjectLabel = favoriteProjectAriaLabel
      ?.replace(/^Add /, '')
      .replace(/ to favorites$/, '')
    expect(favoriteProjectLabel).toBeTruthy()
    await favoriteProjectButton.click()
    await expect.poll(() =>
      window.evaluate(async () => (await window.hrs.getPreferences()).favoriteProjects.length)
    ).toBe(1)
    const favoriteProjectValue = await window.evaluate(
      async () => (await window.hrs.getPreferences()).favoriteProjects[0]
    )
    await expect(visibleProjectDropdown.getByRole('option').first()).toContainText(
      favoriteProjectValue
    )
    await expect(
      visibleProjectDropdown.getByRole('button', {
        name: `Remove ${favoriteProjectLabel} from favorites`
      })
    ).toBeVisible()
    await expect.poll(async () => {
      const [dropdownBox, eyeBox] = await Promise.all([
        visibleProjectDropdown.boundingBox(),
        hideProject.boundingBox()
      ])
      if (!dropdownBox || !eyeBox) return false
      return eyeBox.x >= dropdownBox.x && eyeBox.x + eyeBox.width <= dropdownBox.x + dropdownBox.width + 1
    }).toBe(true)
    await hideProject.click()
    await expect.poll(() =>
      window.evaluate(async () => (await window.hrs.getPreferences()).hiddenProjects.length)
    ).toBe(1)
    await window.getByRole('button', { name: 'Settings' }).click()
    const unhideProjects = window.getByRole('button', { name: 'Unhide hidden projects' })
    await expect(unhideProjects).toBeVisible()
    await unhideProjects.click()
    const restoreDialog = window.getByRole('dialog', { name: 'Unhide hidden projects' })
    await restoreDialog.getByRole('button', { name: 'Restore', exact: true }).click()
    await expect.poll(() =>
      window.evaluate(async () => (await window.hrs.getPreferences()).hiddenProjects.length)
    ).toBe(0)

  } finally {
    await app.close().catch(() => undefined)
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
})
