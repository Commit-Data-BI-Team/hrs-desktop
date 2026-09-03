import { expect, test } from '@playwright/test'
import { _electron as electron } from 'playwright'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('pins the tray across blur and allows explicit dismissal', async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hrs-tray-pinned-'))
  const launch = () =>
    electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        HRS_E2E: '1',
        E2E_USE_FILE: '1'
      }
    })

  let app = await launch()
  try {
    let trayPage = await app.firstWindow()
    await trayPage.waitForLoadState('domcontentloaded')
    let trayWindow = await app.browserWindow(trayPage)

    await expect(trayPage.getByRole('button', { name: 'Pin tray' })).toBeVisible()
    await trayWindow.evaluate(window => window.blur())
    await expect.poll(() => trayWindow.evaluate(window => window.isVisible())).toBe(false)

    await trayWindow.evaluate(window => {
      window.show()
      window.focus()
      window.webContents.send('app:trayOpened')
    })
    await trayPage.getByRole('button', { name: 'Pin tray' }).click()
    await expect(trayPage.getByRole('button', { name: 'Unpin tray' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )

    await trayWindow.evaluate(window => window.blur())
    await new Promise(resolve => setTimeout(resolve, 350))
    expect(await trayWindow.evaluate(window => window.isVisible())).toBe(true)

    await trayPage.getByRole('button', { name: 'Close tray' }).click()
    await expect.poll(() => trayWindow.evaluate(window => window.isVisible())).toBe(false)

    await app.close()
    app = await launch()
    trayPage = await app.firstWindow()
    await trayPage.waitForLoadState('domcontentloaded')
    trayWindow = await app.browserWindow(trayPage)
    await expect(trayPage.getByRole('button', { name: 'Unpin tray' })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    expect(await trayWindow.evaluate(window => window.isVisible())).toBe(true)
  } finally {
    await app.close().catch(() => undefined)
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
})

test('resizes the tray to its content without unnecessary scrolling', async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hrs-tray-resize-'))
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
    const trayWindow = await app.browserWindow(trayPage)
    await trayPage.waitForFunction(() => typeof window.hrs?.resizeTrayToContent === 'function')

    await trayPage.evaluate(() => {
      const content = document.querySelector<HTMLElement>('.tray-content')
      if (!content) throw new Error('Tray content was not rendered')
      const style = document.createElement('style')
      style.id = 'tray-resize-test-style'
      style.textContent =
        '.tray-content.is-resize-test > :not(#tray-resize-fixture) { display: none !important; }'
      document.head.appendChild(style)
      content.classList.add('is-resize-test')
      const fixture = document.createElement('div')
      fixture.id = 'tray-resize-fixture'
      fixture.style.cssText = 'display:block;flex:0 0 260px;height:260px;width:100%;'
      content.appendChild(fixture)
    })

    await expect.poll(() => trayWindow.evaluate(window => window.getBounds().height)).toBeLessThan(340)
    const compactHeight = await trayWindow.evaluate(window => window.getBounds().height)

    await trayPage.evaluate(() => {
      const fixture = document.querySelector<HTMLElement>('#tray-resize-fixture')
      if (!fixture) throw new Error('Tray resize fixture was not rendered')
      fixture.style.cssText = 'display:block;flex:0 0 500px;height:500px;width:100%;'
    })

    await expect
      .poll(() => trayWindow.evaluate(window => window.getBounds().height))
      .toBeGreaterThan(compactHeight + 200)
    const overflow = await trayPage.evaluate(() => {
      const content = document.querySelector<HTMLElement>('.tray-content')
      if (!content) throw new Error('Tray content was not rendered')
      return content.scrollHeight - content.clientHeight
    })
    expect(overflow).toBeLessThanOrEqual(1)

    const constrainedResult = await trayPage.evaluate(async () => {
      const fixture = document.querySelector<HTMLElement>('#tray-resize-fixture')
      if (!fixture) throw new Error('Tray resize fixture was not rendered')
      fixture.style.cssText = 'display:block;flex:0 0 2000px;height:2000px;width:100%;'
      return window.hrs.resizeTrayToContent(2006)
    })
    expect(constrainedResult.constrained).toBe(true)
    expect(await trayWindow.evaluate(window => window.getBounds().height)).toBe(
      constrainedResult.maxHeight
    )
  } finally {
    await app.close().catch(() => undefined)
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
})

test('prevents every visible app window from entering fullscreen or maximized mode', async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hrs-windowed-only-'))
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
    const trayWindow = await app.browserWindow(trayPage)
    expect(await trayWindow.evaluate(window => window.isFullScreenable())).toBe(false)
    expect(await trayWindow.evaluate(window => window.isMaximizable())).toBe(false)

    const reportsPagePromise = app.waitForEvent('window')
    await trayPage.evaluate(() => window.hrs.openReportsWindow())
    const reportsPage = await reportsPagePromise
    await reportsPage.waitForLoadState('domcontentloaded')
    const reportsWindow = await app.browserWindow(reportsPage)
    expect(await reportsWindow.evaluate(window => window.isFullScreenable())).toBe(false)
    expect(await reportsWindow.evaluate(window => window.isMaximizable())).toBe(false)
    const bounds = await reportsWindow.evaluate(window => window.getBounds())
    const workArea = await app.evaluate(
      ({ screen }, windowBounds) => screen.getDisplayMatching(windowBounds).workArea,
      bounds
    )
    expect(bounds.width).toBeLessThan(workArea.width)
    expect(bounds.height).toBeLessThan(workArea.height)
  } finally {
    await app.close().catch(() => undefined)
    await fs.rm(userDataDir, { recursive: true, force: true })
  }
})
