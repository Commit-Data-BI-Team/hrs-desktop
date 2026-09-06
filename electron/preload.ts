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
  getEmployees: () => ipcRenderer.invoke('hrs:getEmployees'),
  getHrsIdentity: () => ipcRenderer.invoke('hrs:getIdentity'),
  getEmployeeHoursReport: (payload: unknown) =>
    ipcRenderer.invoke('hrs:getEmployeeHoursReport', payload),
  logWork: (payload: unknown) => ipcRenderer.invoke('hrs:logWork', payload),
  deleteLog: (date: string) => ipcRenderer.invoke('hrs:deleteLog', date),
  getJiraStatus: () => ipcRenderer.invoke('jira:getStatus'),
  setJiraCredentials: (email: string, token: string) =>
    ipcRenderer.invoke('jira:setCredentials', email, token),
  clearJiraCredentials: () => ipcRenderer.invoke('jira:clearCredentials'),
  getJiraEpics: () => ipcRenderer.invoke('jira:getEpics'),
  searchJiraUsers: (query: string) => ipcRenderer.invoke('jira:searchUsers', query),
  getJiraTransitions: (issueKey: string) =>
    ipcRenderer.invoke('jira:getTransitions', issueKey),
  getJiraRecentComments: (issueKey: string) =>
    ipcRenderer.invoke('jira:getRecentComments', issueKey),
  openJiraAttachment: (payload: { id: string; filename: string }) =>
    ipcRenderer.invoke('jira:openAttachment', payload),
  addJiraComment: (payload: {
    issueKey: string
    text: string
    mentions?: Array<{ accountId: string; label: string }>
    attachments?: Array<{ id: string; filename: string }>
  }) => ipcRenderer.invoke('jira:addComment', payload),
  uploadJiraAttachments: (payload: { issueKey: string; attachmentIds: string[] }) =>
    ipcRenderer.invoke('jira:uploadAttachments', payload),
  transitionJiraIssue: (payload: { issueKey: string; transitionId: string }) =>
    ipcRenderer.invoke('jira:transitionIssue', payload),
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
  getJiraWorkItemDetails: (epicKey: string, forceRefresh?: boolean) =>
    ipcRenderer.invoke('jira:getWorkItemDetails', epicKey, forceRefresh),
  getJiraIssueWorklogs: (issueKey: string) =>
    ipcRenderer.invoke('jira:getIssueWorklogs', issueKey),
  findJiraWorklogsForDate: (date: string) =>
    ipcRenderer.invoke('jira:findWorklogsForDate', date),
  createJiraIssue: (payload: {
    parentIssueKey: string
    summary: string
    description?: string
    estimateSeconds?: number | null
  }) => ipcRenderer.invoke('jira:createIssue', payload),
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
  getSupabaseStatus: () => ipcRenderer.invoke('supabase:getStatus'),
  setSupabaseConfig: (url: string, publishableKey: string) =>
    ipcRenderer.invoke('supabase:setConfig', url, publishableKey),
  signUpSupabase: (email: string, password: string) =>
    ipcRenderer.invoke('supabase:signUp', email, password),
  signInSupabase: (email: string, password: string) =>
    ipcRenderer.invoke('supabase:signIn', email, password),
  resendSupabaseConfirmation: (email: string) =>
    ipcRenderer.invoke('supabase:resendConfirmation', email),
  signOutSupabase: () => ipcRenderer.invoke('supabase:signOut'),
  claimSupabaseManager: (payload: { displayName?: string; employeeId?: string | number | null }) =>
    ipcRenderer.invoke('supabase:claimManager', payload),
  updateSupabaseProfile: (payload: { displayName?: string; employeeId?: string | number | null }) =>
    ipcRenderer.invoke('supabase:updateProfile', payload),
  getSupabaseWorkReports: (startDate: string, endDate: string) =>
    ipcRenderer.invoke('supabase:getWorkReports', startDate, endDate),
  getIsraeliHolidays: (month: string) => ipcRenderer.invoke('holidays:getIsraeli', month),
  getSupabaseProjectUsage: (customer: string, project: string, startDate: string, endDate: string) =>
    ipcRenderer.invoke('supabase:getProjectUsage', { customer, project, startDate, endDate }),
  getSharedFictiveTasks: () => ipcRenderer.invoke('supabase:getSharedFictiveTasks'),
  upsertSharedFictiveTask: (payload: unknown) =>
    ipcRenderer.invoke('supabase:upsertSharedFictiveTask', payload),
  archiveSharedFictiveTask: (taskId: string) =>
    ipcRenderer.invoke('supabase:archiveSharedFictiveTask', taskId),
  getSharedFictiveTaskUsage: (taskIds: string[], startDate: string, endDate: string) =>
    ipcRenderer.invoke('supabase:getSharedFictiveTaskUsage', { taskIds, startDate, endDate }),
  syncSupabaseWorkReports: (payload: {
    startDate: string
    endDate: string
    employeeId?: string | number | null
    rows: unknown[]
  }) => ipcRenderer.invoke('supabase:syncWorkReports', payload),
  getProjectManagementConfig: () => ipcRenderer.invoke('pm:getConfig'),
  setProjectReportingSource: (source: 'hrs' | 'jira') =>
    ipcRenderer.invoke('pm:setReportingSource', source),
  setProjectSyncMode: (mode: 'manual' | 'automatic') =>
    ipcRenderer.invoke('pm:setSyncMode', mode),
  upsertCustomerProjectMapping: (payload: unknown) =>
    ipcRenderer.invoke('pm:upsertCustomerMapping', payload),
  removeCustomerProjectMapping: (id: string) =>
    ipcRenderer.invoke('pm:removeCustomerMapping', id),
  upsertProjectMission: (payload: unknown) => ipcRenderer.invoke('pm:upsertMission', payload),
  removeProjectMission: (id: string) => ipcRenderer.invoke('pm:removeMission', id),
  validateProjectMissionCap: (payload: unknown) =>
    ipcRenderer.invoke('pm:validateMissionCap', payload),
  getProjectSyncAuditLog: (limit?: number) => ipcRenderer.invoke('pm:getSyncAuditLog', limit),
  addProjectSyncAuditEntry: (payload: unknown) =>
    ipcRenderer.invoke('pm:addSyncAuditEntry', payload),
  getSlackStatus: () => ipcRenderer.invoke('slack:getStatus'),
  setSlackToken: (token: string) => ipcRenderer.invoke('slack:setToken', token),
  clearSlack: () => ipcRenderer.invoke('slack:clear'),
  getSlackChannels: () => ipcRenderer.invoke('slack:getChannels'),
  searchSlackUsers: (query: string) => ipcRenderer.invoke('slack:searchUsers', query),
  getSlackRecentMessages: (channelId: string) =>
    ipcRenderer.invoke('slack:getRecentMessages', channelId),
  postSlackMessage: (payload: {
    channelId: string
    text: string
    mentions?: Array<{ slackUserId: string; label: string }>
    attachmentIds?: string[]
    threadTs?: string | null
  }) => ipcRenderer.invoke('slack:postMessage', payload),
  selectIntegrationAttachments: (options?: { imagesOnly?: boolean }) =>
    ipcRenderer.invoke('integration:selectAttachments', options),
  setSlackCustomerMapping: (payload: {
    customerName: string
    channelId: string
    channelName: string
  }) => ipcRenderer.invoke('slack:setMapping', payload),
  removeSlackCustomerMapping: (customerName: string) =>
    ipcRenderer.invoke('slack:removeMapping', customerName),
  postSlackCustomerUpdate: (payload: {
    customer: string
    title: string
    lines: string[]
    channelId?: string | null
    metrics?: {
      capLabel?: string
      usedLabel?: string
      remainingLabel?: string
      usedPercent?: number
    } | null
  }) => ipcRenderer.invoke('slack:postCustomerUpdate', payload),
  getPreferences: () => ipcRenderer.invoke('app:getPreferences'),
  getTrayPinned: () => ipcRenderer.invoke('app:getTrayPinned'),
  setTrayPinned: (pinned: boolean) => ipcRenderer.invoke('app:setTrayPinned', pinned),
  dismissTray: () => ipcRenderer.invoke('app:dismissTray'),
  resizeTrayToContent: (height: number) =>
    ipcRenderer.invoke('app:resizeTrayToContent', height),
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
    trayPinned?: boolean
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
    jiraCustomerAliases?: Record<string, string>
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
    meetingExcludedSubjects?: Record<string, string[]>
    integrationFavoritePeople?: Array<{
      key: string
      label: string
      email: string | null
      avatarUrl: string | null
      jiraAccountId?: string
      slackUserId?: string
    }>
    integrationTextDirection?: 'auto' | 'ltr' | 'rtl'
    favoriteProjects?: string[]
    hiddenProjects?: string[]
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
  getPendingReportSyncMonths: () => ipcRenderer.invoke('app:getPendingReportSyncMonths'),
  setPendingReportSyncMonths: (months: string[]) =>
    ipcRenderer.invoke('app:setPendingReportSyncMonths', months),
  getMeetings: (options: {
    browser: 'safari' | 'chrome'
    headless?: boolean
    month?: string | null
    username?: string | null
    password?: string | null
  }) => ipcRenderer.invoke('meetings:run', options),
  selectMeetingsDuoAction: (action: 'push' | 'call') =>
    ipcRenderer.invoke('meetings:duo-action', action),
  onMeetingsDuoActionRequired: (handler: () => void) => {
    const listener = () => handler()
    ipcRenderer.on('meetings:duo-action-required', listener)
    return () => {
      ipcRenderer.removeListener('meetings:duo-action-required', listener)
    }
  },
  onMeetingsProgress: (handler: (message: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string) => handler(message)
    ipcRenderer.on('meetings:progress', listener)
    return () => {
      ipcRenderer.removeListener('meetings:progress', listener)
    }
  },
  getAgenda: (options: {
    token?: string | null
    username?: string | null
    password?: string | null
    personNames?: string[]
    personTags?: string[]
    tuning?: {
      hiddenThreads?: string[]
      hiddenSenders?: string[]
      importantTerms?: string[]
    }
	  }) => ipcRenderer.invoke('agenda:run', options),
	  getAgendaFact: () => ipcRenderer.invoke('agenda:fact'),
	  getAgendaAiConfig: () => ipcRenderer.invoke('agenda:getAiConfig'),
  setAgendaAiConfig: (payload: { apiKey?: string | null; model?: string | null }) =>
    ipcRenderer.invoke('agenda:setAiConfig', payload),
  clearAgendaAiConfig: () => ipcRenderer.invoke('agenda:clearAiConfig'),
  onAgendaProgress: (handler: (message: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, message: string) => handler(message)
    ipcRenderer.on('agenda:progress', listener)
    return () => {
      ipcRenderer.removeListener('agenda:progress', listener)
    }
  },
  openFloatingTimer: () => ipcRenderer.invoke('app:openFloatingTimer'),
  closeFloatingTimer: () => ipcRenderer.invoke('app:closeFloatingTimer'),
  setFloatingCollapsed: (collapsed: boolean) =>
    ipcRenderer.invoke('app:setFloatingCollapsed', collapsed),
  openMainWindow: () => ipcRenderer.invoke('app:openMainWindow'),
  openReportsWindow: () => ipcRenderer.invoke('app:openReportsWindow'),
  openSettingsWindow: () => ipcRenderer.invoke('app:openSettingsWindow'),
  openMeetingsWindow: () => ipcRenderer.invoke('app:openMeetingsWindow'),
  setNativeThemeMode: (mode: 'dark' | 'oled' | 'liquid' | 'h4c37') =>
    ipcRenderer.invoke('app:setNativeThemeMode', mode),
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  getUpdateState: () => ipcRenderer.invoke('app:getUpdateState'),
  checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
  downloadUpdate: () => ipcRenderer.invoke('app:downloadUpdate'),
  installUpdate: () => ipcRenderer.invoke('app:installUpdate'),
  onUpdateState: (
    handler: (state: {
      state: 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'
      message?: string
      version?: string
      currentVersion?: string
      releaseDate?: string
      changelog?: string[]
      percent?: number
    }) => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: {
        state:
          | 'disabled'
          | 'idle'
          | 'checking'
          | 'available'
          | 'downloading'
          | 'ready'
          | 'error'
        message?: string
        version?: string
        currentVersion?: string
        releaseDate?: string
        changelog?: string[]
        percent?: number
      }
    ) => handler(state)
    ipcRenderer.on('app:updateState', listener)
    return () => {
      ipcRenderer.removeListener('app:updateState', listener)
    }
  },
  onTrayOpened: (handler: () => void) => {
    const listener = () => handler()
    ipcRenderer.on('app:trayOpened', listener)
    return () => {
      ipcRenderer.removeListener('app:trayOpened', listener)
    }
  },
  onTrayClosing: (
    handler: (reason: 'blur' | 'toggle' | 'open-main' | 'dismiss') => void
  ) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      reason: 'blur' | 'toggle' | 'open-main' | 'dismiss'
    ) => handler(reason)
    ipcRenderer.on('app:trayClosing', listener)
    return () => {
      ipcRenderer.removeListener('app:trayClosing', listener)
    }
  }
})
