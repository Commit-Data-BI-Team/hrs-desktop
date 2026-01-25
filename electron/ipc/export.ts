import { BrowserWindow, dialog, ipcMain } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

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
    const { defaultPath, content, format } = payload ?? {}
    if (!defaultPath || !content || !format) return null
    const window = BrowserWindow.getFocusedWindow() ?? undefined
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      defaultPath,
      filters: [{ name: format.toUpperCase(), extensions: [format] }]
    })
    if (canceled || !filePath) return null
    const finalPath = ensureExtension(filePath, format)
    const encoding = payload.encoding ?? 'utf8'
    const data =
      encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8')
    await fs.writeFile(finalPath, data)
    return finalPath
  })

  ipcMain.handle('app:exportPdf', async (_event, payload: ExportPdfPayload) => {
    const { defaultPath, html } = payload ?? {}
    if (!defaultPath || !html) return null
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
