import { contextBridge, ipcRenderer } from 'electron'

console.log('[preload] loaded')

contextBridge.exposeInMainWorld('hrs', {
  login: () => ipcRenderer.invoke('hrs:connectViaAdminLogin'),
  connectViaAdminLogin: () => ipcRenderer.invoke('hrs:connectViaAdminLogin'),
  getCredentials: () => ipcRenderer.invoke('hrs:getCredentials'),
  setCredentials: (username: string, password: string) =>
    ipcRenderer.invoke('hrs:setCredentials', username, password),
  clearCredentials: () => ipcRenderer.invoke('hrs:clearCredentials'),
  autoLogin: () => ipcRenderer.invoke('hrs:autoLogin'),
  checkSession: () => ipcRenderer.invoke('hrs:checkSession'),
  getWorkLogs: (date?: string) => ipcRenderer.invoke('hrs:getWorkLogs', date),
  getReports: (startDate: string, endDate: string) =>
    ipcRenderer.invoke('hrs:getReports', startDate, endDate),
  logWork: (payload: unknown) => ipcRenderer.invoke('hrs:logWork', payload),
  deleteLog: (date: string) => ipcRenderer.invoke('hrs:deleteLog', date),
  getJiraStatus: () => ipcRenderer.invoke('jira:getStatus'),
  setJiraCredentials: (email: string, token: string) =>
    ipcRenderer.invoke('jira:setCredentials', email, token),
  clearJiraCredentials: () => ipcRenderer.invoke('jira:clearCredentials'),
  getJiraEpics: () => ipcRenderer.invoke('jira:getEpics'),
  getJiraMappings: () => ipcRenderer.invoke('jira:getMappings'),
  setJiraMapping: (customer: string, epicKey: string | null) =>
    ipcRenderer.invoke('jira:setMapping', customer, epicKey),
  getJiraWorkItems: (epicKey: string) =>
    ipcRenderer.invoke('jira:getWorkItems', epicKey),
  getJiraWorkItemsSummary: (epicKey: string) =>
    ipcRenderer.invoke('jira:getWorkItemsSummary', epicKey),
  getJiraTimeTrackingConfig: () => ipcRenderer.invoke('jira:getTimeTrackingConfig'),
  getJiraEpicDebug: (epicKey: string) =>
    ipcRenderer.invoke('jira:getEpicDebug', epicKey),
  getJiraWorkItemDetails: (epicKey: string) =>
    ipcRenderer.invoke('jira:getWorkItemDetails', epicKey),
  getJiraIssueWorklogs: (issueKey: string) =>
    ipcRenderer.invoke('jira:getIssueWorklogs', issueKey),
  addJiraWorklog: (payload: {
    issueKey: string
    started: string
    seconds: number
    comment?: string
  }) => ipcRenderer.invoke('jira:addWorklog', payload),
  getJiraWorklogHistory: (issueKey: string) =>
    ipcRenderer.invoke('jira:getWorklogHistory', issueKey),
  deleteJiraWorklog: (payload: { issueKey: string; worklogId: string }) =>
    ipcRenderer.invoke('jira:deleteWorklog', payload),
  getPreferences: () => ipcRenderer.invoke('app:getPreferences'),
  setPreferences: (next: {
    jiraActiveOnly?: boolean
    jiraReportedOnly?: boolean
    jiraSectionOpen?: boolean
    reminderEnabled?: boolean
    reminderLastDate?: string | null
    reminderLastMidday?: string | null
    reminderLastEnd?: string | null
    reminderStartHour?: number
    reminderMiddayHour?: number
    reminderEndHour?: number
    reminderIdleMinutes?: number
    reviewMode?: boolean
    filtersOpen?: boolean
    reportsOpen?: boolean
    logWorkOpen?: boolean
    autoSuggestEnabled?: boolean
    heatmapEnabled?: boolean
    exportFiltered?: boolean
    commentRules?: Array<{
      id: string
      scope: 'project' | 'customer'
      match: string
      tags: string[]
    }>
    jiraManualBudgets?: Record<string, string>
    jiraBudgetInHours?: boolean
    jiraBudgetSortByProgress?: boolean
    jiraBudgetTitle?: string
    jiraEpicAliases?: Record<string, string>
    jiraProjectStartDates?: Record<string, string>
    jiraProjectPeoplePercent?: Record<string, Record<string, number>>
    jiraProjectPositionSnapshots?: Record<
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
    meetingsBrowser?: 'safari' | 'chrome'
    meetingsUsername?: string
    meetingsPassword?: string
    meetingsHeadless?: boolean
    meetingsCollapsed?: boolean
    meetingsCache?: Record<
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
    meetingClientMappings?: Record<string, string>
    reportWorkLogsCache?: Record<
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
    smartDefaults?: {
      lastTaskByWeekday: Record<string, number>
      lastTaskId: number | null
    }
  }) => ipcRenderer.invoke('app:setPreferences', next),
  saveExport: (payload: {
    defaultPath: string
    content: string
    format: 'csv' | 'xlsx'
    encoding?: 'utf8' | 'base64'
  }) =>
    ipcRenderer.invoke('app:saveExport', payload),
  exportPdf: (payload: { defaultPath: string; html: string }) =>
    ipcRenderer.invoke('app:exportPdf', payload),
  notify: (payload: { title: string; body: string }) => ipcRenderer.invoke('app:notify', payload),
  getJiraLoggedEntries: () => ipcRenderer.invoke('app:getJiraLoggedEntries'),
  setJiraLoggedEntries: (
    entries: Record<string, { issueKey: string; loggedAt: string; worklogId?: string }>
  ) =>
    ipcRenderer.invoke('app:setJiraLoggedEntries', entries),
  getMeetings: (options: {
    browser: 'safari' | 'chrome'
    headless?: boolean
    month?: string | null
    username?: string | null
    password?: string | null
  }) => ipcRenderer.invoke('meetings:run', options),
  onMeetingsProgress: (handler: (message: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string) => handler(message)
    ipcRenderer.on('meetings:progress', listener)
    return () => {
      ipcRenderer.removeListener('meetings:progress', listener)
    }
  },
  openFloatingTimer: () => ipcRenderer.invoke('app:openFloatingTimer'),
  closeFloatingTimer: () => ipcRenderer.invoke('app:closeFloatingTimer'),
  setFloatingCollapsed: (collapsed: boolean) =>
    ipcRenderer.invoke('app:setFloatingCollapsed', collapsed)
})
