import { ipcMain } from 'electron'
import {
  getJiraLoggedEntries,
  getPreferences,
  setJiraLoggedEntries,
  setPreferences
} from '../app/preferences'

export function registerPreferencesIpc() {
  ipcMain.handle('app:getPreferences', async () => {
    return getPreferences()
  })

  ipcMain.handle(
    'app:setPreferences',
    async (
      _event,
      next: Partial<{
        jiraActiveOnly: boolean
        jiraReportedOnly: boolean
        jiraSectionOpen: boolean
        reminderEnabled: boolean
        reminderLastDate: string | null
        reminderLastMidday: string | null
        reminderLastEnd: string | null
        reminderStartHour: number
        reminderMiddayHour: number
        reminderEndHour: number
        reminderIdleMinutes: number
        reviewMode: boolean
        filtersOpen: boolean
        reportsOpen: boolean
        logWorkOpen: boolean
        autoLoginEnabled: boolean
        autoSuggestEnabled: boolean
        heatmapEnabled: boolean
        exportFiltered: boolean
        commentRules: Array<{
          id: string
          scope: 'project' | 'customer'
          match: string
          tags: string[]
        }>
        jiraManualBudgets: Record<string, string>
        jiraBudgetInHours: boolean
        jiraBudgetSortByProgress: boolean
        jiraBudgetTitle: string
        jiraEpicAliases: Record<string, string>
        jiraProjectStartDates: Record<string, string>
        jiraProjectPeoplePercent: Record<string, Record<string, number>>
        jiraProjectPositionSnapshots: Record<
          string,
          {
            monthKey: string
            frozen: boolean
            computedAt: string
            totalSeconds: number
            secondsByPerson: Record<string, number>
            percents: Record<string, number>
          }
        >
        meetingsBrowser: 'safari' | 'chrome'
        meetingsUsername: string
        meetingsPassword: string
        meetingsHeadless: boolean
        meetingsCollapsed: boolean
        meetingsCache: Record<
          string,
          {
            updatedAt: string
            meetings: Array<{
              subject: string
              startTime: string
              endTime: string
              participants: string
              attendanceCount: number | null
              attendanceEmails: string[]
              attendeeEmails: string[]
            }>
          }
        >
        meetingClientMappings: Record<string, string>
        reportWorkLogsCache: Record<
          string,
          Array<{
            taskId: number
            from: string | null
            to: string | null
            hours_HHMM: string
            comment: string
            reporting_from: string
            projectInstance?: string
          }>
        >
        smartDefaults: {
          lastTaskByWeekday: Record<string, number>
          lastTaskId: number | null
        }
      }>
    ) => {
    return setPreferences(next ?? {})
    }
  )

  ipcMain.handle('app:getJiraLoggedEntries', async () => {
    return getJiraLoggedEntries()
  })

  ipcMain.handle(
    'app:setJiraLoggedEntries',
    async (
      _event,
      entries: Record<string, { issueKey: string; loggedAt: string; worklogId?: string }>
    ) => {
      return setJiraLoggedEntries(entries ?? {})
    }
  )
}
