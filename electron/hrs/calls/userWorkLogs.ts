import { execInHrs } from '../session'

export type UserWorkLogTask = {
  taskId: number
  taskName: string
  customerName: string
  projectInstance: string
  projectName: string
  reporting_mode: 'FROM_TO' | 'HOURLY'
  commentsRequired: boolean
  projectColor: string
  isActiveTask: boolean
  date: string
}

export async function getUserWorkLogs(date: string): Promise<UserWorkLogTask[]> {
  const js = `
    (async () => {
      const res = await fetch('/api/user_work_logs/?date=' + encodeURIComponent('${date}'), {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json, text/plain, */*' }
      })
      if (!res.ok) throw new Error('user_work_logs ' + res.status)
      return await res.json()
    })()
  `
  return execInHrs<UserWorkLogTask[]>(js)
}