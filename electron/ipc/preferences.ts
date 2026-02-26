import { ipcMain } from 'electron'
import {
  validateDate,
  validateEnum,
  validateExactObject,
  validateNumberRange,
  validateOptionalString,
  validateSafeObject,
  validateStringLength
} from '../utils/validation'
import {
  getJiraLoggedEntries,
  getPreferences,
  setJiraLoggedEntries,
  setPreferences
} from '../app/preferences'

const PREF_PATCH_KEYS = [
  'jiraActiveOnly',
  'jiraReportedOnly',
  'jiraSectionOpen',
  'reminderEnabled',
  'reminderLastDate',
  'reminderLastMidday',
  'reminderLastEnd',
  'reminderStartHour',
  'reminderMiddayHour',
  'reminderEndHour',
  'reminderIdleMinutes',
  'reviewMode',
  'filtersOpen',
  'reportsOpen',
  'logWorkOpen',
  'autoLoginEnabled',
  'autoSuggestEnabled',
  'heatmapEnabled',
  'exportFiltered',
  'commentRules',
  'jiraManualBudgets',
  'jiraBudgetInHours',
  'jiraBudgetSortByProgress',
  'jiraBudgetTitle',
  'jiraEpicAliases',
  'jiraCustomerAliases',
  'jiraProjectStartDates',
  'jiraProjectPeoplePercent',
  'jiraProjectPositionSnapshots',
  'meetingsBrowser',
  'meetingsUsername',
  'meetingsPassword',
  'meetingsHeadless',
  'trayMeetingsSettingsOpen',
  'meetingsCollapsed',
  'meetingsCache',
  'meetingClientMappings',
  'reportWorkLogsCache',
  'smartDefaults'
] as const

function validateStringRecord(value: unknown, label: string, maxEntries = 1000) {
  const obj = validateSafeObject<Record<string, unknown>>(value ?? {})
  const entries = Object.entries(obj)
  if (entries.length > maxEntries) {
    throw new Error(`Invalid ${label}: too many entries`)
  }
  const out: Record<string, string> = {}
  for (const [key, raw] of entries) {
    const safeKey = validateStringLength(key, 1, 200)
    const safeVal = validateStringLength(raw, 0, 500)
    out[safeKey] = safeVal
  }
  return out
}

function validateNoPrototypeObject(value: unknown, label: string) {
  try {
    return validateSafeObject<Record<string, unknown>>(value ?? {})
  } catch {
    throw new Error(`Invalid ${label}: expected plain object`)
  }
}

function validatePreferencesPatch(payload: unknown) {
  const raw = validateExactObject<Record<string, unknown>>(
    payload ?? {},
    PREF_PATCH_KEYS,
    'preferences patch'
  )
  const out: Record<string, unknown> = {}

  const booleanKeys = new Set([
    'jiraActiveOnly',
    'jiraReportedOnly',
    'jiraSectionOpen',
    'reminderEnabled',
    'reviewMode',
    'filtersOpen',
    'reportsOpen',
    'logWorkOpen',
    'autoLoginEnabled',
    'autoSuggestEnabled',
    'heatmapEnabled',
    'exportFiltered',
    'jiraBudgetInHours',
    'jiraBudgetSortByProgress',
    'meetingsHeadless',
    'trayMeetingsSettingsOpen',
    'meetingsCollapsed'
  ])

  for (const [key, value] of Object.entries(raw)) {
    if (booleanKeys.has(key)) {
      if (typeof value !== 'boolean') throw new Error(`Invalid ${key}: expected boolean`)
      out[key] = value
      continue
    }
    switch (key) {
      case 'reminderStartHour':
      case 'reminderMiddayHour':
      case 'reminderEndHour':
        out[key] = validateNumberRange(value, 0, 23, { integer: true })
        break
      case 'reminderIdleMinutes':
        out[key] = validateNumberRange(value, 1, 24 * 60, { integer: true })
        break
      case 'reminderLastDate':
        out[key] = value === null ? null : validateDate(value)
        break
      case 'reminderLastMidday':
      case 'reminderLastEnd':
        out[key] = value === null ? null : validateStringLength(value, 1, 64)
        break
      case 'jiraBudgetTitle':
      case 'meetingsUsername':
      case 'meetingsPassword':
        out[key] = validateStringLength(value, 0, 500)
        break
      case 'meetingsBrowser':
        out[key] = validateEnum(value, ['safari', 'chrome'] as const)
        break
      case 'jiraManualBudgets':
      case 'jiraEpicAliases':
      case 'jiraCustomerAliases':
      case 'jiraProjectStartDates':
      case 'meetingClientMappings':
        out[key] = validateStringRecord(value, key)
        break
      case 'commentRules': {
        if (!Array.isArray(value)) throw new Error('Invalid commentRules: expected array')
        if (value.length > 300) throw new Error('Invalid commentRules: too many entries')
        out[key] = value.map(item => {
          const safeItem = validateExactObject<{
            id?: unknown
            scope?: unknown
            match?: unknown
            tags?: unknown
          }>(item, ['id', 'scope', 'match', 'tags'], 'comment rule')
          if (!Array.isArray(safeItem.tags) || safeItem.tags.length > 40) {
            throw new Error('Invalid comment rule tags')
          }
          return {
            id: validateStringLength(safeItem.id, 1, 120),
            scope: validateEnum(safeItem.scope, ['project', 'customer'] as const),
            match: validateStringLength(safeItem.match, 0, 300),
            tags: safeItem.tags.map(tag => validateStringLength(tag, 0, 80))
          }
        })
        break
      }
      case 'jiraProjectPeoplePercent': {
        const root = validateNoPrototypeObject(value, key)
        const result: Record<string, Record<string, number>> = {}
        for (const [epicKey, peopleRaw] of Object.entries(root)) {
          const safeEpicKey = validateStringLength(epicKey, 1, 120)
          const people = validateNoPrototypeObject(peopleRaw, `${key}:${safeEpicKey}`)
          const peopleOut: Record<string, number> = {}
          for (const [name, percent] of Object.entries(people)) {
            peopleOut[validateStringLength(name, 1, 160)] = validateNumberRange(percent, 0, 100)
          }
          result[safeEpicKey] = peopleOut
        }
        out[key] = result
        break
      }
      case 'jiraProjectPositionSnapshots': {
        const root = validateNoPrototypeObject(value, key)
        const result: Record<string, unknown> = {}
        for (const [epicKey, snapshotRaw] of Object.entries(root)) {
          const safe = validateExactObject<{
            monthKey?: unknown
            frozen?: unknown
            computedAt?: unknown
            totalSeconds?: unknown
            secondsByPerson?: unknown
            percents?: unknown
          }>(
            snapshotRaw,
            ['monthKey', 'frozen', 'computedAt', 'totalSeconds', 'secondsByPerson', 'percents'],
            'jiraProjectPositionSnapshot'
          )
          result[validateStringLength(epicKey, 1, 120)] = {
            monthKey: validateStringLength(safe.monthKey, 1, 20),
            frozen: typeof safe.frozen === 'boolean' ? safe.frozen : false,
            computedAt: validateStringLength(safe.computedAt, 1, 64),
            totalSeconds: validateNumberRange(safe.totalSeconds, 0, 10_000_000, { integer: true }),
            secondsByPerson: Object.fromEntries(
              Object.entries(
                validateNoPrototypeObject(safe.secondsByPerson, 'secondsByPerson')
              ).map(([person, seconds]) => [
                validateStringLength(person, 1, 160),
                validateNumberRange(seconds, 0, 10_000_000, { integer: true })
              ])
            ),
            percents: Object.fromEntries(
              Object.entries(validateNoPrototypeObject(safe.percents, 'percents')).map(
                ([person, percent]) => [
                  validateStringLength(person, 1, 160),
                  validateNumberRange(percent, 0, 100)
                ]
              )
            )
          }
        }
        out[key] = result
        break
      }
      case 'meetingsCache': {
        const root = validateNoPrototypeObject(value, key)
        const result: Record<string, unknown> = {}
        for (const [month, entryRaw] of Object.entries(root)) {
          const entry = validateExactObject<{ updatedAt?: unknown; meetings?: unknown }>(
            entryRaw,
            ['updatedAt', 'meetings'],
            'meetings cache entry'
          )
          const meetingsRaw = Array.isArray(entry.meetings) ? entry.meetings : []
          result[validateStringLength(month, 1, 20)] = {
            updatedAt: validateStringLength(entry.updatedAt, 1, 64),
            meetings: meetingsRaw.slice(0, 400).map(item => {
              const safeMeeting = validateExactObject<{
                subject?: unknown
                startTime?: unknown
                endTime?: unknown
                participants?: unknown
                attendanceCount?: unknown
                attendanceEmails?: unknown
                attendeeEmails?: unknown
              }>(
                item,
                [
                  'subject',
                  'startTime',
                  'endTime',
                  'participants',
                  'attendanceCount',
                  'attendanceEmails',
                  'attendeeEmails'
                ],
                'meeting item'
              )
              const attendanceEmails = Array.isArray(safeMeeting.attendanceEmails)
                ? safeMeeting.attendanceEmails.slice(0, 100).map(email =>
                    validateStringLength(email, 0, 200)
                  )
                : []
              const attendeeEmails = Array.isArray(safeMeeting.attendeeEmails)
                ? safeMeeting.attendeeEmails.slice(0, 100).map(email =>
                    validateStringLength(email, 0, 200)
                  )
                : []
              return {
                subject: validateStringLength(safeMeeting.subject, 0, 500),
                startTime: validateStringLength(safeMeeting.startTime, 0, 64),
                endTime: validateStringLength(safeMeeting.endTime, 0, 64),
                participants: validateStringLength(safeMeeting.participants, 0, 4000),
                attendanceCount:
                  safeMeeting.attendanceCount === null || safeMeeting.attendanceCount === undefined
                    ? null
                    : validateNumberRange(safeMeeting.attendanceCount, 0, 1000, {
                        integer: true
                      }),
                attendanceEmails,
                attendeeEmails
              }
            })
          }
        }
        out[key] = result
        break
      }
      case 'reportWorkLogsCache': {
        const root = validateNoPrototypeObject(value, key)
        const result: Record<string, unknown> = {}
        for (const [dateKey, logsRaw] of Object.entries(root)) {
          if (!Array.isArray(logsRaw)) throw new Error('Invalid reportWorkLogsCache entry')
          result[validateDate(dateKey)] = logsRaw.slice(0, 200).map(item => {
            const safe = validateExactObject<{
              taskId?: unknown
              from?: unknown
              to?: unknown
              hours_HHMM?: unknown
              comment?: unknown
              reporting_from?: unknown
              projectInstance?: unknown
            }>(
              item,
              ['taskId', 'from', 'to', 'hours_HHMM', 'comment', 'reporting_from', 'projectInstance'],
              'report log item'
            )
            return {
              taskId: validateNumberRange(safe.taskId, 1, 10_000_000, { integer: true }),
              from: validateOptionalString(safe.from, { min: 0, max: 8, allowNull: true }) ?? null,
              to: validateOptionalString(safe.to, { min: 0, max: 8, allowNull: true }) ?? null,
              hours_HHMM: validateStringLength(safe.hours_HHMM, 0, 8),
              comment: validateStringLength(safe.comment, 0, 2000),
              reporting_from: validateStringLength(safe.reporting_from, 0, 100),
              projectInstance:
                validateOptionalString(safe.projectInstance, { min: 0, max: 200 }) ?? undefined
            }
          })
        }
        out[key] = result
        break
      }
      case 'smartDefaults': {
        const safe = validateExactObject<{ lastTaskByWeekday?: unknown; lastTaskId?: unknown }>(
          value,
          ['lastTaskByWeekday', 'lastTaskId'],
          'smartDefaults'
        )
        const byWeekday = validateNoPrototypeObject(safe.lastTaskByWeekday, 'lastTaskByWeekday')
        const outByWeekday: Record<string, number> = {}
        for (const [weekday, taskId] of Object.entries(byWeekday)) {
          outByWeekday[validateStringLength(weekday, 1, 20)] = validateNumberRange(taskId, 1, 10_000_000, {
            integer: true
          })
        }
        out[key] = {
          lastTaskByWeekday: outByWeekday,
          lastTaskId:
            safe.lastTaskId === null
              ? null
              : validateNumberRange(safe.lastTaskId, 1, 10_000_000, { integer: true })
        }
        break
      }
      default:
        throw new Error(`Unhandled preferences field "${key}"`)
    }
  }
  return out
}

function validateJiraEntriesPayload(payload: unknown) {
  const raw = validateNoPrototypeObject(payload, 'jira logged entries')
  const out: Record<string, { issueKey: string; loggedAt: string; worklogId?: string }> = {}
  for (const [entryKey, value] of Object.entries(raw)) {
    const safe = validateExactObject<{ issueKey?: unknown; loggedAt?: unknown; worklogId?: unknown }>(
      value,
      ['issueKey', 'loggedAt', 'worklogId'],
      'jira logged entry'
    )
    out[validateStringLength(entryKey, 1, 260)] = {
      issueKey: validateStringLength(safe.issueKey, 1, 64),
      loggedAt: validateStringLength(safe.loggedAt, 1, 64),
      worklogId: validateOptionalString(safe.worklogId, { min: 1, max: 64 }) ?? undefined
    }
  }
  return out
}

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
    ) => setPreferences(validatePreferencesPatch(next))
  )

  ipcMain.handle('app:getJiraLoggedEntries', async () => {
    return getJiraLoggedEntries()
  })

  ipcMain.handle(
    'app:setJiraLoggedEntries',
    async (
      _event,
      entries: Record<string, { issueKey: string; loggedAt: string; worklogId?: string }>
    ) => setJiraLoggedEntries(validateJiraEntriesPayload(entries))
  )
}
