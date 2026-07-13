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
  currentEmployee: EmployeeAdminItem | null
  employees: EmployeeAdminItem[]
  allEmployeesCount: number
  source: 'directReports' | 'accessibleRows' | 'none'
}

type HrsIdentity = {
  employeeId: string | null
  employeeName: string | null
  email: string | null
  username: string | null
  source: 'employee_admin' | 'api_payload' | 'html' | 'credentials' | 'none'
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

type JiraCreatedIssue = {
  id?: string
  key: string
  summary: string
  parentIssueKey: string
  estimateSeconds: number
}

type SupabaseProfile = {
  id: string
  email: string
  employee_id: number | null
  display_name: string | null
  role: 'manager' | 'employee'
}

type SupabaseStatus = {
  configured: boolean
  url: string
  hasPublishableKey: boolean
  email: string | null
  profile: SupabaseProfile | null
}

type SupabaseWorkReportRow = {
  id: string
  employee_id: number
  employee_name: string
  customer: string
  project: string | null
  task_id: number | null
  task_name: string
  report_date: string
  seconds: number
  comment: string | null
  reporting_from: string | null
  from_time: string | null
  to_time: string | null
  shared_fictive_task_id: string | null
  source: string
  synced_at?: string
}

type SharedFictiveTaskUsage = {
  taskId: string
  usedSeconds: number
  contributorCount: number
  lastReportedAt: string | null
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
  sourceRole?: string
  sourceType?: string
  directAskEvidence?: string
  latestMessageFromIdentity?: boolean
  ccOnly?: boolean
  latestAt?: string
  threadTimeline?: Array<{
    time?: string
    from?: string
    direction?: string
    preview?: string
  }>
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

type ReportingSource = 'hrs' | 'jira'
type ProjectSyncMode = 'manual' | 'automatic'
type MissionStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'archived'

type CustomerProjectMapping = {
  id: string
  hrsCustomerName: string
  jiraProjectKeys: string[]
  jiraEpicKeys: string[]
  defaultJiraIssueKey?: string
  active: boolean
  notes?: string
  updatedAt: string
}

type ProjectMission = {
  id: string
  customerName: string
  projectName?: string | null
  name: string
  jiraIssueKey: string
  hrsTaskIds: string[]
  originalHrsTaskName?: string | null
  virtual: boolean
  parentMissionId?: string
  assignedEmployees: string[]
  plannedHours: number | null
  cappedHours: number | null
  status: MissionStatus
  startDate?: string
  dueDate?: string
  dependencies: string[]
  notes?: string
  createdAt: string
  updatedAt: string
  shared?: boolean
  createdBy?: string
  archivedAt?: string | null
}

type SyncAuditStatus = 'pending' | 'applied' | 'skipped' | 'failed' | 'dry_run'
type SyncAuditAction = 'create' | 'update' | 'delete' | 'skip' | 'error'
type SyncAuditEntity = 'worklog' | 'mapping' | 'mission' | 'cap_validation'

type SyncAuditEntry = {
  id: string
  action: SyncAuditAction
  entity: SyncAuditEntity
  source: ReportingSource | 'system'
  status: SyncAuditStatus
  employee?: string
  customerName?: string
  taskName?: string
  jiraIssueKey?: string
  hrsTaskId?: string
  reportingDate?: string
  previousSeconds?: number | null
  nextSeconds?: number | null
  message?: string
  createdAt: string
}

type ProjectManagementConfig = {
  reportingSource: ReportingSource
  syncMode: ProjectSyncMode
  utilizationThresholds: number[]
  customerMappings: CustomerProjectMapping[]
  missions: ProjectMission[]
  updatedAt: string
}

type SlackChannelMapping = {
  customerName: string
  channelId: string
  channelName: string
  updatedAt: string
}

type SlackStatus = {
  configured: boolean
  hasToken: boolean
  mappings: Record<string, SlackChannelMapping>
}

type SlackChannelOption = {
  id: string
  name: string
  label: string
}

type SlackPostResult = {
  posted: boolean
  reason?: string
  channelId?: string
  ts?: string | null
}

type SlackUpdateMetrics = {
  capLabel?: string
  usedLabel?: string
  remainingLabel?: string
  usedPercent?: number
}

type MissionCapValidationResult = {
  mission: ProjectMission
  capped: boolean
  usedHours: number
  additionalHours: number
  nextHours: number
  utilizationPercent: number | null
  exceeded: boolean
  crossedThresholds: number[]
  requiresSeventyPercentPrompt: boolean
}

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
  getHrsIdentity: () => Promise<HrsIdentity>
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
  findJiraWorklogsForDate: (date: string) => Promise<{
    worklogs: Array<JiraWorklogEntry & { issueKey: string }>
    partial: boolean
  }>
  createJiraIssue: (payload: {
    parentIssueKey: string
    summary: string
    description?: string
    estimateSeconds?: number | null
  }) => Promise<JiraCreatedIssue>
  addJiraWorklog: (payload: {
    issueKey: string
    started: string
    seconds: number
    comment?: string
  }) => Promise<JiraWorklogEntry | null>
  getJiraWorklogHistory: (issueKey: string) => Promise<JiraWorklogEntry[]>
  deleteJiraWorklog: (payload: { issueKey: string; worklogId: string }) => Promise<boolean>
  getSupabaseStatus: () => Promise<SupabaseStatus>
  setSupabaseConfig: (
    url: string,
    publishableKey: string
  ) => Promise<{ url: string; publishableKey: string }>
  signUpSupabase: (
    email: string,
    password: string
  ) => Promise<{ email: string | null; needsConfirmation: boolean }>
  signInSupabase: (
    email: string,
    password: string
  ) => Promise<{ email: string | null; profile: SupabaseProfile | null }>
  resendSupabaseConfirmation: (email: string) => Promise<boolean>
  signOutSupabase: () => Promise<boolean>
  claimSupabaseManager: (payload: {
    displayName?: string
    employeeId?: string | number | null
  }) => Promise<SupabaseProfile>
  updateSupabaseProfile: (payload: {
    displayName?: string
    employeeId?: string | number | null
  }) => Promise<SupabaseProfile>
  getSupabaseWorkReports: (
    startDate: string,
    endDate: string
  ) => Promise<SupabaseWorkReportRow[]>
  getSharedFictiveTasks: () => Promise<{
    available: boolean
    tasks: ProjectMission[]
  }>
  upsertSharedFictiveTask: (payload: {
    id?: string
    customerName: string
    projectName?: string | null
    originalHrsTaskId: string | number
    originalHrsTaskName?: string | null
    jiraIssueKey: string
    name: string
    plannedHours?: number | null
    cappedHours?: number | null
    status?: MissionStatus
    notes?: string
    assignedEmployeeIds?: Array<string | number>
  }) => Promise<ProjectMission>
  archiveSharedFictiveTask: (taskId: string) => Promise<boolean>
  getSharedFictiveTaskUsage: (taskIds: string[]) => Promise<SharedFictiveTaskUsage[]>
  syncSupabaseWorkReports: (payload: {
    startDate: string
    endDate: string
    employeeId?: string | number | null
    rows: Array<Record<string, unknown>>
  }) => Promise<{ synced: number; syncRunId: string }>
  getProjectManagementConfig: () => Promise<ProjectManagementConfig>
  setProjectReportingSource: (source: ReportingSource) => Promise<ProjectManagementConfig>
  setProjectSyncMode: (mode: ProjectSyncMode) => Promise<ProjectManagementConfig>
  upsertCustomerProjectMapping: (payload: {
    id?: string
    hrsCustomerName: string
    jiraProjectKeys: string[]
    jiraEpicKeys: string[]
    defaultJiraIssueKey?: string
    active?: boolean
    notes?: string
  }) => Promise<CustomerProjectMapping>
  removeCustomerProjectMapping: (id: string) => Promise<ProjectManagementConfig>
  upsertProjectMission: (payload: {
    id?: string
    customerName: string
    name: string
    jiraIssueKey: string
    hrsTaskIds?: string[]
    virtual?: boolean
    parentMissionId?: string
    assignedEmployees?: string[]
    plannedHours?: number | null
    cappedHours?: number | null
    status?: MissionStatus
    startDate?: string
    dueDate?: string
    dependencies?: string[]
    notes?: string
  }) => Promise<ProjectMission>
  removeProjectMission: (id: string) => Promise<ProjectManagementConfig>
  validateProjectMissionCap: (payload: {
    missionId: string
    usedHours: number
    additionalHours?: number
  }) => Promise<MissionCapValidationResult>
  getProjectSyncAuditLog: (limit?: number) => Promise<SyncAuditEntry[]>
  addProjectSyncAuditEntry: (payload: {
    action: SyncAuditAction
    entity: SyncAuditEntity
    source: ReportingSource | 'system'
    status: SyncAuditStatus
    employee?: string
    customerName?: string
    taskName?: string
    jiraIssueKey?: string
    hrsTaskId?: string
    reportingDate?: string
    previousSeconds?: number | null
    nextSeconds?: number | null
    message?: string
  }) => Promise<SyncAuditEntry>
  getSlackStatus: () => Promise<SlackStatus>
  setSlackToken: (token: string) => Promise<SlackStatus>
  clearSlack: () => Promise<SlackStatus>
  getSlackChannels: () => Promise<SlackChannelOption[]>
  setSlackCustomerMapping: (payload: {
    customerName: string
    channelId: string
    channelName: string
  }) => Promise<SlackChannelMapping>
  removeSlackCustomerMapping: (customerName: string) => Promise<Record<string, SlackChannelMapping>>
  postSlackCustomerUpdate: (payload: {
    customer: string
    title: string
    lines: string[]
    channelId?: string | null
    metrics?: SlackUpdateMetrics | null
  }) => Promise<SlackPostResult>
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
  getPendingReportSyncMonths: () => Promise<string[]>
  setPendingReportSyncMonths: (months: string[]) => Promise<string[]>
  getMeetings: (options: {
    browser: 'safari' | 'chrome'
    headless?: boolean
    month?: string | null
    username?: string | null
    password?: string | null
  }) => Promise<MeetingsResult>
  selectMeetingsDuoAction: (action: 'push' | 'call') => Promise<boolean>
  onMeetingsDuoActionRequired: (handler: () => void) => () => void
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
	  getAgendaFact: () => Promise<string>
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
  setNativeThemeMode: (mode: 'dark' | 'oled' | 'liquid' | 'h4c37') => Promise<{
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
