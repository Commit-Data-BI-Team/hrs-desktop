import Store from 'electron-store'

type IntegrationFavoritePerson = {
  key: string
  label: string
  email: string | null
  avatarUrl: string | null
  jiraAccountId?: string
  slackUserId?: string
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
  trayPinned: boolean
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
  jiraCustomerAliases: Record<string, string>
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
  trayMeetingsSettingsOpen: boolean
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
  meetingExcludedSubjects: Record<string, string[]>
  integrationFavoritePeople: IntegrationFavoritePerson[]
  integrationTextDirection: 'auto' | 'ltr' | 'rtl'
  favoriteProjects: string[]
  hiddenProjects: string[]
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
}

type JiraLoggedEntries = Record<
  string,
  { issueKey: string; loggedAt: string; worklogId?: string }
>

type Schema = {
  preferences?: AppPreferences
  jiraLoggedEntries?: JiraLoggedEntries
  pendingReportSyncMonths?: string[]
  hrsCredentialFlowMigrationVersion?: number
}

const store = new Store<Schema>({
  name: 'hrs-preferences'
})

const HRS_CREDENTIAL_FLOW_MIGRATION_VERSION = 1

const defaultPreferences: AppPreferences = {
  jiraActiveOnly: true,
  jiraReportedOnly: true,
  jiraSectionOpen: false,
  reminderEnabled: true,
  reminderLastDate: null,
  reminderLastMidday: null,
  reminderLastEnd: null,
  reminderStartHour: 9,
  reminderMiddayHour: 13,
  reminderEndHour: 18,
  reminderIdleMinutes: 30,
  reviewMode: false,
  filtersOpen: true,
  reportsOpen: true,
  logWorkOpen: true,
  trayPinned: false,
  autoLoginEnabled: false,
  autoSuggestEnabled: true,
  heatmapEnabled: true,
  exportFiltered: false,
  commentRules: [],
  jiraManualBudgets: {},
  jiraBudgetInHours: false,
  jiraBudgetSortByProgress: false,
  jiraBudgetTitle: 'Jira project budgets',
  jiraEpicAliases: {},
  jiraCustomerAliases: {},
  jiraProjectStartDates: {},
  jiraProjectPeoplePercent: {},
  jiraProjectPositionSnapshots: {},
  meetingsBrowser: 'chrome',
  meetingsUsername: '',
  meetingsPassword: '',
  meetingsHeadless: true,
  trayMeetingsSettingsOpen: true,
  meetingsCollapsed: false,
  meetingsCache: {},
  meetingClientMappings: {},
  meetingExcludedSubjects: {},
  integrationFavoritePeople: [],
  integrationTextDirection: 'auto',
  favoriteProjects: [],
  hiddenProjects: [],
  reportWorkLogsCache: {},
  smartDefaults: {
    lastTaskByWeekday: {},
    lastTaskId: null
  }
}

export function getPreferences(): AppPreferences {
  const stored = store.get('preferences')
  return {
    jiraActiveOnly: stored?.jiraActiveOnly ?? defaultPreferences.jiraActiveOnly,
    jiraReportedOnly: stored?.jiraReportedOnly ?? defaultPreferences.jiraReportedOnly,
    jiraSectionOpen: stored?.jiraSectionOpen ?? defaultPreferences.jiraSectionOpen,
    reminderEnabled: stored?.reminderEnabled ?? defaultPreferences.reminderEnabled,
    reminderLastDate: stored?.reminderLastDate ?? defaultPreferences.reminderLastDate,
    reminderLastMidday: stored?.reminderLastMidday ?? defaultPreferences.reminderLastMidday,
    reminderLastEnd: stored?.reminderLastEnd ?? defaultPreferences.reminderLastEnd,
    reminderStartHour: stored?.reminderStartHour ?? defaultPreferences.reminderStartHour,
    reminderMiddayHour: stored?.reminderMiddayHour ?? defaultPreferences.reminderMiddayHour,
    reminderEndHour: stored?.reminderEndHour ?? defaultPreferences.reminderEndHour,
    reminderIdleMinutes: stored?.reminderIdleMinutes ?? defaultPreferences.reminderIdleMinutes,
    reviewMode: stored?.reviewMode ?? defaultPreferences.reviewMode,
    filtersOpen: stored?.filtersOpen ?? defaultPreferences.filtersOpen,
    reportsOpen: stored?.reportsOpen ?? defaultPreferences.reportsOpen,
    logWorkOpen: stored?.logWorkOpen ?? defaultPreferences.logWorkOpen,
    trayPinned: stored?.trayPinned ?? defaultPreferences.trayPinned,
    autoLoginEnabled: stored?.autoLoginEnabled ?? defaultPreferences.autoLoginEnabled,
    autoSuggestEnabled: stored?.autoSuggestEnabled ?? defaultPreferences.autoSuggestEnabled,
    heatmapEnabled: stored?.heatmapEnabled ?? defaultPreferences.heatmapEnabled,
    exportFiltered: stored?.exportFiltered ?? defaultPreferences.exportFiltered,
    commentRules: stored?.commentRules ?? defaultPreferences.commentRules,
    jiraManualBudgets: stored?.jiraManualBudgets ?? defaultPreferences.jiraManualBudgets,
    jiraBudgetInHours: stored?.jiraBudgetInHours ?? defaultPreferences.jiraBudgetInHours,
    jiraBudgetSortByProgress:
      stored?.jiraBudgetSortByProgress ?? defaultPreferences.jiraBudgetSortByProgress,
    jiraBudgetTitle: stored?.jiraBudgetTitle ?? defaultPreferences.jiraBudgetTitle,
    jiraEpicAliases: stored?.jiraEpicAliases ?? defaultPreferences.jiraEpicAliases,
    jiraCustomerAliases: stored?.jiraCustomerAliases ?? defaultPreferences.jiraCustomerAliases,
    jiraProjectStartDates:
      stored?.jiraProjectStartDates ?? defaultPreferences.jiraProjectStartDates,
    jiraProjectPeoplePercent:
      stored?.jiraProjectPeoplePercent ?? defaultPreferences.jiraProjectPeoplePercent,
    jiraProjectPositionSnapshots:
      stored?.jiraProjectPositionSnapshots ??
      defaultPreferences.jiraProjectPositionSnapshots,
    meetingsBrowser: stored?.meetingsBrowser ?? defaultPreferences.meetingsBrowser,
    meetingsUsername: stored?.meetingsUsername ?? defaultPreferences.meetingsUsername,
    meetingsPassword: stored?.meetingsPassword ?? defaultPreferences.meetingsPassword,
    meetingsHeadless: stored?.meetingsHeadless ?? defaultPreferences.meetingsHeadless,
    trayMeetingsSettingsOpen:
      stored?.trayMeetingsSettingsOpen ?? defaultPreferences.trayMeetingsSettingsOpen,
    meetingsCollapsed: stored?.meetingsCollapsed ?? defaultPreferences.meetingsCollapsed,
    meetingsCache: stored?.meetingsCache ?? defaultPreferences.meetingsCache,
    meetingClientMappings:
      stored?.meetingClientMappings ?? defaultPreferences.meetingClientMappings,
    meetingExcludedSubjects:
      stored?.meetingExcludedSubjects ?? defaultPreferences.meetingExcludedSubjects,
    integrationFavoritePeople:
      stored?.integrationFavoritePeople ?? defaultPreferences.integrationFavoritePeople,
    integrationTextDirection:
      stored?.integrationTextDirection ?? defaultPreferences.integrationTextDirection,
    favoriteProjects: stored?.favoriteProjects ?? defaultPreferences.favoriteProjects,
    hiddenProjects: stored?.hiddenProjects ?? defaultPreferences.hiddenProjects,
    reportWorkLogsCache: stored?.reportWorkLogsCache ?? defaultPreferences.reportWorkLogsCache,
    smartDefaults: stored?.smartDefaults ?? defaultPreferences.smartDefaults
  }
}

export function setPreferences(next: Partial<AppPreferences>): AppPreferences {
  const current = getPreferences()
  const updated = { ...current, ...next }
  store.set('preferences', updated)
  return updated
}

export function migrateHrsCredentialFlowPreferences(): boolean {
  const migrationVersion = store.get('hrsCredentialFlowMigrationVersion') ?? 0
  if (migrationVersion >= HRS_CREDENTIAL_FLOW_MIGRATION_VERSION) return false

  const stored = store.get('preferences')
  if (stored?.autoLoginEnabled) {
    store.set('preferences', { ...stored, autoLoginEnabled: false })
  }
  store.set('hrsCredentialFlowMigrationVersion', HRS_CREDENTIAL_FLOW_MIGRATION_VERSION)
  return true
}

export function getJiraLoggedEntries(): JiraLoggedEntries {
  return store.get('jiraLoggedEntries') ?? {}
}

export function setJiraLoggedEntries(entries: JiraLoggedEntries): JiraLoggedEntries {
  store.set('jiraLoggedEntries', entries)
  return entries
}

export function getPendingReportSyncMonths(): string[] {
  return Array.from(
    new Set(
      (store.get('pendingReportSyncMonths') ?? []).filter(month => /^\d{4}-\d{2}$/.test(month))
    )
  ).sort()
}

export function setPendingReportSyncMonths(months: string[]): string[] {
  const normalized = Array.from(
    new Set(months.filter(month => /^\d{4}-\d{2}$/.test(month)))
  ).sort()
  store.set('pendingReportSyncMonths', normalized)
  return normalized
}
