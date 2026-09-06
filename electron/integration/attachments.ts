import { randomUUID } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, nativeImage } from 'electron'

const MAX_FILE_BYTES = 25 * 1024 * 1024
const MAX_TOTAL_BYTES = 75 * 1024 * 1024
const MAX_FILES = 10
const ATTACHMENT_TTL_MS = 60 * 60 * 1000

export type SelectedIntegrationAttachment = {
  id: string
  name: string
  size: number
  mimeType: string
  previewDataUrl?: string
}

type StoredIntegrationAttachment = SelectedIntegrationAttachment & {
  path: string
  expiresAt: number
}

const selectedAttachments = new Map<string, StoredIntegrationAttachment>()

function inferMimeType(filePath: string) {
  const extension = path.extname(filePath).toLocaleLowerCase()
  const types: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.heic': 'image/heic',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.zip': 'application/zip',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  }
  return types[extension] ?? 'application/octet-stream'
}

function createImagePreview(filePath: string, mimeType: string) {
  if (!mimeType.startsWith('image/')) return undefined
  const source = nativeImage.createFromPath(filePath)
  if (source.isEmpty()) return undefined
  const size = source.getSize()
  const scale = Math.min(1, 360 / Math.max(1, size.width), 220 / Math.max(1, size.height))
  const preview = scale < 1
    ? source.resize({
        width: Math.max(1, Math.round(size.width * scale)),
        height: Math.max(1, Math.round(size.height * scale)),
        quality: 'good'
      })
    : source
  return preview.toDataURL()
}

function pruneExpiredAttachments() {
  const now = Date.now()
  for (const [id, attachment] of selectedAttachments.entries()) {
    if (attachment.expiresAt <= now) selectedAttachments.delete(id)
  }
}

function validateAttachmentIds(value: unknown) {
  if (!Array.isArray(value) || value.length > MAX_FILES) {
    throw new Error(`Choose no more than ${MAX_FILES} attachments.`)
  }
  return value.map(id => {
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
      throw new Error('Invalid attachment selection.')
    }
    return id
  })
}

export async function resolveIntegrationAttachments(value: unknown) {
  pruneExpiredAttachments()
  const ids = validateAttachmentIds(value)
  const resolved: Array<SelectedIntegrationAttachment & { bytes: Uint8Array }> = []
  let totalBytes = 0
  for (const id of ids) {
    const attachment = selectedAttachments.get(id)
    if (!attachment) {
      throw new Error(`Attachment selection expired. Choose the file again.`)
    }
    const fileStats = await stat(attachment.path)
    if (!fileStats.isFile()) throw new Error(`${attachment.name} is no longer available.`)
    if (fileStats.size > MAX_FILE_BYTES) {
      throw new Error(`${attachment.name} exceeds the 25 MB attachment limit.`)
    }
    totalBytes += fileStats.size
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error('The selected attachments exceed the 75 MB total limit.')
    }
    const bytes = await readFile(attachment.path)
    resolved.push({
      id: attachment.id,
      name: attachment.name,
      size: bytes.byteLength,
      mimeType: attachment.mimeType,
      bytes: new Uint8Array(bytes)
    })
  }
  return resolved
}

export function registerIntegrationAttachmentsIpc() {
  ipcMain.handle('integration:selectAttachments', async (event, options?: unknown) => {
    pruneExpiredAttachments()
    const imagesOnly = Boolean(
      options &&
      typeof options === 'object' &&
      !Array.isArray(options) &&
      (options as Record<string, unknown>).imagesOnly === true
    )
    if (!app.isPackaged && process.env.HRS_E2E === '1') {
      const fileName = imagesOnly ? 'hrs-e2e-image.png' : 'hrs-e2e-attachment.txt'
      const filePath = path.join(app.getPath('temp'), fileName)
      if (imagesOnly) {
        await writeFile(
          filePath,
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            'base64'
          )
        )
      } else {
        await writeFile(filePath, 'HRS Desktop attachment test\n', 'utf8')
      }
      const fileStats = await stat(filePath)
      const id = randomUUID()
      const mimeType = imagesOnly ? 'image/png' : 'text/plain'
      const attachment: StoredIntegrationAttachment = {
        id,
        path: filePath,
        name: fileName,
        size: fileStats.size,
        mimeType,
        previewDataUrl: createImagePreview(filePath, mimeType),
        expiresAt: Date.now() + ATTACHMENT_TTL_MS
      }
      selectedAttachments.set(id, attachment)
      return [{
        id,
        name: attachment.name,
        size: attachment.size,
        mimeType: attachment.mimeType,
        previewDataUrl: attachment.previewDataUrl
      }]
    }
    const owner = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const dialogOptions = {
      title: 'Attach files to Jira and Slack',
      buttonLabel: imagesOnly ? 'Insert image' : 'Attach',
      ...(imagesOnly
        ? {
            filters: [
              {
                name: 'Images',
                extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic']
              }
            ]
          }
        : {}),
      properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'>
    }
    const result = owner
      ? await dialog.showOpenDialog(owner, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)
    if (result.canceled) return []
    if (result.filePaths.length > MAX_FILES) {
      throw new Error(`Choose no more than ${MAX_FILES} attachments.`)
    }
    const attachments: SelectedIntegrationAttachment[] = []
    let totalBytes = 0
    for (const filePath of result.filePaths) {
      const fileStats = await stat(filePath)
      if (!fileStats.isFile()) continue
      const name = path.basename(filePath)
      const mimeType = inferMimeType(filePath)
      if (imagesOnly && !mimeType.startsWith('image/')) continue
      if (fileStats.size > MAX_FILE_BYTES) {
        throw new Error(`${name} exceeds the 25 MB attachment limit.`)
      }
      totalBytes += fileStats.size
      if (totalBytes > MAX_TOTAL_BYTES) {
        throw new Error('The selected attachments exceed the 75 MB total limit.')
      }
      const id = randomUUID()
      const attachment: StoredIntegrationAttachment = {
        id,
        path: filePath,
        name,
        size: fileStats.size,
        mimeType,
        previewDataUrl: createImagePreview(filePath, mimeType),
        expiresAt: Date.now() + ATTACHMENT_TTL_MS
      }
      selectedAttachments.set(id, attachment)
      attachments.push({
        id,
        name,
        size: fileStats.size,
        mimeType: attachment.mimeType,
        previewDataUrl: attachment.previewDataUrl
      })
    }
    return attachments
  })
}
