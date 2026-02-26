import { BrowserWindow, dialog, ipcMain } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  validateEnum,
  validateExactObject,
  validateOptionalString,
  validateStringLength
} from '../utils/validation'

type ExportPayload = {
  defaultPath: string
  content: string
  format: 'csv' | 'xlsx'
  encoding?: 'utf8' | 'base64'
}

type ExportPdfPayload = {
  defaultPath: string
  html: string
}

function ensureExtension(filePath: string, extension: string) {
  if (path.extname(filePath).toLowerCase() === `.${extension}`) return filePath
  return `${filePath}.${extension}`
}

export function registerExportIpc() {
  ipcMain.handle('app:saveExport', async (_event, payload: ExportPayload) => {
    const safe = validateExactObject<{
      defaultPath?: unknown
      content?: unknown
      format?: unknown
      encoding?: unknown
    }>(payload ?? {}, ['defaultPath', 'content', 'format', 'encoding'], 'saveExport payload')
    const defaultPath = validateStringLength(safe.defaultPath, 1, 240)
    const content = validateStringLength(safe.content, 1, 8_000_000)
    const format = validateEnum(safe.format, ['csv', 'xlsx'] as const)
    const encoding = (validateOptionalString(safe.encoding, { min: 0, max: 10 }) ??
      'utf8') as 'utf8' | 'base64'
    if (!['utf8', 'base64'].includes(encoding)) {
      throw new Error('Invalid encoding')
    }
    const window = BrowserWindow.getFocusedWindow() ?? undefined
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      defaultPath,
      filters: [{ name: format.toUpperCase(), extensions: [format] }]
    })
    if (canceled || !filePath) return null
    const finalPath = ensureExtension(filePath, format)
    const data =
      encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8')
    await fs.writeFile(finalPath, data)
    return finalPath
  })

  ipcMain.handle('app:exportPdf', async (_event, payload: ExportPdfPayload) => {
    const safe = validateExactObject<{ defaultPath?: unknown; html?: unknown }>(
      payload ?? {},
      ['defaultPath', 'html'],
      'exportPdf payload'
    )
    const defaultPath = validateStringLength(safe.defaultPath, 1, 240)
    const html = validateStringLength(safe.html, 1, 6_000_000)
    const window = BrowserWindow.getFocusedWindow() ?? undefined
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      defaultPath,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    })
    if (canceled || !filePath) return null
    const finalPath = ensureExtension(filePath, 'pdf')

    const pdfWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        sandbox: true
      }
    })
    try {
      await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      const pdfBuffer = await pdfWindow.webContents.printToPDF({ printBackground: true })
      await fs.writeFile(finalPath, pdfBuffer)
      return finalPath
    } finally {
      pdfWindow.close()
    }
  })
}
