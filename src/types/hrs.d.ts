export {}

type LogWorkPayload = {
  date: string
  workLogs: Array<{
    id: number
    from: string
    to: string
    hours_HHMM: string
    hours: number
    comment: string
    notSaved: boolean
    reporting_from: string
    taskId: number
  }>
}

type MonthlyReport = {
  totalHoursNeeded: number
  totalHours: number
  closed_date: string
  totalDays: number
  days: Array<{
    date: string
    minWorkLog: number
    isHoliday: boolean
    reports: Array<{
      taskId: number
      taskName: string
      projectInstance: string
      hours_HHMM: string
      comment: string
      reporting_from: string
      from?: string
      to?: string
    }>
  }>
  weekend: string
}

type JiraStatus = {
  configured: boolean
  email: string | null
  baseUrl: string
  projectKey: string
  projectName?: string
  hasCredentials: boolean
}

type JiraEpic = {
  key: string
  summary: string
}

type JiraWorkItem = {
  key: string
  summary: string
  timespent: number
  estimateSeconds: number
  statusName?: string | null
  worklogTotal?: number
  lastWorklog?: JiraWorklogEntry | null
  worklogs?: JiraWorklogEntry[]
}

type JiraWorklogAuthor = {
  name: string | null
  accountId: string | null
}

type JiraSubtaskItem = JiraWorkItem & {
  assigneeName: string | null
  worklogs: JiraWorklogEntry[]
}

type JiraWorkItemDetail = JiraWorkItem & {
  assigneeName: string | null
  worklogs: JiraWorklogEntry[]
  subtasks: JiraSubtaskItem[]
}

type JiraWorklogEntry = {
  id: string
  started: string | null
  seconds: number
  comment: unknown | null
  authorName?: string | null
  authorId?: string | null
}

type MeetingItem = {
  subject: string
  startTime: string
  endTime: string
  participants: string
  attendanceCount: number | null
  attendanceEmails: string[]
  attendeeEmails: string[]
}

type MeetingsResult = {
  month: string
  count: number
  meetings: MeetingItem[]
}

type MeetingsCacheEntry = {
  updatedAt: string
  meetings: MeetingItem[]
}

type JiraMappings = Record<string, string>

type CommentRule = {
  id: string
  scope: 'project' | 'customer'
  match: string
  tags: string[]
}

type SmartDefaults = {
  lastTaskByWeekday: Record<string, number>
  lastTaskId: number | null
}

type StoredReportLogEntry = {
  taskId: number
  from: string | null
  to: string | null
  hours_HHMM: string
  comment: string
  reporting_from: string
  projectInstance?: string
}

type AppPreferences = {
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
  autoSuggestEnabled: boolean
  heatmapEnabled: boolean
  exportFiltered: boolean
  commentRules: CommentRule[]
  jiraManualBudgets: Record<string, string>
  jiraBudgetInHours: boolean
  jiraBudgetSortByProgress: boolean
  jiraBudgetTitle: string
  jiraEpicAliases: Record<string, string>
  jiraProjectStartDates: Record<string, string>
  jiraProjectPeoplePercent: Record<string, Record<string, number>>
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
  meetingsBrowser: 'safari' | 'chrome'
  meetingsUsername: string
  meetingsPassword: string
  meetingsHeadless: boolean
  trayMeetingsSettingsOpen: boolean
  meetingsCollapsed: boolean
  meetingsCache: Record<string, MeetingsCacheEntry>
  meetingClientMappings: Record<string, string>
  reportWorkLogsCache?: Record<string, StoredReportLogEntry[]>
  smartDefaults: SmartDefaults
}

type HrsApi = {
  login: () => Promise<boolean>
  connectViaAdminLogin: () => Promise<boolean>
  getCredentials: () => Promise<{ username: string | null; hasPassword: boolean }>
  setCredentials: (username: string, password: string) => Promise<boolean>
  clearCredentials: () => Promise<boolean>
  autoLogin: () => Promise<boolean>
  checkSession: () => Promise<boolean>
  getWorkLogs: (date?: string) => Promise<unknown[]>
  getReports: (startDate: string, endDate: string) => Promise<MonthlyReport>
  logWork: (payload: LogWorkPayload) => Promise<boolean>
  deleteLog: (date: string) => Promise<boolean>
  getJiraStatus: () => Promise<JiraStatus>
  setJiraCredentials: (email: string, token: string) => Promise<boolean>
  clearJiraCredentials: () => Promise<boolean>
  getJiraEpics: () => Promise<JiraEpic[]>
  getJiraMappings: () => Promise<JiraMappings>
  setJiraMapping: (customer: string, epicKey: string | null) => Promise<JiraMappings>
  getJiraWorkItems: (epicKey: string) => Promise<JiraWorkItem[]>
  getJiraWorkItemsSummary: (
    epicKey: string
  ) => Promise<{ spentSeconds: number; estimateSeconds: number; partial: boolean }>
  getJiraTimeTrackingConfig: () => Promise<{ hoursPerDay: number; daysPerWeek: number }>
  getJiraEpicDebug: (
    epicKey: string
  ) => Promise<{ epicKey: string; fields: Record<string, unknown> } | null>
  getJiraWorkItemDetails: (epicKey: string, forceRefresh?: boolean) => Promise<{
    items: JiraWorkItemDetail[]
    partial: boolean
  }>
  getJiraIssueWorklogs: (issueKey: string) => Promise<JiraWorklogEntry[]>
  addJiraWorklog: (payload: {
    issueKey: string
    started: string
    seconds: number
    comment?: string
  }) => Promise<JiraWorklogEntry | null>
  getJiraWorklogHistory: (issueKey: string) => Promise<JiraWorklogEntry[]>
  deleteJiraWorklog: (payload: { issueKey: string; worklogId: string }) => Promise<boolean>
  getPreferences: () => Promise<AppPreferences>
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
    commentRules?: CommentRule[]
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
	    trayMeetingsSettingsOpen?: boolean
	    meetingsCollapsed?: boolean
    meetingsCache?: Record<string, MeetingsCacheEntry>
    meetingClientMappings?: Record<string, string>
    reportWorkLogsCache?: Record<string, StoredReportLogEntry[]>
    smartDefaults?: SmartDefaults
  }) => Promise<AppPreferences>
  saveExport: (payload: {
    defaultPath: string
    content: string
    format: 'csv' | 'xlsx'
    encoding?: 'utf8' | 'base64'
  }) => Promise<string | null>
  exportPdf: (payload: { defaultPath: string; html: string }) => Promise<string | null>
  notify: (payload: { title: string; body: string }) => Promise<boolean>
  getJiraLoggedEntries: () => Promise<
    Record<string, { issueKey: string; loggedAt: string; worklogId?: string }>
  >
  setJiraLoggedEntries: (
    entries: Record<string, { issueKey: string; loggedAt: string; worklogId?: string }>
  ) => Promise<Record<string, { issueKey: string; loggedAt: string; worklogId?: string }>>
  getMeetings: (options: {
    browser: 'safari' | 'chrome'
    headless?: boolean
    month?: string | null
    username?: string | null
    password?: string | null
  }) => Promise<MeetingsResult>
  onMeetingsProgress: (handler: (message: string) => void) => () => void
  openFloatingTimer: () => Promise<boolean>
  closeFloatingTimer: () => Promise<boolean>
  setFloatingCollapsed: (collapsed: boolean) => Promise<boolean>
  openMainWindow: () => Promise<boolean>
  openReportsWindow: () => Promise<boolean>
  openSettingsWindow: () => Promise<boolean>
  openMeetingsWindow: () => Promise<boolean>
  onTrayOpened: (handler: () => void) => () => void
  onTrayClosing: (handler: (reason: 'blur' | 'toggle' | 'open-main') => void) => () => void
}

declare global {
  interface Window {
    hrs: HrsApi
  }
}
