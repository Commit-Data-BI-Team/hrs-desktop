import { Notification, ipcMain } from 'electron'

export function registerNotificationIpc() {
  ipcMain.handle('app:notify', async (_event, payload: { title: string; body: string }) => {
    if (!Notification.isSupported()) return false
    const { title, body } = payload ?? {}
    if (!title || !body) return false
    new Notification({ title, body }).show()
    return true
  })
}
