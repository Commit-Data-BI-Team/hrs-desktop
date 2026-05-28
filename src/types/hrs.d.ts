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

type EmployeeAdminItem = {
  id: string
  priorityId: string
  fullName: string
  role: string
  internalId: string
  username: string
  email: string
  phone: string
  pnl: string
  nextPnl: string
  userRoles: string
  reportsTo: string
  positionType: string
  maximumHours: string
  isSubContractor: boolean
  isActive: boolean
  href: string
}

type EmployeeAccessResult = {
  hasAccess: boolean
  hasEmployees: boolean
  currentEmployeeName: string | null
  employees: EmployeeAdminItem[]
  allEmployeesCount: number
  source: 'directReports' | 'accessibleRows' | 'none'
}

type EmployeeHoursEntry = {
  date: string
  employee: string
  customer: string
  task: string
  milestone: string
  hoursHHMM: string
  minutes: number
  rawValue: string
  taskId: string | null
}

type EmployeeHoursDay = {
  date: string
  totalMinutes: number
  entries: EmployeeHoursEntry[]
}

type EmployeeHoursReport = {
  employeeId: string
  employeeName: string
  fromDate: string
  toDate: string
  customerId: string
  customerOptions: Array<{ value: string; label: string }>
  dateColumns: string[]
  days: EmployeeHoursDay[]
  entries: EmployeeHoursEntry[]
  totalMinutes: number
  sourceUrl: string
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
type AgendaItem = {
  id?: string
  kind?: string
  title?: string
  summary?: string
  priority?: string
  reason?: string
  owner?: string
  ownerEmail?: string
  threadKey?: string
  link?: string
  sourceIds?: string[]
  Type?: string
  Title?: string
  Owner?: string
  'Owner Email'?: string
  'Start Date'?: string
  'End Date'?: string
  Priority?: string
  Status?: string
  Preview?: string
  Link?: string
  'Mission Reason'?: string
  category?: string
  categoryLabel?: string
  actionTitle?: string
  brief?: string
  suggestedAction?: string
  whenLabel?: string
  sourceTitle?: string
  project?: string
  customer?: string
  sourceSender?: string
  sourceSenderEmail?: string
  relevanceScore?: number
  aiSource?: string
}
type AgendaResult = {
  mailWindow: string
  meetingWindow: string
  unansweredEmails: number
  meetingsThisWeek: number
  outputDir: string
  brief?: string
  focus?: string[]
  aiProvider?: string
  sections?: {
    tasks: AgendaItem[]
    emailSummaries: AgendaItem[]
    needReply: AgendaItem[]
    followUps: AgendaItem[]
    projectSignals: AgendaItem[]
    meetingPrep: AgendaItem[]
  }
  missions: AgendaItem[]
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
  jiraCustomerAliases: Record<string, string>
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
  meetingExcludedSubjects: Record<string, string[]>
  reportWorkLogsCache?: Record<string, StoredReportLogEntry[]>
  smartDefaults: SmartDefaults
}

type AppUpdateState = {
  state: 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'
  message?: string
  version?: string
  currentVersion?: string
  releaseDate?: string
  changelog?: string[]
  percent?: number
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
  getEmployees: () => Promise<EmployeeAccessResult>
  getEmployeeHoursReport: (payload: {
    employeeId: string
    fromDate: string
    toDate: string
    customerId?: string
  }) => Promise<EmployeeHoursReport>
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
	    trayMeetingsSettingsOpen?: boolean
	    meetingsCollapsed?: boolean
	    meetingsCache?: Record<string, MeetingsCacheEntry>
	    meetingClientMappings?: Record<string, string>
	    meetingExcludedSubjects?: Record<string, string[]>
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
  }) => Promise<AgendaResult>
  getAgendaAiConfig: () => Promise<{ hasApiKey: boolean; model: string }>
  setAgendaAiConfig: (payload: {
    apiKey?: string | null
    model?: string | null
  }) => Promise<{ hasApiKey: boolean; model: string }>
  clearAgendaAiConfig: () => Promise<{ hasApiKey: boolean; model: string }>
  onAgendaProgress: (handler: (message: string) => void) => () => void
  openFloatingTimer: () => Promise<boolean>
  closeFloatingTimer: () => Promise<boolean>
  setFloatingCollapsed: (collapsed: boolean) => Promise<boolean>
  openMainWindow: () => Promise<boolean>
  openReportsWindow: () => Promise<boolean>
  openSettingsWindow: () => Promise<boolean>
  openMeetingsWindow: () => Promise<boolean>
  setNativeThemeMode: (mode: 'dark' | 'oled' | 'liquid') => Promise<{
    nativeLiquidGlass: boolean
    supported: boolean
  }>
  getAppVersion: () => Promise<string>
  getUpdateState: () => Promise<AppUpdateState>
  checkForUpdates: () => Promise<boolean>
  downloadUpdate: () => Promise<boolean>
  installUpdate: () => Promise<boolean>
  onUpdateState: (handler: (state: AppUpdateState) => void) => () => void
  onTrayOpened: (handler: () => void) => () => void
  onTrayClosing: (handler: (reason: 'blur' | 'toggle' | 'open-main') => void) => () => void
}

declare global {
  interface Window {
    hrs: HrsApi
  }
}
