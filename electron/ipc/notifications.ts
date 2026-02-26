import { Notification, ipcMain } from 'electron'
import {
  validateExactObject,
  validateStringLength
} from '../utils/validation'

export function registerNotificationIpc() {
  ipcMain.handle('app:notify', async (_event, payload: { title: string; body: string }) => {
    if (!Notification.isSupported()) return false
    const safe = validateExactObject<{ title?: unknown; body?: unknown }>(
      payload ?? {},
      ['title', 'body'],
      'notification payload'
    )
    const title = validateStringLength(safe.title, 1, 120)
    const body = validateStringLength(safe.body, 1, 2000)
    new Notification({ title, body }).show()
    return true
  })
}
