import {
  Alert,
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Checkbox,
  Collapse,
  Container,
  Group,
  Input,
  Loader,
  Menu,
  Modal,
  NumberInput,
  PasswordInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  TextInput,
  Textarea,
  Text,
  Tooltip,
  ThemeIcon,
  useMantineColorScheme
} from '@mantine/core'
import {
  IconCheck,
  IconAlertTriangle,
  IconFlame,
  IconUser,
  IconClock,
  IconCalendar,
  IconSparkles
} from '@tabler/icons-react'
import { DatePicker, DatePickerInput, TimeInput } from '@mantine/dates'
import type { DayOfWeek } from '@mantine/dates'
import dayjs from 'dayjs'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, CSSProperties } from 'react'
import { useDebouncedValue } from '@mantine/hooks'
import { FixedSizeList, type ListChildComponentProps } from 'react-window'
import * as XLSX from 'xlsx'
// import { ProductTour } from './components/ProductTour' // Disabled for now

type WorkLog = {
  _cid?: string
  taskId: number
  taskName: string
  customerName: string
  projectInstance?: string
  projectName: string
  reporting_mode?: 'FROM_TO' | 'HOURLY'
  commentsRequired?: boolean
  projectColor?: string
  isActiveTask?: boolean
  date?: string
}

type WorkReportEntry = {
  taskId: number
  taskName: string
  projectInstance: string
  hours_HHMM: string
  comment: string
  reporting_from: string
  from?: string
  to?: string
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

type WorkReportDay = {
  date: string
  minWorkLog: number
  isHoliday: boolean
  reports: WorkReportEntry[]
}

type MonthlyReport = {
  totalHoursNeeded: number
  totalHours: number
  closed_date: string
  totalDays: number
  days: WorkReportDay[]
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
  assigneeName?: string | null
  statusName?: string | null
  worklogs?: JiraWorklogEntry[]
  subtasks?: JiraSubtaskItem[]
  worklogTotal?: number
  lastWorklog?: JiraWorklogEntry | null
}

type JiraWorklogEntry = {
  id: string
  started: string | null
  seconds: number
  comment: unknown | null
  authorName?: string | null
  authorId?: string | null
}

type JiraSubtaskItem = JiraWorkItem & {
  assigneeName?: string | null
  worklogs?: JiraWorklogEntry[]
}

type JiraProjectPositionSnapshot = {
  monthKey: string
  frozen: boolean
  computedAt: string
  totalSeconds: number
  secondsByPerson: Record<string, number>
  percents: Record<string, number>
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

type CommentRule = {
  id: string
  scope: 'project' | 'customer'
  match: string
  tags: string[]
}

type WeekDelta = {
  diff: number
  percent: number
  current: number
  prev: number
}

type TimeBudgetAlert = {
  customer: string
  epicKey: string
  spentSeconds: number
  estimateSeconds: number
  ratio: number
}

type JiraContributor = {
  name: string
  seconds: number
}

type JiraBudgetRow = {
  customer: string
  epicKey: string
  spentSeconds: number
  estimateSeconds: number
  ratio: number
  items: JiraWorkItem[]
  contributors: JiraContributor[]
  summaryPartial: boolean
  detailsPartial: boolean
  detailsLoaded: boolean
  detailsLoading: boolean
  detailsError: string | null
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
  autoLoginEnabled: boolean
  autoSuggestEnabled: boolean
  heatmapEnabled: boolean
  exportFiltered: boolean
  commentRules: CommentRule[]
  jiraManualBudgets: Record<string, string>
  jiraBudgetInHours: boolean
  jiraBudgetSortByProgress: boolean
  jiraProjectStartDates: Record<string, string>
  jiraProjectPeoplePercent: Record<string, Record<string, number>>
  meetingsBrowser: 'safari' | 'chrome'
  meetingsUsername: string
  meetingsPassword: string
  meetingsHeadless: boolean
  meetingsCollapsed: boolean
  meetingsCache: Record<string, { updatedAt: string; meetings: MeetingItem[] }>
  meetingClientMappings: Record<string, string>
  reportWorkLogsCache?: Record<string, StoredReportLogEntry[]>
  smartDefaults: {
    lastTaskByWeekday: Record<string, number>
    lastTaskId: number | null
  }
}

type SelectOption = {
  value: string
  label: string
}

type Duration = {
  minutes: number
  hours: number
  hoursHHMM: string
}

type DateInputValue = Date | string | null

type LogWorkItem = {
  id: number
  from: string
  to: string
  hours_HHMM: string
  hours: number
  comment: string
  notSaved: boolean
  reporting_from: string
  taskId: number
}

type ReportLogEntry = {
  taskId: number
  from: string | null
  to: string | null
  hours_HHMM: string
  comment: string
  reporting_from: string
  projectInstance?: string
}

function buildOptions(items: WorkLog[], pick: (item: WorkLog) => string | undefined): SelectOption[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    const value = pick(item)
    if (!value) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([value, count]) => ({ value, label: `${value} (${count})` }))
}

function parseTimeToMinutes(value: string): number | null {
  const match = value.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null
  return hours * 60 + minutes
}

function minutesToHHMM(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

function buildDurationFromTimes(from: string, to: string): Duration | null {
  const start = parseTimeToMinutes(from)
  const end = parseTimeToMinutes(to)
  if (start === null || end === null || end <= start) return null
  const minutes = end - start
  const hours = Math.round((minutes / 60) * 100) / 100
  return { minutes, hours, hoursHHMM: minutesToHHMM(minutes) }
}

function normalizeTimeValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.trim().match(/(\d{1,2}:\d{2})/)
  if (!match) return null
  const minutes = parseTimeToMinutes(match[1])
  if (minutes === null) return null
  return minutesToHHMM(minutes)
}

function extractTimeRangeFromRecord(record: Record<string, unknown>): { from: string; to: string } | null {
  const from = normalizeTimeValue(
    record.from ??
      record.start ??
      record.start_time ??
      record.from_time ??
      record.time_from ??
      record.timeFrom
  )
  const to = normalizeTimeValue(
    record.to ?? record.end ?? record.end_time ?? record.to_time ?? record.time_to ?? record.timeTo
  )
  if (!from || !to) return null
  return { from, to }
}

function buildReportEntryKeys(
  entry: {
    taskId: number
    hours_HHMM: string
    comment?: string
    reporting_from?: string
    projectInstance?: string
  },
  dateKey: string
) {
  const normalized = {
    taskId: entry.taskId,
    hours_HHMM: entry.hours_HHMM,
    comment: entry.comment || '',
    reporting_from: entry.reporting_from || '',
    projectInstance: entry.projectInstance || ''
  }
  const keys = new Set<string>([getReportEntryKey(normalized, dateKey)])
  if (normalized.comment) {
    keys.add(getReportEntryKey({ ...normalized, comment: '' }, dateKey))
  }
  if (normalized.reporting_from) {
    keys.add(getReportEntryKey({ ...normalized, reporting_from: '' }, dateKey))
  }
  if (normalized.projectInstance) {
    keys.add(getReportEntryKey({ ...normalized, projectInstance: '' }, dateKey))
  }
  if (normalized.comment || normalized.reporting_from || normalized.projectInstance) {
    keys.add(
      getReportEntryKey(
        {
          taskId: normalized.taskId,
          hours_HHMM: normalized.hours_HHMM,
          comment: '',
          reporting_from: '',
          projectInstance: ''
        },
        dateKey
      )
    )
  }
  return Array.from(keys)
}

function normalizeReportLogEntry(entry: unknown): ReportLogEntry | null {
  if (!entry || typeof entry !== 'object') return null
  const record = entry as Record<string, unknown>
  const taskIdRaw = record.taskId
  const taskId = typeof taskIdRaw === 'number' ? taskIdRaw : Number(taskIdRaw)
  if (!Number.isFinite(taskId)) return null
  const timeRange = extractTimeRangeFromRecord(record)
  const comment =
    typeof record.comment === 'string'
      ? record.comment
      : typeof record.task_comment === 'string'
        ? record.task_comment
        : typeof record.taskComment === 'string'
          ? record.taskComment
          : typeof record.description === 'string'
            ? record.description
            : typeof record.note === 'string'
              ? record.note
              : ''
  const reportingFrom =
    typeof record.reporting_from === 'string'
      ? record.reporting_from
      : typeof record.reportingFrom === 'string'
        ? record.reportingFrom
        : ''
  const hoursRaw =
    typeof record.hours_HHMM === 'string'
      ? record.hours_HHMM
      : typeof record.hoursHHMM === 'string'
        ? record.hoursHHMM
        : ''
  const computed = timeRange ? buildDurationFromTimes(timeRange.from, timeRange.to) : null
  const hours = hoursRaw || computed?.hoursHHMM || ''
  const projectInstance =
    typeof record.projectInstance === 'string' ? record.projectInstance : undefined
  return {
    taskId,
    from: timeRange?.from ?? null,
    to: timeRange?.to ?? null,
    hours_HHMM: hours,
    comment,
    reporting_from: reportingFrom,
    projectInstance
  }
}
function addMinutesToTime(value: string, minutesToAdd: number): string | null {
  const start = parseTimeToMinutes(value)
  if (start === null) return null
  const total = Math.min(start + minutesToAdd, 23 * 60 + 59)
  return minutesToHHMM(total)
}

function getMonthRange(date: Date) {
  const start = dayjs(date).startOf('month').format('YYYY-MM-DD')
  const end = dayjs(date).endOf('month').format('YYYY-MM-DD')
  return { start, end }
}

function parseHoursHHMMToMinutes(value: string): number {
  const match = value.match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return 0
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return 0
  return hours * 60 + minutes
}

function formatTimeFromDate(date: Date): string {
  return dayjs(date).format('HH:mm')
}

function formatMinutesToLabel(minutes: number): string {
  if (minutes <= 0) return ''
  const hours = minutes / 60
  if (hours >= 1) return `${hours.toFixed(1)}h`
  return `${minutes}m`
}

function formatReportingFromLabel(value: string): string {
  if (!value) return ''
  const normalized = value.trim().toUpperCase()
  if (normalized === 'OFFICE') return 'Office'
  if (normalized === 'HOME') return 'Home'
  if (normalized === 'CLIENT') return 'Customer'
  return normalized
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
}

function buildWeekDelta(current: number, prev: number): WeekDelta {
  const diff = current - prev
  const percent = prev > 0 ? (diff / prev) * 100 : current > 0 ? 100 : 0
  return { diff, percent, current, prev }
}

function formatElapsed(seconds: number) {
  const total = Math.max(0, seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(
    secs
  ).padStart(2, '0')}`
}

function escapeCsvValue(value: string) {
  if (!value) return ''
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function extractJiraCommentText(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value !== 'object') return ''
  const node = value as { type?: string; text?: string; content?: unknown[] }
  if (node.text) return node.text
  if (Array.isArray(node.content)) {
    return node.content.map(entry => extractJiraCommentText(entry)).join(' ')
  }
  return ''
}

type ExportRow = {
  date: string
  project: string
  customer: string
  task: string
  comment: string
  hours: string
  reportingFrom: string
  jiraLogged: string
  jiraIssue: string
}

function toLogWorkItem(
  report: Pick<
    WorkReportEntry,
    'taskId' | 'hours_HHMM' | 'comment' | 'reporting_from' | 'from' | 'to'
  >,
  index: number
): LogWorkItem {
  const timeRange = extractTimeRangeFromRecord(report as unknown as Record<string, unknown>)
  const minutes = parseHoursHHMMToMinutes(report.hours_HHMM)
  const hours = Math.round((minutes / 60) * 100) / 100
  const fallbackFrom = '00:00'
  const fallbackTo = minutesToHHMM(minutes)
  const from = timeRange?.from ?? fallbackFrom
  const to = timeRange?.to ?? fallbackTo
  return {
    id: Date.now() + index,
    from,
    to,
    hours_HHMM: report.hours_HHMM,
    hours,
    comment: report.comment || '',
    notSaved: true,
    reporting_from: report.reporting_from || 'OFFICE',
    taskId: report.taskId
  }
}

function buildLogWorkPayload(date: string, reports: WorkReportEntry[]) {
  return {
    date,
    workLogs: reports.map((report, index) => toLogWorkItem(report, index))
  }
}

function parseWeekendDays(weekend?: string): DayOfWeek[] {
  if (!weekend) return [0, 6]
  const mapping: Record<string, DayOfWeek> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  }
  const days = weekend.split('-').map(part => mapping[part.trim()])
  const cleaned = days.filter((day): day is DayOfWeek => day !== undefined)
  return cleaned.length ? cleaned : [0, 6]
}

function toDate(value: DateInputValue): Date | null {
  if (!value) return null
  return typeof value === 'string' ? dayjs(value).toDate() : value
}

function getReportSizeClass(values: string[]) {
  const maxLength = values.reduce((max, value) => Math.max(max, value.length), 0)
  if (maxLength > 48) return 'report-tight'
  if (maxLength > 32) return 'report-compact'
  return 'report-normal'
}

function getReportEntryKey(
  entry: Pick<WorkReportEntry, 'taskId' | 'hours_HHMM' | 'comment' | 'reporting_from' | 'projectInstance'>,
  date: string
) {
  return [
    date,
    entry.taskId,
    entry.hours_HHMM,
    entry.comment || '',
    entry.reporting_from || '',
    entry.projectInstance || ''
  ].join('|')
}

function formatJiraHours(seconds: number) {
  if (!seconds || seconds <= 0) return '0h'
  const hours = seconds / 3600
  if (hours < 1) return `${Math.round((seconds / 60) / 6) / 10}h`
  return `${Math.round(hours * 10) / 10}h`
}

function recalculateMonthlyHours(days: WorkReportDay[]) {
  const totalMinutes = days.reduce((sum, day) => {
    return (
      sum +
      day.reports.reduce(
        (daySum, report) => daySum + parseHoursHHMMToMinutes(report.hours_HHMM),
        0
      )
    )
  }, 0)
  return Math.round((totalMinutes / 60) * 10) / 10
}

function updateMonthlyReportDay(
  report: MonthlyReport,
  dateKey: string,
  reports: WorkReportEntry[]
) {
  const days = report.days.map(day =>
    day.date === dateKey ? { ...day, reports } : day
  )
  return {
    ...report,
    days,
    totalHours: recalculateMonthlyHours(days)
  }
}

function buildJiraIssueOptions(items: JiraWorkItem[], includeSubtasks = false): SelectOption[] {
  const seen = new Set<string>()
  const options: SelectOption[] = []
  const pushOption = (key: string, label: string) => {
    if (!key || seen.has(key)) return
    seen.add(key)
    options.push({ value: key, label })
  }
  for (const issue of items) {
    pushOption(
      issue.key,
      `${issue.key} · ${issue.summary} (${formatJiraHours(issue.timespent)})`
    )
    if (includeSubtasks && issue.subtasks?.length) {
      for (const subtask of issue.subtasks) {
        pushOption(
          subtask.key,
          `${subtask.key} · ${subtask.summary} (Subtask of ${issue.key})`
        )
      }
    }
  }
  return options
}

function formatJiraDuration(
  seconds: number,
  config: { hoursPerDay: number; daysPerWeek: number } | null
) {
  if (!seconds || seconds <= 0) return '0h'
  const hoursPerDay = config?.hoursPerDay ?? 8
  const daysPerWeek = config?.daysPerWeek ?? 5
  const secondsPerHour = 3600
  const secondsPerDay = hoursPerDay * secondsPerHour
  const secondsPerWeek = daysPerWeek * secondsPerDay
  let remaining = Math.round(seconds)
  const weeks = Math.floor(remaining / secondsPerWeek)
  remaining -= weeks * secondsPerWeek
  const days = Math.floor(remaining / secondsPerDay)
  remaining -= days * secondsPerDay
  let hours = Math.floor(remaining / secondsPerHour)
  let minutes = Math.round((remaining - hours * secondsPerHour) / 60)
  if (minutes === 60) {
    hours += 1
    minutes = 0
  }
  const parts: string[] = []
  if (weeks) parts.push(`${weeks}w`)
  if (days) parts.push(`${days}d`)
  if (hours || parts.length === 0) parts.push(`${hours}h`)
  if (minutes) parts.push(`${minutes}m`)
  return parts.join(' ')
}

function getMeetingKey(meeting: MeetingItem) {
  return `${meeting.subject || ''}|${meeting.startTime}|${meeting.endTime}`
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function formatJiraBudgetValue(
  seconds: number,
  showHours: boolean,
  config: { hoursPerDay: number; daysPerWeek: number } | null
) {
  return showHours ? formatJiraHours(seconds) : formatJiraDuration(seconds, config)
}

function getWorkItemTotals(item: JiraWorkItem) {
  let estimateSeconds = item.estimateSeconds ?? 0
  let spentSeconds = item.timespent ?? 0
  const subtasks = item.subtasks ?? []
  for (const subtask of subtasks) {
    estimateSeconds += subtask.estimateSeconds ?? 0
    spentSeconds += subtask.timespent ?? 0
  }
  return { estimateSeconds, spentSeconds }
}

function dedupeWorkItemsDeep(items: JiraWorkItem[]) {
  const unique = new Map<string, JiraWorkItem>()
  for (const item of items ?? []) {
    const subtasks = item.subtasks ?? []
    const uniqueSubtasks = subtasks.length
      ? Array.from(new Map(subtasks.map(subtask => [subtask.key, subtask])).values())
      : []
    unique.set(item.key, {
      ...item,
      subtasks: uniqueSubtasks
    })
  }
  return Array.from(unique.values())
}

function sortByProgress(items: JiraWorkItem[]) {
  return [...items].sort((a, b) => {
    const aTotals = getWorkItemTotals(a)
    const bTotals = getWorkItemTotals(b)
    const aHasEstimate = aTotals.estimateSeconds > 0
    const bHasEstimate = bTotals.estimateSeconds > 0
    if (aHasEstimate !== bHasEstimate) return aHasEstimate ? -1 : 1

    const aRatio = aHasEstimate ? aTotals.spentSeconds / aTotals.estimateSeconds : null
    const bRatio = bHasEstimate ? bTotals.spentSeconds / bTotals.estimateSeconds : null
    if (aRatio !== null && bRatio !== null && bRatio !== aRatio) return bRatio - aRatio

    if (bTotals.spentSeconds !== aTotals.spentSeconds) return bTotals.spentSeconds - aTotals.spentSeconds
    if (bTotals.estimateSeconds !== aTotals.estimateSeconds) return bTotals.estimateSeconds - aTotals.estimateSeconds
    return a.key.localeCompare(b.key)
  })
}

function computeJiraTotals(items: JiraWorkItem[]) {
  let estimateSeconds = 0
  let spentSeconds = 0
  for (const item of items) {
    const totals = getWorkItemTotals(item)
    estimateSeconds += totals.estimateSeconds
    spentSeconds += totals.spentSeconds
  }
  return { estimateSeconds, spentSeconds }
}

function collectJiraWorklogs(item: JiraWorkItem): JiraWorklogEntry[] {
  const worklogs = item.worklogs ?? []
  const subtasks = item.subtasks ?? []
  if (!subtasks.length) return worklogs
  const subtaskLogs = subtasks.flatMap(subtask => subtask.worklogs ?? [])
  return [...worklogs, ...subtaskLogs]
}

function hasPartialWorklogs(item: JiraWorkItem): boolean {
  const worklogCount = item.worklogs?.length ?? 0
  const total = item.worklogTotal ?? worklogCount
  if (worklogCount < total) return true
  if (item.subtasks?.some(subtask => hasPartialWorklogs(subtask))) return true
  return false
}

function buildContributorSummary(items: JiraWorkItem[]): JiraContributor[] {
  const totals = new Map<string, number>()
  for (const item of items) {
    const worklogs = collectJiraWorklogs(item)
    for (const log of worklogs) {
      const name = log.authorName?.trim() || 'Unknown'
      totals.set(name, (totals.get(name) ?? 0) + (log.seconds ?? 0))
    }
  }
  return Array.from(totals.entries())
    .map(([name, seconds]) => ({ name, seconds }))
    .sort((a, b) => b.seconds - a.seconds)
}

// Calculate position % from task assignments and timespent (no worklogs needed)
function buildPositionFromAssignments(items: JiraWorkItem[]): JiraContributor[] {
  const totals = new Map<string, number>()
  for (const item of items) {
    // Add item's timespent to its assignee
    const assignee = item.assigneeName?.trim() || 'Unassigned'
    const itemSeconds = item.timespent ?? 0
    // Only count if there are no subtasks, otherwise subtasks have the breakdown
    const subtasks = item.subtasks ?? []
    if (!subtasks.length && itemSeconds > 0) {
      totals.set(assignee, (totals.get(assignee) ?? 0) + itemSeconds)
    }
    // Add each subtask's timespent to its assignee
    for (const subtask of subtasks) {
      const subAssignee = subtask.assigneeName?.trim() || 'Unassigned'
      const subSeconds = subtask.timespent ?? 0
      if (subSeconds > 0) {
        totals.set(subAssignee, (totals.get(subAssignee) ?? 0) + subSeconds)
      }
    }
  }
  return Array.from(totals.entries())
    .filter(([, seconds]) => seconds > 0)
    .map(([name, seconds]) => ({ name, seconds }))
    .sort((a, b) => b.seconds - a.seconds)
}

function formatContributorSummary(contributors: JiraContributor[], limit = 3) {
  if (!contributors.length) return 'No worklogs yet.'
  const parts = contributors.slice(0, limit).map(entry => {
    return `${entry.name} ${formatJiraHours(entry.seconds)}`
  })
  const extra = contributors.length - limit
  const label = contributors.length === 1 ? 'person' : 'people'
  return `${contributors.length} ${label} · ${parts.join(' · ')}${
    extra > 0 ? ` +${extra} more` : ''
  }`
}

// Count work days from start of month until today (excluding Fri=5, Sat=6)
function getWorkDaysInMonthUntilToday(now = dayjs()) {
  const start = now.startOf('month')
  const end = now.endOf('day')
  let workDays = 0
  let cursor = start
  while (cursor.isBefore(end) || cursor.isSame(end, 'day')) {
    const dayOfWeek = cursor.day() // 0=Sun, 5=Fri, 6=Sat
    // Work days are Sun-Thu (0-4), weekend is Fri-Sat (5-6)
    if (dayOfWeek !== 5 && dayOfWeek !== 6) {
      workDays++
    }
    cursor = cursor.add(1, 'day')
  }
  return workDays
}

// Calculate position % = person's month hours / expected work hours
// Expected = work days × 10 hours/day (50h/week ÷ 5 days)
const HOURS_PER_WORK_DAY = 10

type HistoryTableRow = {
  dateKey: string
  values: Record<string, number>
  totalSeconds: number
}

type HistoryTable = {
  people: string[]
  rows: HistoryTableRow[]
  totals: Record<string, number>
  totalSeconds: number
}

function buildHistoryTable(worklogs: JiraWorklogEntry[]): HistoryTable {
  const totals = new Map<string, number>()
  const rowsMap = new Map<string, Map<string, number>>()
  for (const log of worklogs) {
    if (!log.started) continue
    const dateKey = dayjs(log.started).format('YYYY-MM-DD')
    const name = log.authorName?.trim() || 'Unknown'
    const seconds = log.seconds ?? 0
    totals.set(name, (totals.get(name) ?? 0) + seconds)
    if (!rowsMap.has(dateKey)) rowsMap.set(dateKey, new Map())
    const row = rowsMap.get(dateKey) as Map<string, number>
    row.set(name, (row.get(name) ?? 0) + seconds)
  }
  const people = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
  const rows = Array.from(rowsMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dateKey, map]) => {
      const values: Record<string, number> = {}
      let totalSeconds = 0
      for (const person of people) {
        const value = map.get(person) ?? 0
        values[person] = value
        totalSeconds += value
      }
      return { dateKey, values, totalSeconds }
    })
  const totalSeconds = Array.from(totals.values()).reduce((sum, value) => sum + value, 0)
  return {
    people,
    rows,
    totals: Object.fromEntries(totals),
    totalSeconds
  }
}

function buildJiraDeleteCandidates(params: {
  worklogs: JiraWorklogEntry[]
  dateKey: string
  expectedStarted: string | null
  seconds: number | null
  expectedComment: string
  rawComment: string
}) {
  const { worklogs, dateKey, expectedStarted, seconds, expectedComment, rawComment } = params
  const trimmedComment = rawComment.trim()
  return worklogs.filter(entry => {
    if (!entry.started) return false
    const startedDate = dayjs(entry.started).format('YYYY-MM-DD')
    if (startedDate !== dateKey) return false
    const commentText = extractJiraCommentText(entry.comment ?? '')
    const hasExpectedComment = expectedComment && commentText.includes(expectedComment)
    const hasRawComment = trimmedComment && commentText.includes(trimmedComment)
    const hasSeconds = seconds !== null && entry.seconds === seconds
    const hasExactStart =
      expectedStarted && entry.started
        ? dayjs(entry.started).isSame(dayjs(expectedStarted), 'minute')
        : false
    return (hasExpectedComment || hasRawComment || hasExactStart) && (seconds === null || hasSeconds)
  })
}

function buildJiraStarted(date: Date, time: string) {
  const [hours, minutes] = time.split(':').map(value => Number(value))
  const started = dayjs(date)
    .hour(Number.isFinite(hours) ? hours : 0)
    .minute(Number.isFinite(minutes) ? minutes : 0)
    .second(0)
    .millisecond(0)
  const base = started.format('YYYY-MM-DDTHH:mm:ss.SSS')
  const offset = started.format('Z').replace(':', '')
  return `${base}${offset}`
}

function buildJiraComment(selectedTask: WorkLog | null, comment: string) {
  const cleaned = comment.trim()
  if (cleaned) return cleaned
  return 'HRS work log'
}

function formatLastWorklog(lastWorklog?: JiraWorklogEntry | null) {
  if (!lastWorklog?.started) return 'No worklogs yet.'
  const dateLabel = dayjs(lastWorklog.started).format('DD/MM')
  const name = lastWorklog.authorName?.trim() || 'Unknown'
  return `Last log: ${dateLabel} · ${name}`
}

function getSundayWeekRange(date = dayjs()) {
  const start = date.startOf('day').subtract(date.day(), 'day')
  const end = start.add(4, 'day').endOf('day')
  return { start, end }
}

function addWorkdays(start: dayjs.Dayjs, days: number) {
  let remaining = Math.max(0, Math.ceil(days))
  let cursor = start.startOf('day')
  while (remaining > 0) {
    cursor = cursor.add(1, 'day')
    const day = cursor.day()
    if (day >= 0 && day <= 4) {
      remaining -= 1
    }
  }
  return cursor
}

function getWeeklyLogsByPerson(items: JiraWorkItem[]) {
  const { start, end } = getSundayWeekRange()
  const totals = new Map<string, number>()
  const allLogs = items.flatMap(item => collectJiraWorklogs(item))
  for (const log of allLogs) {
    if (!log.started || !log.authorName) continue
    const started = dayjs(log.started)
    if (started.isBefore(start) || started.isAfter(end)) continue
    totals.set(log.authorName, (totals.get(log.authorName) ?? 0) + (log.seconds ?? 0))
  }
  return totals
}

function getMonthToDateLogsByPerson(items: JiraWorkItem[], now = dayjs()) {
  const start = now.startOf('month')
  const end = now.endOf('day')
  const totals = new Map<string, number>()
  const allLogs = items.flatMap(item => collectJiraWorklogs(item))
  for (const log of allLogs) {
    if (!log.started || !log.authorName) continue
    const started = dayjs(log.started)
    if (started.isBefore(start) || started.isAfter(end)) continue
    totals.set(log.authorName, (totals.get(log.authorName) ?? 0) + (log.seconds ?? 0))
  }
  return totals
}

function isJiraDoneStatus(statusName?: string | null) {
  const normalized = (statusName ?? '').trim().toLowerCase()
  if (!normalized) return false
  return (
    normalized === 'done' ||
    normalized === 'closed' ||
    normalized === 'resolved' ||
    normalized === 'complete' ||
    normalized === 'completed'
  )
}

function isEpicDone(items: JiraWorkItem[]) {
  if (!items.length) return false
  return items.every(item => {
    if (!isJiraDoneStatus(item.statusName)) return false
    const subtasks = item.subtasks ?? []
    if (!subtasks.length) return true
    return subtasks.every(subtask => isJiraDoneStatus(subtask.statusName))
  })
}

function applyCommentRules(
  comment: string,
  selectedTask: WorkLog | null,
  rules: CommentRule[]
) {
  if (!selectedTask || !rules.length) return comment
  const base = comment.trim()
  const existingTags = new Set(
    base
      .split(/\s+/)
      .filter(word => word.startsWith('#'))
      .map(word => word.toLowerCase())
  )
  const matchedTags: string[] = []
  for (const rule of rules) {
    const target =
      rule.scope === 'project' ? selectedTask.projectName : selectedTask.customerName
    const match = rule.match.trim().toLowerCase()
    if (!match) continue
    if (!target.toLowerCase().includes(match)) continue
    for (const tag of rule.tags) {
      const cleaned = tag.trim()
      if (!cleaned) continue
      const formatted = cleaned.startsWith('#') ? cleaned : `#${cleaned}`
      if (!existingTags.has(formatted.toLowerCase())) {
        matchedTags.push(formatted)
        existingTags.add(formatted.toLowerCase())
      }
    }
  }
  if (!matchedTags.length) return base
  return base ? `${base} ${matchedTags.join(' ')}` : matchedTags.join(' ')
}

function sumMinutesForRange(report: MonthlyReport, start: dayjs.Dayjs, end: dayjs.Dayjs) {
  return report.days.reduce((sum, day) => {
    const date = dayjs(day.date)
    if (date.isBefore(start, 'day') || date.isAfter(end, 'day')) return sum
    return (
      sum +
      day.reports.reduce(
        (daySum, reportItem) => daySum + parseHoursHHMMToMinutes(reportItem.hours_HHMM),
        0
      )
    )
  }, 0)
}

const BOOT_TIMEOUT_MS = 12000
const JIRA_TIMEOUT_MS = 60000
const JIRA_EPICS_RETRY_MS = 60000
const SESSION_TIMEOUT_MS = 30000
const SESSION_RETRY_LIMIT = 2
const JIRA_PREFETCH_TIMEOUT_MS = 120000
const JIRA_LIGHT_PREFETCH_TIMEOUT_MS = 45000
const JIRA_DETAIL_TIMEOUT_MS = 180000
const JIRA_PREFETCH_FAILURE_COOLDOWN_MS = 5 * 60 * 1000
const JIRA_PREFETCH_MAX_RETRIES = 1
const JIRA_PREFETCH_CONCURRENCY = 15

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: number | undefined
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(new Error(`${label} timed out.`))
    }, ms)
  })
  try {
    return await Promise.race([promise, timeoutPromise])
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId)
  }
}

export default function App() {
  const { colorScheme, setColorScheme } = useMantineColorScheme()
  const [oledEnabled, setOledEnabled] = useState(() => {
    try {
      return localStorage.getItem('hrs-oled') === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    if (colorScheme !== 'dark') {
      setColorScheme('dark')
    }
  }, [colorScheme, setColorScheme])

  useEffect(() => {
    if (typeof document !== 'undefined') {
      if (oledEnabled) {
        document.documentElement.setAttribute('data-oled', 'true')
      } else {
        document.documentElement.removeAttribute('data-oled')
      }
    }
    try {
      localStorage.setItem('hrs-oled', oledEnabled ? '1' : '0')
    } catch {
      // Ignore storage errors to keep UI responsive.
    }
  }, [oledEnabled])

  const [loggedIn, setLoggedIn] = useState(false)
  const [logs, setLogs] = useState<WorkLog[]>([])
  const [loading, setLoading] = useState(false)
  const [logsLoaded, setLogsLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [checkingSession, setCheckingSession] = useState(true)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [duoPending, setDuoPending] = useState(false)
  const sessionRetryCount = useRef(0)

  const [projectName, setProjectName] = useState<string | null>(null)
  const [customerName, setCustomerName] = useState<string | null>(null)
  const [taskName, setTaskName] = useState<string | null>(null)
  const [debouncedProjectName] = useDebouncedValue(projectName, 150)
  const [debouncedCustomerName] = useDebouncedValue(customerName, 150)
  const [debouncedTaskName] = useDebouncedValue(taskName, 150)

  const [logDate, setLogDate] = useState<Date | null>(() => new Date())
  const [fromTime, setFromTime] = useState('09:00')
  const [toTime, setToTime] = useState('18:00')
  const [comment, setComment] = useState('')
  const [reportingFrom, setReportingFrom] = useState('OFFICE')
  const [logLoading, setLogLoading] = useState(false)
  const [logError, setLogError] = useState<string | null>(null)
  const [logSuccess, setLogSuccess] = useState<string | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [editingEntry, setEditingEntry] = useState<{ dateKey: string; index: number } | null>(null)
  const [editHours, setEditHours] = useState('')
  const [editComment, setEditComment] = useState('')
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [logSameOpen, setLogSameOpen] = useState(false)
  const [logSameEntry, setLogSameEntry] = useState<WorkReportEntry | null>(null)
  const [logSameDate, setLogSameDate] = useState<Date | null>(null)
  const [logSameFrom, setLogSameFrom] = useState('09:00')
  const [logSameTo, setLogSameTo] = useState('18:00')
  const [logSameComment, setLogSameComment] = useState('')
  const [logSameLoading, setLogSameLoading] = useState(false)
  const [logSameError, setLogSameError] = useState<string | null>(null)
  const [newRuleScope, setNewRuleScope] = useState<'project' | 'customer'>('project')
  const [newRuleMatch, setNewRuleMatch] = useState('')
  const [newRuleTags, setNewRuleTags] = useState('')
  const [bulkEditOpen, setBulkEditOpen] = useState(false)
  const [bulkEditMode, setBulkEditMode] = useState<'replace' | 'append'>('replace')
  const [bulkEditHours, setBulkEditHours] = useState('')
  const [bulkEditComment, setBulkEditComment] = useState('')
  const [bulkActionError, setBulkActionError] = useState<string | null>(null)
  const [selectedReportEntries, setSelectedReportEntries] = useState<Record<string, boolean>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [searchFilters, setSearchFilters] = useState<Array<'jira' | 'today' | 'week' | 'month'>>([])
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewChecks, setReviewChecks] = useState<Record<string, boolean>>({})
  const [jiraWorklogs, setJiraWorklogs] = useState<JiraWorklogEntry[]>([])
  const [jiraWorklogWarning, setJiraWorklogWarning] = useState<string | null>(null)
  const [timerRunning, setTimerRunning] = useState(false)
  const [timerStartedAt, setTimerStartedAt] = useState<Date | null>(null)
  const [timerElapsed, setTimerElapsed] = useState(0)
  const [floatingCollapsed, setFloatingCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).get('floating') === '1'
  })
  const [floatingStartOpen, setFloatingStartOpen] = useState(false)
  const [floatingStartError, setFloatingStartError] = useState<string | null>(null)
  const [floatingStopOpen, setFloatingStopOpen] = useState(false)
  const [floatingStopError, setFloatingStopError] = useState<string | null>(null)
  const filtersTouchedRef = useRef(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const [commandQuery, setCommandQuery] = useState('')
  const [reportMonth, setReportMonth] = useState<Date>(() => new Date())
  const [selectedReportDate, setSelectedReportDate] = useState<Date | null>(() => new Date())
  const [monthlyReport, setMonthlyReport] = useState<MonthlyReport | null>(null)
  const [currentMonthReport, setCurrentMonthReport] = useState<MonthlyReport | null>(null)
  const [currentMonthKey, setCurrentMonthKey] = useState<string | null>(null)
  const [reportWorkLogsByDate, setReportWorkLogsByDate] = useState<
    Record<string, ReportLogEntry[]>
  >({})
  const [reportsLoading, setReportsLoading] = useState(false)
  const [reportsLoaded, setReportsLoaded] = useState(false)
  const [reportsError, setReportsError] = useState<string | null>(null)
  const reportsRequestId = useRef(0)
  const jiraIssuesRequestId = useRef(0)
  const jiraIssuesCacheRef = useRef(new Map<string, JiraWorkItem[]>())
  const jiraBudgetDetailsCacheRef = useRef(
    new Map<string, { items: JiraWorkItem[]; partial: boolean }>()
  )
  const jiraBudgetDetailsInFlightRef = useRef(
    new Map<string, Promise<{ items: JiraWorkItem[]; partial: boolean }>>()
  )
  const jiraBudgetPrefetchQueueRef = useRef(new Set<string>())
  const jiraBudgetDetailsFailureRef = useRef(new Map<string, number>())
  const hasProject = Boolean(projectName)
  const hasCustomer = Boolean(customerName)
  const lockCustomer = !hasProject || !logs.length
  const lockTask = !hasCustomer || !logs.length
  const [suppressCustomerAutoSelect, setSuppressCustomerAutoSelect] = useState(false)
  const [suppressTaskAutoSelect, setSuppressTaskAutoSelect] = useState(false)

  const [jiraStatus, setJiraStatus] = useState<JiraStatus | null>(null)
  const jiraConfigured = jiraStatus?.configured ?? false
  const [jiraEmail, setJiraEmail] = useState('')
  const [jiraToken, setJiraToken] = useState('')
  const [jiraSaving, setJiraSaving] = useState(false)
  const [jiraError, setJiraError] = useState<string | null>(null)
  const [jiraConnectOpen, setJiraConnectOpen] = useState(false)
  const [jiraErrorSticky, setJiraErrorSticky] = useState<{
    message: string
    at: string
  } | null>(null)
  const [jiraEpicsFailedAt, setJiraEpicsFailedAt] = useState<number | null>(null)
  const [jiraStatusLoaded, setJiraStatusLoaded] = useState(false)
  const [jiraEpics, setJiraEpics] = useState<JiraEpic[]>([])
  const [jiraMappings, setJiraMappings] = useState<Record<string, string>>({})
  const [jiraManualBudgets, setJiraManualBudgets] = useState<Record<string, string>>({})
  const [manualBudgetCustomer, setManualBudgetCustomer] = useState('')
  const [manualBudgetEpicKey, setManualBudgetEpicKey] = useState<string | null>(null)
  const [manualBudgetError, setManualBudgetError] = useState<string | null>(null)
  const [jiraBudgetInHours, setJiraBudgetInHours] = useState(false)
  const [jiraBudgetSortByProgress, setJiraBudgetSortByProgress] = useState(false)
  const [jiraBudgetTitle, setJiraBudgetTitle] = useState('Jira project budgets')
  const [jiraEpicAliases, setJiraEpicAliases] = useState<Record<string, string>>({})
  const [jiraEpicRenameKey, setJiraEpicRenameKey] = useState<string | null>(null)
  const [jiraEpicRenameValue, setJiraEpicRenameValue] = useState('')
  const [jiraProjectStartDates, setJiraProjectStartDates] = useState<Record<string, string>>({})
  const [jiraProjectPeoplePercent, setJiraProjectPeoplePercent] = useState<
    Record<string, Record<string, number>>
  >({})
  const [jiraProjectPositionSnapshots, setJiraProjectPositionSnapshots] = useState<
    Record<string, JiraProjectPositionSnapshot>
  >({})
  const [jiraPeopleView, setJiraPeopleView] = useState(false)
  const [jiraPeopleFilter, setJiraPeopleFilter] = useState<string | null>(null)
  const [jiraPeopleLoading, setJiraPeopleLoading] = useState(false)
  const [jiraTimeConfig, setJiraTimeConfig] = useState<{
    hoursPerDay: number
    daysPerWeek: number
  } | null>(null)
  const [jiraLoading, setJiraLoading] = useState(false)
  const [jiraIssues, setJiraIssues] = useState<JiraWorkItem[]>([])
  const [jiraIssueKey, setJiraIssueKey] = useState<string | null>(null)
  const [jiraLoadingIssues, setJiraLoadingIssues] = useState(false)
  const [jiraIssueLoadError, setJiraIssueLoadError] = useState<string | null>(null)
  const [logToJira, setLogToJira] = useState(false)
  const [jiraActiveOnly, setJiraActiveOnly] = useState(true)
  const [jiraReportedOnly, setJiraReportedOnly] = useState(true)
  const [jiraMappingProject, setJiraMappingProject] = useState<string | null>(null)
  const [jiraMappingCustomer, setJiraMappingCustomer] = useState<string | null>(null)
  const [preferencesLoaded, setPreferencesLoaded] = useState(false)
  const [jiraLogLoadingKey, setJiraLogLoadingKey] = useState<string | null>(null)
  const [jiraLoggedEntries, setJiraLoggedEntries] = useState<
    Record<string, { issueKey: string; loggedAt: string; worklogId?: string }>
  >({})
  const [jiraLogModalOpen, setJiraLogModalOpen] = useState(false)
  const [jiraLogModalEntry, setJiraLogModalEntry] = useState<{
    entry: WorkReportEntry
    dateKey: string
    customer: string
  } | null>(null)
  const [jiraLogModalItems, setJiraLogModalItems] = useState<JiraWorkItem[]>([])
  const [jiraLogModalIssueKey, setJiraLogModalIssueKey] = useState<string | null>(null)
  const [jiraLogModalLoading, setJiraLogModalLoading] = useState(false)
  const [jiraLogModalError, setJiraLogModalError] = useState<string | null>(null)
  const jiraLogModalRequestId = useRef(0)
  const [jiraEpicDebugOpen, setJiraEpicDebugOpen] = useState(false)
  const [jiraEpicDebugData, setJiraEpicDebugData] = useState<{
    epicKey: string
    fields: Record<string, unknown>
  } | null>(null)
  const [activeClientTrend, setActiveClientTrend] = useState<
    Array<{ monthKey: string; label: string; count: number }>
  >([])
  const [meetings, setMeetings] = useState<MeetingItem[]>([])
  const [meetingsMonth, setMeetingsMonth] = useState<string | null>(null)
  const [meetingsLoading, setMeetingsLoading] = useState(false)
  const [meetingsError, setMeetingsError] = useState<string | null>(null)
  const [meetingsBrowser, setMeetingsBrowser] = useState<'safari' | 'chrome'>('chrome')
  const [meetingsHeadless, setMeetingsHeadless] = useState(true)
  const [meetingsUsername, setMeetingsUsername] = useState('')
  const [meetingsPassword, setMeetingsPassword] = useState('')
  const [meetingsUpdatedAt, setMeetingsUpdatedAt] = useState<string | null>(null)
  const [meetingsProgress, setMeetingsProgress] = useState<string | null>(null)
  const [meetingsCollapsed, setMeetingsCollapsed] = useState(false)
  const [meetingsCredentialsOpen, setMeetingsCredentialsOpen] = useState(false)
  const [meetingsCache, setMeetingsCache] = useState<
    Record<string, { updatedAt: string; meetings: MeetingItem[] }>
  >({})
  const [meetingClientMappings, setMeetingClientMappings] = useState<Record<string, string>>({})
  const [meetingMappingOpen, setMeetingMappingOpen] = useState(false)
  const [meetingMappingMeeting, setMeetingMappingMeeting] = useState<MeetingItem | null>(null)
  const [meetingMappingKey, setMeetingMappingKey] = useState<string | null>(null)
  const [meetingMappingProject, setMeetingMappingProject] = useState<string | null>(null)
  const [meetingMappingClient, setMeetingMappingClient] = useState<string | null>(null)
  const [meetingMappingCustomKey, setMeetingMappingCustomKey] = useState('')
  const [meetingMappingError, setMeetingMappingError] = useState<string | null>(null)
  const [meetingLogToJira, setMeetingLogToJira] = useState(false)
  const [meetingLogIssues, setMeetingLogIssues] = useState<JiraWorkItem[]>([])
  const [meetingLogIssueKey, setMeetingLogIssueKey] = useState<string | null>(null)
  const [meetingLogTaskId, setMeetingLogTaskId] = useState<string | null>(null)
  const [meetingLogLoading, setMeetingLogLoading] = useState(false)
  const [meetingLogError, setMeetingLogError] = useState<string | null>(null)
  const meetingLogRequestId = useRef(0)
  const [meetingLoggedKeys, setMeetingLoggedKeys] = useState<Record<string, boolean>>({})
  const meetingMappingPrefillRef = useRef<{
    client?: string | null
    logToJira?: boolean
  } | null>(null)
  const meetingsAutoFetchRef = useRef(false)
  const [activeClientTrendLoading, setActiveClientTrendLoading] = useState(false)
  const [activeClientTrendLoaded, setActiveClientTrendLoaded] = useState(false)
  const [activeClientTrendError, setActiveClientTrendError] = useState<string | null>(null)
  const activeClientTrendRequestId = useRef(0)
  const [hoursTrend, setHoursTrend] = useState<
    Array<{ monthKey: string; label: string; totalHours: number; mtdHours: number }>
  >([])
  const [weekHoursDelta, setWeekHoursDelta] = useState<WeekDelta | null>(null)
  const [lastMonthWeekHours, setLastMonthWeekHours] = useState<number | null>(null)
  const [reminderEnabled, setReminderEnabled] = useState(false)
  const [reminderLastDate, setReminderLastDate] = useState<string | null>(null)
  const [reminderLastMidday, setReminderLastMidday] = useState<string | null>(null)
  const [reminderLastEnd, setReminderLastEnd] = useState<string | null>(null)
  const [reminderStartHour, setReminderStartHour] = useState(9)
  const [reminderMiddayHour, setReminderMiddayHour] = useState(13)
  const [reminderEndHour, setReminderEndHour] = useState(18)
  const [reminderIdleMinutes, setReminderIdleMinutes] = useState(30)
  const [reviewMode, setReviewMode] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [reportsOpen, setReportsOpen] = useState(true)
  const [logWorkOpen, setLogWorkOpen] = useState(true)
  const [autoLoginEnabled, setAutoLoginEnabled] = useState(false)
  const [autoSuggestEnabled, setAutoSuggestEnabled] = useState(false)
  const [heatmapEnabled, setHeatmapEnabled] = useState(true)
  const [exportFiltered, setExportFiltered] = useState(false)
  const [kpiCollapsed, setKpiCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('hrs-kpi-collapsed') === '1'
  })
  const [jiraBudgetCollapsed, setJiraBudgetCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('hrs-jira-budget-collapsed') === '1'
  })
  useEffect(() => {
    try {
      localStorage.setItem('hrs-kpi-collapsed', kpiCollapsed ? '1' : '0')
    } catch {
      // Ignore storage errors.
    }
  }, [kpiCollapsed])

  useEffect(() => {
    try {
      localStorage.setItem('hrs-jira-budget-collapsed', jiraBudgetCollapsed ? '1' : '0')
    } catch {
      // Ignore storage errors.
    }
  }, [jiraBudgetCollapsed])

  useEffect(() => {
    if (!window?.hrs?.onMeetingsProgress) return
    const unsubscribe = window.hrs.onMeetingsProgress(message => {
      setMeetingsProgress(message)
    })
    return () => {
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    if (meetingsBrowser !== 'chrome' && meetingsHeadless) {
      setMeetingsHeadless(false)
    }
  }, [meetingsBrowser, meetingsHeadless])
  const [commentRules, setCommentRules] = useState<CommentRule[]>([])
  const [smartDefaults, setSmartDefaults] = useState<{
    lastTaskByWeekday: Record<string, number>
    lastTaskId: number | null
  }>({ lastTaskByWeekday: {}, lastTaskId: null })
  const lastInteractionRef = useRef(Date.now())
  const [exportingCsv, setExportingCsv] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [exportClientOpen, setExportClientOpen] = useState(false)
  const [exportClient, setExportClient] = useState<string | null>(null)
  const [exportClientFormat, setExportClientFormat] = useState<'pdf' | 'xlsx'>('pdf')
  const [bridgeError, setBridgeError] = useState<string | null>(null)
  const [jiraSectionOpen, setJiraSectionOpen] = useState(false)
  const [jiraPrefetchDone, setJiraPrefetchDone] = useState(true)
  const [jiraPrefetchError, setJiraPrefetchError] = useState<string | null>(null)
  const [jiraPrefetchProgress, setJiraPrefetchProgress] = useState<{
    done: number
    total: number
  } | null>(null)
  const [jiraPrefetchEntries, setJiraPrefetchEntries] = useState<
    Record<
      string,
      {
        status: 'pending' | 'loading' | 'done' | 'error'
        tasks: number
        subtasks: number
        startedAt?: number
        finishedAt?: number
        error?: string | null
      }
    >
  >({})
  const jiraPrefetchStartedRef = useRef(false)
  const [storedUsername, setStoredUsername] = useState<string | null>(null)
  const [hasStoredPassword, setHasStoredPassword] = useState(false)
  const [credentialsModalOpen, setCredentialsModalOpen] = useState(false)
  const [credentialsUsername, setCredentialsUsername] = useState('')
  const [credentialsPassword, setCredentialsPassword] = useState('')
  const [bootStatus, setBootStatus] = useState('Preparing your workspace…')
  const [focusMode, setFocusMode] = useState(false)
  const [jiraBudgetRows, setJiraBudgetRows] = useState<JiraBudgetRow[]>([])
  const [timeBudgetLoading, setTimeBudgetLoading] = useState(false)
  const [timeBudgetError, setTimeBudgetError] = useState<string | null>(null)
  const [budgetExpandedCustomer, setBudgetExpandedCustomer] = useState<string | null>(null)
  const [historyModalOpen, setHistoryModalOpen] = useState(false)
  const [historyModalTitle, setHistoryModalTitle] = useState('')
  const [historyModalData, setHistoryModalData] = useState<HistoryTable | null>(null)
  const [historyModalLoading, setHistoryModalLoading] = useState(false)
  const [historyModalError, setHistoryModalError] = useState<string | null>(null)
  const autoLoginAttemptedRef = useRef(false)
  const hoursSparklineRef = useRef<HTMLDivElement | null>(null)
  const reportListRef = useRef<HTMLDivElement | null>(null)
  const logWorkRef = useRef<HTMLDivElement | null>(null)
  const reportsCacheRef = useRef<Map<string, MonthlyReport>>(new Map())
  const reportsPrefetchRef = useRef<Set<string>>(new Set())
  const [reportListWidth, setReportListWidth] = useState(0)
  const [hoursTooltip, setHoursTooltip] = useState<{
    x: number
    y: number
    label: string
    value: string
  } | null>(null)

  const filterSelectStyles = {
    label: {
      fontWeight: 600,
      fontStyle: 'italic',
      paddingLeft: 4,
      marginBottom: 8
    }
  } as const

  const isFloating = useMemo(() => {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).get('floating') === '1'
  }, [])

  useEffect(() => {
    if (!isFloating) return
    document.body.classList.add('floating-mode')
    return () => {
      document.body.classList.remove('floating-mode')
    }
  }, [isFloating])

  useEffect(() => {
    if (!isFloating) return
    if (!logDate) setLogDate(new Date())
  }, [isFloating, logDate])

  useEffect(() => {
    if (!isFloating) return
    void window.hrs.setFloatingCollapsed(floatingCollapsed)
  }, [isFloating, floatingCollapsed])

  const appReady = useMemo(() => {
    if (isFloating) return true
    if (checkingSession || !preferencesLoaded || !jiraStatusLoaded) return false
    if (!loggedIn) return true
    if (jiraConfigured && !jiraPrefetchDone) return false
    if (!logsLoaded || !reportsLoaded) return false
    if (logs.length && (activeClientTrendLoading || !activeClientTrendLoaded)) return false
    return true
  }, [
    isFloating,
    checkingSession,
    preferencesLoaded,
    jiraStatusLoaded,
    loggedIn,
    jiraConfigured,
    jiraPrefetchDone,
    logsLoaded,
    reportsLoaded,
    logs.length,
    activeClientTrendLoading,
    activeClientTrendLoaded
  ])

  async function login() {
    autoLoginAttemptedRef.current = false
    await window.hrs.login()
    setLoggedIn(true)
    setDuoPending(false)
    setSessionError(null)
  }

  async function openFloatingTimer() {
    try {
      await window.hrs.openFloatingTimer()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setBridgeError(message)
    }
  }

  async function closeFloatingTimer() {
    try {
      await window.hrs.closeFloatingTimer()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setBridgeError(message)
    }
  }

  async function checkSession() {
    setCheckingSession(true)
    setBootStatus('Checking session…')
    let shouldRetry = false
    try {
      const ok = await withTimeout(window.hrs.checkSession(), SESSION_TIMEOUT_MS, 'Session check')
      sessionRetryCount.current = 0
      if (!ok && autoLoginEnabled && hasStoredPassword && !autoLoginAttemptedRef.current) {
        autoLoginAttemptedRef.current = true
        setDuoPending(true)
        setBootStatus('Sent DUO to phone for approval…')
        setSessionError(null)
        const autoLogged = await window.hrs.autoLogin()
        setDuoPending(false)
        if (autoLogged) {
          setBootStatus('Rechecking session…')
          const recheck = await window.hrs.checkSession()
          setLoggedIn(recheck)
          setSessionError(recheck ? null : 'Auto-login failed. Please login again.')
          return recheck
        }
        setLoggedIn(false)
        setSessionError('Auto-login failed. Please login again.')
        return false
      }
      setLoggedIn(ok)
      if (!ok) {
        setSessionError('Session expired. Please login again.')
      } else {
        setDuoPending(false)
        setSessionError(null)
      }
      return ok
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('timed out') && sessionRetryCount.current < SESSION_RETRY_LIMIT) {
        sessionRetryCount.current += 1
        shouldRetry = true
        setBootStatus('Session check is slow. Retrying…')
        setSessionError('Session check is taking longer than expected. Retrying…')
        window.setTimeout(() => {
          void checkSession()
        }, 1200)
        return false
      }
      if (autoLoginEnabled && hasStoredPassword && !autoLoginAttemptedRef.current) {
        autoLoginAttemptedRef.current = true
        setDuoPending(true)
        setBootStatus('Sent DUO to phone for approval…')
        setSessionError(null)
        const autoLogged = await window.hrs.autoLogin()
        setDuoPending(false)
        if (autoLogged) {
          setBootStatus('Rechecking session…')
          const recheck = await window.hrs.checkSession()
          setLoggedIn(recheck)
          setSessionError(recheck ? null : 'Auto-login failed. Please login again.')
          return recheck
        }
      }
      setSessionError(message)
      setLoggedIn(false)
      return false
    } finally {
      if (!shouldRetry) {
        setCheckingSession(false)
      }
    }
  }

  async function loadLogs() {
    setLoading(true)
    setLogsLoaded(false)
    setError(null)
    setBootStatus('Loading work logs…')
    try {
      const data = await withTimeout(window.hrs.getWorkLogs(), BOOT_TIMEOUT_MS, 'Loading logs')
      if (!Array.isArray(data)) {
        throw new Error('Unexpected response from HRS')
      }
      setLogs(data as WorkLog[])
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message === 'AUTH_REQUIRED') {
        setBootStatus('Session expired. Reconnecting…')
        const ok = await checkSession()
        if (ok) {
          try {
            const data = await withTimeout(window.hrs.getWorkLogs(), BOOT_TIMEOUT_MS, 'Loading logs')
            if (!Array.isArray(data)) {
              throw new Error('Unexpected response from HRS')
            }
            setLogs(data as WorkLog[])
            return
          } catch (retryErr) {
            const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr)
            setError(retryMessage)
          }
        } else {
          setLoggedIn(false)
          setError('Session expired. Please login again.')
        }
      } else {
        setError(message)
      }
    } finally {
      setLoading(false)
      setLogsLoaded(true)
    }
  }

  async function loadReportsForMonth(month: Date) {
    const requestId = ++reportsRequestId.current
    const monthKey = dayjs(month).format('YYYY-MM')
    const cached = reportsCacheRef.current.get(monthKey)
    if (cached) {
      setMonthlyReport(cached)
      setReportsLoading(false)
      setReportsLoaded(true)
      return
    }
    setReportsLoading(true)
    setReportsError(null)
    setBootStatus('Loading monthly report…')
    try {
      const { start, end } = getMonthRange(month)
      const data = await withTimeout(
        window.hrs.getReports(start, end),
        BOOT_TIMEOUT_MS,
        'Loading reports'
      )
      if (requestId !== reportsRequestId.current) return
      const report = data as MonthlyReport
      reportsCacheRef.current.set(monthKey, report)
      setMonthlyReport(report)
    } catch (err) {
      if (requestId !== reportsRequestId.current) return
      const message = err instanceof Error ? err.message : String(err)
      if (message === 'AUTH_REQUIRED') {
        setBootStatus('Session expired. Reconnecting…')
        const ok = await checkSession()
        if (ok) {
          try {
            const { start, end } = getMonthRange(month)
            const data = await withTimeout(
              window.hrs.getReports(start, end),
              BOOT_TIMEOUT_MS,
              'Loading reports'
            )
            if (requestId === reportsRequestId.current) {
              setMonthlyReport(data as MonthlyReport)
            }
            return
          } catch (retryErr) {
            if (requestId !== reportsRequestId.current) return
            const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr)
            setReportsError(retryMessage)
          }
        } else {
          setLoggedIn(false)
          setReportsError('Session expired. Please login again.')
        }
      } else {
        setReportsError(message)
      }
    } finally {
      if (requestId === reportsRequestId.current) {
        setReportsLoading(false)
        setReportsLoaded(true)
      }
    }
  }

  async function loadCurrentMonthReport() {
    const now = dayjs()
    const key = now.format('YYYY-MM')
    if (currentMonthReport && currentMonthKey === key) return currentMonthReport
    try {
      const { start, end } = getMonthRange(now.toDate())
      const data = await withTimeout(
        window.hrs.getReports(start, end),
        BOOT_TIMEOUT_MS,
        'Loading current month'
      )
      const report = data as MonthlyReport
      setCurrentMonthReport(report)
      setCurrentMonthKey(key)
      return report
    } catch {
      return null
    }
  }

  const isJiraAuthError = (message: string) =>
    message.includes('JIRA_AUTH_REQUIRED') ||
    message.includes('JIRA 401') ||
    message.includes('JIRA 403')

  const handleJiraAuthError = (message: string) => {
    console.error('[jira]', message)
    setJiraError('Jira session expired. Please connect again.')
    setJiraErrorSticky({ message, at: new Date().toISOString() })
    setJiraStatus(prev => {
      if (!prev) return prev
      return {
        ...prev,
        configured: false,
        hasCredentials: false,
        email: null
      }
    })
    setJiraIssueKey(null)
    setJiraIssues([])
    setLogToJira(false)
    setJiraLoadingIssues(false)
    setJiraConnectOpen(true)
  }

  function reportJiraError(message: string) {
    if (isJiraAuthError(message)) {
      handleJiraAuthError(message)
      return
    }
    console.error('[jira]', message)
    setJiraError(message)
    setJiraErrorSticky({ message, at: new Date().toISOString() })
  }

  async function loadJiraStatus() {
    setJiraError(null)
    setJiraStatusLoaded(false)
    setBootStatus('Loading Jira status…')
    try {
      const status = await withTimeout(
        window.hrs.getJiraStatus(),
        BOOT_TIMEOUT_MS,
        'Loading Jira status'
      )
      setJiraStatus(status)
      setJiraEmail(status.email ?? '')
      setJiraPrefetchDone(!status.configured)
      if (status.configured) {
        await loadJiraMappings()
      } else if (status.hasCredentials) {
        reportJiraError('Jira credentials are invalid or expired.')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      reportJiraError(message)
    } finally {
      setJiraStatusLoaded(true)
    }
  }

  async function loadPreferences() {
    try {
      setBootStatus('Loading preferences…')
      const prefs = (await withTimeout(
        window.hrs.getPreferences(),
        BOOT_TIMEOUT_MS,
        'Loading preferences'
      )) as AppPreferences
      setJiraActiveOnly(prefs.jiraActiveOnly)
      setJiraReportedOnly(prefs.jiraReportedOnly)
      setJiraSectionOpen(prefs.jiraSectionOpen ?? false)
      setReminderEnabled(false)
      setReminderLastDate(prefs.reminderLastDate)
      setReminderLastMidday(prefs.reminderLastMidday)
      setReminderLastEnd(prefs.reminderLastEnd)
      setReminderStartHour(prefs.reminderStartHour)
      setReminderMiddayHour(prefs.reminderMiddayHour)
      setReminderEndHour(prefs.reminderEndHour)
      setReminderIdleMinutes(prefs.reminderIdleMinutes)
      setReviewMode(false)
      setFiltersOpen(true)
      setReportsOpen(prefs.reportsOpen)
      setLogWorkOpen(prefs.logWorkOpen)
      setAutoLoginEnabled(prefs.autoLoginEnabled)
      setAutoSuggestEnabled(false)
      setHeatmapEnabled(prefs.heatmapEnabled)
      setExportFiltered(prefs.exportFiltered)
      setCommentRules(prefs.commentRules)
      setJiraManualBudgets(prefs.jiraManualBudgets ?? {})
      setJiraBudgetInHours(prefs.jiraBudgetInHours ?? false)
      setJiraBudgetSortByProgress(prefs.jiraBudgetSortByProgress ?? false)
      setJiraBudgetTitle(prefs.jiraBudgetTitle ?? 'Jira project budgets')
      setJiraEpicAliases(prefs.jiraEpicAliases ?? {})
      setJiraProjectStartDates(prefs.jiraProjectStartDates ?? {})
      setJiraProjectPeoplePercent(prefs.jiraProjectPeoplePercent ?? {})
      setJiraProjectPositionSnapshots(prefs.jiraProjectPositionSnapshots ?? {})
      setMeetingsBrowser(prefs.meetingsBrowser ?? 'chrome')
      setMeetingsUsername(prefs.meetingsUsername ?? '')
      setMeetingsPassword(prefs.meetingsPassword ?? '')
      setMeetingsHeadless(prefs.meetingsHeadless ?? true)
      setMeetingsCollapsed(prefs.meetingsCollapsed ?? false)
      const normalizedMeetingsCache = Object.fromEntries(
        Object.entries(prefs.meetingsCache ?? {}).map(([key, entry]) => [
          key,
          {
            updatedAt: entry.updatedAt,
            meetings: (entry.meetings ?? []).map(meeting => ({
              ...meeting,
              attendanceEmails: Array.isArray(meeting.attendanceEmails)
                ? meeting.attendanceEmails
                : meeting.attendanceEmails
                  ? [meeting.attendanceEmails]
                  : [],
              attendeeEmails: Array.isArray(meeting.attendeeEmails)
                ? meeting.attendeeEmails
                : meeting.attendeeEmails
                  ? [meeting.attendeeEmails]
                  : []
            }))
          }
        ])
      )
      setMeetingsCache(normalizedMeetingsCache)
      const rawMeetingMappings = prefs.meetingClientMappings ?? {}
      const normalizedMeetingMappings = Object.fromEntries(
        Object.entries(rawMeetingMappings).map(([key, value]) => [
          normalizeMeetingKey(key),
          value
        ])
      )
      setMeetingClientMappings(normalizedMeetingMappings)
      if (prefs.reportWorkLogsCache && typeof prefs.reportWorkLogsCache === 'object') {
        const normalizedWorkLogs = Object.fromEntries(
          Object.entries(prefs.reportWorkLogsCache).map(([key, entries]) => {
            const safeKey = key.trim()
            const safeEntries = Array.isArray(entries)
              ? entries
                  .map(entry => normalizeReportLogEntry(entry))
                  .filter((entry): entry is ReportLogEntry => Boolean(entry))
              : []
            return [safeKey, safeEntries]
          })
        )
        setReportWorkLogsByDate(normalizedWorkLogs)
      }
      const monthKey = dayjs().format('YYYY-MM')
      const cachedMeetings = normalizedMeetingsCache[monthKey]
      if (cachedMeetings) {
        setMeetings(cachedMeetings.meetings ?? [])
        setMeetingsMonth(monthKey)
        setMeetingsUpdatedAt(cachedMeetings.updatedAt ?? null)
      }
      setSmartDefaults(prefs.smartDefaults)
      setPreferencesLoaded(true)
    } catch {
      setPreferencesLoaded(true)
    }
  }

  async function loadHrsCredentials() {
    try {
      const creds = await window.hrs.getCredentials()
      setStoredUsername(creds.username)
      setHasStoredPassword(creds.hasPassword)
      if (creds.username) {
        setCredentialsUsername(creds.username)
      }
    } catch {}
  }

  async function saveHrsCredentials() {
    if (!credentialsUsername || !credentialsPassword) return
    try {
      await window.hrs.setCredentials(credentialsUsername, credentialsPassword)
      setCredentialsPassword('')
      setAutoLoginEnabled(true)
      await loadHrsCredentials()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setSessionError(message)
    }
  }

  async function clearHrsCredentials() {
    try {
      await window.hrs.clearCredentials()
      setStoredUsername(null)
      setHasStoredPassword(false)
      setCredentialsUsername('')
      setCredentialsPassword('')
      setAutoLoginEnabled(false)
    } catch {}
  }

  async function loadJiraLoggedEntries() {
    try {
      const entries = await withTimeout(
        window.hrs.getJiraLoggedEntries(),
        BOOT_TIMEOUT_MS,
        'Loading Jira history'
      )
      setJiraLoggedEntries(
        entries as Record<string, { issueKey: string; loggedAt: string; worklogId?: string }>
      )
    } catch {}
  }

  async function fetchMeetings(background = false) {
    setMeetingsLoading(true)
    setMeetingsError(null)
    if (!background) {
      setMeetingsProgress('Starting meetings fetch…')
    }
    try {
      const monthKey = dayjs().format('YYYY-MM')
      const cached = meetingsCache[monthKey]
      const cacheFresh =
        cached && dayjs(cached.updatedAt).isAfter(dayjs().subtract(1, 'hour'))
      if (background && cacheFresh) {
        setMeetings(cached.meetings ?? [])
        setMeetingsMonth(monthKey)
        setMeetingsUpdatedAt(cached.updatedAt ?? null)
        setMeetingsProgress('Using cached meetings.')
        return
      }
      const result = await window.hrs.getMeetings({
        browser: meetingsBrowser,
        headless: meetingsHeadless,
        month: monthKey,
        username: meetingsUsername.trim() || null,
        password: meetingsPassword || null
      })
      setMeetings(result.meetings || [])
      setMeetingsMonth(result.month || monthKey)
      const updatedAt = new Date().toISOString()
      setMeetingsUpdatedAt(updatedAt)
      setMeetingsCache(prev => ({
        ...prev,
        [monthKey]: { updatedAt, meetings: result.meetings || [] }
      }))
      setMeetingsProgress(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setMeetingsError(message)
      setMeetingsProgress(null)
    } finally {
      setMeetingsLoading(false)
    }
  }

  function normalizeMeetingKey(value: string) {
    return value.trim().toLowerCase()
  }

  const getMeetingEmails = (meeting: MeetingItem) => {
    const emails: string[] = []
    const seen = new Set<string>()
    const pushEmail = (value: string | null | undefined) => {
      if (!value) return
      const normalized = value.toLowerCase()
      if (seen.has(normalized)) return
      seen.add(normalized)
      emails.push(normalized)
    }
    for (const email of meeting.attendanceEmails ?? []) {
      pushEmail(email)
    }
    for (const email of meeting.attendeeEmails ?? []) {
      pushEmail(email)
    }
    return emails
  }

  const getMeetingDomains = (emails: string[]) => {
    const domains = new Set<string>()
    for (const email of emails) {
      const parts = email.split('@')
      if (parts.length === 2 && parts[1]) {
        domains.add(parts[1].toLowerCase())
      }
    }
    return Array.from(domains)
  }

  const getMeetingNames = (meeting: MeetingItem) => {
    if (!meeting.participants) return []
    return meeting.participants
      .split(',')
      .map(value => value.trim())
      .filter(Boolean)
  }

  const buildMeetingMappingOptions = (meeting: MeetingItem | null) => {
    if (!meeting) return []
    const options: SelectOption[] = []
    const emails = getMeetingEmails(meeting)
    const domains = getMeetingDomains(emails)
    const names = getMeetingNames(meeting)
    for (const email of emails) {
      options.push({ value: `email:${normalizeMeetingKey(email)}`, label: `Email • ${email}` })
    }
    for (const domain of domains) {
      options.push({ value: `domain:${normalizeMeetingKey(domain)}`, label: `Domain • ${domain}` })
    }
    for (const name of names) {
      options.push({ value: `name:${normalizeMeetingKey(name)}`, label: `Name • ${name}` })
    }
    return options
  }

  const resolveMeetingClient = (meeting: MeetingItem) => {
    const emails = getMeetingEmails(meeting)
    const domains = getMeetingDomains(emails)
    const names = getMeetingNames(meeting)
    const keys = [
      ...emails.map(email => `email:${normalizeMeetingKey(email)}`),
      ...domains.map(domain => `domain:${normalizeMeetingKey(domain)}`),
      ...names.map(name => `name:${normalizeMeetingKey(name)}`)
    ]
    for (const key of keys) {
      const mapped = meetingClientMappings[key]
      if (mapped) return mapped
    }
    return null
  }

  const openMeetingMapping = (
    meeting: MeetingItem,
    prefill?: { client?: string | null; logToJira?: boolean }
  ) => {
    meetingMappingPrefillRef.current = prefill ?? null
    setMeetingMappingMeeting(meeting)
    setMeetingMappingError(null)
    setMeetingMappingOpen(true)
  }

  const handleLogMeeting = (meeting: MeetingItem) => {
    const mappedClient = resolveMeetingClient(meeting)
    if (mappedClient) {
      openMeetingMapping(meeting, { client: mappedClient })
      return
    }
    openMeetingMapping(meeting)
  }

  const meetingMappingOptions = useMemo(
    () => buildMeetingMappingOptions(meetingMappingMeeting),
    [meetingMappingMeeting]
  )

  const meetingMappedEpicKey = meetingMappingClient
    ? jiraMappings[meetingMappingClient] ?? null
    : null

  const meetingMappedEpic = useMemo(() => {
    if (!meetingMappedEpicKey) return null
    return jiraEpics.find(epic => epic.key === meetingMappedEpicKey) ?? null
  }, [jiraEpics, meetingMappedEpicKey])

  const meetingMappingProjectOptions = useMemo(
    () => buildOptions(logs, log => log.projectName),
    [logs]
  )

  const meetingMappingProjectOptionsForClient = useMemo(() => {
    if (!meetingMappingClient) return meetingMappingProjectOptions
    const filtered = logs.filter(log => log.customerName === meetingMappingClient)
    const options = buildOptions(filtered, log => log.projectName)
    return options.length ? options : meetingMappingProjectOptions
  }, [logs, meetingMappingClient, meetingMappingProjectOptions])

  const meetingMappingCustomerOptions = useMemo(() => {
    if (!meetingMappingProject) {
      return buildOptions(logs, log => log.customerName)
    }
    const filtered = logs.filter(log => log.projectName === meetingMappingProject)
    return buildOptions(filtered, log => log.customerName)
  }, [logs, meetingMappingProject])

  useEffect(() => {
    if (!meetingMappingOpen) return
    const prefill = meetingMappingPrefillRef.current
    setMeetingMappingKey(meetingMappingOptions[0]?.value ?? null)
    setMeetingMappingProject(null)
    setMeetingMappingClient(prefill?.client ?? null)
    setMeetingMappingCustomKey('')
    setMeetingMappingError(null)
    setMeetingLogToJira(prefill?.logToJira ?? false)
    setMeetingLogIssues([])
    setMeetingLogIssueKey(null)
    setMeetingLogTaskId(null)
    setMeetingLogLoading(false)
    setMeetingLogError(null)
    meetingMappingPrefillRef.current = null
  }, [meetingMappingOpen, meetingMappingOptions])

  const meetingLogIssueOptions = useMemo(
    () => buildJiraIssueOptions(meetingLogIssues, true),
    [meetingLogIssues]
  )

  const meetingLogTaskOptions = useMemo(() => {
    if (!meetingMappingProject || !meetingMappingClient) return []
    const scope = logs.filter(
      log =>
        log.projectName === meetingMappingProject &&
        log.customerName === meetingMappingClient
    )
    const active = scope.filter(log => log.isActiveTask !== false)
    const source = active.length ? active : scope
    const map = new Map<string, WorkLog>()
    for (const log of source) {
      if (!log.taskName) continue
      const existing = map.get(log.taskName)
      if (!existing) {
        map.set(log.taskName, log)
        continue
      }
      const nextDate = log.date ? dayjs(log.date) : null
      const existingDate = existing.date ? dayjs(existing.date) : null
      if (nextDate && (!existingDate || nextDate.isAfter(existingDate))) {
        map.set(log.taskName, log)
      }
    }
    return Array.from(map.values())
      .sort((a, b) => (a.taskName || '').localeCompare(b.taskName || ''))
      .map(log => ({
        value: String(log.taskId),
        label: log.taskName || String(log.taskId)
      }))
  }, [logs, meetingMappingProject, meetingMappingClient])


  useEffect(() => {
    if (!meetingMappingProject) return
    if (meetingMappingCustomerOptions.length === 1) {
      setMeetingMappingClient(meetingMappingCustomerOptions[0].value)
    } else {
      setMeetingMappingClient(null)
    }
  }, [meetingMappingProject, meetingMappingCustomerOptions])

  useEffect(() => {
    if (meetingMappingProject) return
    if (!meetingMappingClient) return
    if (meetingMappingProjectOptionsForClient.length === 1) {
      setMeetingMappingProject(meetingMappingProjectOptionsForClient[0].value)
    }
  }, [meetingMappingProject, meetingMappingClient, meetingMappingProjectOptionsForClient])

  useEffect(() => {
    if (!meetingMappingProject || !meetingMappingClient) {
      setMeetingLogTaskId(null)
      return
    }
    if (meetingLogTaskOptions.length === 1) {
      setMeetingLogTaskId(meetingLogTaskOptions[0].value)
      return
    }
    if (
      meetingLogTaskId &&
      !meetingLogTaskOptions.some(option => option.value === meetingLogTaskId)
    ) {
      setMeetingLogTaskId(null)
    }
  }, [meetingMappingProject, meetingMappingClient, meetingLogTaskOptions, meetingLogTaskId])

  useEffect(() => {
    if (!meetingMappingOpen) return
    if (!meetingLogToJira) {
      setMeetingLogIssues([])
      setMeetingLogIssueKey(null)
      setMeetingLogError(null)
      setMeetingLogLoading(false)
      return
    }
    if (!jiraConfigured) {
      setMeetingLogError('Connect Jira to enable logging.')
      setMeetingLogIssues([])
      setMeetingLogLoading(false)
      return
    }
    if (!meetingMappedEpicKey) {
      setMeetingLogError('Map this client to a Jira epic first.')
      setMeetingLogIssues([])
      setMeetingLogLoading(false)
      return
    }
    const cached = jiraIssuesCacheRef.current.get(meetingMappedEpicKey)
    if (cached) {
      setMeetingLogIssues(cached)
      if (cached.length === 1) {
        setMeetingLogIssueKey(cached[0].key)
      }
      setMeetingLogLoading(false)
      setMeetingLogError(null)
      return
    }
    const requestId = ++meetingLogRequestId.current
    setMeetingLogLoading(true)
    setMeetingLogError(null)
    window.hrs
      .getJiraWorkItems(meetingMappedEpicKey)
      .then(items => {
        if (requestId !== meetingLogRequestId.current) return
        const parsed = Array.isArray(items)
          ? Array.from(new Map(items.map(item => [item.key, item])).values())
          : []
        jiraIssuesCacheRef.current.set(meetingMappedEpicKey, parsed)
        setMeetingLogIssues(parsed)
        if (parsed.length === 1) {
          setMeetingLogIssueKey(parsed[0].key)
        }
      })
      .catch(err => {
        if (requestId !== meetingLogRequestId.current) return
        const message = err instanceof Error ? err.message : String(err)
        setMeetingLogError(message)
        setMeetingLogIssues([])
      })
      .finally(() => {
        if (requestId === meetingLogRequestId.current) {
          setMeetingLogLoading(false)
        }
      })
  }, [meetingMappingOpen, meetingLogToJira, meetingMappedEpicKey, jiraConfigured])

  useEffect(() => {
    if (!meetingLogIssueKey) return
    if (!meetingLogIssueOptions.some(option => option.value === meetingLogIssueKey)) {
      setMeetingLogIssueKey(null)
    }
  }, [meetingLogIssueKey, meetingLogIssueOptions])

  const normalizeMappingInput = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return ''
    if (trimmed.includes(':')) return normalizeMeetingKey(trimmed)
    return `name:${normalizeMeetingKey(trimmed)}`
  }

  const saveMeetingMapping = async () => {
    if (!meetingMappingMeeting) return
    const rawKey = meetingMappingCustomKey || meetingMappingKey || ''
    const normalizedKey = normalizeMappingInput(rawKey)
    if (!normalizedKey) {
      setMeetingMappingError('Select a match key or enter a custom one.')
      return
    }
    if (!meetingMappingClient) {
      setMeetingMappingError('Select a client to map.')
      return
    }
    if (!meetingLogTaskId) {
      setMeetingMappingError('Select a task to log the meeting.')
      return
    }
    const taskId = Number(meetingLogTaskId)
    if (Number.isNaN(taskId)) {
      setMeetingMappingError('Select a valid task to log the meeting.')
      return
    }
    if (meetingLogToJira && !meetingMappedEpicKey) {
      setMeetingMappingError('Map this client to a Jira epic first.')
      return
    }
    setMeetingClientMappings(prev => ({
      ...prev,
      [normalizedKey]: meetingMappingClient
    }))
    const start = dayjs(meetingMappingMeeting.startTime.replace(' ', 'T'))
    const end = dayjs(meetingMappingMeeting.endTime.replace(' ', 'T'))
    if (!start.isValid() || !end.isValid()) {
      setMeetingMappingError('Meeting time is invalid.')
      return
    }
    const from = start.format('HH:mm')
    const to = end.format('HH:mm')
    const duration = buildDurationFromTimes(from, to)
    if (!duration) {
      setMeetingMappingError('Meeting duration is invalid.')
      return
    }
    const meetingTitle = (meetingMappingMeeting.subject || 'Meeting').trim() || 'Meeting'
	    const success = await submitLogWork(taskId, duration, {
	      date: start.toDate(),
	      fromTime: from,
	      toTime: to,
	      comment: meetingTitle,
	      skipCommentRules: true,
	      reportingFrom,
	      logToJira: meetingLogToJira && Boolean(meetingMappedEpicKey),
	      jiraIssueKey: meetingLogIssueKey,
	      jiraCommentOverride: meetingTitle,
	      onError: message => setMeetingMappingError(message)
	    })
    if (success) {
      const meetingKey = getMeetingKey(meetingMappingMeeting)
      setMeetingLoggedKeys(prev => ({ ...prev, [meetingKey]: true }))
      setMeetingMappingOpen(false)
      setMeetingMappingMeeting(null)
    } else {
      setMeetingMappingError('Failed to log meeting. Check the log form for errors.')
    }
  }

  useEffect(() => {
    if (!preferencesLoaded) return
    if (meetingsAutoFetchRef.current) return
    if (!Object.keys(meetingsCache).length) return
    meetingsAutoFetchRef.current = true
  }, [preferencesLoaded, meetingsCache])

  // Disabled: Auto-fetch meetings every hour (manual fetch only)
  // useEffect(() => {
  //   if (!preferencesLoaded) return
  //   if (!meetingsUsername.trim() && !meetingsPassword && !Object.keys(meetingsCache).length) return
  //   const intervalId = window.setInterval(() => {
  //     void fetchMeetings(true)
  //   }, 60 * 60 * 1000)
  //   return () => window.clearInterval(intervalId)
  // }, [preferencesLoaded, meetingsUsername, meetingsPassword, meetingsBrowser, meetingsHeadless])

  useEffect(() => {
    if (isFloating) return
    if (!loggedIn || !jiraStatusLoaded || !preferencesLoaded) return
    if (!jiraConfigured) {
      setJiraPrefetchDone(true)
      return
    }
    void prefetchJiraDetails()
  }, [isFloating, loggedIn, jiraStatusLoaded, preferencesLoaded, jiraConfigured])

  useEffect(() => {
    if (jiraConfigured) return
    jiraPrefetchStartedRef.current = false
    setJiraPrefetchDone(true)
    setJiraPrefetchError(null)
    setJiraPrefetchProgress(null)
  }, [jiraConfigured])

  async function loadJiraEpics() {
    setJiraLoading(true)
    setJiraError(null)
    try {
      const epics = await withTimeout(
        window.hrs.getJiraEpics(),
        JIRA_TIMEOUT_MS,
        'Loading Jira epics'
      )
      setJiraEpics(epics as JiraEpic[])
      setJiraEpicsFailedAt(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      reportJiraError(message)
      setJiraEpicsFailedAt(Date.now())
    } finally {
      setJiraLoading(false)
    }
  }

  async function loadJiraMappings() {
    try {
      const mappings = await window.hrs.getJiraMappings()
      setJiraMappings(mappings as Record<string, string>)
      return mappings as Record<string, string>
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      reportJiraError(message)
      return null
    }
  }

  async function saveJiraCredentials() {
    if (!jiraEmail.trim() || !jiraToken.trim()) {
      setJiraError('Jira email and token are required.')
      return
    }
    setJiraSaving(true)
    setJiraError(null)
    try {
      await window.hrs.setJiraCredentials(jiraEmail.trim(), jiraToken.trim())
      setJiraToken('')
      await loadJiraStatus()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      reportJiraError(message)
    } finally {
      setJiraSaving(false)
    }
  }

  async function clearJiraCredentials() {
    setJiraSaving(true)
    try {
      await window.hrs.clearJiraCredentials()
      setJiraStatus(null)
      setJiraEpics([])
      setJiraMappings({})
      setJiraIssues([])
      setJiraIssueKey(null)
      setLogToJira(false)
      setJiraToken('')
      setJiraErrorSticky(null)
      setJiraEpicsFailedAt(null)
    } finally {
      setJiraSaving(false)
    }
  }

  async function updateJiraMapping(customer: string, epicKey: string | null) {
    try {
      const mappings = await window.hrs.setJiraMapping(customer, epicKey)
      setJiraMappings(mappings as Record<string, string>)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      reportJiraError(message)
    }
  }

  function addManualBudget() {
    const label = manualBudgetCustomer.trim()
    if (!label) {
      setManualBudgetError('Enter a customer name.')
      return
    }
    if (!manualBudgetEpicKey) {
      setManualBudgetError('Select a Jira epic.')
      return
    }
    if (jiraMappings[label] || jiraManualBudgets[label]) {
      setManualBudgetError('Customer already exists.')
      return
    }
    setManualBudgetError(null)
    setJiraManualBudgets(prev => ({ ...prev, [label]: manualBudgetEpicKey }))
    setManualBudgetCustomer('')
    setManualBudgetEpicKey(null)
  }

  function removeManualBudget(customer: string) {
    setJiraManualBudgets(prev => {
      const next = { ...prev }
      delete next[customer]
      return next
    })
  }

  function setProjectStartDate(epicKey: string, date: Date | null) {
    setJiraProjectStartDates(prev => {
      const next = { ...prev }
      if (!date) {
        delete next[epicKey]
        return next
      }
      next[epicKey] = dayjs(date).format('YYYY-MM-DD')
      return next
    })
  }

  async function loadJiraWorkItems(epicKey: string, force = false) {
    if (!force) {
      const cached = jiraIssuesCacheRef.current.get(epicKey)
      if (cached) {
        setJiraIssues(cached)
        setJiraLoadingIssues(false)
        setJiraError(null)
        return
      }
    }
    if (force) {
      jiraIssuesCacheRef.current.delete(epicKey)
    }
    const budgetRow = jiraBudgetRows.find(
      row => row.epicKey === epicKey && row.detailsLoaded && row.items.length
    )
    if (budgetRow) {
      jiraIssuesCacheRef.current.set(epicKey, budgetRow.items)
      setJiraIssues(budgetRow.items)
      setJiraLoadingIssues(false)
      setJiraIssueLoadError(null)
      return
    }
    const cachedDetails = jiraBudgetDetailsCacheRef.current.get(epicKey)
    if (cachedDetails?.items.length) {
      jiraIssuesCacheRef.current.set(epicKey, cachedDetails.items)
      setJiraIssues(cachedDetails.items)
      setJiraLoadingIssues(false)
      setJiraIssueLoadError(null)
      return
    }
    const requestId = ++jiraIssuesRequestId.current
    setJiraLoadingIssues(true)
    setJiraError(null)
    setJiraIssueLoadError(null)
    try {
      const details = (await withTimeout(
        window.hrs.getJiraWorkItemDetails(epicKey),
        JIRA_TIMEOUT_MS,
        'Loading Jira work items'
      )) as { items?: JiraWorkItem[] }
      if (requestId !== jiraIssuesRequestId.current) return
      const rawItems = details.items ?? []
      const parsed = rawItems.length
        ? Array.from(new Map(rawItems.map(item => [item.key, item])).values())
        : []
      jiraIssuesCacheRef.current.set(epicKey, parsed)
      setJiraIssues(parsed)
    } catch (err) {
      if (requestId !== jiraIssuesRequestId.current) return
      const message = err instanceof Error ? err.message : String(err)
      if (isJiraAuthError(message)) {
        handleJiraAuthError(message)
        return
      }
      if (message.includes('timed out') || message.includes('JIRA_REQUEST_TIMEOUT')) {
        setJiraIssueLoadError('Work items are taking too long. Logging will use the epic.')
      } else {
        reportJiraError(message)
      }
      setJiraIssues([])
    } finally {
      if (requestId === jiraIssuesRequestId.current) {
        setJiraLoadingIssues(false)
      }
    }
  }

  async function requestBudgetDetails(
    epicKey: string,
    options?: { timeoutMs?: number }
  ) {
    const cached = jiraBudgetDetailsCacheRef.current.get(epicKey)
    if (cached) return cached
    const inFlight = jiraBudgetDetailsInFlightRef.current.get(epicKey)
    if (inFlight) {
      return options?.timeoutMs
        ? withTimeout(inFlight, options.timeoutMs, 'Loading Jira task details')
        : inFlight
    }
    const request = (async () => {
      const details = (await window.hrs.getJiraWorkItemDetails(epicKey)) as {
        items?: JiraWorkItem[]
        partial?: boolean
      }
      const rawItems = details.items ?? []
      const items = rawItems.length ? dedupeWorkItemsDeep(rawItems) : []
      const entry = { items, partial: Boolean(details.partial) }
      jiraBudgetDetailsCacheRef.current.set(epicKey, entry)
      jiraBudgetDetailsFailureRef.current.delete(epicKey)
      applyDetailsToRow(epicKey, entry)
      return entry
    })()
    const wrapped = options?.timeoutMs
      ? withTimeout(request, options.timeoutMs, 'Loading Jira task details')
      : request
    jiraBudgetDetailsInFlightRef.current.set(epicKey, request)
    void request
      .finally(() => {
        jiraBudgetDetailsInFlightRef.current.delete(epicKey)
      })
      .catch(() => {
        // Swallow to avoid unhandled rejection when callers time out.
      })
    return wrapped
  }

  async function loadBudgetDetails(epicKey: string) {
    const cachedDetails = jiraBudgetDetailsCacheRef.current.get(epicKey)
    if (cachedDetails) {
      applyDetailsToRow(epicKey, cachedDetails)
      return
    }
    setJiraBudgetRows(prev =>
      prev.map(row =>
        row.epicKey === epicKey
          ? { ...row, detailsLoading: true, detailsError: null }
          : row
      )
    )
    try {
      const details = await requestBudgetDetails(epicKey, {
        timeoutMs: JIRA_DETAIL_TIMEOUT_MS
      })
      applyDetailsToRow(epicKey, details)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (!message.includes('timed out')) {
        reportJiraError(message)
      }
      setJiraBudgetRows(prev =>
        prev.map(row =>
          row.epicKey === epicKey
            ? { ...row, detailsLoading: false, detailsError: message, detailsLoaded: false }
            : row
        )
      )
    }
  }

  async function loadBudgetTasks(epicKey: string) {
    // Check if already loading to prevent duplicate requests
    if (jiraBudgetDetailsInFlightRef.current.get(epicKey)) {
      return
    }
    
    const cachedDetails = jiraBudgetDetailsCacheRef.current.get(epicKey)
    // Check if cached data has complete worklog info
    const hasCompleteData = cachedDetails?.items.every(item => {
      const hasWorklogsData = item.worklogs !== undefined
      const subtasks = item.subtasks ?? []
      if (!subtasks.length) return hasWorklogsData
      return subtasks.every(subtask => subtask.worklogs !== undefined)
    })
    
    if (cachedDetails && hasCompleteData) {
      applyDetailsToRow(epicKey, cachedDetails)
      return
    }
    
    // Mark as loading to prevent duplicate fetches
    const loadingPromise = (async () => {
      
      setJiraBudgetRows(prev =>
        prev.map(row =>
          row.epicKey === epicKey
            ? { ...row, detailsLoading: true, detailsError: null }
            : row
        )
      )
      try {
        // Use backend cache for speed - it has correct subtask timespent from worklogs
        const details = await withTimeout(
          window.hrs.getJiraWorkItemDetails(epicKey, false),
          JIRA_DETAIL_TIMEOUT_MS,
          'Loading Jira task details'
        ) as {
          items?: JiraWorkItem[]
          partial?: boolean
        }
        const rawItems = details.items ?? []
        
        const items = rawItems.length ? dedupeWorkItemsDeep(rawItems) : []
        const entry = { items, partial: Boolean(details.partial) }
        
        jiraBudgetDetailsCacheRef.current.set(epicKey, entry)
        applyDetailsToRow(epicKey, entry)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setJiraBudgetRows(prev =>
          prev.map(row =>
            row.epicKey === epicKey
              ? { ...row, detailsLoading: false, detailsError: message, detailsLoaded: false }
              : row
          )
        )
      } finally {
        jiraBudgetDetailsInFlightRef.current.delete(epicKey)
      }
    })()
    
    jiraBudgetDetailsInFlightRef.current.set(epicKey, loadingPromise)
    await loadingPromise
  }

  async function loadPeopleViewData() {
    setJiraPeopleLoading(true)
    try {
      for (const row of jiraBudgetRows) {
        if (row.detailsLoaded || row.detailsLoading) continue
        await loadBudgetDetails(row.epicKey)
      }
    } finally {
      setJiraPeopleLoading(false)
    }
  }

  function applyDetailsToRow(
    epicKey: string,
    cachedDetails: { items: JiraWorkItem[]; partial: boolean }
  ) {
    const totals = computeJiraTotals(cachedDetails.items)
    const ratio = totals.estimateSeconds ? totals.spentSeconds / totals.estimateSeconds : 0
    const contributors = buildContributorSummary(cachedDetails.items)
    setJiraBudgetRows(prev =>
      prev.map(row =>
        row.epicKey === epicKey
          ? {
              ...row,
              items: cachedDetails.items,
              contributors,
              detailsPartial: cachedDetails.partial,
              estimateSeconds: totals.estimateSeconds,
              spentSeconds: totals.spentSeconds,
              ratio,
              detailsLoaded: true,
              detailsLoading: false,
              detailsError: null,
              summaryPartial: cachedDetails.partial
            }
          : row
      )
    )
  }

  async function prefetchLightBudget(epicKey: string) {
    // Lightweight prefetch: tasks only (no worklogs) to show basic info quickly
    // Don't apply to rows - let user expand to fetch full data with worklogs
    const cached = jiraBudgetDetailsCacheRef.current.get(epicKey)
    if (cached) return cached
    const items = (await withTimeout(
      window.hrs.getJiraWorkItems(epicKey),
      JIRA_LIGHT_PREFETCH_TIMEOUT_MS,
      'Loading Jira tasks'
    )) as JiraWorkItem[]
    const uniqueItems = items.length ? dedupeWorkItemsDeep(items) : []
    const entry = {
      items: uniqueItems,
      partial: uniqueItems.length >= 200
    }
    // Cache the light data but don't mark row as loaded
    // This allows first expand to fetch full data, subsequent expands use cache
    jiraBudgetDetailsCacheRef.current.set(epicKey, entry)
    return entry
  }

  async function openEpicDebug(epicKey: string) {
    try {
      const payload = await window.hrs.getJiraEpicDebug(epicKey)
      if (payload) {
        setJiraEpicDebugData(payload)
        setJiraEpicDebugOpen(true)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      reportJiraError(message)
    }
  }

  async function loadJiraWorklogHistory(issueKey: string) {
    setJiraWorklogWarning(null)
    try {
      const entries = await window.hrs.getJiraWorklogHistory(issueKey)
      const sorted = [...(entries as JiraWorklogEntry[])].sort((a, b) => {
        const aTime = a.started ? Date.parse(a.started) : 0
        const bTime = b.started ? Date.parse(b.started) : 0
        return bTime - aTime
      })
      setJiraWorklogs(sorted)
      const dateKey = logDate ? dayjs(logDate).format('YYYY-MM-DD') : null
      const warnings: string[] = []
      if (dateKey && sorted.some(entry => entry.started?.startsWith(dateKey))) {
        warnings.push('A Jira worklog already exists for this date.')
      }
      const trimmed = comment.trim()
      if (
        trimmed &&
        sorted.some(entry =>
          extractJiraCommentText(entry.comment).toLowerCase().includes(trimmed.toLowerCase())
        )
      ) {
        warnings.push('A similar Jira comment already exists.')
      }
      setJiraWorklogWarning(warnings.length ? warnings.join(' ') : null)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      reportJiraError(message)
      setJiraWorklogs([])
    }
  }

  async function prefetchJiraDetails() {
    if (!jiraConfigured) {
      setJiraPrefetchDone(true)
      return
    }
    if (jiraPrefetchStartedRef.current) return
    jiraPrefetchStartedRef.current = true
    setJiraPrefetchDone(false)
    setJiraPrefetchError(null)
    setJiraPrefetchProgress(null)
    setBootStatus('Loading Jira epics…')
    setJiraPrefetchEntries({})
    let epics: JiraEpic[] = []
    let mappings: Record<string, string> = {}
    try {
      const loadedEpics = await window.hrs.getJiraEpics()
      epics = (loadedEpics as JiraEpic[]) ?? []
      setJiraEpics(epics)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      reportJiraError(message)
      setJiraPrefetchError(message)
    }
    try {
      const loadedMappings = await window.hrs.getJiraMappings()
      mappings = (loadedMappings as Record<string, string>) ?? {}
      setJiraMappings(mappings)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      reportJiraError(message)
      setJiraPrefetchError(message)
    }
    const epicKeys = Array.from(
      new Set([
        ...Object.values(mappings),
        ...Object.values(jiraManualBudgets)
      ])
    ).filter(Boolean)
    if (!epicKeys.length) {
      setJiraPrefetchDone(true)
      setBootStatus('Preparing your workspace…')
      return
    }
    const total = epicKeys.length
    setJiraPrefetchEntries(
      epicKeys.reduce((acc, key) => {
        acc[key] = { status: 'pending', tasks: 0, subtasks: 0 }
        return acc
      }, {} as typeof jiraPrefetchEntries)
    )
    let done = 0
    setJiraPrefetchProgress({ done, total })
    setBootStatus(`Loading Jira tasks ${done}/${total}…`)

    const queue = [...epicKeys]
    const workers = Array.from({ length: 1 }, async () => {
      while (queue.length) {
        const epicKey = queue.shift()
        if (!epicKey) break
        setJiraPrefetchEntries(prev => ({
          ...prev,
          [epicKey]: {
            status: 'loading',
            tasks: prev[epicKey]?.tasks ?? 0,
            subtasks: prev[epicKey]?.subtasks ?? 0,
            startedAt: Date.now(),
            finishedAt: undefined,
            error: null
          }
        }))
        try {
          // Load FULL details with worklogs for accurate contributor data
          await loadBudgetTasks(epicKey)
          const cached = jiraBudgetDetailsCacheRef.current.get(epicKey)
          const taskCount = cached?.items.length ?? 0
          const subtaskCount =
            cached?.items.reduce((sum, item) => sum + (item.subtasks?.length ?? 0), 0) ?? 0
          done += 1
          jiraBudgetDetailsFailureRef.current.delete(epicKey)
          setJiraPrefetchEntries(prev => ({
            ...prev,
            [epicKey]: {
              status: 'done',
              tasks: taskCount,
              subtasks: subtaskCount,
              startedAt: prev[epicKey]?.startedAt ?? Date.now(),
              finishedAt: Date.now(),
              error: null
            }
          }))
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          const isTimeout = message.includes('timed out') || message.includes('JIRA_REQUEST_TIMEOUT')
          done += 1
          if (isTimeout) {
            jiraBudgetDetailsFailureRef.current.set(epicKey, Date.now())
            setJiraPrefetchError('Some Jira tasks are taking too long. You can retry them.')
          } else {
            setJiraPrefetchError(message)
            reportJiraError(message)
          }
          setJiraPrefetchEntries(prev => ({
            ...prev,
            [epicKey]: {
              status: 'error',
              tasks: prev[epicKey]?.tasks ?? 0,
              subtasks: prev[epicKey]?.subtasks ?? 0,
              startedAt: prev[epicKey]?.startedAt ?? Date.now(),
              finishedAt: Date.now(),
              error: message
            }
          }))
        } finally {
          setJiraPrefetchProgress({ done, total })
          setBootStatus(`Loading Jira tasks ${done}/${total}…`)
        }
      }
    })
    await Promise.all(workers)
    setBootStatus('Preparing your workspace…')
    setJiraPrefetchDone(true)
  }

  async function openHistoryModal(title: string, issueKey: string) {
    setHistoryModalTitle(title)
    setHistoryModalData(null)
    setHistoryModalError(null)
    setHistoryModalLoading(true)
    setHistoryModalOpen(true)
    try {
      const worklogs = await window.hrs.getJiraIssueWorklogs(issueKey)
      if (worklogs.length) {
        setHistoryModalData(buildHistoryTable(worklogs as JiraWorklogEntry[]))
        const worklogSeconds = worklogs.reduce(
          (sum, entry) => sum + (entry.seconds ?? 0),
          0
        )
        setJiraBudgetRows(prev =>
          prev.map(row => {
            if (!row.items.length) return row
            const items = row.items.map(item => {
              if (item.key === issueKey) {
                return { ...item, timespent: worklogSeconds }
              }
              if (!item.subtasks?.length) return item
              const subtasks = item.subtasks.map(subtask =>
                subtask.key === issueKey
                  ? { ...subtask, timespent: worklogSeconds }
                  : subtask
              )
              return { ...item, subtasks }
            })
            return { ...row, items }
          })
        )
      } else {
        setHistoryModalData(null)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setHistoryModalError(message)
    } finally {
      setHistoryModalLoading(false)
    }
  }

  async function loadActiveClientTrend() {
    const requestId = ++activeClientTrendRequestId.current
    setActiveClientTrendLoading(true)
    setActiveClientTrendLoaded(false)
    setActiveClientTrendError(null)
    setBootStatus('Preparing analytics…')
    try {
      const taskIdToCustomer = new Map<number, string>()
      for (const log of logs) {
        if (log.customerName) {
          taskIdToCustomer.set(log.taskId, log.customerName)
        }
      }
      const now = dayjs()
      const months = Array.from({ length: 12 }).map((_, index) =>
        now.subtract(11 - index, 'month')
      )
      const results = await Promise.all(
        months.map(async month => {
          const { start, end } = getMonthRange(month.toDate())
          const data = await withTimeout(
            window.hrs.getReports(start, end),
            BOOT_TIMEOUT_MS,
            'Loading trend'
          )
          const monthReport = data as MonthlyReport
          const set = new Set<string>()
          let totalMinutes = 0
          const targetDay = Math.min(now.date(), month.daysInMonth())
          for (const day of monthReport.days) {
            const dayNumber = dayjs(day.date).date()
            const dayMinutes = day.reports.reduce(
              (sum, report) => sum + parseHoursHHMMToMinutes(report.hours_HHMM),
              0
            )
            totalMinutes += dayMinutes
            if (dayNumber <= targetDay) {
              // no-op, using totalMinutes below for month-to-date
            }
            for (const report of day.reports) {
              const customer =
                taskIdToCustomer.get(report.taskId) ||
                report.projectInstance ||
                report.taskName
              if (customer) set.add(customer)
            }
          }
          const mtdMinutes = monthReport.days.reduce((sum, day) => {
            const dayNumber = dayjs(day.date).date()
            if (dayNumber > targetDay) return sum
            return (
              sum +
              day.reports.reduce(
                (daySum, report) => daySum + parseHoursHHMMToMinutes(report.hours_HHMM),
                0
              )
            )
          }, 0)
          const totalHours = Number(monthReport.totalHours)
          const normalizedTotalHours = Number.isFinite(totalHours)
            ? totalHours
            : Math.round((totalMinutes / 60) * 10) / 10
          return {
            monthKey: month.format('YYYY-MM'),
            label: month.format('MMM'),
            count: set.size,
            totalHours: normalizedTotalHours,
            mtdHours: Math.round((mtdMinutes / 60) * 10) / 10
          }
        })
      )
      if (requestId !== activeClientTrendRequestId.current) return
      const currentMonthKey = now.format('YYYY-MM')
      setActiveClientTrend(
        results
          .filter(({ monthKey }) => monthKey !== currentMonthKey)
          .map(({ monthKey, label, count }) => ({ monthKey, label, count }))
      )
      setHoursTrend(
        results.map(({ monthKey, label, totalHours, mtdHours }) => ({
          monthKey,
          label,
          totalHours,
          mtdHours
        }))
      )
    } catch (err) {
      if (requestId !== activeClientTrendRequestId.current) return
      const message = err instanceof Error ? err.message : String(err)
      if (message === 'AUTH_REQUIRED') {
        const ok = await checkSession()
        if (!ok) {
          setLoggedIn(false)
          setActiveClientTrendError('Session expired. Please login again.')
        }
      } else {
        setActiveClientTrendError(message)
      }
    } finally {
      if (requestId === activeClientTrendRequestId.current) {
        setActiveClientTrendLoading(false)
        setActiveClientTrendLoaded(true)
      }
    }
  }

  function persistJiraLoggedEntries(
    next: Record<string, { issueKey: string; loggedAt: string; worklogId?: string }>
  ) {
    setJiraLoggedEntries(next)
    void window.hrs.setJiraLoggedEntries(next)
  }

  async function logReportEntryToJira(
    entry: WorkReportEntry,
    dateKey: string,
    customer: string,
    issueKeyOverride?: string | null
  ) {
    if (!jiraConfigured) {
      setLogError('Connect Jira to log work items.')
      return
    }
    const epicKey = jiraMappings[customer]
    if (!epicKey) {
      setLogError('Map this customer to a Jira epic to enable logging.')
      return
    }
    setLogError(null)
    const entryKey = getReportEntryKey(entry, dateKey)
    setJiraLogLoadingKey(entryKey)
    try {
      let issueKey = issueKeyOverride ?? jiraIssueKey
      if (!issueKey) {
        const issues = await window.hrs.getJiraWorkItems(epicKey)
        if (issues.length === 1) {
          issueKey = issues[0].key
        }
      }
      if (!issueKey) {
        setLogError('Select a Jira work item to log this entry.')
        return
      }
      const started = buildJiraStarted(dayjs(dateKey).toDate(), '09:00')
      const seconds = Math.max(60, parseHoursHHMMToMinutes(entry.hours_HHMM) * 60)
      const jiraComment = buildJiraComment(
        {
          taskId: entry.taskId,
          taskName: entry.taskName,
          customerName: customer,
          projectName: entry.projectInstance || 'Project'
        },
        entry.comment || ''
      )
      const createdWorklog = await window.hrs.addJiraWorklog({
        issueKey,
        started,
        seconds,
        comment: jiraComment
      })
      const next = {
        ...jiraLoggedEntries,
        [entryKey]: {
          issueKey,
          loggedAt: new Date().toISOString(),
          worklogId:
            createdWorklog && typeof createdWorklog === 'object'
              ? (createdWorklog as JiraWorklogEntry).id
              : undefined
        }
      }
      persistJiraLoggedEntries(next)
      void loadJiraWorklogHistory(issueKey)
      setLogSuccess('Logged to Jira.')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (isJiraAuthError(message)) {
        handleJiraAuthError(message)
        setLogError('Jira session expired. Please connect again.')
        return
      }
      setLogError(`Jira failed: ${message}`)
    } finally {
      setJiraLogLoadingKey(null)
    }
  }

  async function openJiraLogModal(entry: WorkReportEntry, dateKey: string, customer: string) {
    setJiraLogModalOpen(true)
    setJiraLogModalEntry({ entry, dateKey, customer })
    setJiraLogModalIssueKey(null)
    setJiraLogModalError(null)
    const epicKey = jiraMappings[customer]
    if (!jiraConfigured) {
      setJiraLogModalError('Connect Jira to load work items.')
      setJiraLogModalItems([])
      return
    }
    if (!epicKey) {
      setJiraLogModalError('Map this customer to a Jira epic first.')
      setJiraLogModalItems([])
      return
    }
    const requestId = ++jiraLogModalRequestId.current
    setJiraLogModalLoading(true)
    try {
      const items = await window.hrs.getJiraWorkItems(epicKey)
      if (requestId !== jiraLogModalRequestId.current) return
      setJiraLogModalItems(items as JiraWorkItem[])
      if (items.length === 1) {
        setJiraLogModalIssueKey(items[0].key)
      }
    } catch (err) {
      if (requestId !== jiraLogModalRequestId.current) return
      const message = err instanceof Error ? err.message : String(err)
      setJiraLogModalError(message)
      setJiraLogModalItems([])
    } finally {
      if (requestId === jiraLogModalRequestId.current) {
        setJiraLogModalLoading(false)
      }
    }
  }

  async function submitLogWork(
    taskId: number,
    duration: Duration,
    overrides?: {
      date?: Date
      fromTime?: string
      toTime?: string
      comment?: string
      skipCommentRules?: boolean
      reportingFrom?: string
      logToJira?: boolean
      jiraIssueKey?: string | null
      jiraCommentOverride?: string | null
      onError?: (message: string) => void
    }
  ): Promise<boolean> {
    const effectiveDate = overrides?.date ?? logDate
    if (!effectiveDate) {
      setLogError('Choose a date to log work.')
      return false
    }
    const effectiveTask = taskMetaById.get(taskId) ?? selectedTask
    const effectiveComment = overrides?.comment ?? comment
    const baseComment = effectiveComment.trim()
    const ruledComment = overrides?.skipCommentRules
      ? baseComment
      : applyCommentRules(baseComment, effectiveTask, commentRules)
    const trimmedComment = ruledComment.trim()
    if (trimmedComment.length < 3) {
      setLogError('Add a short, informative comment before logging.')
      return false
    }
    const effectiveFromTime = overrides?.fromTime ?? fromTime
    const effectiveToTime = overrides?.toTime ?? toTime
    const effectiveReportingFrom = overrides?.reportingFrom ?? reportingFrom
    const shouldLogToJira = overrides?.logToJira ?? logToJira
    const effectiveCustomerName = effectiveTask?.customerName ?? customerName
    const mappedEpicForLog = effectiveCustomerName
      ? jiraMappings[effectiveCustomerName] ?? null
      : null
    const effectiveJiraIssueKey =
      overrides?.jiraIssueKey ?? jiraIssueKey ?? mappedEpicForLog
    setLogLoading(true)
    setLogError(null)
    setLogSuccess(null)
	    try {
	      const date = dayjs(effectiveDate).format('YYYY-MM-DD')
	      let existingReports: WorkReportEntry[] = []
	      const dateKey = date
	      if (monthlyReport && dayjs(effectiveDate).isSame(reportMonth, 'month')) {
	        existingReports = reportsByDate.get(dateKey)?.day.reports ?? []
	      } else {
	        const { start, end } = getMonthRange(effectiveDate)
	        const data = await window.hrs.getReports(start, end)
	        const month = data as MonthlyReport
	        existingReports = month.days.find(day => day.date === dateKey)?.reports ?? []
	      }

	      let existingDetailed: ReportLogEntry[] = reportWorkLogsByDate[dateKey] ?? []
	      if (!existingDetailed.length && existingReports.length) {
	        try {
	          const data = await withTimeout(
	            window.hrs.getWorkLogs(dateKey),
	            BOOT_TIMEOUT_MS,
	            'Loading work logs'
	          )
	          existingDetailed = Array.isArray(data)
	            ? data
	                .map(item => normalizeReportLogEntry(item))
	                .filter((item): item is ReportLogEntry => Boolean(item))
	            : []
	          setReportWorkLogsByDate(prev => ({ ...prev, [dateKey]: existingDetailed }))
	        } catch {
	          existingDetailed = []
	        }
	      }

	      const rangeKeyToRange = new Map<string, { from: string; to: string }>()
	      const rangeByTaskId = new Map<number, Array<{ from: string; to: string; hours: string; comment: string }>>()
	      for (const entry of existingDetailed) {
	        if (!entry.from || !entry.to) continue
	        const hours = entry.hours_HHMM || buildDurationFromTimes(entry.from, entry.to)?.hoursHHMM || ''
	        if (!hours) continue
	        const comment = entry.comment || ''
	        const normalizedKeys = buildReportEntryKeys(
	          {
	            taskId: entry.taskId,
	            hours_HHMM: hours,
	            comment,
	            reporting_from: entry.reporting_from,
	            projectInstance: entry.projectInstance
	          },
	          dateKey
	        )
	        for (const key of normalizedKeys) {
	          if (!rangeKeyToRange.has(key)) {
	            rangeKeyToRange.set(key, { from: entry.from, to: entry.to })
	          }
	        }
	        const list = rangeByTaskId.get(entry.taskId) ?? []
	        list.push({ from: entry.from, to: entry.to, hours, comment })
	        rangeByTaskId.set(entry.taskId, list)
	      }

	      const newLogItem: LogWorkItem = {
	        id: Date.now() + existingReports.length + 1,
	        from: effectiveFromTime,
	        to: effectiveToTime,
	        hours_HHMM: duration.hoursHHMM,
	        hours: duration.hours,
	        comment: trimmedComment,
	        notSaved: true,
	        reporting_from: effectiveReportingFrom,
	        taskId
	      }

	      const reservedRanges: Array<{ start: number; end: number }> = []
	      const resolvedRanges: Array<{ from: string; to: string } | null> = []

	      const meetingStartMinutes = parseTimeToMinutes(effectiveFromTime)
	      const meetingEndMinutes = parseTimeToMinutes(effectiveToTime)
	      if (meetingStartMinutes !== null && meetingEndMinutes !== null && meetingEndMinutes > meetingStartMinutes) {
	        reservedRanges.push({ start: meetingStartMinutes, end: meetingEndMinutes })
	      }

	      for (const report of existingReports) {
	        const directRange = extractTimeRangeFromRecord(report as unknown as Record<string, unknown>)
	        let from = directRange?.from ?? null
	        let to = directRange?.to ?? null
	        if (!from || !to) {
	          const keys = buildReportEntryKeys(report, dateKey)
	          for (const key of keys) {
	            const found = rangeKeyToRange.get(key)
	            if (found) {
	              from = found.from
	              to = found.to
	              break
	            }
	          }
	        }
	        if ((!from || !to) && rangeByTaskId.has(report.taskId)) {
	          const candidates = rangeByTaskId.get(report.taskId) ?? []
	          if (candidates.length === 1) {
	            from = candidates[0].from
	            to = candidates[0].to
	          }
	        }
	        const fromMinutes = from ? parseTimeToMinutes(from) : null
	        const toMinutes = to ? parseTimeToMinutes(to) : null
	        if (fromMinutes !== null && toMinutes !== null && toMinutes > fromMinutes) {
	          reservedRanges.push({ start: fromMinutes, end: toMinutes })
	          resolvedRanges.push({ from, to })
	        } else {
	          resolvedRanges.push(null)
	        }
	      }

	      const findEarliestGap = (durationMinutes: number) => {
	        const sorted = [...reservedRanges].sort((a, b) => a.start - b.start)
	        let cursor = 0
	        for (const range of sorted) {
	          if (cursor + durationMinutes <= range.start) {
	            return cursor
	          }
	          if (cursor < range.end) cursor = range.end
	        }
	        const endOfDay = 24 * 60
	        if (cursor + durationMinutes <= endOfDay) return cursor
	        return Math.max(0, endOfDay - durationMinutes)
	      }

	      for (let index = 0; index < existingReports.length; index += 1) {
	        if (resolvedRanges[index]) continue
	        const report = existingReports[index]
	        const minutes = parseHoursHHMMToMinutes(report.hours_HHMM) || 1
	        const startMinutes = findEarliestGap(minutes)
	        const endMinutes = Math.min(24 * 60, startMinutes + minutes)
	        const from = minutesToHHMM(startMinutes)
	        const to = minutesToHHMM(endMinutes)
	        resolvedRanges[index] = { from, to }
	        reservedRanges.push({ start: startMinutes, end: endMinutes })
	      }

	      const workLogs = existingReports.map((report, index) => {
	        const range = resolvedRanges[index]
	        return toLogWorkItem(
	          {
	            taskId: report.taskId,
	            hours_HHMM: report.hours_HHMM,
	            comment: report.comment,
	            reporting_from: report.reporting_from,
	            from: range?.from ?? undefined,
	            to: range?.to ?? undefined
	          },
	          index
	        )
	      })
	      workLogs.push(newLogItem)

      const payload = {
        date,
        workLogs
      }
      await window.hrs.logWork(payload)
      setReportWorkLogsByDate(prev => {
        const existing = prev[dateKey] ?? []
        const projectInstance =
          effectiveTask?.projectInstance || effectiveTask?.projectName || undefined
        const nextEntry: ReportLogEntry = {
          taskId,
          from: effectiveFromTime,
          to: effectiveToTime,
          hours_HHMM: duration.hoursHHMM,
          comment: trimmedComment,
          reporting_from: effectiveReportingFrom,
          projectInstance
        }
        return {
          ...prev,
          [dateKey]: [...existing, nextEntry]
        }
      })
      let jiraFailure: string | null = null
      if (shouldLogToJira && effectiveJiraIssueKey && jiraStatus?.configured) {
    try {
      const started = buildJiraStarted(effectiveDate, effectiveFromTime)
      const seconds = Math.max(1, Math.round(duration.minutes * 60))
      const jiraComment =
        overrides?.jiraCommentOverride ?? buildJiraComment(effectiveTask, trimmedComment)
      const createdWorklog = await window.hrs.addJiraWorklog({
        issueKey: effectiveJiraIssueKey,
        started,
        seconds,
        comment: jiraComment
      })
          const entryKey = getReportEntryKey(
            {
              taskId,
              hours_HHMM: duration.hoursHHMM,
              comment: trimmedComment,
              reporting_from: effectiveReportingFrom,
              projectInstance: effectiveTask?.projectInstance || effectiveTask?.projectName
            },
            date
          )
          const next = {
            ...jiraLoggedEntries,
            [entryKey]: {
              issueKey: effectiveJiraIssueKey,
              loggedAt: new Date().toISOString(),
              worklogId:
                createdWorklog && typeof createdWorklog === 'object'
                  ? (createdWorklog as JiraWorklogEntry).id
                  : undefined
            }
          }
      persistJiraLoggedEntries(next)
          void loadJiraWorklogHistory(effectiveJiraIssueKey)
    } catch (err) {
      jiraFailure = err instanceof Error ? err.message : String(err)
      if (jiraFailure && isJiraAuthError(jiraFailure)) {
        handleJiraAuthError(jiraFailure)
      }
    }
      }
      if (jiraFailure) {
        setLogError(`HRS saved, Jira failed: ${jiraFailure}`)
      } else {
        setLogSuccess('Work log saved.')
      }
      if (!overrides?.comment) {
        setComment('')
      }
      const monthKey = dayjs(effectiveDate).format('YYYY-MM')
      reportsCacheRef.current.delete(monthKey)
      if (currentMonthKey === monthKey) {
        setCurrentMonthReport(null)
        setCurrentMonthKey(null)
      }
      const effectiveMonth = dayjs(effectiveDate).toDate()
      setReportMonth(effectiveMonth)
      setSelectedReportDate(effectiveDate)
      loadReportsForMonth(effectiveMonth)
      const weekdayKey = dayjs(effectiveDate).day().toString()
      setSmartDefaults(prev => ({
        lastTaskByWeekday: {
          ...prev.lastTaskByWeekday,
          [weekdayKey]: taskId
        },
        lastTaskId: taskId
      }))
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      overrides?.onError?.(message)
      if (message === 'AUTH_REQUIRED') {
        setLoggedIn(false)
        setLogError('Session expired. Please login again.')
      } else {
        setLogError(message)
      }
      return false
    } finally {
      setLogLoading(false)
    }
  }

  const ensureReportWorkLogsForDate = async (
    dateKey: string,
    expectedReportsCount?: number
  ): Promise<ReportLogEntry[]> => {
    if (Object.prototype.hasOwnProperty.call(reportWorkLogsByDate, dateKey)) {
      const existing = reportWorkLogsByDate[dateKey] ?? []
      if (!expectedReportsCount || existing.length > 0 || expectedReportsCount <= 0) {
        return existing
      }
      // Fall through to refetch when we expect logs but have none cached.
    }
    try {
      const data = await withTimeout(
        window.hrs.getWorkLogs(dateKey),
        BOOT_TIMEOUT_MS,
        'Loading work logs'
      )
      const entries = Array.isArray(data)
        ? data
            .map(item => normalizeReportLogEntry(item))
            .filter((item): item is ReportLogEntry => Boolean(item))
        : []
      setReportWorkLogsByDate(prev => ({ ...prev, [dateKey]: entries }))
      return entries
    } catch {
      setReportWorkLogsByDate(prev => ({ ...prev, [dateKey]: [] }))
      return []
    }
  }

  const refreshReportWorkLogsForDate = async (dateKey: string): Promise<void> => {
    try {
      const data = await withTimeout(
        window.hrs.getWorkLogs(dateKey),
        BOOT_TIMEOUT_MS,
        'Refreshing work logs'
      )
      const entries = Array.isArray(data)
        ? data
            .map(item => normalizeReportLogEntry(item))
            .filter((item): item is ReportLogEntry => Boolean(item))
        : []
      setReportWorkLogsByDate(prev => ({ ...prev, [dateKey]: entries }))
    } catch {
      setReportWorkLogsByDate(prev => ({ ...prev, [dateKey]: [] }))
    }
  }

  const buildLogWorkPayloadForMutation = (
    dateKey: string,
    items: Array<{ report: WorkReportEntry; sourceIndex: number }>,
    sourceReports: WorkReportEntry[],
    detailed: ReportLogEntry[]
  ) => {
    const validDetails = detailed
      .filter(entry => entry.from && entry.to)
      .map(entry => {
        const from = entry.from as string
        const to = entry.to as string
        const fromMinutes = parseTimeToMinutes(from)
        const toMinutes = parseTimeToMinutes(to)
        return { entry, from, to, fromMinutes, toMinutes }
      })
      .filter(
        item =>
          item.fromMinutes !== null &&
          item.toMinutes !== null &&
          (item.toMinutes as number) > (item.fromMinutes as number)
      )
      .sort((a, b) => (a.fromMinutes as number) - (b.fromMinutes as number))

    const computeDetailHours = (entry: ReportLogEntry) => {
      if (entry.hours_HHMM) return entry.hours_HHMM
      if (entry.from && entry.to) {
        return buildDurationFromTimes(entry.from, entry.to)?.hoursHHMM ?? ''
      }
      return ''
    }

    const scoreMatch = (report: WorkReportEntry, detail: ReportLogEntry) => {
      if (report.taskId !== detail.taskId) return 0
      let score = 100
      const detailHours = computeDetailHours(detail)
      if (report.hours_HHMM && detailHours && report.hours_HHMM === detailHours) score += 50
      const reportComment = normalizeText(report.comment || '')
      const detailComment = normalizeText(detail.comment || '')
      if (reportComment && detailComment) {
        if (reportComment === detailComment) score += 25
        else if (detailComment.includes(reportComment) || reportComment.includes(detailComment)) {
          score += 10
        }
      } else if (!reportComment && !detailComment) {
        score += 5
      }
      const reportFrom = normalizeText(report.reporting_from || '')
      const detailFrom = normalizeText(detail.reporting_from || '')
      if (reportFrom && detailFrom && reportFrom === detailFrom) score += 5
      const reportProject = normalizeText(report.projectInstance || '')
      const detailProject = normalizeText(detail.projectInstance || '')
      if (reportProject && detailProject && reportProject === detailProject) score += 5
      return score
    }

    const remaining = [...validDetails]
    const byIndex = new Map<number, { from: string; to: string }>()
    for (let index = 0; index < sourceReports.length; index += 1) {
      const report = sourceReports[index]
      let bestIdx = -1
      let bestScore = 0
      for (let i = 0; i < remaining.length; i += 1) {
        const candidate = remaining[i]
        const score = scoreMatch(report, candidate.entry)
        if (score <= 0) continue
        if (score > bestScore) {
          bestScore = score
          bestIdx = i
        }
      }
      if (bestIdx >= 0) {
        const picked = remaining.splice(bestIdx, 1)[0]
        byIndex.set(index, { from: picked.from, to: picked.to })
      }
    }

    const reservedRanges: Array<{ start: number; end: number }> = []
    const resolvedRanges: Array<{ from: string; to: string } | null> = []

    for (const { report, sourceIndex } of items) {
      const directRange = extractTimeRangeFromRecord(report as unknown as Record<string, unknown>)
      let from = directRange?.from ?? null
      let to = directRange?.to ?? null
      if (!from || !to) {
        const mapped = byIndex.get(sourceIndex)
        if (mapped) {
          from = mapped.from
          to = mapped.to
        }
      }
      if (!from || !to) {
        resolvedRanges.push(null)
        continue
      }
      const fromMinutes = parseTimeToMinutes(from)
      const toMinutes = parseTimeToMinutes(to)
      if (fromMinutes !== null && toMinutes !== null && toMinutes > fromMinutes) {
        reservedRanges.push({ start: fromMinutes, end: toMinutes })
        resolvedRanges.push({ from, to })
      } else {
        resolvedRanges.push(null)
      }
    }

    const findEarliestGap = (durationMinutes: number) => {
      const sorted = [...reservedRanges].sort((a, b) => a.start - b.start)
      let cursor = 0
      for (const range of sorted) {
        if (cursor + durationMinutes <= range.start) {
          return cursor
        }
        if (cursor < range.end) cursor = range.end
      }
      const endOfDay = 24 * 60
      if (cursor + durationMinutes <= endOfDay) return cursor
      return Math.max(0, endOfDay - durationMinutes)
    }

    for (let index = 0; index < items.length; index += 1) {
      if (resolvedRanges[index]) continue
      const report = items[index].report
      const minutes = parseHoursHHMMToMinutes(report.hours_HHMM) || 1
      const startMinutes = findEarliestGap(minutes)
      const endMinutes = Math.min(24 * 60, startMinutes + minutes)
      const from = minutesToHHMM(startMinutes)
      const to = minutesToHHMM(endMinutes)
      resolvedRanges[index] = { from, to }
      reservedRanges.push({ start: startMinutes, end: endMinutes })
    }

    const workLogs = items.map(({ report }, index) => {
      const range = resolvedRanges[index]
      return toLogWorkItem(
        {
          taskId: report.taskId,
          hours_HHMM: report.hours_HHMM,
          comment: report.comment,
          reporting_from: report.reporting_from,
          from: range?.from ?? undefined,
          to: range?.to ?? undefined
        },
        index
      )
    })

    return { date: dateKey, workLogs }
  }

  async function deleteReportEntry(dateKey: string, entryIndex: number) {
    const dayInfo = reportsByDate.get(dateKey)
    if (!dayInfo) return
    const remaining = dayInfo.day.reports.filter((_, idx) => idx !== entryIndex)
    const removedEntry = dayInfo.day.reports[entryIndex]
    const removedKey = removedEntry ? getReportEntryKey(removedEntry, dateKey) : null
    const jiraEntry = removedKey ? jiraLoggedEntries[removedKey] : null
    const timeRange =
      removedEntry
        ? reportTimeRangesByIndex.get(dateKey)?.get(entryIndex) ??
          buildReportEntryKeys(removedEntry, dateKey)
            .map(key => reportTimeRanges.get(key))
            .find(Boolean) ??
          null
        : null

    setDeleteLoading(true)
    setLogError(null)
    setLogSuccess(null)
    try {
      const detailed = await ensureReportWorkLogsForDate(dateKey, dayInfo.day.reports.length)
      if (!remaining.length) {
        await window.hrs.deleteLog(dateKey)
        setLogSuccess(`All logs cleared for ${dateKey}.`)
      } else {
        const items = dayInfo.day.reports
          .map((report, idx) => ({ report, sourceIndex: idx }))
          .filter(item => item.sourceIndex !== entryIndex)
        const payload = buildLogWorkPayloadForMutation(
          dateKey,
          items,
          dayInfo.day.reports,
          detailed
        )
        await window.hrs.logWork(payload)
        setLogSuccess(`Log removed for ${dateKey}.`)
      }
      if (monthlyReport) {
        const updated = updateMonthlyReportDay(monthlyReport, dateKey, remaining)
        setMonthlyReport(updated)
        const monthKey = dayjs(dateKey).format('YYYY-MM')
        reportsCacheRef.current.set(monthKey, updated)
      }
      if (currentMonthReport && currentMonthKey === dayjs(dateKey).format('YYYY-MM')) {
        const updated = updateMonthlyReportDay(currentMonthReport, dateKey, remaining)
        setCurrentMonthReport(updated)
      }
      void refreshReportWorkLogsForDate(dateKey)
      if (removedKey && jiraLoggedEntries[removedKey]) {
        const next = { ...jiraLoggedEntries }
        delete next[removedKey]
        persistJiraLoggedEntries(next)
      }
      if (removedKey) {
        setSelectedReportEntries(prev => {
          if (!prev[removedKey]) return prev
          const next = { ...prev }
          delete next[removedKey]
          return next
        })
      }
      if (jiraEntry) {
        try {
          const started =
            timeRange && removedEntry
              ? buildJiraStarted(dayjs(dateKey).toDate(), timeRange.from)
              : null
          const seconds =
            removedEntry && removedEntry.hours_HHMM
              ? Math.max(1, parseHoursHHMMToMinutes(removedEntry.hours_HHMM) * 60)
              : null
          const meta = removedEntry
            ? taskMetaById.get(removedEntry.taskId) ?? {
                taskId: removedEntry.taskId,
                taskName: removedEntry.taskName,
                customerName: '',
                projectName: removedEntry.projectInstance || 'Project'
              }
            : null
          const expectedComment = removedEntry
            ? buildJiraComment(meta, removedEntry.comment || '')
            : ''
          let worklogIds: string[] = []
          if (jiraEntry.worklogId) {
            worklogIds = [jiraEntry.worklogId]
          } else if (removedEntry && jiraEntry.issueKey) {
            const allLogs = await window.hrs.getJiraIssueWorklogs(jiraEntry.issueKey)
            const candidates = buildJiraDeleteCandidates({
              worklogs: allLogs as JiraWorklogEntry[],
              dateKey,
              expectedStarted: started,
              seconds,
              expectedComment,
              rawComment: removedEntry.comment || ''
            })
            worklogIds = candidates.map(entry => entry.id).filter(Boolean)
          }
          if (worklogIds.length) {
            for (const worklogId of worklogIds) {
              await window.hrs.deleteJiraWorklog({
                issueKey: jiraEntry.issueKey,
                worklogId
              })
            }
          } else {
            console.warn('[jira] Worklog not found for deletion after HRS delete.', {
              dateKey,
              issueKey: jiraEntry.issueKey
            })
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          console.warn('[jira] Delete worklog failed after HRS delete.', {
            dateKey,
            issueKey: jiraEntry.issueKey,
            message
          })
        }
      }
      const monthKey = dayjs(dateKey).format('YYYY-MM')
      reportsCacheRef.current.delete(monthKey)
      if (currentMonthKey === monthKey) {
        setCurrentMonthReport(null)
        setCurrentMonthKey(null)
      }
      try {
        const { start, end } = getMonthRange(dayjs(dateKey).toDate())
        const data = await withTimeout(
          window.hrs.getReports(start, end),
          BOOT_TIMEOUT_MS,
          'Refreshing reports'
        )
        const refreshed = data as MonthlyReport
        reportsCacheRef.current.set(monthKey, refreshed)
        setMonthlyReport(refreshed)
        if (currentMonthKey === monthKey) {
          setCurrentMonthReport(refreshed)
        }
      } catch {
        // Fall back to reloading if the refresh fails.
      }
      loadReportsForMonth(dayjs(dateKey).toDate())
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message === 'AUTH_REQUIRED') {
        setLoggedIn(false)
        setLogError('Session expired. Please login again.')
      } else {
        setLogError(message)
      }
    } finally {
      setDeleteLoading(false)
    }
  }

  function startEditReport(dateKey: string, index: number, entry: WorkReportEntry) {
    setEditError(null)
    setEditingEntry({ dateKey, index })
    setEditHours(entry.hours_HHMM)
    setEditComment(entry.comment || '')
  }

  function cancelEditReport() {
    setEditingEntry(null)
    setEditError(null)
  }

  async function saveEditReport(dateKey: string, index: number) {
    const dayInfo = reportsByDate.get(dateKey)
    if (!dayInfo) return
    const trimmedHours = editHours.trim()
    const minutes = parseHoursHHMMToMinutes(trimmedHours)
    if (!minutes) {
      setEditError('Enter hours as HH:MM (at least 00:01).')
      return
    }
    const trimmedComment = editComment.trim()
    if (trimmedComment.length < 3) {
      setEditError('Add a short, informative comment.')
      return
    }
    setEditLoading(true)
    setEditError(null)
    try {
      const updated = dayInfo.day.reports.map((report, idx) =>
        idx === index
          ? {
              ...report,
              hours_HHMM: trimmedHours,
              comment: trimmedComment
            }
          : report
      )
      const detailed = await ensureReportWorkLogsForDate(dateKey, dayInfo.day.reports.length)
      const items = updated.map((report, idx) => ({ report, sourceIndex: idx }))
      const payload = buildLogWorkPayloadForMutation(
        dateKey,
        items,
        dayInfo.day.reports,
        detailed
      )
      await window.hrs.logWork(payload)
      const oldEntry = dayInfo.day.reports[index]
      const oldKey = getReportEntryKey(oldEntry, dateKey)
      const newEntry = { ...oldEntry, hours_HHMM: trimmedHours, comment: trimmedComment }
      const newKey = getReportEntryKey(newEntry, dateKey)
      if (oldKey !== newKey && jiraLoggedEntries[oldKey]) {
        const next = { ...jiraLoggedEntries }
        next[newKey] = next[oldKey]
        delete next[oldKey]
        persistJiraLoggedEntries(next)
      }
      setLogSuccess(`Log updated for ${dateKey}.`)
      setEditingEntry(null)
      void refreshReportWorkLogsForDate(dateKey)
      loadReportsForMonth(dayjs(dateKey).toDate())
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message === 'AUTH_REQUIRED') {
        setLoggedIn(false)
        setEditError('Session expired. Please login again.')
      } else {
        setEditError(message)
      }
    } finally {
      setEditLoading(false)
    }
  }

  function toggleReportSelection(entryKey: string, next: boolean) {
    setSelectedReportEntries(prev => {
      const updated = { ...prev }
      if (next) {
        updated[entryKey] = true
      } else {
        delete updated[entryKey]
      }
      return updated
    })
  }

  function clearReportSelection() {
    setSelectedReportEntries({})
    setBulkActionError(null)
  }

  function toggleSearchFilter(filter: 'jira' | 'today' | 'week' | 'month') {
    setSearchFilters(prev =>
      prev.includes(filter) ? prev.filter(item => item !== filter) : [...prev, filter]
    )
  }

  function addCommentRule() {
    const match = newRuleMatch.trim()
    if (!match || !newRuleTags.trim()) return
    const tags = newRuleTags
      .split(',')
      .map(tag => tag.trim())
      .filter(Boolean)
    if (!tags.length) return
    const next: CommentRule = {
      id: crypto.randomUUID(),
      scope: newRuleScope,
      match,
      tags
    }
    setCommentRules(prev => [...prev, next])
    setNewRuleMatch('')
    setNewRuleTags('')
  }

  function removeCommentRule(ruleId: string) {
    setCommentRules(prev => prev.filter(rule => rule.id !== ruleId))
  }

  async function bulkDeleteReports(items: ReportItem[]) {
    if (!items.length) return
    const byDate = new Map<string, ReportItem[]>()
    for (const item of items) {
      const list = byDate.get(item.dateKey) ?? []
      list.push(item)
      byDate.set(item.dateKey, list)
    }
    setDeleteLoading(true)
    setBulkActionError(null)
    try {
      const nextJiraEntries = { ...jiraLoggedEntries }
      const affectedMonths = new Set<string>()
      for (const [dateKey, entries] of byDate.entries()) {
        const dayInfo = reportsByDate.get(dateKey)
        if (!dayInfo) continue
        const detailed = await ensureReportWorkLogsForDate(dateKey, dayInfo.day.reports.length)
        const remaining = dayInfo.day.reports.filter((_, idx) =>
          !entries.some(entry => entry.dayIndex === idx)
        )
        for (const entry of entries) {
          const removed = dayInfo.day.reports[entry.dayIndex]
          const removedKey = removed ? getReportEntryKey(removed, dateKey) : null
          if (removedKey) {
            delete nextJiraEntries[removedKey]
          }
        }
        if (!remaining.length) {
          await window.hrs.deleteLog(dateKey)
        } else {
          const remainingItems = dayInfo.day.reports
            .map((report, idx) => ({ report, sourceIndex: idx }))
            .filter(item => !entries.some(entry => entry.dayIndex === item.sourceIndex))
          const payload = buildLogWorkPayloadForMutation(
            dateKey,
            remainingItems,
            dayInfo.day.reports,
            detailed
          )
          await window.hrs.logWork(payload)
        }
        affectedMonths.add(dayjs(dateKey).format('YYYY-MM'))
        void refreshReportWorkLogsForDate(dateKey)
      }
      persistJiraLoggedEntries(nextJiraEntries)
      clearReportSelection()
      for (const monthKey of affectedMonths) {
        reportsCacheRef.current.delete(monthKey)
        if (currentMonthKey === monthKey) {
          setCurrentMonthReport(null)
          setCurrentMonthKey(null)
        }
      }
      loadReportsForMonth(reportMonth)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setBulkActionError(message)
    } finally {
      setDeleteLoading(false)
    }
  }

  async function bulkEditReports(items: ReportItem[]) {
    if (!items.length) return
    const trimmedHours = bulkEditHours.trim()
    const minutes = trimmedHours ? parseHoursHHMMToMinutes(trimmedHours) : null
    if (trimmedHours && !minutes) {
      setBulkActionError('Enter hours as HH:MM (at least 00:01).')
      return
    }
    const trimmedComment = bulkEditComment.trim()
    const hasComment = trimmedComment.length >= 3
    const hasHours = Boolean(minutes)
    if (!hasComment && !hasHours) {
      setBulkActionError('Provide a comment or hours to update.')
      return
    }
    if (trimmedComment.length > 0 && trimmedComment.length < 3) {
      setBulkActionError('Add a short, informative comment.')
      return
    }
    setBulkActionError(null)
    try {
      let nextJiraEntries = { ...jiraLoggedEntries }
      const byDate = new Map<string, ReportItem[]>()
      for (const item of items) {
        const list = byDate.get(item.dateKey) ?? []
        list.push(item)
        byDate.set(item.dateKey, list)
      }
      for (const [dateKey, entries] of byDate.entries()) {
        const dayInfo = reportsByDate.get(dateKey)
        if (!dayInfo) continue
        const detailed = await ensureReportWorkLogsForDate(dateKey, dayInfo.day.reports.length)
        const updated = dayInfo.day.reports.map((report, idx) => {
          const match = entries.find(entry => entry.dayIndex === idx)
          if (!match) return report
          const nextComment = hasComment
            ? bulkEditMode === 'append'
              ? `${report.comment || ''} ${trimmedComment}`.trim()
              : trimmedComment
            : report.comment
          return {
            ...report,
            comment: nextComment,
            hours_HHMM: minutes ? trimmedHours : report.hours_HHMM
          }
        })
        for (const entry of entries) {
          const oldEntry = dayInfo.day.reports[entry.dayIndex]
          const newEntry = updated[entry.dayIndex]
          const oldKey = getReportEntryKey(oldEntry, dateKey)
          const newKey = getReportEntryKey(newEntry, dateKey)
          if (oldKey !== newKey && nextJiraEntries[oldKey]) {
            nextJiraEntries = {
              ...nextJiraEntries,
              [newKey]: nextJiraEntries[oldKey]
            }
            delete nextJiraEntries[oldKey]
          }
        }
        const payload = buildLogWorkPayloadForMutation(
          dateKey,
          updated.map((report, idx) => ({ report, sourceIndex: idx })),
          dayInfo.day.reports,
          detailed
        )
        await window.hrs.logWork(payload)
        void refreshReportWorkLogsForDate(dateKey)
      }
      if (nextJiraEntries !== jiraLoggedEntries) {
        persistJiraLoggedEntries(nextJiraEntries)
      }
      clearReportSelection()
      setBulkEditOpen(false)
      loadReportsForMonth(reportMonth)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setBulkActionError(message)
    }
  }

  async function bulkLogToJira(items: ReportItem[]) {
    if (!items.length) return
    if (!jiraConfigured) {
      setBulkActionError('Connect Jira to log work items.')
      return
    }
    setBulkActionError(null)
    for (const item of items) {
      const entryKey = getReportEntryKey(item, item.dateKey)
      if (jiraLoggedEntries[entryKey]) continue
      const meta = taskMetaById.get(item.taskId)
      const customer = meta?.customerName || 'Customer'
      const epicKey = jiraMappings[customer]
      if (!epicKey) {
        setBulkActionError(`Missing Jira mapping for ${customer}.`)
        return
      }
      try {
        const issues = await window.hrs.getJiraWorkItems(epicKey)
        if (issues.length !== 1) {
          setBulkActionError(
            `Multiple Jira work items for ${customer}. Choose the issue manually.`
          )
          return
        }
        await logReportEntryToJira(item, item.dateKey, customer, issues[0].key)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setBulkActionError(message)
        return
      }
    }
    clearReportSelection()
  }

  async function openLogSameModal() {
    if (!taskIdForLog || !logDate) return
    setLogSameOpen(true)
    setLogSameLoading(true)
    setLogSameError(null)
    setLogSameEntry(null)
    try {
      const previousDate = dayjs(logDate).subtract(1, 'day')
      const previousKey = previousDate.format('YYYY-MM-DD')
      let previousDay = reportsByDate.get(previousKey)?.day
      if (!previousDay) {
        const { start, end } = getMonthRange(previousDate.toDate())
        const data = await window.hrs.getReports(start, end)
        const report = data as MonthlyReport
        previousDay = report.days.find(day => day.date === previousKey)
      }
      if (!previousDay || !previousDay.reports.length) {
        setLogSameError('No logs found for yesterday.')
        return
      }
      const matching = previousDay.reports.filter(report => report.taskId === taskIdForLog)
      const entry = matching[matching.length - 1]
      if (!entry) {
        setLogSameError('No logs found for yesterday for this task.')
        return
      }
      setLogSameEntry(entry)
      setLogSameDate(logDate)
      const minutes = parseHoursHHMMToMinutes(entry.hours_HHMM)
      const computedTo = addMinutesToTime(fromTime, minutes)
      setLogSameFrom(fromTime)
      setLogSameTo(computedTo ?? toTime)
      setLogSameComment(entry.comment || comment)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setLogSameError(message)
    } finally {
      setLogSameLoading(false)
    }
  }

  async function confirmLogSame() {
    if (!taskIdForLog || !logSameDate) return
    const durationOverride = buildDurationFromTimes(logSameFrom, logSameTo)
    if (!durationOverride) {
      setLogSameError('Enter a valid start and end time.')
      return
    }
    const success = await submitLogWork(taskIdForLog, durationOverride, {
      date: logSameDate,
      fromTime: logSameFrom,
      toTime: logSameTo,
      comment: logSameComment,
      reportingFrom
    })
    if (success) {
      setLogSameOpen(false)
    }
  }

  function startTimer() {
    if (timerRunning) return
    const now = new Date()
    setTimerStartedAt(now)
    setTimerRunning(true)
    setFromTime(formatTimeFromDate(now))
    setTimerElapsed(0)
    setLogSuccess('Timer started.')
    if (isFloating) {
      setFloatingCollapsed(true)
    }
  }

  function stopTimer() {
    if (!timerRunning || !timerStartedAt) return
    const now = new Date()
    setTimerRunning(false)
    setToTime(formatTimeFromDate(now))
    setTimerElapsed(Math.floor((now.getTime() - timerStartedAt.getTime()) / 1000))
    setLogSuccess('Timer stopped. Times filled in.')
  }

  const openFloatingStart = () => {
    if (timerRunning) return
    setFloatingStartError(null)
    setFloatingStartOpen(true)
    if (isFloating) {
      setFloatingCollapsed(false)
    }
  }

  const closeFloatingStart = () => {
    setFloatingStartOpen(false)
    setFloatingStartError(null)
    if (isFloating) {
      setFloatingCollapsed(true)
    }
  }

  const confirmFloatingStart = () => {
    if (!taskIdForLog) {
      setFloatingStartError('Select a task before starting the timer.')
      return
    }
    if (logToJira && (!jiraConfigured || (!jiraIssueKey && !mappedEpicKey))) {
      setFloatingStartError(
        jiraConfigured ? 'Select a Jira work item or disable Jira logging.' : 'Connect Jira first.'
      )
      return
    }
    closeFloatingStart()
    startTimer()
  }

  const openFloatingStop = () => {
    if (!timerRunning) return
    stopTimer()
    setFloatingStopError(null)
    setComment('')
    setFloatingStopOpen(true)
    if (isFloating) {
      setFloatingCollapsed(false)
    }
  }

  const closeFloatingStop = () => {
    setFloatingStopOpen(false)
    setFloatingStopError(null)
    if (isFloating) {
      setFloatingCollapsed(true)
    }
  }

  const confirmFloatingStop = async () => {
    if (!taskIdForLog) {
      setFloatingStopError('Select a task before logging.')
      return
    }
    if (!duration) {
      setFloatingStopError('Start and stop the timer to set a duration.')
      return
    }
    if (comment.trim().length < 3) {
      setFloatingStopError('Add a short, informative comment before logging.')
      return
    }
    const success = await submitLogWork(taskIdForLog, duration)
    if (success) {
      closeFloatingStop()
    }
  }

  function openReview() {
    setReviewChecks({
      task: false,
      time: false,
      comment: false,
      jira: !logToJira
    })
    setReviewOpen(true)
  }

  async function confirmReview() {
    if (!taskIdForLog || !duration) return
    await submitLogWork(taskIdForLog, duration)
    setReviewOpen(false)
  }

  function handleCalendarChange(value: DateInputValue) {
    const nextDate = toDate(value)
    setSelectedReportDate(nextDate)
    if (nextDate) {
      setLogDate(nextDate)
      if (!dayjs(nextDate).isSame(reportMonth, 'month')) {
        beginMonthTransition(nextDate)
      }
    }
  }

  function beginMonthTransition(nextMonth: Date) {
    setReportsError(null)
    const cached = reportsCacheRef.current.get(dayjs(nextMonth).format('YYYY-MM'))
    if (cached) {
      setMonthlyReport(cached)
      setReportsLoading(false)
    } else {
      setMonthlyReport(null)
      setReportsLoading(true)
    }
    setReportMonth(nextMonth)
  }

  function shiftReportMonth(delta: number) {
    beginMonthTransition(dayjs(reportMonth).add(delta, 'month').toDate())
  }

  const projectOptions = useMemo(() => buildOptions(logs, log => log.projectName), [logs])

  const customerOptions = useMemo(() => {
    const scope = logs.filter(log => !projectName || log.projectName === projectName)
    return buildOptions(scope, log => log.customerName)
  }, [logs, projectName])

  const taskScope = useMemo(() => {
    return logs.filter(log => {
      if (projectName && log.projectName !== projectName) return false
      if (customerName && log.customerName !== customerName) return false
      return true
    })
  }, [logs, projectName, customerName])

  const activeTaskScope = useMemo(() => {
    const active = taskScope.filter(log => log.isActiveTask !== false)
    return active.length ? active : taskScope
  }, [taskScope])

  const taskNameMap = useMemo(() => {
    const map = new Map<string, WorkLog>()
    for (const log of activeTaskScope) {
      if (!log.taskName) continue
      const existing = map.get(log.taskName)
      if (!existing) {
        map.set(log.taskName, log)
        continue
      }
      const nextDate = log.date ? dayjs(log.date) : null
      const existingDate = existing.date ? dayjs(existing.date) : null
      if (nextDate && (!existingDate || nextDate.isAfter(existingDate))) {
        map.set(log.taskName, log)
        continue
      }
      if (!nextDate && !existingDate && log.taskId > existing.taskId) {
        map.set(log.taskName, log)
      }
    }
    return map
  }, [activeTaskScope])

  const taskOptions = useMemo(() => {
    return Array.from(taskNameMap.keys())
      .sort((a, b) => a.localeCompare(b))
      .map(value => ({ value, label: value }))
  }, [taskNameMap])

  const ruleMatchOptions = useMemo(
    () => (newRuleScope === 'project' ? projectOptions : customerOptions),
    [newRuleScope, projectOptions, customerOptions]
  )

  const allReportItems = useMemo<ReportItem[]>(() => {
    if (!monthlyReport) return []
    return monthlyReport.days.flatMap(day =>
      day.reports.map((report, index) => ({
        ...report,
        dateKey: day.date,
        dayIndex: index
      }))
    )
  }, [monthlyReport])

  const uniqueCustomers = useMemo(() => {
    const set = new Set<string>()
    for (const log of logs) {
      if (log.customerName) set.add(log.customerName)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [logs])

  const activeCustomers = useMemo(() => {
    const set = new Set<string>()
    for (const log of logs) {
      if (log.isActiveTask && log.customerName) {
        set.add(log.customerName)
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [logs])

  const reportedCustomers = useMemo(() => {
    const taskIdToCustomer = new Map<number, string>()
    for (const log of logs) {
      if (log.customerName) {
        taskIdToCustomer.set(log.taskId, log.customerName)
      }
    }
    const set = new Set<string>()
    for (const entry of allReportItems) {
      const customer = taskIdToCustomer.get(entry.taskId)
      if (customer) set.add(customer)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [logs, allReportItems])

  const displayedJiraCustomers = useMemo(() => {
    let list = uniqueCustomers
    if (jiraActiveOnly) {
      list = list.filter(customer => activeCustomers.includes(customer))
    }
    if (jiraReportedOnly) {
      list = list.filter(customer => reportedCustomers.includes(customer))
    }
    return list
  }, [uniqueCustomers, jiraActiveOnly, jiraReportedOnly, activeCustomers, reportedCustomers])

  const jiraProjectOptions = useMemo(
    () => buildOptions(logs, log => log.projectName),
    [logs]
  )

  const jiraProjectCustomerOptions = useMemo(() => {
    const scoped = logs.filter(
      log => !jiraMappingProject || log.projectName === jiraMappingProject
    )
    const options = buildOptions(scoped, log => log.customerName)
    const allowed = new Set(displayedJiraCustomers)
    return options.filter(option => allowed.has(option.value))
  }, [logs, jiraMappingProject, displayedJiraCustomers])

  const jiraMappingCustomers = useMemo(() => {
    let customers = displayedJiraCustomers
    if (jiraMappingProject) {
      const allowed = new Set(
        logs
          .filter(log => log.projectName === jiraMappingProject)
          .map(log => log.customerName)
          .filter(Boolean)
      )
      customers = customers.filter(customer => allowed.has(customer))
    }
    if (jiraMappingCustomer) {
      customers = customers.filter(customer => customer === jiraMappingCustomer)
    }
    return customers
  }, [displayedJiraCustomers, jiraMappingProject, jiraMappingCustomer, logs])

  useEffect(() => {
    if (!jiraConnectOpen) return
    if (jiraConfigured) {
      setJiraConnectOpen(false)
    }
  }, [jiraConnectOpen, jiraConfigured])

  useEffect(() => {
    if (!jiraMappingProject) {
      setJiraMappingCustomer(null)
      return
    }
    if (jiraProjectCustomerOptions.length === 1) {
      setJiraMappingCustomer(jiraProjectCustomerOptions[0].value)
    } else if (
      jiraMappingCustomer &&
      !jiraProjectCustomerOptions.some(option => option.value === jiraMappingCustomer)
    ) {
      setJiraMappingCustomer(null)
    }
  }, [jiraMappingProject, jiraProjectCustomerOptions, jiraMappingCustomer])
  const mappedEpicKey = customerName ? jiraMappings[customerName] ?? null : null

  const retryJiraFetch = () => {
    setJiraEpicsFailedAt(null)
    setJiraIssueLoadError(null)
    void loadJiraEpics()
    if (mappedEpicKey) {
      void loadJiraWorkItems(mappedEpicKey, true)
    }
  }

  const jiraEpicOptions = useMemo(() => {
    const seen = new Set<string>()
    const options: SelectOption[] = []
    for (const epic of jiraEpics) {
      if (!epic.key || seen.has(epic.key)) continue
      seen.add(epic.key)
      options.push({
        value: epic.key,
        label: `${epic.key} · ${epic.summary}`
      })
    }
    return options
  }, [jiraEpics])

  const jiraIssueOptions = useMemo(() => {
    const seen = new Set<string>()
    const options: SelectOption[] = []
    for (const issue of jiraIssues) {
      if (seen.has(issue.key)) continue
      seen.add(issue.key)
      options.push({
        value: issue.key,
        label: `${issue.key} · ${issue.summary} (${formatJiraHours(issue.timespent)})`
      })
    }
    return options
  }, [jiraIssues])

  const jiraModalIssueOptions = useMemo(() => {
    const seen = new Set<string>()
    const options: SelectOption[] = []
    for (const issue of jiraLogModalItems) {
      if (seen.has(issue.key)) continue
      seen.add(issue.key)
      options.push({
        value: issue.key,
        label: `${issue.key} · ${issue.summary} (${formatJiraHours(issue.timespent)})`
      })
    }
    return options
  }, [jiraLogModalItems])

  const jiraPeopleViewData = useMemo(() => {
    const map = new Map<string, JiraWorkItem[]>()
    for (const row of jiraBudgetRows) {
      for (const item of row.items) {
        const people = new Set<string>()
        if (item.assigneeName) people.add(item.assigneeName)
        for (const log of item.worklogs ?? []) {
          if (log.authorName) people.add(log.authorName)
        }
        for (const subtask of item.subtasks ?? []) {
          if (subtask.assigneeName) people.add(subtask.assigneeName)
          for (const log of subtask.worklogs ?? []) {
            if (log.authorName) people.add(log.authorName)
          }
        }
        if (!people.size) people.add('Unassigned')
        for (const person of people) {
          const list = map.get(person) ?? []
          list.push({ ...item, summary: `${row.customer} · ${item.summary}` })
          map.set(person, list)
        }
      }
    }
    return Array.from(map.entries())
      .map(([person, tasks]) => ({
        person,
        tasks: jiraBudgetSortByProgress ? sortByProgress(tasks) : tasks
      }))
      .sort((a, b) => a.person.localeCompare(b.person))
  }, [jiraBudgetRows, jiraBudgetSortByProgress])

  const jiraBudgetRowsForRender = useMemo(() => {
    if (!jiraBudgetSortByProgress) return jiraBudgetRows
    return [...jiraBudgetRows].sort((a, b) => {
      const aHasData = a.estimateSeconds > 0 || a.spentSeconds > 0
      const bHasData = b.estimateSeconds > 0 || b.spentSeconds > 0
      if (aHasData !== bHasData) return aHasData ? -1 : 1
      const aRatio = a.estimateSeconds > 0 ? a.spentSeconds / a.estimateSeconds : 0
      const bRatio = b.estimateSeconds > 0 ? b.spentSeconds / b.estimateSeconds : 0
      if (bRatio !== aRatio) return bRatio - aRatio
      if (b.spentSeconds !== a.spentSeconds) return b.spentSeconds - a.spentSeconds
      return a.customer.localeCompare(b.customer)
    })
  }, [jiraBudgetRows, jiraBudgetSortByProgress])

  const jiraPeopleOptions = useMemo(
    () => jiraPeopleViewData.map(entry => ({ value: entry.person, label: entry.person })),
    [jiraPeopleViewData]
  )

  const jiraBudgetSummary = useMemo(() => {
    const total = jiraBudgetRows.length
    let spentSeconds = 0
    let estimateSeconds = 0
    let overCount = 0
    for (const row of jiraBudgetRows) {
      spentSeconds += row.spentSeconds
      estimateSeconds += row.estimateSeconds
      if (row.ratio >= 1) overCount += 1
    }
    return { total, spentSeconds, estimateSeconds, overCount }
  }, [jiraBudgetRows])

  const jiraBudgetSummaryMeta = useMemo(() => {
    let nearCount = 0
    let noEstimateCount = 0
    let worstRatio = 0
    let worstCustomer: string | null = null
    for (const row of jiraBudgetRows) {
      if (row.estimateSeconds <= 0) {
        noEstimateCount += 1
        continue
      }
      if (row.ratio >= 0.8 && row.ratio < 1) nearCount += 1
      if (row.ratio > worstRatio) {
        worstRatio = row.ratio
        worstCustomer = row.customer
      }
    }
    const avgRatio =
      jiraBudgetSummary.estimateSeconds > 0
        ? jiraBudgetSummary.spentSeconds / jiraBudgetSummary.estimateSeconds
        : null
    return { nearCount, noEstimateCount, worstRatio, worstCustomer, avgRatio }
  }, [jiraBudgetRows, jiraBudgetSummary.estimateSeconds, jiraBudgetSummary.spentSeconds])

  const activeClientSparkline = useMemo(() => {
    if (!activeClientTrend.length) return null
    const width = 280
    const height = 64
    const padding = 6
    const counts = activeClientTrend.map(item => item.count)
    const min = Math.min(...counts)
    const max = Math.max(...counts)
    const range = max - min || 1
    const points = activeClientTrend.map((item, index) => {
      const x =
        activeClientTrend.length === 1
          ? width / 2
          : (index / (activeClientTrend.length - 1)) * (width - padding * 2) + padding
      const y =
        height - padding - ((item.count - min) / range) * (height - padding * 2)
      return {
        x,
        y,
        label: item.label,
        count: item.count
      }
    })
    const path = points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`)
      .join(' ')
    const areaPath = `${path} L${points[points.length - 1]?.x ?? 0},${height - padding} L${
      points[0]?.x ?? 0
    },${height - padding} Z`
    return { width, height, points, path, areaPath }
  }, [activeClientTrend])

  const hoursTrendMax = useMemo(() => {
    const max = Math.max(...hoursTrend.map(item => item.totalHours), 0)
    return max || 1
  }, [hoursTrend])

  const hoursTrendDelta = useMemo(() => {
    if (hoursTrend.length < 2) return null
    const current = hoursTrend[hoursTrend.length - 1]?.mtdHours ?? 0
    const prev = hoursTrend[hoursTrend.length - 2]?.mtdHours ?? 0
    const diff = current - prev
    const percent = prev > 0 ? (diff / prev) * 100 : current > 0 ? 100 : 0
    return { diff, percent, current, prev }
  }, [hoursTrend])

  const hoursSparkline = useMemo(() => {
    if (!hoursTrend.length) return null
    const width = 260
    const height = 56
    const padding = 4
    const max = hoursTrendMax
    const points = hoursTrend.map((item, index) => {
      const x =
        hoursTrend.length === 1 ? width / 2 : (index / (hoursTrend.length - 1)) * (width - padding * 2) + padding
      const y =
        height - padding - (item.totalHours / max) * (height - padding * 2)
      return {
        x,
        y,
        label: item.label,
        hours: item.totalHours
      }
    })
    const path = points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`)
      .join(' ')
    return { width, height, points, path }
  }, [hoursTrend, hoursTrendMax])

  const showHoursTooltip = (
    event: ReactMouseEvent<SVGCircleElement>,
    point: { label: string; hours: number }
  ) => {
    const rect = hoursSparklineRef.current?.getBoundingClientRect()
    if (!rect) return
    const value = Number.isFinite(point.hours) ? point.hours.toFixed(1) : '0.0'
    setHoursTooltip({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      label: point.label,
      value
    })
  }

  const hideHoursTooltip = () => {
    setHoursTooltip(null)
  }

  useEffect(() => {
    if (projectName && !projectOptions.some(option => option.value === projectName)) {
      setProjectName(null)
    }
  }, [projectName, projectOptions])

  useEffect(() => {
    if (!projectName && projectOptions.length === 1) {
      setProjectName(projectOptions[0].value)
    }
  }, [projectName, projectOptions])

  useEffect(() => {
    if (customerName && !customerOptions.some(option => option.value === customerName)) {
      setCustomerName(null)
    }
  }, [customerName, customerOptions])

  useEffect(() => {
    if (!customerName && customerOptions.length === 1 && !suppressCustomerAutoSelect) {
      setCustomerName(customerOptions[0].value)
    }
  }, [customerName, customerOptions, suppressCustomerAutoSelect])

  useEffect(() => {
    if (taskName && !taskOptions.some(option => option.value === taskName)) {
      setTaskName(null)
    }
  }, [taskName, taskOptions])

  useEffect(() => {
    if (!taskName && taskOptions.length === 1 && !suppressTaskAutoSelect) {
      setTaskName(taskOptions[0].value)
    }
  }, [taskName, taskOptions, suppressTaskAutoSelect])

  useEffect(() => {
    if (!autoSuggestEnabled) return
    if (smartDefaults.lastTaskId) return
    if (!allReportItems.length) return
    const byWeekday: Record<string, number> = {}
    const sorted = [...allReportItems].sort((a, b) => b.dateKey.localeCompare(a.dateKey))
    for (const item of sorted) {
      const weekday = dayjs(item.dateKey).day().toString()
      if (!byWeekday[weekday]) {
        byWeekday[weekday] = item.taskId
      }
    }
    setSmartDefaults({
      lastTaskByWeekday: byWeekday,
      lastTaskId: sorted[0]?.taskId ?? null
    })
  }, [autoSuggestEnabled, smartDefaults.lastTaskId, allReportItems])

  useEffect(() => {
    if (!projectName) {
      if (customerName) setCustomerName(null)
      if (taskName) setTaskName(null)
      setSuppressCustomerAutoSelect(false)
      setSuppressTaskAutoSelect(false)
    }
  }, [projectName, customerName, taskName])

  useEffect(() => {
    if (!customerName && taskName) {
      setTaskName(null)
    }
  }, [customerName, taskName])

  useEffect(() => {
    if (!window.hrs) {
      setBridgeError('App bridge failed to load. Please restart the app.')
      setCheckingSession(false)
      setPreferencesLoaded(true)
      setJiraStatusLoaded(true)
      return
    }
    void checkSession()
    void loadJiraStatus()
    void loadPreferences()
    void loadHrsCredentials()
    void loadJiraLoggedEntries()
  }, [])

  useEffect(() => {
    if (!autoLoginEnabled || !hasStoredPassword) return
    if (loggedIn || checkingSession) return
    if (!sessionError) return
    void checkSession()
  }, [autoLoginEnabled, hasStoredPassword, loggedIn, checkingSession, sessionError])

  useEffect(() => {
    if (!loggedIn) return
    loadReportsForMonth(reportMonth)
  }, [loggedIn, reportMonth])

  useEffect(() => {
    if (!loggedIn) return
    const intervalId = window.setInterval(async () => {
      const ok = await window.hrs.checkSession()
      if (!ok) {
        setSessionError('Session expired. Please login again.')
        setLoggedIn(false)
      }
    }, 15 * 60 * 1000)
    return () => window.clearInterval(intervalId)
  }, [loggedIn])

  useEffect(() => {
    if (!loggedIn || !monthlyReport) return
    const base = dayjs(reportMonth).startOf('month')
    const targets = Array.from({ length: 6 }, (_, index) =>
      base.subtract(index, 'month').toDate()
    )
    for (const target of targets) {
      const key = dayjs(target).format('YYYY-MM')
      if (reportsCacheRef.current.has(key) || reportsPrefetchRef.current.has(key)) continue
      reportsPrefetchRef.current.add(key)
      const range = getMonthRange(target)
      void window.hrs
        .getReports(range.start, range.end)
        .then(data => {
          reportsCacheRef.current.set(key, data as MonthlyReport)
        })
        .catch(() => {})
        .finally(() => {
          reportsPrefetchRef.current.delete(key)
        })
    }
  }, [loggedIn, reportMonth, monthlyReport])

  useEffect(() => {
    const key = dayjs().format('YYYY-MM')
    if (monthlyReport && dayjs(reportMonth).format('YYYY-MM') === key) {
      setCurrentMonthReport(monthlyReport)
      setCurrentMonthKey(key)
    }
  }, [monthlyReport, reportMonth])

  useEffect(() => {
    if (!loggedIn) return
    loadLogs()
  }, [loggedIn])

  useEffect(() => {
    if (!loggedIn || !logs.length) return
    void loadActiveClientTrend()
  }, [loggedIn, logs])

  useEffect(() => {
    if (!preferencesLoaded) return
    if (!jiraConfigured) return
    if (jiraEpics.length || jiraLoading) return
    if (jiraEpicsFailedAt && Date.now() - jiraEpicsFailedAt < JIRA_EPICS_RETRY_MS) return
    void loadJiraEpics()
  }, [
    preferencesLoaded,
    jiraConfigured,
    jiraEpics.length,
    jiraLoading,
    jiraEpicsFailedAt
  ])

  useEffect(() => {
    if (!jiraConfigured) {
      setJiraTimeConfig(null)
      return
    }
    let cancelled = false
    const loadConfig = async () => {
      try {
        const config = await window.hrs.getJiraTimeTrackingConfig()
        if (!cancelled) setJiraTimeConfig(config)
      } catch {
        // Keep fallback defaults in formatter.
      }
    }
    void loadConfig()
    return () => {
      cancelled = true
    }
  }, [jiraConfigured])

  useEffect(() => {
    if (!jiraConfigured || !mappedEpicKey) {
      setJiraIssues([])
      setJiraIssueKey(null)
      setJiraIssueLoadError(null)
      setJiraLoadingIssues(false)
      setLogToJira(false)
      return
    }
    if (logToJira) {
      setJiraIssueKey(null)
      setJiraIssues([])
      void loadJiraWorkItems(mappedEpicKey)
      return
    }
    setJiraLoadingIssues(false)
    setJiraIssueLoadError(null)
  }, [jiraConfigured, mappedEpicKey, logToJira])

  useEffect(() => {
    if (!logToJira) return
    if (!jiraIssueKey && jiraIssues.length) {
      setJiraIssueKey(jiraIssues[0].key)
    }
  }, [logToJira, jiraIssueKey, jiraIssues])

  useEffect(() => {
    if (!logToJira || !mappedEpicKey || jiraIssues.length) return
    const row = jiraBudgetRows.find(
      entry => entry.epicKey === mappedEpicKey && entry.items.length
    )
    if (!row) return
    jiraIssuesCacheRef.current.set(mappedEpicKey, row.items)
    setJiraIssues(row.items)
  }, [logToJira, mappedEpicKey, jiraIssues.length, jiraBudgetRows])

  useEffect(() => {
    if (!jiraConfigured) {
      setJiraBudgetRows([])
      setTimeBudgetError(null)
      setTimeBudgetLoading(false)
      return
    }
    if (!jiraPrefetchDone) {
      setJiraBudgetRows([])
      setTimeBudgetError(null)
      setTimeBudgetLoading(false)
      return
    }
    const autoMappings = Object.entries(jiraMappings)
      .filter(([, epicKey]) => Boolean(epicKey))
      .filter(([customer]) => displayedJiraCustomers.includes(customer))
    const manualMappings = Object.entries(jiraManualBudgets).filter(
      ([, epicKey]) => Boolean(epicKey)
    )
    const mappings = [...autoMappings, ...manualMappings]
    if (!mappings.length) {
      setJiraBudgetRows([])
      setTimeBudgetError(null)
      setTimeBudgetLoading(false)
      return
    }
    setTimeBudgetLoading(true)
    setTimeBudgetError(null)
    const rows = mappings
      .map(([customer, epicKey]) => ({
        customer,
        epicKey: epicKey as string,
        estimateSeconds: 0,
        spentSeconds: 0,
        ratio: 0,
        items: [],
        contributors: [],
        summaryPartial: false,
        detailsPartial: false,
        detailsLoaded: false,
        detailsLoading: false,
        detailsError: null
      }))
      .sort((a, b) => a.customer.localeCompare(b.customer))
    setJiraBudgetRows(rows)
    setTimeBudgetLoading(false)
  }, [jiraConfigured, jiraPrefetchDone, jiraMappings, jiraManualBudgets, displayedJiraCustomers])

  useEffect(() => {
    if (!jiraConfigured || !jiraBudgetRows.length) return
    let cancelled = false
    const now = Date.now()
    const pending = jiraBudgetRows
      .map(row => row.epicKey)
      .filter(epicKey => {
        if (jiraBudgetDetailsCacheRef.current.has(epicKey)) return false
        if (jiraBudgetPrefetchQueueRef.current.has(epicKey)) return false
        const failedAt = jiraBudgetDetailsFailureRef.current.get(epicKey)
        if (failedAt && now - failedAt < JIRA_PREFETCH_FAILURE_COOLDOWN_MS) return false
        return true
      })
    if (!pending.length) return
    ;(async () => {
      for (const epicKey of pending) {
        if (cancelled) return
        jiraBudgetPrefetchQueueRef.current.add(epicKey)
        try {
          // Load FULL details with worklogs immediately on startup
          await loadBudgetTasks(epicKey)
          jiraBudgetDetailsFailureRef.current.delete(epicKey)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          if (message.includes('timed out') || message.includes('JIRA_REQUEST_TIMEOUT')) {
            jiraBudgetDetailsFailureRef.current.set(epicKey, Date.now())
          }
        } finally {
          jiraBudgetPrefetchQueueRef.current.delete(epicKey)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [jiraConfigured, jiraBudgetRows])

  useEffect(() => {
    if (!jiraBudgetRows.length) return
    const cachedKeys: string[] = []
    for (const row of jiraBudgetRows) {
      if (row.detailsLoaded || row.detailsLoading) continue
      if (jiraBudgetDetailsCacheRef.current.has(row.epicKey)) {
        cachedKeys.push(row.epicKey)
      }
    }
    if (!cachedKeys.length) return
    for (const epicKey of cachedKeys) {
      const cached = jiraBudgetDetailsCacheRef.current.get(epicKey)
      if (cached) {
        applyDetailsToRow(epicKey, cached)
      }
    }
  }, [jiraBudgetRows])

  useEffect(() => {
    if (!jiraPrefetchDone || !jiraBudgetRows.length) return
    for (const row of jiraBudgetRows) {
      if (row.detailsLoaded || row.detailsLoading) continue
      const cached = jiraBudgetDetailsCacheRef.current.get(row.epicKey)
      if (cached) {
        applyDetailsToRow(row.epicKey, cached)
      } else {
        void loadBudgetTasks(row.epicKey)
      }
    }
  }, [jiraPrefetchDone, jiraBudgetRows])

  // Background fetch disabled - full data loads when user expands row
  // (Re-enable if needed for automatic loading)
  /*
  const backgroundFetchStartedRef = useRef(false)
  useEffect(() => {
    // ... background fetch code ...
  }, [jiraPrefetchDone, jiraBudgetRows])
  */

  useEffect(() => {
    if (!jiraConfigured || !jiraIssueKey) {
      setJiraWorklogs([])
      setJiraWorklogWarning(null)
      return
    }
    void loadJiraWorklogHistory(jiraIssueKey)
  }, [jiraConfigured, jiraIssueKey, logDate, comment])

  useEffect(() => {
    if (!preferencesLoaded) return
    void window.hrs.setPreferences({
      jiraActiveOnly,
      jiraReportedOnly,
      jiraSectionOpen,
      reminderEnabled,
      reminderLastDate,
      reminderLastMidday,
      reminderLastEnd,
      reminderStartHour,
      reminderMiddayHour,
      reminderEndHour,
      reminderIdleMinutes,
      reviewMode,
      filtersOpen,
      reportsOpen,
      logWorkOpen,
      autoLoginEnabled,
      autoSuggestEnabled,
      heatmapEnabled,
      exportFiltered,
      commentRules,
      jiraManualBudgets,
      jiraBudgetInHours,
      jiraBudgetSortByProgress,
      jiraBudgetTitle,
      jiraEpicAliases,
      jiraProjectStartDates,
      jiraProjectPeoplePercent,
      jiraProjectPositionSnapshots,
      meetingsBrowser,
      meetingsUsername,
      meetingsPassword,
      meetingsHeadless,
      meetingsCollapsed,
      meetingsCache,
      meetingClientMappings,
      smartDefaults
    })
  }, [
    jiraActiveOnly,
    jiraReportedOnly,
    jiraSectionOpen,
    reminderEnabled,
    reminderLastDate,
    reminderLastMidday,
    reminderLastEnd,
    reminderStartHour,
    reminderMiddayHour,
    reminderEndHour,
    reminderIdleMinutes,
    reviewMode,
    filtersOpen,
    reportsOpen,
    logWorkOpen,
    autoLoginEnabled,
    autoSuggestEnabled,
    heatmapEnabled,
    exportFiltered,
    commentRules,
    jiraManualBudgets,
    jiraBudgetInHours,
    jiraBudgetSortByProgress,
    jiraBudgetTitle,
    jiraEpicAliases,
    jiraProjectStartDates,
    jiraProjectPeoplePercent,
    jiraProjectPositionSnapshots,
    meetingsBrowser,
    meetingsUsername,
    meetingsPassword,
    meetingsHeadless,
    meetingsCollapsed,
    meetingsCache,
    meetingClientMappings,
    smartDefaults,
    preferencesLoaded
  ])

  useEffect(() => {
    if (!jiraBudgetRows.length) return
    const now = dayjs()
    const currentMonthKey = now.format('YYYY-MM')
    const computedAt = new Date().toISOString()

    function buildSnapshot(items: JiraWorkItem[], frozen: boolean): JiraProjectPositionSnapshot | null {
      const totals = getMonthToDateLogsByPerson(items, now)
      const entries = Array.from(totals.entries()).filter(([, seconds]) => seconds > 0)
      if (!entries.length) return null
      const totalSeconds = entries.reduce((sum, [, seconds]) => sum + seconds, 0)
      if (!totalSeconds) return null
      // Calculate expected hours based on work days in month so far
      const workDays = getWorkDaysInMonthUntilToday(now)
      const expectedHours = workDays * HOURS_PER_WORK_DAY
      const secondsByPerson: Record<string, number> = {}
      const percents: Record<string, number> = {}
      for (const [person, seconds] of entries) {
        secondsByPerson[person] = seconds
        // Position % = person's hours / expected full-time hours
        const hours = seconds / 3600
        percents[person] = expectedHours > 0
          ? Math.round((hours / expectedHours) * 100)
          : 0
      }
      return {
        monthKey: currentMonthKey,
        frozen,
        computedAt,
        totalSeconds,
        secondsByPerson,
        percents
      }
    }

    function sameSnapshot(a: JiraProjectPositionSnapshot | undefined, b: JiraProjectPositionSnapshot) {
      if (!a) return false
      if (a.monthKey !== b.monthKey) return false
      if (a.frozen !== b.frozen) return false
      if (a.totalSeconds !== b.totalSeconds) return false
      const aKeys = Object.keys(a.percents)
      const bKeys = Object.keys(b.percents)
      if (aKeys.length !== bKeys.length) return false
      for (const key of bKeys) {
        if (a.percents[key] !== b.percents[key]) return false
        if (a.secondsByPerson[key] !== b.secondsByPerson[key]) return false
      }
      return true
    }

    setJiraProjectPositionSnapshots(prev => {
      let next: Record<string, JiraProjectPositionSnapshot> | null = null

      for (const row of jiraBudgetRows) {
        if (!row.detailsLoaded || !row.items.length) continue
        const already = prev[row.epicKey]
        if (already?.frozen) continue

        const frozen = isEpicDone(row.items)
        const snapshot = buildSnapshot(row.items, frozen)
        if (!snapshot) continue

        if (sameSnapshot(already, snapshot)) continue
        if (!next) next = { ...prev }
        next[row.epicKey] = snapshot
      }

      return next ?? prev
    })
  }, [jiraBudgetRows])

  useEffect(() => {
    if (!preferencesLoaded) return
    const timeoutId = window.setTimeout(() => {
      const keys = Object.keys(reportWorkLogsByDate).sort((a, b) => b.localeCompare(a))
      const maxDays = 120
      const next: Record<string, StoredReportLogEntry[]> = {}
      for (const key of keys.slice(0, maxDays)) {
        const entries = reportWorkLogsByDate[key] ?? []
        if (!entries.length) continue
        next[key] = entries.map(entry => ({
          taskId: entry.taskId,
          from: entry.from,
          to: entry.to,
          hours_HHMM: entry.hours_HHMM,
          comment: entry.comment,
          reporting_from: entry.reporting_from,
          projectInstance: entry.projectInstance
        }))
      }
      void window.hrs.setPreferences({ reportWorkLogsCache: next })
    }, 1200)
    return () => window.clearTimeout(timeoutId)
  }, [preferencesLoaded, reportWorkLogsByDate])

  useEffect(() => {
    if (!loggedIn) {
      setLogs([])
      setMonthlyReport(null)
      setLogsLoaded(false)
      setReportsLoaded(false)
      setActiveClientTrendLoaded(false)
    }
  }, [loggedIn])

  useEffect(() => {
    if (monthlyReport) {
      setExportError(null)
    }
  }, [monthlyReport])

  useEffect(() => {
    if (!selectedReportDate) return
    if (!dayjs(selectedReportDate).isSame(reportMonth, 'month')) {
      setSelectedReportDate(reportMonth)
    }
  }, [reportMonth, selectedReportDate])

  const filteredLogs = useMemo(() => {
    const preferredTaskId = debouncedTaskName
      ? taskNameMap.get(debouncedTaskName)?.taskId ?? null
      : null
    return logs.filter(log => {
      if (debouncedProjectName && log.projectName !== debouncedProjectName) return false
      if (debouncedCustomerName && log.customerName !== debouncedCustomerName) return false
      if (debouncedTaskName && log.taskName !== debouncedTaskName) return false
      if (preferredTaskId && log.taskId !== preferredTaskId) return false
      return true
    })
  }, [logs, debouncedProjectName, debouncedCustomerName, debouncedTaskName, taskNameMap])

  const uniqueTaskIds = useMemo(() => {
    return Array.from(new Set(filteredLogs.map(log => log.taskId)))
  }, [filteredLogs])

  const taskIdForLog = uniqueTaskIds.length === 1 ? uniqueTaskIds[0] : null

  const selectedTask = taskIdForLog
    ? filteredLogs.find(log => log.taskId === taskIdForLog) ?? null
    : null

  const reportingFromOptions = useMemo(() => {
    const values = new Set<string>()
    if (monthlyReport) {
      for (const day of monthlyReport.days) {
        for (const report of day.reports) {
          if (report.reporting_from) values.add(report.reporting_from)
        }
      }
    }
    if (reportingFrom) values.add(reportingFrom)
    values.add('OFFICE')
    values.add('HOME')
    values.add('CLIENT')
    return Array.from(values).map(value => ({
      value,
      label: formatReportingFromLabel(value)
    }))
  }, [monthlyReport, reportingFrom])

  const meetingsSummary = useMemo(() => {
    const clientCounts = new Map<string, number>()
    let totalMinutes = 0
    for (const meeting of meetings) {
      const start = dayjs(meeting.startTime.replace(' ', 'T'))
      const end = dayjs(meeting.endTime.replace(' ', 'T'))
      if (start.isValid() && end.isValid()) {
        const diff = Math.max(0, end.diff(start, 'minute'))
        totalMinutes += diff
      }
      const client = resolveMeetingClient(meeting)
      if (client) {
        clientCounts.set(client, (clientCounts.get(client) ?? 0) + 1)
      }
    }
    const topClients = Array.from(clientCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([client, count]) => ({ client, count }))
    return {
      totalMeetings: meetings.length,
      totalMinutes,
      mappedClients: clientCounts.size,
      topClients
    }
  }, [meetings, meetingClientMappings])

  const meetingsSorted = useMemo(() => {
    const entries = meetings.map((meeting, index) => {
      const started = dayjs(meeting.startTime.replace(' ', 'T'))
      return {
        meeting,
        index,
        timestamp: started.isValid() ? started.valueOf() : 0
      }
    })
    entries.sort((a, b) => {
      if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp
      return a.index - b.index
    })
    return entries.map(entry => entry.meeting)
  }, [meetings])

  const meetingLoggedKeysFromHrs = useMemo(() => {
    const result: Record<string, boolean> = {}
    if (!meetings.length) return result

    const reportsToCheck: MonthlyReport[] = []
    if (monthlyReport) reportsToCheck.push(monthlyReport)
    if (currentMonthReport && currentMonthReport !== monthlyReport) {
      reportsToCheck.push(currentMonthReport)
    }

    const checkMeeting = (meeting: MeetingItem) => {
      const start = dayjs(meeting.startTime.replace(' ', 'T'))
      const end = dayjs(meeting.endTime.replace(' ', 'T'))
      if (!start.isValid() || !end.isValid()) return false

      const dateKey = start.format('YYYY-MM-DD')
      const from = start.format('HH:mm')
      const to = end.format('HH:mm')
      const duration = buildDurationFromTimes(from, to)
      const expectedHours = duration?.hoursHHMM ?? null
      const subject = normalizeText(meeting.subject || '')

      for (const report of reportsToCheck) {
        const day = report.days.find(entry => entry.date === dateKey)
        if (!day) continue
        for (const entry of day.reports) {
          const comment = normalizeText(entry.comment || '')
          const commentMatch =
            !subject || comment === subject || comment.includes(subject) || subject.includes(comment)
          if (!commentMatch) continue

          const range = extractTimeRangeFromRecord(entry as unknown as Record<string, unknown>)
          const rangeMatch = range ? range.from === from && range.to === to : false
          const hoursMatch = expectedHours ? entry.hours_HHMM === expectedHours : false
          if (rangeMatch || hoursMatch) return true
        }
      }
      return false
    }

    for (const meeting of meetings) {
      if (checkMeeting(meeting)) {
        result[getMeetingKey(meeting)] = true
      }
    }
    return result
  }, [meetings, monthlyReport, currentMonthReport])

  const taskMetaById = useMemo(() => {
    const map = new Map<number, WorkLog>()
    for (const log of logs) {
      if (!map.has(log.taskId)) map.set(log.taskId, log)
    }
    return map
  }, [logs])

  useEffect(() => {
    if (!loggedIn) return
    const computeWeekDelta = async () => {
      const now = dayjs()
      const weekStart = now.startOf('week')
      const weekEnd = now.endOf('week')
      const prevWeekStart = weekStart.subtract(1, 'week')
      const prevWeekEnd = weekEnd.subtract(1, 'week')
      const lastMonthWeekStart = weekStart.subtract(1, 'month')
      const lastMonthWeekEnd = weekEnd.subtract(1, 'month')

      const collectEntriesForRange = (report: MonthlyReport, start: dayjs.Dayjs, end: dayjs.Dayjs) => {
        const entries: Array<{ entry: WorkReportEntry; dateKey: string }> = []
        for (const day of report.days) {
          const date = dayjs(day.date)
          if (date.isBefore(start, 'day') || date.isAfter(end, 'day')) continue
          for (const entry of day.reports) {
            entries.push({ entry, dateKey: day.date })
          }
        }
        return entries
      }

      const getReportFor = async (date: dayjs.Dayjs) => {
        const range = getMonthRange(date.toDate())
        const data = await window.hrs.getReports(range.start, range.end)
        return data as MonthlyReport
      }

      const currentReport =
        monthlyReport && dayjs(reportMonth).isSame(now, 'month')
          ? monthlyReport
          : await getReportFor(now)
      const prevReport =
        dayjs(prevWeekStart).isSame(now, 'month')
          ? currentReport
          : await getReportFor(prevWeekStart)

      const currentMinutes = sumMinutesForRange(currentReport, weekStart, weekEnd)
      const prevMinutes = sumMinutesForRange(prevReport, prevWeekStart, prevWeekEnd)
      const lastMonthReport = await getReportFor(lastMonthWeekStart)
      const lastMonthMinutes = sumMinutesForRange(
        lastMonthReport,
        lastMonthWeekStart,
        lastMonthWeekEnd
      )
      const currentHours = Math.round((currentMinutes / 60) * 10) / 10
      const prevHours = Math.round((prevMinutes / 60) * 10) / 10
      const lastMonthHours = Math.round((lastMonthMinutes / 60) * 10) / 10
      setWeekHoursDelta(buildWeekDelta(currentHours, prevHours))
      setLastMonthWeekHours(lastMonthHours)

    }
    void computeWeekDelta()
  }, [loggedIn, monthlyReport, reportMonth])

  const duration = useMemo<Duration | null>(() => {
    return buildDurationFromTimes(fromTime, toTime)
  }, [fromTime, toTime])

  const logSameDuration = useMemo<Duration | null>(() => {
    return buildDurationFromTimes(logSameFrom, logSameTo)
  }, [logSameFrom, logSameTo])

  const reportsByDate = useMemo(() => {
    const map = new Map<string, { day: WorkReportDay; totalMinutes: number }>()
    if (!monthlyReport) return map
    for (const day of monthlyReport.days) {
      const totalMinutes = day.reports.reduce(
        (sum, report) => sum + parseHoursHHMMToMinutes(report.hours_HHMM),
        0
      )
      map.set(day.date, { day, totalMinutes })
    }
    return map
  }, [monthlyReport])

  const weekendDays = useMemo(
    () => parseWeekendDays(monthlyReport?.weekend ?? 'Fri-Sat'),
    [monthlyReport]
  )

  const handleFloatingLog = async () => {
    if (!taskIdForLog) {
      setLogError('Select a task to log work.')
      return
    }
    if (timerRunning) {
      setLogError('Stop the timer before logging.')
      return
    }
    if (!duration) {
      setLogError('Start and stop the timer to set a duration.')
      return
    }
    await submitLogWork(taskIdForLog, duration)
  }

  const maxDayMinutes = useMemo(() => {
    if (!reportsByDate.size) return 0
    const weekdayMinutes = Array.from(reportsByDate.entries())
      .filter(([dateKey]) => !weekendDays.includes(dayjs(dateKey).day() as DayOfWeek))
      .map(([, info]) => info.totalMinutes)
    if (!weekdayMinutes.length) return 0
    return Math.max(...weekdayMinutes)
  }, [reportsByDate, weekendDays])

  const suggestedTaskId = useMemo(() => {
    if (!autoSuggestEnabled) return null
    const weekdayKey = dayjs(logDate ?? new Date()).day().toString()
    const lastByWeekday = smartDefaults.lastTaskByWeekday?.[weekdayKey]
    if (lastByWeekday) return lastByWeekday
    if (smartDefaults.lastTaskId) return smartDefaults.lastTaskId
    if (!allReportItems.length) return null
    const recent = [...allReportItems].sort((a, b) => b.dateKey.localeCompare(a.dateKey))[0]
    return recent?.taskId ?? null
  }, [autoSuggestEnabled, logDate, smartDefaults, allReportItems])

  const suggestedTaskForProject = useMemo(() => {
    if (!autoSuggestEnabled || !projectName) return null
    const candidates = allReportItems.filter(item => {
      const meta = taskMetaById.get(item.taskId)
      return meta?.projectName === projectName
    })
    if (!candidates.length) return null
    const recent = candidates.sort((a, b) => b.dateKey.localeCompare(a.dateKey))[0]
    return recent?.taskId ?? null
  }, [autoSuggestEnabled, projectName, allReportItems, taskMetaById])

  useEffect(() => {
    if (!autoSuggestEnabled) return
    if (filtersTouchedRef.current) return
    if (projectName || customerName || taskName) return
    if (!suggestedTaskId) return
    const suggestion = logs.find(log => log.taskId === suggestedTaskId)
    if (!suggestion) return
    setProjectName(suggestion.projectName)
    setCustomerName(suggestion.customerName)
    setTaskName(suggestion.taskName)
  }, [autoSuggestEnabled, projectName, customerName, taskName, suggestedTaskId, logs])

  useEffect(() => {
    if (!autoSuggestEnabled) return
    if (filtersTouchedRef.current) return
    if (!projectName || customerName || taskName) return
    if (!suggestedTaskForProject) return
    const suggestion = logs.find(log => log.taskId === suggestedTaskForProject)
    if (!suggestion) return
    setCustomerName(suggestion.customerName)
    setTaskName(suggestion.taskName)
  }, [autoSuggestEnabled, projectName, customerName, taskName, suggestedTaskForProject, logs])

  const selectedReportKey = selectedReportDate
    ? dayjs(selectedReportDate).format('YYYY-MM-DD')
    : null

  useEffect(() => {
    if (!loggedIn || !reminderEnabled || !preferencesLoaded) return
    const markActivity = () => {
      lastInteractionRef.current = Date.now()
    }
    window.addEventListener('mousemove', markActivity)
    window.addEventListener('mousedown', markActivity)
    window.addEventListener('keydown', markActivity)
    window.addEventListener('touchstart', markActivity)

    const checkReminder = async () => {
      const now = dayjs()
      if (now.hour() < reminderStartHour) return
      const todayKey = now.format('YYYY-MM-DD')
      const isAfterMidday = now.hour() >= reminderMiddayHour
      const afterEndOfDay = now.hour() >= reminderEndHour
      const isWeekend = weekendDays.includes(now.day() as DayOfWeek)
      if (isWeekend) return

      const report =
        monthlyReport && dayjs(reportMonth).isSame(now, 'month')
          ? monthlyReport
          : await loadCurrentMonthReport()
      if (!report) return
      const today = report.days.find(day => day.date === todayKey)
      if (!today || today.isHoliday) return

      const totalMinutes = today.reports.reduce(
        (sum, reportItem) => sum + parseHoursHHMMToMinutes(reportItem.hours_HHMM),
        0
      )
      const baseTarget = today.minWorkLog ? today.minWorkLog * 60 : 9 * 60
      const targetMinutes = Math.max(0, baseTarget)
      if (!targetMinutes || totalMinutes >= targetMinutes) return

      const idleMinutes = (Date.now() - lastInteractionRef.current) / 60000
      if (!afterEndOfDay && !isAfterMidday && idleMinutes < reminderIdleMinutes) return

      const remainingLabel = formatMinutesToLabel(targetMinutes - totalMinutes)
      let title = 'Idle reminder'
      if (afterEndOfDay) title = 'End of day reminder'
      else if (isAfterMidday) title = 'Mid-day reminder'

      if (afterEndOfDay && reminderLastEnd === todayKey) return
      if (!afterEndOfDay && isAfterMidday && reminderLastMidday === todayKey) return
      if (!afterEndOfDay && !isAfterMidday && reminderLastDate === todayKey) return
      const body = remainingLabel
        ? `Missing ${remainingLabel} today.`
        : 'Missing hours for today.'
      if (window.hrs?.notify) {
        await window.hrs.notify({ title, body })
      }
      if (afterEndOfDay) {
        setReminderLastEnd(todayKey)
      } else if (isAfterMidday) {
        setReminderLastMidday(todayKey)
      } else {
        setReminderLastDate(todayKey)
      }
    }

    const intervalId = window.setInterval(() => {
      void checkReminder()
    }, 60000)

    void checkReminder()

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('mousemove', markActivity)
      window.removeEventListener('mousedown', markActivity)
      window.removeEventListener('keydown', markActivity)
      window.removeEventListener('touchstart', markActivity)
    }
  }, [
    loggedIn,
    reminderEnabled,
    reminderLastDate,
    reminderLastMidday,
    reminderLastEnd,
    preferencesLoaded,
    weekendDays,
    monthlyReport,
    reportMonth,
    currentMonthReport,
    currentMonthKey,
    reminderStartHour,
    reminderMiddayHour,
    reminderEndHour,
    reminderIdleMinutes
  ])

  const selectedReportInfo = selectedReportKey
    ? reportsByDate.get(selectedReportKey) ?? null
    : null

  const hasReportLogsForDate = selectedReportKey
    ? Object.prototype.hasOwnProperty.call(reportWorkLogsByDate, selectedReportKey)
    : false

  const reportWorkLogsPrefetchMonthRef = useRef<string | null>(null)
  const reportWorkLogsPrefetchInFlightRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (!selectedReportKey || hasReportLogsForDate) return
    let cancelled = false
    ;(async () => {
      try {
        const data = await withTimeout(
          window.hrs.getWorkLogs(selectedReportKey),
          BOOT_TIMEOUT_MS,
          'Loading work logs'
        )
        if (cancelled) return
        const entries = Array.isArray(data)
          ? data
              .map(item => normalizeReportLogEntry(item))
              .filter((item): item is ReportLogEntry => Boolean(item))
          : []
        setReportWorkLogsByDate(prev => ({ ...prev, [selectedReportKey]: entries }))
      } catch {
        if (cancelled) return
        setReportWorkLogsByDate(prev => ({ ...prev, [selectedReportKey]: [] }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedReportKey, hasReportLogsForDate])

  useEffect(() => {
    if (!loggedIn || !monthlyReport) return
    const monthKey = dayjs(reportMonth).format('YYYY-MM')
    if (reportWorkLogsPrefetchMonthRef.current !== monthKey) {
      reportWorkLogsPrefetchMonthRef.current = monthKey
      reportWorkLogsPrefetchInFlightRef.current.clear()
    }

    const queue = monthlyReport.days
      .filter(day => day.reports.length > 0)
      .map(day => day.date)
      .filter(dateKey => !Object.prototype.hasOwnProperty.call(reportWorkLogsByDate, dateKey))
      .filter(dateKey => !reportWorkLogsPrefetchInFlightRef.current.has(dateKey))

    if (!queue.length) return

    let cancelled = false
    const concurrency = 2
    const worker = async () => {
      while (!cancelled) {
        const next = queue.shift()
        if (!next) break
        reportWorkLogsPrefetchInFlightRef.current.add(next)
        try {
          const data = await withTimeout(
            window.hrs.getWorkLogs(next),
            BOOT_TIMEOUT_MS,
            'Loading work logs'
          )
          if (cancelled) break
          const entries = Array.isArray(data)
            ? data
                .map(item => normalizeReportLogEntry(item))
                .filter((item): item is ReportLogEntry => Boolean(item))
            : []
          setReportWorkLogsByDate(prev => ({ ...prev, [next]: entries }))
        } catch {
          if (cancelled) break
          // Mark as attempted to avoid retry loops for bad dates/sessions.
          setReportWorkLogsByDate(prev => ({ ...prev, [next]: prev[next] ?? [] }))
        } finally {
          reportWorkLogsPrefetchInFlightRef.current.delete(next)
        }
      }
    }

    const workers = Array.from({ length: Math.min(concurrency, queue.length) }).map(() => worker())
    void Promise.all(workers)

    return () => {
      cancelled = true
    }
  }, [loggedIn, monthlyReport, reportMonth, reportWorkLogsByDate])

  const reportTimeRanges = useMemo(() => {
    const ranges = new Map<string, { from: string; to: string }>()
    for (const [dateKey, info] of reportsByDate.entries()) {
      for (const report of info.day.reports) {
        const directRange = extractTimeRangeFromRecord(report as Record<string, unknown>)
        if (!directRange) continue
        for (const key of buildReportEntryKeys(report, dateKey)) {
          ranges.set(key, directRange)
        }
      }
    }
    for (const [dateKey, entries] of Object.entries(reportWorkLogsByDate)) {
      for (const entry of entries) {
        if (!entry.from || !entry.to) continue
        const hours =
          entry.hours_HHMM || buildDurationFromTimes(entry.from, entry.to)?.hoursHHMM || ''
        if (!hours) continue
        const keys = buildReportEntryKeys(
          {
            taskId: entry.taskId,
            hours_HHMM: hours,
            comment: entry.comment,
            reporting_from: entry.reporting_from,
            projectInstance: entry.projectInstance
          },
          dateKey
        )
        for (const key of keys) {
          ranges.set(key, { from: entry.from, to: entry.to })
        }
      }
    }
    return ranges
  }, [reportsByDate, reportWorkLogsByDate])

  const reportTimeRangesByIndex = useMemo(() => {
    const result = new Map<string, Map<number, { from: string; to: string }>>()
    if (!monthlyReport) return result

    const computeDetailHours = (entry: ReportLogEntry) => {
      if (entry.hours_HHMM) return entry.hours_HHMM
      if (entry.from && entry.to) return buildDurationFromTimes(entry.from, entry.to)?.hoursHHMM ?? ''
      return ''
    }

    const scoreMatch = (report: WorkReportEntry, detail: ReportLogEntry) => {
      if (report.taskId !== detail.taskId) return 0
      let score = 100
      const detailHours = computeDetailHours(detail)
      if (report.hours_HHMM && detailHours && report.hours_HHMM === detailHours) score += 50
      const reportComment = normalizeText(report.comment || '')
      const detailComment = normalizeText(detail.comment || '')
      if (reportComment && detailComment) {
        if (reportComment === detailComment) score += 25
        else if (detailComment.includes(reportComment) || reportComment.includes(detailComment)) score += 10
      }
      if (report.reporting_from && detail.reporting_from && report.reporting_from === detail.reporting_from) {
        score += 15
      }
      if (report.projectInstance && detail.projectInstance && report.projectInstance === detail.projectInstance) {
        score += 10
      }
      return score
    }

    for (const day of monthlyReport.days) {
      const dateKey = day.date
      const detailed = reportWorkLogsByDate[dateKey] ?? []
      const remaining = detailed
        .filter(entry => entry.from && entry.to)
        .map(entry => {
          const from = entry.from as string
          const to = entry.to as string
          const fromMinutes = parseTimeToMinutes(from)
          const toMinutes = parseTimeToMinutes(to)
          return {
            entry,
            from,
            to,
            fromMinutes,
            toMinutes
          }
        })
        .filter(item => item.fromMinutes !== null && item.toMinutes !== null && (item.toMinutes as number) > (item.fromMinutes as number))
        .sort((a, b) => (a.fromMinutes as number) - (b.fromMinutes as number))

      if (!remaining.length) continue
      const assigned = new Map<number, { from: string; to: string }>()

      for (let index = 0; index < day.reports.length; index += 1) {
        const report = day.reports[index]
        let bestIdx = -1
        let bestScore = 0
        for (let i = 0; i < remaining.length; i += 1) {
          const candidate = remaining[i]
          const score = scoreMatch(report, candidate.entry)
          if (score <= 0) continue
          if (score > bestScore) {
            bestScore = score
            bestIdx = i
          }
        }
        if (bestIdx >= 0) {
          const picked = remaining.splice(bestIdx, 1)[0]
          assigned.set(index, { from: picked.from, to: picked.to })
        }
      }

      if (assigned.size) {
        result.set(dateKey, assigned)
      }
    }

    return result
  }, [monthlyReport, reportWorkLogsByDate])

  const weekRadar = useMemo(() => {
    if (!monthlyReport) return []
    const baseDate = selectedReportDate ?? logDate ?? new Date()
    const start = dayjs(baseDate).startOf('week')
    return Array.from({ length: 7 }).map((_, index) => {
      const date = start.add(index, 'day')
      const key = date.format('YYYY-MM-DD')
      const info = reportsByDate.get(key)
      const totalMinutes = info?.totalMinutes ?? 0
      const isWeekend = weekendDays.includes(date.day() as DayOfWeek)
      const isHoliday = info?.day.isHoliday ?? false
      const baseTarget = info?.day.minWorkLog ? info.day.minWorkLog * 60 : 9 * 60
      const isFuture = date.isAfter(dayjs(), 'day')
      const targetMinutes = isWeekend || isHoliday || isFuture ? 0 : baseTarget
      const missingMinutes =
        targetMinutes > 0 ? Math.max(0, targetMinutes - totalMinutes) : 0
      const ratio = targetMinutes ? Math.min(totalMinutes / targetMinutes, 1) : 0
      return {
        key,
        label: date.format('dd').toUpperCase(),
        dateLabel: date.format('DD/MM'),
        totalMinutes,
        targetMinutes,
        missingMinutes,
        ratio,
        isWeekend
      }
    })
  }, [monthlyReport, reportsByDate, selectedReportDate, logDate, weekendDays])

  const weekRadarHasMissing = useMemo(() => {
    return weekRadar.some(day => day.targetMinutes > 0 && day.missingMinutes > 0)
  }, [weekRadar])

  const focusLogWorkForDate = (date: string) => {
    setLogDate(dayjs(date).toDate())
    setLogWorkOpen(true)
    window.requestAnimationFrame(() => {
      logWorkRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  useEffect(() => {
    const element = reportListRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const updateWidth = () => {
      setReportListWidth(element.clientWidth)
    }
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(element)
    return () => {
      observer.disconnect()
    }
  }, [reportListRef, selectedReportKey])

  useEffect(() => {
    if (!editingEntry) return
    if (!selectedReportKey || selectedReportKey !== editingEntry.dateKey) {
      setEditingEntry(null)
      setEditError(null)
    }
  }, [editingEntry, selectedReportKey])

  useEffect(() => {
    if (logSameOpen) return
    setLogSameEntry(null)
    setLogSameError(null)
  }, [logSameOpen])

  useEffect(() => {
    if (bulkEditOpen) return
    setBulkEditHours('')
    setBulkEditComment('')
    setBulkActionError(null)
  }, [bulkEditOpen])

  useEffect(() => {
    clearReportSelection()
  }, [selectedReportKey])

  useEffect(() => {
    if (!timerRunning || !timerStartedAt) return
    const updateElapsed = () => {
      setTimerElapsed(Math.floor((Date.now() - timerStartedAt.getTime()) / 1000))
    }
    updateElapsed()
    const interval = window.setInterval(updateElapsed, 1000)
    return () => window.clearInterval(interval)
  }, [timerRunning, timerStartedAt])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const isMeta = event.metaKey || event.ctrlKey
      if (!isMeta) return
      if (event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandOpen(true)
        return
      }
      if (event.key.toLowerCase() === 'j') {
        event.preventDefault()
        setJiraSectionOpen(prev => !prev)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        if (taskIdForLog && duration) {
          if (reviewMode) {
            openReview()
          } else {
            submitLogWork(taskIdForLog, duration)
          }
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [taskIdForLog, duration, reviewMode])

  const reportItems = selectedReportKey
    ? allReportItems.filter(item => item.dateKey === selectedReportKey)
    : []
  const searchActive = Boolean(searchQuery.trim().length || searchFilters.length)
  const todayKey = dayjs().format('YYYY-MM-DD')
  const filteredReportItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const items = searchActive ? allReportItems : reportItems
    return items.filter(item => {
      if (query) {
        const meta = taskMetaById.get(item.taskId)
        const haystack = [
          item.taskName,
          item.comment,
          meta?.projectName,
          meta?.customerName,
          item.dateKey
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(query)) return false
      }
      if (searchFilters.includes('jira')) {
        const entryKey = getReportEntryKey(item, item.dateKey)
        if (jiraLoggedEntries[entryKey]) return false
      }
      if (searchFilters.includes('today')) {
        if (item.dateKey !== todayKey) return false
      }
      if (searchFilters.includes('week')) {
        if (!dayjs(item.dateKey).isSame(dayjs(), 'week')) return false
      }
      if (searchFilters.includes('month')) {
        if (!dayjs(item.dateKey).isSame(dayjs(), 'month')) return false
      }
      return true
    })
  }, [
    searchQuery,
    searchFilters,
    searchActive,
    allReportItems,
    reportItems,
    taskMetaById,
    jiraLoggedEntries,
    todayKey
  ])

  type ReportDisplayRow =
    | {
        type: 'group'
        key: string
        projectLabel: string
        customerLabel: string
        totalMinutes: number
        items: ReportItem[]
      }
    | { type: 'item'; item: ReportItem }

  const reportDisplayRows = useMemo<ReportDisplayRow[]>(() => {
    if (searchActive) {
      return filteredReportItems.map(item => ({ type: 'item', item }))
    }

    const groups = new Map<
      string,
      { projectLabel: string; customerLabel: string; items: ReportItem[]; totalMinutes: number }
    >()

    for (const item of filteredReportItems) {
      const meta = taskMetaById.get(item.taskId)
      const projectLabel = meta?.projectName || item.projectInstance || 'Project'
      const customerLabel = meta?.customerName || 'Customer'
      const key = `${projectLabel}||${customerLabel}`
      const group = groups.get(key) ?? {
        projectLabel,
        customerLabel,
        items: [],
        totalMinutes: 0
      }
      group.items.push(item)
      group.totalMinutes += parseHoursHHMMToMinutes(item.hours_HHMM)
      groups.set(key, group)
    }

    const rows: ReportDisplayRow[] = []
    for (const [key, group] of groups.entries()) {
      if (group.items.length > 1) {
        rows.push({
          type: 'group',
          key,
          projectLabel: group.projectLabel,
          customerLabel: group.customerLabel,
          totalMinutes: group.totalMinutes,
          items: group.items
        })
      } else {
        rows.push({ type: 'item', item: group.items[0] })
      }
    }
    return rows
  }, [filteredReportItems, searchActive, taskMetaById])

  const hasReportGroups = useMemo(
    () => reportDisplayRows.some(row => row.type === 'group'),
    [reportDisplayRows]
  )

  const shouldVirtualizeReports = !hasReportGroups && filteredReportItems.length > 8
  const reportRowHeight = 150
  const reportListHeight = Math.min(filteredReportItems.length, 4) * reportRowHeight
  const reviewReady = useMemo(
    () => Object.values(reviewChecks).every(Boolean),
    [reviewChecks]
  )

  const commandActions = useMemo(
    () => [
      {
        id: 'refresh',
        label: 'Refresh data',
        keywords: 'refresh reload',
        run: () => loadLogs()
      },
      {
        id: 'toggle-theme',
        label: oledEnabled ? 'Switch to DARK' : 'Switch to OLED',
        keywords: 'theme oled dark',
        run: () => setOledEnabled(prev => !prev)
      },
      {
        id: 'toggle-jira',
        label: jiraSectionOpen ? 'Collapse Jira integration' : 'Expand Jira integration',
        keywords: 'jira mapping',
        run: () => setJiraSectionOpen(prev => !prev)
      },
      {
        id: 'toggle-reports',
        label: reportsOpen ? 'Collapse reports' : 'Expand reports',
        keywords: 'reports calendar',
        run: () => setReportsOpen(prev => !prev)
      },
      {
        id: 'toggle-log',
        label: logWorkOpen ? 'Collapse log work' : 'Expand log work',
        keywords: 'log work',
        run: () => setLogWorkOpen(prev => !prev)
      },
      {
        id: 'start-timer',
        label: timerRunning ? 'Stop timer' : 'Start timer',
        keywords: 'timer',
        run: () => (timerRunning ? stopTimer() : startTimer())
      },
      {
        id: 'log-work',
        label: 'Log work',
        keywords: 'submit log',
        run: () => {
          if (taskIdForLog && duration) {
            if (reviewMode) {
              openReview()
            } else {
              submitLogWork(taskIdForLog, duration)
            }
          }
        }
      },
      {
        id: 'export-xlsx',
        label: 'Export XLSX',
        keywords: 'export xlsx',
        run: () => handleExportXlsx()
      },
      {
        id: 'export-pdf',
        label: 'Export PDF',
        keywords: 'export pdf',
        run: () => handleExportPdf()
      }
    ],
    [
      oledEnabled,
      jiraSectionOpen,
      filtersOpen,
      reportsOpen,
      logWorkOpen,
      timerRunning,
      taskIdForLog,
      duration,
      reviewMode,
      exportFiltered
    ]
  )

  const filteredCommands = useMemo(() => {
    const query = commandQuery.trim().toLowerCase()
    if (!query) return commandActions
    return commandActions.filter(action => {
      const text = `${action.label} ${action.keywords}`.toLowerCase()
      return text.includes(query)
    })
  }, [commandActions, commandQuery])

  const renderReportItem = (
    report: ReportItem,
    index: number,
    options?: { inGroup?: boolean }
  ) => {
    const meta = taskMetaById.get(report.taskId)
    const projectLabel = meta?.projectName || report.projectInstance || 'Project'
    const customerLabel = meta?.customerName || 'Customer'
    const entryKey = getReportEntryKey(report, report.dateKey)
    const isJiraLogged = Boolean(jiraLoggedEntries[entryKey])
    const isSelected = Boolean(selectedReportEntries[entryKey])
    const commentLabel =
      report.comment && report.comment.trim().length ? report.comment.trim() : 'No comment'
    const timeRange =
      reportTimeRangesByIndex.get(report.dateKey)?.get(report.dayIndex) ??
      buildReportEntryKeys(report, report.dateKey)
        .map(key => reportTimeRanges.get(key))
        .find(Boolean) ??
      null
    const sizeClass = getReportSizeClass([
      projectLabel,
      customerLabel,
      report.taskName,
      commentLabel
    ])
    const isEditing =
      editingEntry?.dateKey === report.dateKey && editingEntry?.index === report.dayIndex
    return (
      <Box
        key={`${report.dateKey}-${report.taskId}-${report.dayIndex}`}
        className={`report-item ${sizeClass}${options?.inGroup ? ' in-group' : ''}${
          isEditing ? ' is-editing' : ''
        }${
          isSelected ? ' is-selected' : ''
        }`}
      >
        <Group justify="space-between" align="flex-start" className="report-top">
          <Stack gap={6} className="report-details">
            {searchActive && (
              <Group gap="xs" className="report-line">
                <Text size="xs" c="dimmed" className="report-label">
                  Date:
                </Text>
                <Text className="report-value">
                  {dayjs(report.dateKey).format('DD-MM-YYYY')}
                </Text>
              </Group>
            )}
            <Group gap="xs" className="report-line report-primary">
              <Text className="report-value report-project">{projectLabel}</Text>
              <Text className="report-separator">•</Text>
              <Text className="report-value report-task">{report.taskName}</Text>
            </Group>
            <Group gap="xs" className="report-line report-secondary">
              <Text size="xs" c="dimmed" className="report-label">
                Customer:
              </Text>
              <Text className="report-value">{customerLabel}</Text>
            </Group>
            <Group gap="xs" className="report-line report-secondary">
              <Text size="xs" c="dimmed" className="report-label">
                Comment:
              </Text>
              {isEditing ? (
                <Textarea
                  value={editComment}
                  onChange={event => setEditComment(event.currentTarget.value)}
                  autosize
                  minRows={2}
                  className="report-edit-comment"
                />
              ) : (
                <Text className="report-value report-comment">{commentLabel}</Text>
              )}
            </Group>
          </Stack>
          <Stack gap="xs" className="report-actions">
            <Group gap="xs" className="report-meta">
              <Checkbox
                checked={isSelected}
                onChange={event => toggleReportSelection(entryKey, event.currentTarget.checked)}
                aria-label="Select report"
                className="report-select"
              />
              {isEditing ? (
                <TextInput
                  value={editHours}
                  onChange={event => setEditHours(event.currentTarget.value)}
                  className="report-edit-hours"
                  placeholder="HH:MM"
                />
              ) : (
                <Badge variant="light" color="teal" className="report-hours-badge">
                  {report.hours_HHMM}
                </Badge>
              )}
            </Group>
            {timeRange && (
              <Badge variant="light" color="blue" className="report-time-badge">
                {timeRange.from} – {timeRange.to}
              </Badge>
            )}
            {isEditing ? (
              <Group gap="xs" className="report-edit-actions">
                <Button
                  size="xs"
                  variant="light"
                  loading={editLoading}
                  onClick={() => {
                    saveEditReport(report.dateKey, report.dayIndex)
                  }}
                >
                  Save
                </Button>
                <Button size="xs" variant="subtle" onClick={cancelEditReport}>
                  Cancel
                </Button>
              </Group>
            ) : (
              <>
                {isJiraLogged ? (
                  <Text size="xs" className="jira-log-status">
                    ✓ Logged to Jira
                  </Text>
                ) : (
                  <Button
                    size="xs"
                    variant="light"
                    className="jira-log-button"
                    loading={jiraLogLoadingKey === entryKey}
                    onClick={() => {
                      openJiraLogModal(report, report.dateKey, customerLabel)
                    }}
                  >
                    Log to Jira
                  </Button>
                )}
                <Group gap="xs" className="report-action-row">
                  <Button
                    size="xs"
                    variant="light"
                    onClick={() => {
                      startEditReport(report.dateKey, report.dayIndex, report)
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    color="red"
                    loading={deleteLoading}
                    onClick={() => {
                      if (window.confirm('Delete this log entry?')) {
                        deleteReportEntry(report.dateKey, report.dayIndex)
                      }
                    }}
                  >
                    Delete
                  </Button>
                </Group>
              </>
            )}
          </Stack>
        </Group>
      </Box>
    )
  }

  const renderReportRow = ({ index, style }: ListChildComponentProps) => {
    const report = filteredReportItems[index]
    if (!report) return null
    return (
      <div style={style} className="report-row">
        {renderReportItem(report, index)}
      </div>
    )
  }

  const clientHours = useMemo(() => {
    const taskIdToClient = new Map<number, string>()
    for (const log of logs) {
      taskIdToClient.set(log.taskId, log.customerName || log.projectName)
    }
    const totals = new Map<string, number>()
    for (const report of allReportItems) {
      const client =
        taskIdToClient.get(report.taskId) || report.projectInstance || report.taskName
      const minutes = parseHoursHHMMToMinutes(report.hours_HHMM)
      totals.set(client, (totals.get(client) ?? 0) + minutes)
    }
    return totals
  }, [logs, allReportItems])

  const totalHoursReported = useMemo(() => {
    if (!monthlyReport) return 0
    const value = Number(monthlyReport.totalHours)
    return Number.isFinite(value) ? value : 0
  }, [monthlyReport])

  const currentHoursMtd = useMemo(() => {
    if (!hoursTrend.length) return null
    const value = hoursTrend[hoursTrend.length - 1]?.mtdHours
    return Number.isFinite(value) ? value : null
  }, [hoursTrend])

  const uniqueClientsCount = clientHours.size

  const activeClientTrendDelta = useMemo(() => {
    if (!monthlyReport || !activeClientTrend.length) return null
    const current = uniqueClientsCount ?? 0
    const prev = activeClientTrend[activeClientTrend.length - 1]?.count ?? 0
    const diff = current - prev
    const percent = prev > 0 ? (diff / prev) * 100 : current > 0 ? 100 : 0
    return { diff, percent, current, prev }
  }, [activeClientTrend, uniqueClientsCount, monthlyReport])

  const topClients = useMemo(() => {
    const items = Array.from(clientHours.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([client, minutes]) => ({
        client,
        hours: Math.round((minutes / 60) * 10) / 10
      }))
    return items
  }, [clientHours])

  const topClientsGap = useMemo(() => {
    const missing = 5 - topClients.length
    if (missing <= 0) return 6
    return 6 + missing * 4
  }, [topClients.length])

  const exportMonthLabel = useMemo(() => dayjs(reportMonth).format('MMMM YYYY'), [reportMonth])
  const exportMonthKey = useMemo(() => dayjs(reportMonth).format('YYYY-MM'), [reportMonth])

  const exportItems = useMemo(() => {
    if (!exportFiltered) return allReportItems
    const query = searchQuery.trim().toLowerCase()
    return allReportItems.filter(item => {
      const meta = taskMetaById.get(item.taskId)
      if (projectName && meta?.projectName !== projectName) return false
      if (customerName && meta?.customerName !== customerName) return false
      if (taskName && meta?.taskName !== taskName) return false
      if (query) {
        const haystack = [
          item.taskName,
          item.comment,
          meta?.projectName,
          meta?.customerName,
          item.dateKey
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(query)) return false
      }
      if (searchFilters.includes('jira')) {
        const entryKey = getReportEntryKey(item, item.dateKey)
        if (jiraLoggedEntries[entryKey]) return false
      }
      if (searchFilters.includes('today')) {
        if (item.dateKey !== todayKey) return false
      }
      if (searchFilters.includes('week')) {
        if (!dayjs(item.dateKey).isSame(dayjs(), 'week')) return false
      }
      if (searchFilters.includes('month')) {
        if (!dayjs(item.dateKey).isSame(dayjs(), 'month')) return false
      }
      return true
    })
  }, [
    exportFiltered,
    allReportItems,
    projectName,
    customerName,
    taskName,
    searchQuery,
    searchFilters,
    taskMetaById,
    jiraLoggedEntries,
    todayKey
  ])

  const exportRows = useMemo<ExportRow[]>(() => {
    if (!monthlyReport) return []
    return exportItems.map(item => {
      const meta = taskMetaById.get(item.taskId)
      const project = meta?.projectName || item.projectInstance || 'Project'
      const customer = meta?.customerName || 'Customer'
      const entryKey = getReportEntryKey(item, item.dateKey)
      const jiraEntry = jiraLoggedEntries[entryKey]
      return {
        date: item.dateKey,
        project,
        customer,
        task: item.taskName,
        comment: item.comment || '',
        hours: item.hours_HHMM,
        reportingFrom: item.reporting_from || '',
        jiraLogged: jiraEntry ? 'Yes' : 'No',
        jiraIssue: jiraEntry?.issueKey ?? ''
      }
    })
  }, [monthlyReport, exportItems, taskMetaById, jiraLoggedEntries])

  const exportSummary = useMemo(() => {
    const synced = exportRows.filter(row => row.jiraLogged === 'Yes').length
    const pending = exportRows.length - synced
    return { synced, pending }
  }, [exportRows])

  function buildXlsxBase64(
    rows: ExportRow[],
    options: { includeCustomer: boolean; includeTotal: boolean }
  ) {
    const header = [
      'Date',
      'Project',
      ...(options.includeCustomer ? ['Customer'] : []),
      'Task',
      'Comment',
      'Hours',
      ...(options.includeTotal ? ['Total hours'] : []),
      'Reporting From',
      'Jira Logged',
      'Jira Issue'
    ]
    const body = rows.map(row => [
      row.date,
      row.project,
      ...(options.includeCustomer ? [row.customer] : []),
      row.task,
      row.comment,
      row.hours,
      ...(options.includeTotal ? [''] : []),
      row.reportingFrom,
      row.jiraLogged,
      row.jiraIssue
    ])
    if (options.includeTotal) {
      const totalMinutes = rows.reduce(
        (sum, row) => sum + parseHoursHHMMToMinutes(row.hours),
        0
      )
      const totalLabel = formatMinutesToLabel(totalMinutes) || '0h'
      const totalRow = Array(header.length).fill('')
      totalRow[0] = 'Total'
      totalRow[header.indexOf('Total hours')] = totalLabel
      body.push(totalRow)
    }
    const sheet = XLSX.utils.aoa_to_sheet([header, ...body])
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Report')
    return XLSX.write(book, { bookType: 'xlsx', type: 'base64' })
  }

  async function handleExportXlsx() {
    if (!exportRows.length) {
      setExportError('No monthly data available to export.')
      return
    }
    if (!window.hrs?.saveExport) {
      setExportError('Export is unavailable. Please restart the app.')
      return
    }
    setExportingCsv(true)
    setExportError(null)
    try {
      const base64 = buildXlsxBase64(exportRows, {
        includeCustomer: true,
        includeTotal: false
      })
      const savedPath = await window.hrs.saveExport({
        defaultPath: `hrs-${exportMonthKey}.xlsx`,
        content: base64,
        format: 'xlsx',
        encoding: 'base64'
      })
      if (savedPath) {
        const fileName = savedPath.split('/').pop() ?? savedPath
        if (window.hrs?.notify) {
          void window.hrs.notify({
            title: 'Export complete',
            body: `XLSX saved: ${fileName}`
          })
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setExportError(message)
    } finally {
      setExportingCsv(false)
    }
  }

  async function handleExportPdf() {
    if (!exportRows.length) {
      setExportError('No monthly data available to export.')
      return
    }
    if (!window.hrs?.exportPdf) {
      setExportError('Export is unavailable. Please restart the app.')
      return
    }
    setExportingPdf(true)
    setExportError(null)
    try {
      const rowsHtml = exportRows
        .map(row => {
          return `<tr>
            <td>${escapeHtml(row.date)}</td>
            <td>${escapeHtml(row.project)}</td>
            <td>${escapeHtml(row.customer)}</td>
            <td>${escapeHtml(row.task)}</td>
            <td>${escapeHtml(row.comment)}</td>
            <td>${escapeHtml(row.hours)}</td>
            <td>${escapeHtml(row.reportingFrom)}</td>
            <td>${escapeHtml(row.jiraLogged)}</td>
            <td>${escapeHtml(row.jiraIssue)}</td>
          </tr>`
        })
        .join('')
      const html = `<!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            <title>HRS Monthly Report</title>
            <style>
              body { font-family: "Avenir Next", "Futura", "Gill Sans", "Trebuchet MS", sans-serif; color: #162128; padding: 28px; }
              h1 { font-size: 20px; margin: 0 0 6px; }
              .meta { font-size: 12px; color: #4a5860; margin-bottom: 18px; }
              .summary { display: flex; gap: 16px; font-size: 12px; margin-bottom: 16px; }
              .summary span { padding: 6px 10px; border-radius: 999px; background: #eef3f6; }
              table { width: 100%; border-collapse: collapse; font-size: 11px; }
              th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #e2e6ea; vertical-align: top; }
              th { text-transform: uppercase; letter-spacing: 0.08em; font-size: 10px; color: #5b6a73; }
              tr:nth-child(even) td { background: #f7f9fb; }
            </style>
          </head>
          <body>
            <h1>HRS Monthly Report</h1>
            <div class="meta">Month: ${escapeHtml(exportMonthLabel)}</div>
            <div class="summary">
              <span>Total logs: ${exportRows.length}</span>
              <span>Jira synced: ${exportSummary.synced}</span>
              <span>Jira pending: ${exportSummary.pending}</span>
            </div>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Project</th>
                  <th>Customer</th>
                  <th>Task</th>
                  <th>Comment</th>
                  <th>Hours</th>
                  <th>Reporting From</th>
                  <th>Jira Logged</th>
                  <th>Jira Issue</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
            </table>
          </body>
        </html>`
      const savedPath = await window.hrs.exportPdf({
        defaultPath: `hrs-${exportMonthKey}.pdf`,
        html
      })
      if (savedPath) {
        const fileName = savedPath.split('/').pop() ?? savedPath
        if (window.hrs?.notify) {
          void window.hrs.notify({
            title: 'Export complete',
            body: `PDF saved: ${fileName}`
          })
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setExportError(message)
    } finally {
      setExportingPdf(false)
    }
  }

  async function handleExportClient(format: 'pdf' | 'xlsx') {
    if (!exportClient) {
      setExportError('Select a client to export.')
      return
    }
    if (!exportRows.length) {
      setExportError('No monthly data available to export.')
      return
    }
    const rows = exportRows.filter(row => row.customer === exportClient)
    if (!rows.length) {
      setExportError('No logs for the selected client.')
      return
    }
    if (format === 'xlsx') {
      if (!window.hrs?.saveExport) {
        setExportError('Export is unavailable. Please restart the app.')
        return
      }
      setExportingCsv(true)
      setExportError(null)
      try {
        const base64 = buildXlsxBase64(rows, {
          includeCustomer: false,
          includeTotal: true
        })
        const safeClient = exportClient.replace(/\s+/g, '-').toLowerCase()
        const savedPath = await window.hrs.saveExport({
          defaultPath: `hrs-${safeClient}-${exportMonthKey}.xlsx`,
          content: base64,
          format: 'xlsx',
          encoding: 'base64'
        })
        if (savedPath) {
          const fileName = savedPath.split('/').pop() ?? savedPath
          if (window.hrs?.notify) {
            void window.hrs.notify({
              title: 'Export complete',
              body: `XLSX saved: ${fileName}`
            })
          }
        }
        setExportClientOpen(false)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setExportError(message)
      } finally {
        setExportingCsv(false)
      }
      return
    }

    if (!window.hrs?.exportPdf) {
      setExportError('Export is unavailable. Please restart the app.')
      return
    }
    setExportingPdf(true)
    setExportError(null)
    try {
      const totalMinutes = rows.reduce(
        (sum, row) => sum + parseHoursHHMMToMinutes(row.hours),
        0
      )
      const totalLabel = formatMinutesToLabel(totalMinutes) || '0h'
      const rowsHtml = rows
        .map(row => {
          return `<tr>
            <td>${escapeHtml(row.date)}</td>
            <td>${escapeHtml(row.project)}</td>
            <td>${escapeHtml(row.task)}</td>
            <td>${escapeHtml(row.comment)}</td>
            <td>${escapeHtml(row.hours)}</td>
            <td></td>
            <td>${escapeHtml(row.reportingFrom)}</td>
            <td>${escapeHtml(row.jiraLogged)}</td>
            <td>${escapeHtml(row.jiraIssue)}</td>
          </tr>`
        })
        .join('')
      const html = `<!doctype html>
        <html>
          <head>
            <meta charset="utf-8" />
            <title>HRS Client Report</title>
            <style>
              body { font-family: "Avenir Next", "Futura", "Gill Sans", "Trebuchet MS", sans-serif; color: #162128; padding: 28px; }
              h1 { font-size: 20px; margin: 0 0 6px; }
              .meta { font-size: 12px; color: #4a5860; margin-bottom: 18px; }
              table { width: 100%; border-collapse: collapse; font-size: 11px; }
              th, td { text-align: left; padding: 8px 6px; border-bottom: 1px solid #e2e6ea; vertical-align: top; }
              th { text-transform: uppercase; letter-spacing: 0.08em; font-size: 10px; color: #5b6a73; }
              tr:nth-child(even) td { background: #f7f9fb; }
              tfoot td { font-weight: 700; background: #eef3f6; }
            </style>
          </head>
          <body>
            <h1>HRS Client Report</h1>
            <div class="meta">Client: ${escapeHtml(exportClient)} · Month: ${escapeHtml(exportMonthLabel)}</div>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Project</th>
                  <th>Task</th>
                  <th>Comment</th>
                  <th>Hours</th>
                  <th>Total hours</th>
                  <th>Reporting From</th>
                  <th>Jira Logged</th>
                  <th>Jira Issue</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml}
              </tbody>
              <tfoot>
                <tr>
                  <td colspan="5">Total</td>
                  <td>${escapeHtml(totalLabel)}</td>
                  <td colspan="3"></td>
                </tr>
              </tfoot>
            </table>
          </body>
        </html>`
      const safeClient = exportClient.replace(/\s+/g, '-').toLowerCase()
      const savedPath = await window.hrs.exportPdf({
        defaultPath: `hrs-${safeClient}-${exportMonthKey}.pdf`,
        html
      })
      if (savedPath) {
        const fileName = savedPath.split('/').pop() ?? savedPath
        if (window.hrs?.notify) {
          void window.hrs.notify({
            title: 'Export complete',
            body: `PDF saved: ${fileName}`
          })
        }
      }
      setExportClientOpen(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setExportError(message)
    } finally {
      setExportingPdf(false)
    }
  }

  if (isFloating) {
    return (
      <Box className="floating-shell">
        <Modal
          opened={floatingStartOpen}
          onClose={closeFloatingStart}
          title="Start timer"
          centered
          size="sm"
          classNames={{ content: 'floating-modal' }}
        >
          <Stack gap="sm">
            <Select
              label="Project"
              placeholder="Choose a project"
              data={projectOptions}
              value={projectName}
              onChange={value => setProjectName(value)}
              searchable
              comboboxProps={{
                withinPortal: true,
                floatingStrategy: 'fixed',
                position: 'bottom-start',
                offset: 6
              }}
            />
            <Select
              label="Customer"
              placeholder={projectName ? 'Choose a customer' : 'Select a project first'}
              data={customerOptions}
              value={customerName}
              onChange={value => setCustomerName(value)}
              searchable
              disabled={!projectName}
              comboboxProps={{
                withinPortal: true,
                floatingStrategy: 'fixed',
                position: 'bottom-start',
                offset: 6
              }}
            />
            <Select
              label="Task"
              placeholder={customerName ? 'Choose a task' : 'Select a customer first'}
              data={taskOptions}
              value={taskName}
              onChange={value => setTaskName(value)}
              searchable
              disabled={!customerName}
              comboboxProps={{
                withinPortal: true,
                floatingStrategy: 'fixed',
                position: 'bottom-start',
                offset: 6
              }}
            />
            <Switch
              checked={logToJira}
              onChange={event => {
                const next = event.currentTarget.checked
                setLogToJira(next)
                if (next && !jiraIssueKey && jiraIssueOptions.length) {
                  setJiraIssueKey(jiraIssueOptions[0].value)
                }
              }}
              label="Log to Jira"
            />
            {logToJira && (
              <>
                {jiraConfigured && mappedEpicKey ? (
                  <Select
                    label="Jira work item"
                    placeholder="Select Jira work item"
                    data={jiraIssueOptions}
                    value={jiraIssueKey}
                    onChange={value => setJiraIssueKey(value)}
                    searchable
                    comboboxProps={{
                      withinPortal: true,
                      floatingStrategy: 'fixed',
                      position: 'bottom-start',
                      offset: 6
                    }}
                  />
                ) : (
                  <Text size="xs" c="dimmed">
                    {jiraConfigured
                      ? 'Map this customer to a Jira epic first.'
                      : 'Connect Jira first.'}
                  </Text>
                )}
              </>
            )}
            {floatingStartError && (
              <Text size="xs" c="red">
                {floatingStartError}
              </Text>
            )}
            <Group justify="space-between" mt="xs">
              <Button variant="subtle" onClick={closeFloatingStart}>
                Cancel
              </Button>
              <Button onClick={confirmFloatingStart}>Start timer</Button>
            </Group>
          </Stack>
        </Modal>

        <Modal
          opened={floatingStopOpen}
          onClose={closeFloatingStop}
          title="Finish & log"
          centered
          size="sm"
          classNames={{ content: 'floating-modal' }}
        >
          <Stack gap="sm">
            <Textarea
              label="Comment"
              placeholder="Add a short, informative comment"
              value={comment}
              onChange={event => setComment(event.currentTarget.value)}
              autosize
              minRows={2}
              maxRows={4}
            />
            {floatingStopError && (
              <Text size="xs" c="red">
                {floatingStopError}
              </Text>
            )}
            <Group justify="space-between" mt="xs">
              <Button variant="subtle" onClick={closeFloatingStop}>
                Cancel
              </Button>
              <Button
                onClick={confirmFloatingStop}
                loading={logLoading}
                disabled={comment.trim().length < 3 || logLoading}
              >
                Log work
              </Button>
            </Group>
          </Stack>
        </Modal>

        <Card
          className={`floating-card${floatingCollapsed ? ' is-collapsed' : ''}`}
          radius="md"
          p={0}
        >
          <Group justify="space-between" align="center" wrap="nowrap" className="floating-timer-row">
            <Group gap="xs">
              <ActionIcon
                variant="light"
                className="floating-action-icon"
                aria-label="Start timer"
                onClick={openFloatingStart}
                disabled={!loggedIn || timerRunning}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polygon points="6 4 20 12 6 20 6 4" />
                </svg>
              </ActionIcon>
              <ActionIcon
                variant="light"
                className="floating-action-icon"
                aria-label="Stop timer"
                onClick={openFloatingStop}
                disabled={!loggedIn || !timerRunning}
              >
                <svg
                  viewBox="0 0 24 24"
                  width="16"
                  height="16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="6" y="6" width="12" height="12" rx="2" />
                </svg>
              </ActionIcon>
            </Group>
            <Text size="md" className="floating-timer-value">
              {timerRunning ? formatElapsed(timerElapsed) : '00:00:00'}
            </Text>
            <ActionIcon
              variant="subtle"
              className="floating-close"
              aria-label="Close floating timer"
              onClick={closeFloatingTimer}
            >
              <svg
                viewBox="0 0 24 24"
                width="14"
                height="14"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </ActionIcon>
          </Group>
        </Card>
      </Box>
    )
  }

  if (!appReady) {
    const epicLabelLookup = new Map(
      jiraEpics.map(epic => [epic.key, epic.summary ?? epic.key])
    )
    const prefetchEpicKeys = jiraPrefetchProgress
      ? Object.keys(jiraPrefetchEntries)
      : []
    return (
      <Box className="app-shell">
        <Container size="sm">
          <Card className="glass-card hero-card" radius="lg" p="xl">
            <Stack gap="sm" align="center">
              <Loader size="sm" />
              <Text size="sm" c="dimmed">
                {bootStatus}
              </Text>
              {prefetchEpicKeys.length > 0 && (
                <Stack gap={4} align="stretch" style={{ width: '100%' }}>
                  {prefetchEpicKeys.map(epicKey => {
                    const entry = jiraPrefetchEntries[epicKey]
                    const summary = epicLabelLookup.get(epicKey)
                    const label = summary ? `${epicKey} · ${summary}` : epicKey
                    const elapsed =
                      entry?.startedAt && entry.finishedAt
                        ? `${Math.max(0, Math.round((entry.finishedAt - entry.startedAt) / 1000))}s`
                        : entry?.startedAt
                          ? `${Math.max(0, Math.round((Date.now() - entry.startedAt) / 1000))}s`
                          : null
                    const statusLabel =
                      entry?.status === 'done'
                        ? `Loaded (${entry.tasks} tasks, ${entry.subtasks} subtasks)${
                            elapsed ? ` · ${elapsed}` : ''
                          }`
                        : entry?.status === 'loading'
                          ? `Loading${elapsed ? ` · ${elapsed}` : ''}…`
                          : entry?.status === 'error'
                            ? `Timed out${elapsed ? ` · ${elapsed}` : ''}`
                            : 'Queued'
                    return (
                      <Group key={epicKey} justify="space-between" wrap="nowrap">
                        <Text size="xs" c="dimmed">
                          {label}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {statusLabel}
                        </Text>
                      </Group>
                    )
                  })}
                </Stack>
              )}
              {duoPending && (
                <Alert className="duo-banner" color="cyan" variant="light" radius="md">
                  <Group gap="xs">
                    <Loader size="xs" />
                    <Text size="xs">Sent DUO to phone for approval.</Text>
                  </Group>
                </Alert>
              )}
              {sessionError && (
                <Text size="xs" c="red">
                  {sessionError}
                </Text>
              )}
              {jiraPrefetchError && (
                <Text size="xs" c="red">
                  {jiraPrefetchError}
                </Text>
              )}
            </Stack>
          </Card>
        </Container>
      </Box>
    )
  }

  if (!loggedIn) {
    return (
      <Box className="app-shell">
        <Container size="sm">
          <Card className="glass-card hero-card" radius="lg" p="xl">
            <Stack gap="lg">
              <div className="page-title-card">
                <Text className="page-title-text">HRS Desktop Ver 0.1</Text>
              </div>
              <Group justify="center" align="center">
                <div className="theme-toggle" role="group" aria-label="Theme">
                  <button
                    type="button"
                    className={`theme-toggle-option${!oledEnabled ? ' is-active' : ''}`}
                    aria-pressed={!oledEnabled}
                    onClick={() => setOledEnabled(false)}
                  >
                    DARK
                  </button>
                  <button
                    type="button"
                    className={`theme-toggle-option${oledEnabled ? ' is-active' : ''}`}
                    aria-pressed={oledEnabled}
                    onClick={() => setOledEnabled(true)}
                  >
                    OLED
                  </button>
                </div>
              </Group>
              <Text c="dimmed" mt="xs" ta="center">
                Connect once, then pick project, customer, and task to log hours quickly.
              </Text>
              {duoPending && (
                <Alert className="duo-banner" color="cyan" variant="light" radius="md">
                  <Group gap="xs">
                    <Loader size="xs" />
                    <Text size="sm">Sent DUO to phone for approval. Waiting…</Text>
                  </Group>
                </Alert>
              )}
              {bridgeError && (
                <Alert color="red" variant="light" radius="md">
                  {bridgeError}
                </Alert>
              )}
              {sessionError && (
                <Alert color="red" variant="light" radius="md">
                  {sessionError}
                </Alert>
              )}
              <Stack gap="xs">
                <Group justify="space-between" align="center">
                  <Switch
                    size="sm"
                    checked={autoLoginEnabled}
                    onChange={event => setAutoLoginEnabled(event.currentTarget.checked)}
                    label="Auto-login (optional)"
                  />
                  <Button
                    size="xs"
                    variant="subtle"
                    onClick={() => setCredentialsModalOpen(true)}
                  >
                    {storedUsername ? 'Update credentials' : 'Add credentials'}
                  </Button>
                </Group>
                {storedUsername && hasStoredPassword && (
                  <Text size="xs" c="dimmed">
                    Saved for {storedUsername}.
                  </Text>
                )}
              </Stack>
              <Group justify="space-between" align="center">
                <Button
                  size="md"
                  radius="md"
                  onClick={login}
                  className="cta-button"
                  loading={checkingSession}
                  disabled={checkingSession}
                >
                  Login to HRS
                </Button>
                {checkingSession && (
                  <Group gap="xs">
                    <Loader size="sm" />
                    <Text size="sm" c="dimmed">
                      Checking saved session…
                    </Text>
                  </Group>
                )}
              </Group>
            </Stack>
          </Card>
        </Container>
        <Modal
          opened={credentialsModalOpen}
          onClose={() => setCredentialsModalOpen(false)}
          title="Auto-login credentials"
          centered
        >
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              Stored in your Keychain and used only to auto-login when a session expires.
            </Text>
            <TextInput
              label="Username"
              value={credentialsUsername}
              onChange={event => setCredentialsUsername(event.currentTarget.value)}
            />
            <PasswordInput
              label="Password"
              value={credentialsPassword}
              onChange={event => setCredentialsPassword(event.currentTarget.value)}
            />
            <Group justify="space-between" align="center">
              <Button
                variant="subtle"
                color="red"
                onClick={() => {
                  void clearHrsCredentials()
                  setCredentialsModalOpen(false)
                }}
              >
                Clear saved
              </Button>
              <Button
                onClick={() => {
                  void saveHrsCredentials()
                  setCredentialsModalOpen(false)
                }}
                disabled={!credentialsUsername || !credentialsPassword}
              >
                Save
              </Button>
            </Group>
          </Stack>
        </Modal>
      </Box>
    )
  }

  return (
    <Box className="app-shell">
      <Container size="lg" className="app-container">
        <Stack gap="xl">
          <Stack gap="sm" className="page-header">
            <div className="page-title-card">
              <Text className="page-title-text">HRS Desktop Ver 0.1</Text>
            </div>
            <Group justify="space-between" align="center" wrap="wrap" className="page-toolbar">
              <Stack gap={6} className="connection-stack">
                <Badge color="teal" variant="light">
                  Connected to HRS
                </Badge>
                {jiraConfigured ? (
                  <Group gap="xs" align="center" className="connection-row">
                    <Badge color="teal" variant="light">
                      Connected to Jira
                    </Badge>
                    <Tooltip
                      label={jiraSectionOpen ? 'Collapse Jira integration' : 'Expand Jira integration'}
                      position="bottom"
                      withArrow
                    >
                      <ActionIcon
                        size="sm"
                        variant="light"
                        className="jira-gear"
                        onClick={() => setJiraSectionOpen(prev => !prev)}
                        aria-label="Toggle Jira integration"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="14"
                          height="14"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <circle cx="12" cy="12" r="3" />
                          <path d="M19.4 15a1.7 1.7 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.82-.33 1.7 1.7 0 0 0-1 1.51V22a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.51 1.7 1.7 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .33-1.82 1.7 1.7 0 0 0-1.51-1H2a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.51-1 1.7 1.7 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.82.33h.07A1.7 1.7 0 0 0 9 3.09V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.51 1.7 1.7 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.33 1.82v.07A1.7 1.7 0 0 0 20.91 11H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
                        </svg>
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip label="Disconnect" position="bottom" withArrow>
                      <ActionIcon
                        size="sm"
                        variant="light"
                        className="jira-disconnect"
                        onClick={clearJiraCredentials}
                        loading={jiraSaving}
                        aria-label="Disconnect from Jira"
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="14"
                          height="14"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                ) : (
                  <Button
                    size="xs"
                    variant="light"
                    onClick={() => setJiraConnectOpen(true)}
                  >
                    Login to Jira
                  </Button>
                )}
              </Stack>
              <Group align="center" className="page-toolbar-actions">
                <div className="theme-toggle theme-toggle-sm" role="group" aria-label="Theme">
                  <button
                    type="button"
                    className={`theme-toggle-option${!oledEnabled ? ' is-active' : ''}`}
                    aria-pressed={!oledEnabled}
                    onClick={() => setOledEnabled(false)}
                  >
                    DARK
                  </button>
                  <button
                    type="button"
                    className={`theme-toggle-option${oledEnabled ? ' is-active' : ''}`}
                    aria-pressed={oledEnabled}
                    onClick={() => setOledEnabled(true)}
                  >
                    OLED
                  </button>
                </div>
                <Tooltip
                  label={focusMode ? 'Exit focus mode' : 'Enter focus mode'}
                  position="bottom"
                  withArrow
                  transitionProps={{ transition: 'pop', duration: 160 }}
                >
                  <ActionIcon
                    className={`focus-action${focusMode ? ' is-active' : ''}`}
                    variant="light"
                    radius="md"
                    size="lg"
                    onClick={() => setFocusMode(prev => !prev)}
                    aria-label="Toggle focus mode"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="12" r="3" />
                      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7" />
                    </svg>
                  </ActionIcon>
                </Tooltip>
                <Tooltip
                  label="Open floating timer"
                  position="bottom"
                  withArrow
                  transitionProps={{ transition: 'pop', duration: 160 }}
                >
                  <ActionIcon
                    className="floating-action"
                    variant="light"
                    radius="md"
                    size="lg"
                    onClick={openFloatingTimer}
                    aria-label="Open floating timer"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="12" cy="13" r="8" />
                      <path d="M12 9v4l2 2" />
                      <path d="M9 2h6" />
                    </svg>
                  </ActionIcon>
                </Tooltip>
                <Tooltip
                  label="Refresh data"
                  position="bottom"
                  withArrow
                  transitionProps={{ transition: 'pop', duration: 160 }}
                >
                  <ActionIcon
                    className="refresh-action"
                    variant="light"
                    radius="md"
                    size="lg"
                    loading={loading}
                    onClick={loadLogs}
                    aria-label="Refresh data"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="18"
                      height="18"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                      <polyline points="21 3 21 9 15 9" />
                    </svg>
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>
          </Stack>

          {jiraConfigured && jiraSectionOpen && !focusMode && (
            <Card className="glass-card fade-in jira-card" radius="lg" p="xl">
              <Stack gap="md">
                <Group justify="space-between" align="center" wrap="wrap">
                  <Group gap="sm" align="center" wrap="wrap">
                    <Text className="section-title">Jira integration</Text>
                    {jiraConfigured && jiraStatus && (
                      <Text size="sm" c="dimmed" className="jira-connection">
                        {jiraStatus.email} · {jiraStatus.baseUrl} · {jiraStatus.projectName ?? jiraStatus.projectKey}
                      </Text>
                    )}
                  </Group>
                </Group>

                <Stack gap="md">
                  {jiraError && (
                    <Alert color="red" variant="light" radius="md">
                      <Group justify="space-between" align="center" wrap="wrap">
                        <Text size="sm">{jiraError}</Text>
                        <Button
                          size="xs"
                          variant="light"
                          onClick={retryJiraFetch}
                        >
                          Retry Jira
                        </Button>
                      </Group>
                    </Alert>
                  )}

                  {jiraConfigured && jiraStatus && (
                    <Group justify="space-between" align="center" wrap="wrap">
                      <Text size="sm" c="dimmed">
                        Epics loaded from {jiraStatus.projectName ?? jiraStatus.projectKey}.
                      </Text>
                    </Group>
                  )}

                  {jiraConfigured && (
                    <Stack gap="sm">
                      <Group justify="space-between" align="center" wrap="wrap">
                        <Text size="sm" c="dimmed">
                          Map HRS customers to Jira epics.
                        </Text>
                        <Group gap="sm">
                          <Switch
                            size="sm"
                            checked={jiraActiveOnly}
                            onChange={event => setJiraActiveOnly(event.currentTarget.checked)}
                            label="Active only"
                          />
                          <Switch
                            size="sm"
                            checked={jiraReportedOnly}
                            onChange={event => setJiraReportedOnly(event.currentTarget.checked)}
                            label="Reported hours (month)"
                          />
                        </Group>
                      </Group>

                      {jiraProjectOptions.length > 1 && (
                        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
                          <Select
                            label="Project"
                            placeholder="Select a project"
                            data={jiraProjectOptions}
                            value={jiraMappingProject}
                            onChange={value => setJiraMappingProject(value)}
                            searchable
                            clearable
                            nothingFoundMessage="No projects found"
                          />
                          <Select
                            label="Customer"
                            placeholder={
                              jiraMappingProject
                                ? 'Select a customer'
                                : 'Select a project first'
                            }
                            data={jiraProjectCustomerOptions}
                            value={jiraMappingCustomer}
                            onChange={value => setJiraMappingCustomer(value)}
                            searchable
                            clearable
                            nothingFoundMessage="No customers found"
                            disabled={!jiraMappingProject}
                          />
                        </SimpleGrid>
                      )}

                      {jiraMappingProject &&
                        jiraProjectCustomerOptions.length === 1 &&
                        jiraMappingCustomer && (
                          <Text size="xs" c="dimmed">
                            Only one customer found for this project.
                          </Text>
                        )}
                      {jiraLoading ? (
                        <Group gap="xs">
                          <Loader size="xs" />
                          <Text size="sm" c="dimmed">
                            Loading Jira epics...
                          </Text>
                        </Group>
                      ) : (
                        <Stack gap="sm">
                          {jiraMappingProject &&
                          jiraProjectCustomerOptions.length > 1 &&
                          !jiraMappingCustomer ? (
                            <Text size="sm" c="dimmed">
                              Select a customer to map for this project.
                            </Text>
                          ) : jiraMappingCustomers.length ? (
                            jiraMappingCustomers.map(customer => (
                              <Group
                                key={customer}
                                className="jira-mapping-row"
                                justify="space-between"
                                align="center"
                                wrap="wrap"
                              >
                                <Text size="sm" fw={600} className="jira-customer">
                                  {customer}
                                </Text>
                                <Select
                                  className="jira-epic-select"
                                  placeholder="Select epic"
                                  data={jiraEpicOptions}
                                  value={jiraMappings[customer] ?? null}
                                  onChange={value => updateJiraMapping(customer, value ?? null)}
                                  searchable
                                  clearable
                                  nothingFoundMessage="No epics found"
                                  disabled={!jiraEpicOptions.length}
                                />
                              </Group>
                            ))
                          ) : (
                            <Text size="sm" c="dimmed">
                              No customers to map with current filter.
                            </Text>
                          )}
                        </Stack>
                      )}
                    </Stack>
                  )}
                </Stack>
              </Stack>
            </Card>
          )}

          {bridgeError && (
            <Alert color="red" variant="light" radius="md">
              {bridgeError}
            </Alert>
          )}

          {error && (
            <Alert color="red" variant="light" radius="md">
              {error}
            </Alert>
          )}

          {!focusMode && weekRadarHasMissing && (
            <Card className="glass-card radar-card" radius="md">
              <Stack gap="xs">
                <Group justify="space-between" align="center">
                  <Text className="stat-label">Missing hours radar (week)</Text>
                  <Text size="xs" c="dimmed">
                    {weekRadar[0]?.dateLabel} – {weekRadar[weekRadar.length - 1]?.dateLabel}
                  </Text>
                </Group>
                <div className="week-radar">
                  {weekRadar.map(day => (
                    <div
                      key={day.key}
                      className={[
                        'week-radar-item',
                        day.missingMinutes > 0 ? 'is-missing' : '',
                        day.isWeekend ? 'is-weekend' : ''
                      ]
                        .join(' ')
                        .trim()}
                    >
                      <span className="week-radar-label">{day.label}</span>
                      <div className="week-radar-bar">
                        <span
                          className="week-radar-fill"
                          style={{ width: `${Math.round(day.ratio * 100)}%` }}
                        />
                      </div>
                      <span className="week-radar-value">
                        {day.targetMinutes === 0
                          ? '—'
                          : day.missingMinutes > 0
                            ? `Missing ${formatMinutesToLabel(day.missingMinutes)}`
                            : 'Done'}
                      </span>
                    </div>
                  ))}
                </div>
              </Stack>
            </Card>
          )}

	          {!focusMode && (
	            <Stack gap="sm">
	              <Group justify="space-between" align="center">
	                <Text className="section-title">HRS overview</Text>
	                <Button
	                  size="xs"
	                  variant="subtle"
	                  onClick={() => setKpiCollapsed(prev => !prev)}
	                >
                  {kpiCollapsed ? 'Expand' : 'Collapse'}
                </Button>
              </Group>
              {kpiCollapsed ? (
                <div className="kpi-mini-grid">
                  <div className="kpi-mini">
                    <span className="kpi-mini-label">Clients</span>
                    <span className="kpi-mini-value">{uniqueClientsCount || '—'}</span>
                    {activeClientTrendDelta && (
                      <span
                        className={`kpi-mini-delta ${
                          activeClientTrendDelta.diff > 0
                            ? 'is-up'
                            : activeClientTrendDelta.diff < 0
                              ? 'is-down'
                              : 'is-flat'
                        }`}
                      >
                        {activeClientTrendDelta.diff > 0 ? '+' : ''}
                        {Math.abs(activeClientTrendDelta.percent).toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <div className="kpi-mini">
                    <span className="kpi-mini-label">Hours</span>
                    <span className="kpi-mini-value">
                      {currentHoursMtd !== null
                        ? currentHoursMtd.toFixed(1)
                        : monthlyReport
                          ? totalHoursReported.toFixed(1)
                          : '—'}
                    </span>
                    {weekHoursDelta && (
                      <span
                        className={`kpi-mini-delta ${
                          weekHoursDelta.diff >= 0 ? 'is-up' : 'is-down'
                        }`}
                      >
                        {weekHoursDelta.diff >= 0 ? '+' : '-'}
                        {Math.abs(weekHoursDelta.percent).toFixed(1)}%
                      </span>
                    )}
                  </div>
                  <div className="kpi-mini">
                    <span className="kpi-mini-label">Top client</span>
                    <span className="kpi-mini-value">
                      {topClients[0]?.client ?? '—'}
                    </span>
                    <span className="kpi-mini-meta">
                      {topClients[0] ? `${topClients[0].hours}h` : ''}
                    </span>
                  </div>
                </div>
              ) : (
                <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg">
            <Card className="glass-card stat-card" radius="md">
              <Group justify="space-between" align="flex-start" wrap="wrap">
                <div>
                  <Text className="stat-label">Active clients (month)</Text>
                  <Text className="stat-value">{uniqueClientsCount || '—'}</Text>
                </div>
                {activeClientTrendDelta && (
                  <div
                    className={`trend-kpi ${
                      activeClientTrendDelta.diff > 0
                        ? 'is-up'
                        : activeClientTrendDelta.diff < 0
                          ? 'is-down'
                          : 'is-flat'
                    }`}
                  >
                    <span className="trend-arrow">
                      {activeClientTrendDelta.diff > 0
                        ? '▲'
                        : activeClientTrendDelta.diff < 0
                          ? '▼'
                          : '—'}
                    </span>
                    <span>
                      {activeClientTrendDelta.diff > 0 ? '+' : ''}
                      {Math.abs(activeClientTrendDelta.percent).toFixed(1)}%
                    </span>
                  </div>
                )}
              </Group>
              {activeClientTrendDelta && (
                <Text size="xs" c="dimmed" className="trend-caption">
                  vs last month: {activeClientTrendDelta.prev} → {activeClientTrendDelta.current}{' '}
                  clients
                </Text>
              )}
              {activeClientTrendLoading && (
                <Text size="xs" c="dimmed">
                  Loading monthly trend...
                </Text>
              )}
              {activeClientTrendError && (
                <Text size="xs" c="dimmed">
                  {activeClientTrendError}
                </Text>
              )}
              {activeClientSparkline && (
                <div className="active-sparkline">
                  <svg
                    viewBox={`0 0 ${activeClientSparkline.width} ${activeClientSparkline.height}`}
                    role="img"
                    aria-label="Active client trend"
                    preserveAspectRatio="none"
                  >
                    <defs>
                      <linearGradient id="activeSparklineFill" x1="0" x2="0" y1="0" y2="1">
                        <stop offset="0%" stopColor="rgba(73, 194, 208, 0.6)" />
                        <stop offset="100%" stopColor="rgba(73, 194, 208, 0.04)" />
                      </linearGradient>
                    </defs>
                    <path
                      className="active-sparkline-area"
                      d={activeClientSparkline.areaPath}
                    />
                    <path
                      className="active-sparkline-path"
                      d={activeClientSparkline.path}
                    />
                    {activeClientSparkline.points.map((point, index) => (
                      <circle
                        key={`active-point-${index}`}
                        cx={point.x}
                        cy={point.y}
                        r={index === activeClientSparkline.points.length - 1 ? 3.6 : 2.6}
                        className={`active-sparkline-point${
                          index === activeClientSparkline.points.length - 1 ? ' is-current' : ''
                        }`}
                      />
                    ))}
                  </svg>
                  <div className="active-sparkline-labels">
                    {activeClientTrend.map(item => (
                      <span key={item.monthKey}>{item.label}</span>
                    ))}
                  </div>
                </div>
              )}
            </Card>
            <Card className="glass-card stat-card" radius="md">
              <Group justify="space-between" align="flex-start" wrap="wrap">
                <div>
                  <Text className="stat-label">Total hours (month)</Text>
                  <Text className="stat-value">
                    {currentHoursMtd !== null
                      ? currentHoursMtd.toFixed(1)
                      : monthlyReport
                        ? totalHoursReported.toFixed(1)
                        : '—'}
                  </Text>
                </div>
                {hoursTrendDelta && (
                  <div className={`trend-kpi ${hoursTrendDelta.diff >= 0 ? 'is-up' : 'is-down'}`}>
                    <span className="trend-arrow">
                      {hoursTrendDelta.diff >= 0 ? '▲' : '▼'}
                    </span>
                    <span>{Math.abs(hoursTrendDelta.percent).toFixed(1)}%</span>
                  </div>
                )}
              </Group>
              {hoursSparkline && (
                <div className="hours-sparkline" ref={hoursSparklineRef}>
                  {hoursTooltip && (
                    <div
                      className="hours-tooltip"
                      style={{ left: hoursTooltip.x, top: hoursTooltip.y }}
                    >
                      <span className="hours-tooltip-label">{hoursTooltip.label}</span>
                      <span className="hours-tooltip-value">{hoursTooltip.value}h</span>
                    </div>
                  )}
                  <svg
                    viewBox={`0 0 ${hoursSparkline.width} ${hoursSparkline.height}`}
                    role="img"
                    aria-label="Monthly hours trend"
                    preserveAspectRatio="none"
                  >
                    <path className="hours-sparkline-path" d={hoursSparkline.path} />
                    {hoursSparkline.points.map((point, index) => {
                      return (
                        <circle
                          key={`hours-point-${index}`}
                          cx={point.x}
                          cy={point.y}
                          r={index === hoursSparkline.points.length - 1 ? 3.6 : 2.6}
                          className={`hours-sparkline-point${
                            index === hoursSparkline.points.length - 1 ? ' is-current' : ''
                          }`}
                          onMouseEnter={event => showHoursTooltip(event, point)}
                          onMouseMove={event => showHoursTooltip(event, point)}
                          onMouseLeave={hideHoursTooltip}
                        />
                      )
                    })}
                  </svg>
                </div>
              )}
              {weekHoursDelta && (
                <Stack gap={4}>
                  <Text size="xs" c="dimmed">
                    This week: {weekHoursDelta.current.toFixed(1)}h (
                    {weekHoursDelta.diff >= 0 ? '+' : '-'}
                    {Math.abs(weekHoursDelta.percent).toFixed(1)}%)
                  </Text>
                  {lastMonthWeekHours !== null && (
                    <Text size="xs" c="dimmed">
                      Last month (same week): {lastMonthWeekHours.toFixed(1)}h
                    </Text>
                  )}
                </Stack>
              )}
            </Card>
            <Card className="glass-card stat-card" radius="md">
              <Text className="stat-label">Top clients</Text>
              {topClients.length ? (
                <Stack gap={topClientsGap}>
                  {topClients.map(item => (
                    <Group key={item.client} justify="space-between">
                      <Text size="sm">{item.client}</Text>
                      <Badge variant="light" color="teal">
                        {item.hours}h
                      </Badge>
                    </Group>
                  ))}
                </Stack>
              ) : (
                <Text className="stat-value">—</Text>
              )}
            </Card>
            </SimpleGrid>
              )}
            </Stack>
          )}

	          {!focusMode && (
	            <Card
	              className={
	                jiraBudgetCollapsed
	                  ? 'budget-card budget-card--flat'
	                  : 'glass-card budget-card'
	              }
	              radius="md"
	            >
	              <Stack gap="sm">
	                <Group justify="space-between" align="center">
	                  <Text className="section-title">
	                    {jiraBudgetTitle.trim() || 'Jira project budgets'}
	                  </Text>
                  <Group gap="sm" align="center">
                    <Text size="xs" c="dimmed">
                      Spent vs estimate per mapped customer
                    </Text>
                    <Button
                      size="xs"
                      variant="subtle"
                      onClick={() => setJiraBudgetCollapsed(prev => !prev)}
                    >
                      {jiraBudgetCollapsed ? 'Expand' : 'Collapse'}
                    </Button>
                  </Group>
                </Group>
	                {jiraBudgetCollapsed ? (
	                  <div className="budget-collapsed">
	                    {!jiraConfigured ? (
	                      <Text size="sm" c="dimmed">
	                        Connect Jira to enable budget alerts.
	                      </Text>
	                    ) : (
		                      <div className="kpi-mini-grid">
		                        <div className="kpi-mini">
		                          <span className="kpi-mini-label">Projects</span>
		                          <span className="kpi-mini-value">
		                            {jiraBudgetSummary.total || '—'}
		                          </span>
		                          <span className="kpi-mini-meta">
		                            {jiraBudgetSummary.total
		                              ? `Over ${jiraBudgetSummary.overCount} · Near ${jiraBudgetSummaryMeta.nearCount} · No est ${jiraBudgetSummaryMeta.noEstimateCount}`
		                              : '—'}
		                          </span>
		                        </div>
		                        <div className="kpi-mini">
		                          <span className="kpi-mini-label">Spent</span>
		                          <span className="kpi-mini-value">
		                            {jiraBudgetSummary.total
		                              ? formatJiraBudgetValue(
		                                  jiraBudgetSummary.spentSeconds,
		                                  jiraBudgetInHours,
		                                  jiraTimeConfig
		                                )
		                              : '—'}
		                          </span>
		                          <span className="kpi-mini-meta">
		                            {jiraBudgetSummary.total && jiraBudgetSummary.estimateSeconds > 0
		                              ? `Est ${formatJiraBudgetValue(
		                                  jiraBudgetSummary.estimateSeconds,
		                                  jiraBudgetInHours,
		                                  jiraTimeConfig
		                                )} · ${Math.round(
		                                  (jiraBudgetSummaryMeta.avgRatio ?? 0) * 100
		                                )}%`
		                              : jiraBudgetSummary.total
		                                ? 'No estimate totals'
		                                : '—'}
		                          </span>
		                        </div>
		                        <div className="kpi-mini">
		                          <span className="kpi-mini-label">Over</span>
		                          <span className="kpi-mini-value">
		                            {jiraBudgetSummary.overCount || 0}
		                          </span>
		                          <span className="kpi-mini-meta">
		                            {jiraBudgetSummaryMeta.worstCustomer && jiraBudgetSummaryMeta.worstRatio > 0
		                              ? `At risk: ${jiraBudgetSummaryMeta.worstCustomer} · ${Math.round(
		                                  jiraBudgetSummaryMeta.worstRatio * 100
		                                )}%`
		                              : '—'}
		                          </span>
		                        </div>
		                      </div>
	                    )}
	                  </div>
                ) : (
                  <>
                    {!jiraConfigured && (
                      <Text size="sm" c="dimmed">
                        Connect Jira to enable budget alerts.
                      </Text>
                    )}
                    {jiraConfigured && (
                      <Group gap="xs">
                        <Switch
                          size="sm"
                          checked={jiraBudgetInHours}
                          onChange={event => setJiraBudgetInHours(event.currentTarget.checked)}
                          label="Show hours"
                        />
                        <Switch
                          size="sm"
                          checked={jiraBudgetSortByProgress}
                          onChange={event => setJiraBudgetSortByProgress(event.currentTarget.checked)}
                          label="Sort by progress"
                        />
                        <Switch
                          size="sm"
                          checked={jiraPeopleView}
                          onChange={event => setJiraPeopleView(event.currentTarget.checked)}
                          label="Group by person"
                        />
                      </Group>
                    )}
                    {jiraErrorSticky && (
                      <Alert
                        color="red"
                        variant="light"
                        radius="md"
                        withCloseButton
                        onClose={() => setJiraErrorSticky(null)}
                        title="Jira error"
                      >
                        <Text size="xs" c="dimmed">
                          {dayjs(jiraErrorSticky.at).format('DD/MM HH:mm')} · {jiraErrorSticky.message}
                        </Text>
                      </Alert>
                    )}
                    {timeBudgetError && (
                      <Text size="xs" c="dimmed">
                        {timeBudgetError}
                      </Text>
                    )}
                    {timeBudgetLoading && (
                      <Group gap="xs">
                        <Loader size="xs" />
                        <Text size="sm" c="dimmed">
                          Checking Jira estimates...
                        </Text>
                      </Group>
                    )}
                    {jiraConfigured && !timeBudgetLoading && !jiraBudgetRows.length && (
                      <Text size="sm" c="dimmed">
                        No mapped customers yet.
                      </Text>
                    )}
                    {jiraConfigured && (
                      <Stack gap={6} className="manual-budget">
                        <Text size="xs" c="dimmed">
                          Add manual customer (optional)
                        </Text>
                        <Group gap="sm" align="flex-end" wrap="wrap">
                          <TextInput
                            label="Customer"
                            placeholder="Customer name"
                            value={manualBudgetCustomer}
                            onChange={event => {
                              setManualBudgetCustomer(event.currentTarget.value)
                              if (manualBudgetError) setManualBudgetError(null)
                            }}
                          />
                          <Select
                            label="Jira epic"
                            placeholder="Select epic"
                            data={jiraEpicOptions}
                            value={manualBudgetEpicKey}
                            onChange={value => {
                              setManualBudgetEpicKey(value)
                              if (manualBudgetError) setManualBudgetError(null)
                            }}
                            searchable
                            clearable
                            disabled={!jiraEpicOptions.length || !jiraConfigured}
                            comboboxProps={{ withinPortal: true, position: 'bottom-start', zIndex: 3000 }}
                          />
                          <Button onClick={addManualBudget}>Add</Button>
                        </Group>
                        {manualBudgetError && (
                          <Text size="xs" c="red">
                            {manualBudgetError}
                          </Text>
                        )}
                        {!jiraEpicOptions.length && (
                          <Text size="xs" c="dimmed">
                            {jiraConfigured
                              ? 'Epics are still loading or unavailable.'
                              : 'Connect Jira to load epics.'}
                          </Text>
                        )}
                        {Object.keys(jiraManualBudgets).length > 0 && (
                          <Stack gap={4}>
                            {Object.entries(jiraManualBudgets).map(([customer, epicKey]) => (
                              <Group key={customer} gap="xs">
                                <Text size="xs" c="dimmed">
                                  {customer} · {epicKey}
                                </Text>
                                <Button
                                  size="xs"
                                  variant="subtle"
                                  color="red"
                                  onClick={() => removeManualBudget(customer)}
                                >
                                  Remove
                                </Button>
                              </Group>
                            ))}
                          </Stack>
                        )}
                      </Stack>
                    )}
                {jiraConfigured && jiraPeopleView && (
                  <Stack gap="xs">
                    <Group gap="sm" align="center">
                      <Button
                        size="xs"
                        variant="light"
                        onClick={loadPeopleViewData}
                        loading={jiraPeopleLoading}
                      >
                        Load tasks for people view
                      </Button>
                      <Select
                        placeholder="Filter by person"
                        data={jiraPeopleOptions}
                        value={jiraPeopleFilter}
                        onChange={setJiraPeopleFilter}
                        clearable
                        searchable
                        comboboxProps={{ withinPortal: true, position: 'bottom-start', zIndex: 3000 }}
                      />
                    </Group>
                    {!jiraPeopleViewData.length && (
                      <Text size="xs" c="dimmed">
                        Load tasks to see people view.
                      </Text>
                    )}
                    {jiraPeopleViewData
                      .filter(entry =>
                        jiraPeopleFilter ? entry.person === jiraPeopleFilter : true
                      )
                      .map(entry => (
                        <div key={entry.person} className="budget-row">
                          <Text size="sm" fw={600}>
                            {entry.person}
                          </Text>
                          <Text size="xs" c="dimmed">
                            {entry.tasks.length} tasks
                          </Text>
                          <Stack gap={6} mt={6}>
                            {entry.tasks.map(task => {
                              const ratio = task.estimateSeconds
                                ? task.timespent / task.estimateSeconds
                                : 0
                              return (
                                <div key={task.key} className="budget-task">
                                  <div className="budget-task-header">
                                    <div>
                                      <Text size="xs" fw={600}>
                                        {task.key} · {task.summary}
                                      </Text>
                                      <Text size="xs" c="dimmed">
                                        {task.estimateSeconds
                                          ? `${formatJiraBudgetValue(
                                              task.timespent,
                                              jiraBudgetInHours,
                                              jiraTimeConfig
                                            )} / ${formatJiraBudgetValue(
                                              task.estimateSeconds,
                                              jiraBudgetInHours,
                                              jiraTimeConfig
                                            )} (${Math.round(ratio * 100)}%)`
                                          : `${formatJiraBudgetValue(
                                              task.timespent,
                                              jiraBudgetInHours,
                                              jiraTimeConfig
                                            )} spent · No estimate`}
                                      </Text>
                                    </div>
                                  </div>
                                  <div className="budget-task-bar">
                                    <span
                                      className={`budget-progress-fill${
                                        ratio >= 1 ? ' is-over' : ratio >= 0.8 ? ' is-near' : ''
                                      }`}
                                      style={{ width: `${Math.min(ratio, 1) * 100}%` }}
                                    />
                                  </div>
                                </div>
                              )
                            })}
                          </Stack>
                        </div>
                      ))}
                  </Stack>
                )}
                {jiraBudgetRows.length > 0 && (
                  <Stack gap="sm">
                    {jiraBudgetRowsForRender.map(row => {
                      const totalsReady =
                        row.detailsLoaded || row.estimateSeconds > 0 || row.spentSeconds > 0
                      const ratio = totalsReady
                        ? row.estimateSeconds
                          ? row.ratio
                          : 0
                        : 0
                      const percent = totalsReady && row.estimateSeconds
                        ? Math.round(row.ratio * 100)
                        : null
                      const isExpanded = budgetExpandedCustomer === row.customer
                      const partialContrib =
                        row.detailsLoaded && row.items.some(item => hasPartialWorklogs(item))
                      
                      // Always show contributors - use assignment-based when not expanded
                      const contributorsToShow = row.detailsLoaded 
                        ? row.contributors 
                        : buildPositionFromAssignments(row.items)

                      // Calculate status class based on budget percentage
                      let statusClass = 'status-on-track'
                      let statusIcon = null
                      if (percent !== null) {
                        if (percent > 100) {
                          statusClass = 'status-over-budget'
                          statusIcon = <IconFlame size={16} />
                        } else if (percent >= 91) {
                          statusClass = 'status-at-risk'
                          statusIcon = <IconAlertTriangle size={16} />
                        } else if (percent >= 71) {
                          statusClass = 'status-watch'
                          statusIcon = <IconAlertTriangle size={16} />
                        } else {
                          statusClass = 'status-on-track'
                          statusIcon = <IconCheck size={16} />
                        }
                      } else if (row.estimateSeconds === 0) {
                        // No estimate - default to on-track appearance
                        statusClass = 'status-on-track'
                        statusIcon = <IconCheck size={16} />
                      }

                      // Check if project was created in the last 7 days
                      const subtaskCount = row.detailsLoaded 
                        ? row.items.reduce((count, item) => count + (item.subtasks?.length ?? 0), 0)
                        : 0
                      
                      const contributorSummary = contributorsToShow.length
                        ? `${formatContributorSummary(contributorsToShow)}${partialContrib ? ' · partial' : ''}`
                        : row.detailsLoading
                          ? 'Loading Jira tasks...'
                          : buildPositionFromAssignments(row.items).length > 0
                            ? formatContributorSummary(buildPositionFromAssignments(row.items))
                            : 'No assignments yet.'
                      const epicAlias = jiraEpicAliases[row.epicKey]
                      const displayName = epicAlias?.trim() || row.customer
	                      const isRenamingEpic = jiraEpicRenameKey === row.epicKey
	                      const projectStartDate = jiraProjectStartDates[row.epicKey] ?? null
	                      const weeklyLogs = row.detailsLoaded
	                        ? getWeeklyLogsByPerson(row.items)
	                        : new Map<string, number>()
	                      const positionSnapshot = jiraProjectPositionSnapshots[row.epicKey]
	                      const currentMonthKey = dayjs().format('YYYY-MM')
	                      const monthTotals = row.detailsLoaded
	                        ? getMonthToDateLogsByPerson(row.items)
	                        : new Map<string, number>()
	                      const monthTotalSeconds = Array.from(monthTotals.values()).reduce(
	                        (sum, seconds) => sum + seconds,
	                        0
	                      )
	                      // Fall back to assignment-based position when worklogs unavailable
	                      const assignmentContribs = row.detailsLoaded
	                        ? buildPositionFromAssignments(row.items)
	                        : []
	                      const useSnapshot =
	                        positionSnapshot &&
	                        (positionSnapshot.frozen || positionSnapshot.monthKey === currentMonthKey)
	                      const hoursPerDay = jiraTimeConfig?.hoursPerDay ?? 8
	                      // Work days from start of month until today (Sun-Thu, excluding Fri-Sat)
	                      const workDaysThisMonth = getWorkDaysInMonthUntilToday()
	                      // Expected hours = work days × 10h/day (50h/week)
	                      const expectedHoursThisMonth = workDaysThisMonth * HOURS_PER_WORK_DAY
	                      // Position % = person's hours / expected hours × 100
	                      // This shows what % of full-time this person is dedicating to this project
	                      const monthEntries = useSnapshot
	                        ? Object.entries(positionSnapshot.secondsByPerson)
	                            .filter(([, seconds]) => seconds > 0)
	                            .map(([person, seconds]) => ({
	                              person,
	                              seconds,
	                              percent: positionSnapshot.percents[person] ?? 0
	                            }))
	                            .sort((a, b) => b.seconds - a.seconds)
	                        : monthTotalSeconds > 0
	                          ? Array.from(monthTotals.entries())
	                              .filter(([, seconds]) => seconds > 0)
	                              .map(([person, seconds]) => {
	                                const hours = seconds / 3600
	                                const percent = expectedHoursThisMonth > 0
	                                  ? Math.round((hours / expectedHoursThisMonth) * 100)
	                                  : 0
	                                return { person, seconds, percent }
	                              })
	                              .sort((a, b) => b.seconds - a.seconds)
	                          : assignmentContribs.map(c => {
	                              const hours = c.seconds / 3600
	                              const percent = expectedHoursThisMonth > 0
	                                ? Math.round((hours / expectedHoursThisMonth) * 100)
	                                : 0
	                              return { person: c.name, seconds: c.seconds, percent }
	                            })
	                      const positionPercents = Object.fromEntries(
	                        monthEntries.map(entry => [entry.person, entry.percent])
	                      ) as Record<string, number>
	                      return (
                        <div key={row.customer} className={`budget-row ${statusClass}`}>
                          <div
                            role="button"
                            tabIndex={0}
                            className={`budget-row-header ${statusClass}`}
                            onClick={() => {
                              const nextExpanded = isExpanded ? null : row.customer
                              setBudgetExpandedCustomer(nextExpanded)
                              // Always load full details when expanding (will use cache if data is complete)
                              if (!isExpanded) {
                                void loadBudgetTasks(row.epicKey)
                              }
                            }}
                            onKeyDown={event => {
                              if (event.key !== 'Enter' && event.key !== ' ') return
                              event.preventDefault()
                              const nextExpanded = isExpanded ? null : row.customer
                              setBudgetExpandedCustomer(nextExpanded)
                              // Always load full details when expanding (will use cache if data is complete)
                              if (!isExpanded) {
                                void loadBudgetTasks(row.epicKey)
                              }
                            }}
                          >
                            <div>
                              <Group gap="xs" align="center">
                                {statusIcon && (
                                  <ThemeIcon
                                    size="sm"
                                    radius="xl"
                                    color={
                                      statusClass === 'status-over-budget' ? 'red' :
                                      statusClass === 'status-at-risk' ? 'orange' :
                                      statusClass === 'status-watch' ? 'yellow' :
                                      'green'
                                    }
                                    variant="light"
                                  >
                                    {statusIcon}
                                  </ThemeIcon>
                                )}
                                {isRenamingEpic ? (
                                  <div
                                    onClick={event => event.stopPropagation()}
                                    onMouseDown={event => event.stopPropagation()}
                                  >
                                    <TextInput
                                      size="xs"
                                      value={jiraEpicRenameValue}
                                      onChange={event => setJiraEpicRenameValue(event.currentTarget.value)}
                                      onKeyDown={event => {
                                        if (event.key === 'Escape') {
                                          event.preventDefault()
                                          setJiraEpicRenameKey(null)
                                          setJiraEpicRenameValue('')
                                          return
                                        }
                                        if (event.key === 'Enter') {
                                          event.preventDefault()
                                          const trimmed = jiraEpicRenameValue.trim()
                                          setJiraEpicAliases(prev => {
                                            const next = { ...prev }
                                            if (trimmed) {
                                              next[row.epicKey] = trimmed
                                            } else {
                                              delete next[row.epicKey]
                                            }
                                            return next
                                          })
                                          setJiraEpicRenameKey(null)
                                          setJiraEpicRenameValue('')
                                        }
                                      }}
                                      onBlur={() => {
                                        if (jiraEpicRenameKey !== row.epicKey) return
                                        const trimmed = jiraEpicRenameValue.trim()
                                        setJiraEpicAliases(prev => {
                                          const next = { ...prev }
                                          if (trimmed) {
                                            next[row.epicKey] = trimmed
                                          } else {
                                            delete next[row.epicKey]
                                          }
                                          return next
                                        })
                                        setJiraEpicRenameKey(null)
                                        setJiraEpicRenameValue('')
                                      }}
                                    />
                                  </div>
                                ) : (
                                  <>
                                    <Text className="project-name">
                                      {displayName}
                                    </Text>
                                    {subtaskCount > 0 && (
                                      <Badge size="sm" variant="light" color="gray">
                                        {subtaskCount} subtask{subtaskCount > 1 ? 's' : ''}
                                      </Badge>
                                    )}
                                  </>
                                )}
                                <ActionIcon
                                  size="xs"
                                  variant="subtle"
                                  component="span"
                                  onClick={event => {
                                    event.stopPropagation()
                                    if (isRenamingEpic) {
                                      const trimmed = jiraEpicRenameValue.trim()
                                      setJiraEpicAliases(prev => {
                                        const next = { ...prev }
                                        if (trimmed) {
                                          next[row.epicKey] = trimmed
                                        } else {
                                          delete next[row.epicKey]
                                        }
                                        return next
                                      })
                                      setJiraEpicRenameKey(null)
                                      setJiraEpicRenameValue('')
                                      return
                                    }
                                    setJiraEpicRenameKey(row.epicKey)
                                    setJiraEpicRenameValue(epicAlias ?? displayName)
                                  }}
                                  aria-label="Rename epic"
                                >
                                  {isRenamingEpic ? (
                                    <svg
                                      viewBox="0 0 24 24"
                                      width="12"
                                      height="12"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    >
                                      <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                  ) : (
                                    <svg
                                      viewBox="0 0 24 24"
                                      width="12"
                                      height="12"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    >
                                      <path d="M12 20h9" />
                                      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                                    </svg>
                                  )}
                                </ActionIcon>
                              </Group>
                              {epicAlias && (
                                <Text size="xs" c="dimmed" className="project-meta">
                                  {row.customer} · {row.epicKey}
                                </Text>
                              )}
                              <Group gap={4} align="center">
                                <IconClock size={14} opacity={0.5} />
                                <Text size="xs" c="dimmed" className="project-meta hours-mono">
                                  {totalsReady
                                    ? row.estimateSeconds
                                      ? `${formatJiraBudgetValue(
                                          row.spentSeconds,
                                          jiraBudgetInHours,
                                          jiraTimeConfig
                                        )} / ${formatJiraBudgetValue(
                                          row.estimateSeconds,
                                          jiraBudgetInHours,
                                          jiraTimeConfig
                                        )} (${percent}%)`
                                      : `${formatJiraBudgetValue(
                                          row.spentSeconds,
                                          jiraBudgetInHours,
                                          jiraTimeConfig
                                        )} spent · No estimate`
                                    : 'Totals calculate on expand.'}
                                  {row.summaryPartial ? ' · partial' : ''}
                                </Text>
                              </Group>
                              <Group gap={4} align="center">
                                <IconUser size={14} opacity={0.5} />
                                <Text size="xs" c="dimmed" className="project-meta">
                                  {contributorSummary}
                                </Text>
                              </Group>
                            </div>
                            {row.estimateSeconds > 0 && (
                              <Badge
                                color={ratio >= 1 ? 'red' : ratio >= 0.8 ? 'orange' : 'gray'}
                                variant="light"
                              >
                                {ratio >= 1 ? 'Over' : ratio >= 0.8 ? 'Near' : 'On track'}
                              </Badge>
                            )}
                            <span className={`budget-toggle${isExpanded ? ' is-open' : ''}`}>
                              ▾
                            </span>
                          </div>
                          {totalsReady && (
                            <div className="budget-progress">
                              <span
                                className={`budget-progress-fill${
                                  ratio > 1 
                                    ? ' is-over-budget' 
                                    : ratio >= 0.91 
                                      ? ' is-at-risk' 
                                      : ratio >= 0.71 
                                        ? ' is-watch' 
                                        : ' is-on-track'
                                }`}
                                style={{ width: `${Math.min(ratio, 1) * 100}%` }}
                              />
                            </div>
                          )}
                          {isExpanded && (
                            <div className="budget-tasks">
                              <Group gap="xs">
                                <Button
                                  size="xs"
                                  variant="subtle"
                                  onClick={() => openEpicDebug(row.epicKey)}
                                >
                                  Debug totals
                                </Button>
                              </Group>
	                              {row.detailsLoaded && (
	                                <Stack gap="xs" className="budget-planning">
	                                  <Text size="xs" c="dimmed">
	                                    Project planning
	                                  </Text>
                                  <Group gap="sm" align="flex-end" wrap="wrap">
                                    <DatePickerInput
                                      label="Project start date"
                                      placeholder="Select date"
                                      value={projectStartDate ? dayjs(projectStartDate).toDate() : null}
                                      onChange={value => setProjectStartDate(row.epicKey, value)}
                                      size="xs"
                                      clearable
                                    />
                                  </Group>
	                                  {monthEntries.length ? (
	                                    <Stack gap={4}>
	                                      <Text size="xs" c="dimmed">
	                                        Position % (hours / {expectedHoursThisMonth}h expected){' '}
	                                        {useSnapshot && positionSnapshot?.frozen ? '· frozen' : ''}
	                                      </Text>
	                                      {monthEntries.map(entry => {
	                                        const weeklyLoggedSeconds =
	                                          weeklyLogs.get(entry.person) ?? 0
	                                        const weeklyLoggedHours =
	                                          weeklyLoggedSeconds / 3600
	                                        const hoursLogged = entry.seconds / 3600
	                                        const isMonthlyData = monthTotalSeconds > 0 || useSnapshot
	                                        // Avg days/week = position% × 5 work days
	                                        const avgDaysPerWeek = (entry.percent / 100) * 5
	                                        return (
	                                          <Group key={entry.person} gap="sm" align="center">
	                                            <Text size="xs" fw={600}>
	                                              {entry.person}
	                                            </Text>
	                                            <Badge
	                                              color={entry.percent >= 100 ? 'red' : entry.percent >= 50 ? 'yellow' : 'green'}
	                                              variant="light"
	                                            >
	                                              {entry.percent}%
	                                            </Badge>
	                                            <Text size="xs" c="dimmed">
	                                              ~{avgDaysPerWeek.toFixed(1)} days/week
	                                            </Text>
	                                            <Text size="xs" c="dimmed">
	                                              {hoursLogged.toFixed(1)}h {isMonthlyData ? 'this month' : 'total'}
	                                            </Text>
	                                            {isMonthlyData && weeklyLoggedHours > 0 && (
	                                              <Text size="xs" c="dimmed">
	                                                {weeklyLoggedHours.toFixed(1)}h this week
	                                              </Text>
	                                            )}
	                                          </Group>
	                                        )
	                                      })}
	                                      <Text size="xs" c="dimmed" mt={4}>
	                                        {workDaysThisMonth} work days × 10h = {expectedHoursThisMonth}h expected
	                                      </Text>
	                                    </Stack>
	                                  ) : (
	                                    <Text size="xs" c="dimmed">
	                                      No time tracking data available.
	                                    </Text>
	                                  )}
	                                </Stack>
	                              )}
                              {!row.detailsLoaded && row.detailsLoading && (
                                <Group gap="xs">
                                  <Loader size="xs" />
                                  <Text size="xs" c="dimmed">
                                    Loading Jira tasks...
                                </Text>
                              </Group>
                            )}
                            {!row.detailsLoaded && !row.detailsLoading && row.detailsError && (
                              <Text size="xs" c="dimmed">
                                {row.detailsError}
                              </Text>
                            )}
                            {row.detailsLoaded && row.detailsPartial && (
                              <Text size="xs" c="dimmed">
                                Showing the most recent {row.items.length} tasks.
                              </Text>
                            )}
                              {row.detailsLoaded &&
                                (row.items.length ? (
                                  (jiraBudgetSortByProgress
                                    ? sortByProgress(row.items)
                                    : row.items
                                  ).map(item => {
                                    const totals = getWorkItemTotals(item)
                                    const taskEstimate = totals.estimateSeconds
                                    const taskSpent = totals.spentSeconds
                                    const taskRatio = taskEstimate ? taskSpent / taskEstimate : 0
                                  const subtaskCount = item.subtasks?.length ?? 0
                                  const subtasks = item.subtasks?.length
                                    ? jiraBudgetSortByProgress
                                      ? sortByProgress(item.subtasks ?? [])
                                      : item.subtasks ?? []
                                    : []
                                  const assigneeLabel = item.assigneeName || 'Unassigned'
	                                  const percent = positionPercents[assigneeLabel] ?? 100
	                                  const effectiveDailyHours =
	                                    percent > 0 ? (hoursPerDay * percent) / 100 : 0
                                  const estimateHours = taskEstimate / 3600
                                  const daysNeeded =
                                    projectStartDate && estimateHours && effectiveDailyHours
                                      ? estimateHours / effectiveDailyHours
                                      : null
                                  const forecastEnd =
                                    projectStartDate && daysNeeded
                                      ? addWorkdays(dayjs(projectStartDate), daysNeeded)
                                      : null
                                  const forecastStatus =
                                    forecastEnd && taskSpent < taskEstimate
                                      ? dayjs().isAfter(forecastEnd)
                                        ? 'Delayed'
                                        : 'On time'
                                      : taskEstimate && taskSpent >= taskEstimate
                                        ? 'Complete'
                                        : null
                                  return (
                                    <div key={item.key} className="budget-task">
                                      <div className="budget-task-header">
                                        <div>
                                            <Text size="xs" fw={600}>
                                              {item.key} · {item.summary}
                                            </Text>
                                          <Text size="xs" c="dimmed">
                                            {item.assigneeName
                                              ? `Assigned to ${item.assigneeName}`
                                              : 'Unassigned'}
                                              {subtaskCount ? ` · ${subtaskCount} subtasks` : ''}
                                          </Text>
                                          {forecastEnd && (
                                            <Text size="xs" c="dimmed">
                                              ETA: {forecastEnd.format('DD/MM')} {forecastStatus ? `· ${forecastStatus}` : ''}
                                            </Text>
                                          )}
                                          {item.statusName && (
                                            <Text size="xs" c="dimmed">
                                              Status: {item.statusName}
                                            </Text>
                                          )}
                                          <Text size="xs" c="dimmed">
                                            {formatLastWorklog(item.lastWorklog)}
                                          </Text>
                                          <Text size="xs" c="dimmed">
                                            {taskEstimate
                                              ? `${formatJiraBudgetValue(
                                                  taskSpent,
                                                  jiraBudgetInHours,
                                                  jiraTimeConfig
                                                )} / ${formatJiraBudgetValue(
                                                  taskEstimate,
                                                  jiraBudgetInHours,
                                                  jiraTimeConfig
                                                )} (${Math.round(taskRatio * 100)}%)`
                                                : `${formatJiraBudgetValue(
                                                  taskSpent,
                                                  jiraBudgetInHours,
                                                  jiraTimeConfig
                                                )} spent · No estimate`}
                                            </Text>
                                          </div>
                                          <Button
                                            size="xs"
                                            variant="light"
                                            onClick={() =>
                                              openHistoryModal(
                                                `${item.key} · ${item.summary}`,
                                                item.key
                                              )
                                            }
                                          >
                                            History Logs
                                          </Button>
                                        </div>
                                        <div className="budget-task-bar">
                                          <span
                                            className={`budget-progress-fill${
                                              taskRatio >= 1
                                                ? ' is-over'
                                                : taskRatio >= 0.8
                                                  ? ' is-near'
                                                  : ''
                                            }`}
                                            style={{ width: `${Math.min(taskRatio, 1) * 100}%` }}
                                          />
                                        </div>
                                        {subtasks.length > 0 && (
                                          <div className="budget-subtasks">
                                          {subtasks.map(subtask => {
                                            const subtaskTotals = getWorkItemTotals(subtask)
                                            const subtaskEstimate = subtaskTotals.estimateSeconds
                                            const subtaskSpent = subtaskTotals.spentSeconds
                                            const subtaskRatio = subtaskEstimate
                                              ? subtaskSpent / subtaskEstimate
                                              : 0
                                            return (
                                              <div key={subtask.key} className="budget-subtask">
                                                <div className="budget-task-header">
                                                  <div>
                                                      <Text size="xs" fw={600}>
                                                        ↳ {subtask.key} · {subtask.summary}
                                                      </Text>
                                                      <Text size="xs" c="dimmed">
                                                        {subtask.assigneeName
                                                          ? `Assigned to ${subtask.assigneeName}`
                                                          : 'Unassigned'}
                                                    </Text>
                                                    {subtask.statusName && (
                                                      <Text size="xs" c="dimmed">
                                                        Status: {subtask.statusName}
                                                      </Text>
                                                    )}
                                                    <Text size="xs" c="dimmed">
                                                      {formatLastWorklog(subtask.lastWorklog)}
                                                    </Text>
                                                    <Text size="xs" c="dimmed">
                                                      {subtaskEstimate
                                                        ? `${formatJiraBudgetValue(
                                                            subtaskSpent,
                                                            jiraBudgetInHours,
                                                            jiraTimeConfig
                                                          )} / ${formatJiraBudgetValue(
                                                            subtaskEstimate,
                                                            jiraBudgetInHours,
                                                            jiraTimeConfig
                                                          )} (${Math.round(subtaskRatio * 100)}%)`
                                                          : `${formatJiraBudgetValue(
                                                              subtaskSpent,
                                                              jiraBudgetInHours,
                                                              jiraTimeConfig
                                                            )} spent · No estimate`}
                                                      </Text>
                                                    </div>
                                                    <Button
                                                      size="xs"
                                                      variant="light"
                                                      onClick={() =>
                                                        openHistoryModal(
                                                          `${subtask.key} · ${subtask.summary}`,
                                                          subtask.key
                                                        )
                                                      }
                                                    >
                                                      History Logs
                                                    </Button>
                                                  </div>
                                                  <div className="budget-task-bar">
                                                    <span
                                                      className={`budget-progress-fill${
                                                        subtaskRatio >= 1
                                                          ? ' is-over'
                                                          : subtaskRatio >= 0.8
                                                            ? ' is-near'
                                                            : ''
                                                      }`}
                                                      style={{
                                                        width: `${Math.min(subtaskRatio, 1) * 100}%`
                                                      }}
                                                    />
                                                  </div>
                                                </div>
                                              )
                                            })}
                                          </div>
                                        )}
                                      </div>
                                    )
                                  })
                                ) : (
                                  <Text size="xs" c="dimmed">
                                    No Tasks To Fetch For Customer.
                                  </Text>
                                ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </Stack>
                )}
                  </>
                )}
              </Stack>
            </Card>
          )}

          <Card className="glass-card work-panel" radius="lg" p="xl">
            <Stack gap="lg">
              <Group justify="center" align="center" className="section-header workday-header">
                <div className="page-title-card">
                  <Text className="page-title-text">Log Workday</Text>
                </div>
              </Group>

              <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="xl" className="work-split">
                <Stack ref={logWorkRef} gap="lg" className="work-column work-left">
                  <Group justify="space-between" align="center" className="panel-header">
                    <Text className="section-title">Task</Text>
                    <Tooltip label="Reset selection" position="bottom" withArrow>
                      <ActionIcon
                        size="sm"
                        variant="subtle"
                        aria-label="Reset filters"
                        onClick={() => {
                          filtersTouchedRef.current = false
                          setProjectName(null)
                          setCustomerName(null)
                          setTaskName(null)
                        }}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="14"
                          height="14"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="1 4 1 10 7 10" />
                          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                        </svg>
                      </ActionIcon>
                    </Tooltip>
                  </Group>
                  <SimpleGrid cols={{ base: 1, md: 3 }} spacing="lg" className="filters-grid">
                    <Select
                      label="Project"
                      placeholder="Choose a project"
                      data={projectOptions}
                      value={projectName}
                      onChange={value => {
                        filtersTouchedRef.current = true
                        setProjectName(value)
                        setSuppressCustomerAutoSelect(false)
                        setSuppressTaskAutoSelect(false)
                      }}
                      styles={filterSelectStyles}
                      comboboxProps={{
                        withinPortal: true,
                        floatingStrategy: 'fixed',
                        position: 'bottom-start',
                        offset: 8,
                        middlewares: { flip: false, shift: false }
                      }}
                      searchable
                      clearable
                      nothingFoundMessage="No matching project"
                      maxDropdownHeight={220}
                      disabled={!logs.length}
                    />
                    <Select
                      label="Customer"
                      placeholder="Choose a customer"
                      data={customerOptions}
                      value={customerName}
                      onChange={value => {
                        filtersTouchedRef.current = true
                        setCustomerName(value)
                        if (!value) {
                          setSuppressCustomerAutoSelect(true)
                          setSuppressTaskAutoSelect(true)
                        } else {
                          setSuppressCustomerAutoSelect(false)
                          setSuppressTaskAutoSelect(false)
                        }
                      }}
                      styles={filterSelectStyles}
                      comboboxProps={{
                        withinPortal: true,
                        floatingStrategy: 'fixed',
                        position: 'bottom-start',
                        offset: 8,
                        middlewares: { flip: false, shift: false }
                      }}
                      searchable
                      clearable
                      nothingFoundMessage="No matching customer"
                      maxDropdownHeight={220}
                      disabled={lockCustomer}
                    />
                    <Select
                      label="Task"
                      placeholder="Choose a task"
                      data={taskOptions}
                      value={taskName}
                      onChange={value => {
                        filtersTouchedRef.current = true
                        setTaskName(value)
                        if (!value) {
                          setSuppressTaskAutoSelect(true)
                        } else {
                          setSuppressTaskAutoSelect(false)
                        }
                      }}
                      styles={filterSelectStyles}
                      comboboxProps={{
                        withinPortal: true,
                        floatingStrategy: 'fixed',
                        position: 'bottom-start',
                        offset: 8,
                        middlewares: { flip: false, shift: false }
                      }}
                      searchable
                      clearable
                      nothingFoundMessage="No matching task"
                      maxDropdownHeight={220}
                      disabled={lockTask}
                    />
                  </SimpleGrid>
                  {!taskIdForLog && (
                    <Text size="xs" c="dimmed">
                      Select a project, customer, and task to unlock logging.
                    </Text>
                  )}

                  <Collapse in={logWorkOpen} transitionDuration={180}>
                    <div className="log-work-content">
                      <Stack gap="md">
                        {logError && (
                          <Alert color="red" variant="light" radius="md">
                            {logError}
                          </Alert>
                        )}

                        {logSuccess && (
                          <Alert color="teal" variant="light" radius="md">
                            {logSuccess}
                          </Alert>
                        )}

                        <div className="log-work-form">
                          <div className="log-work-date-row">
                            <Input.Wrapper label="Date">
                              <div className="log-work-date-card">
                                <Text size="sm" fw={600}>
                                  {logDate ? dayjs(logDate).format('YYYY-MM-DD') : '—'}
                                </Text>
                              </div>
                            </Input.Wrapper>
                          </div>
                          <SimpleGrid
                            cols={{ base: 1, sm: 2 }}
                            spacing="md"
                            className="log-work-time-grid"
                          >
                            <TimeInput
                              label="From"
                              value={fromTime}
                              onChange={event => setFromTime(event.currentTarget.value)}
                            />
                            <TimeInput
                              label="To"
                              value={toTime}
                              onChange={event => setToTime(event.currentTarget.value)}
                            />
                          </SimpleGrid>
                          <Text size="sm" c="dimmed" className="duration-pill">
                            {duration
                              ? `Duration: ${duration.hoursHHMM} (${duration.hours}h)`
                              : 'Enter a valid start and end time.'}
                          </Text>
                        </div>

                        <Select
                          label="Reporting from"
                          placeholder="Select location"
                          value={reportingFrom}
                          onChange={value => setReportingFrom(value ?? 'OFFICE')}
                          data={reportingFromOptions}
                        />

                        <Textarea
                          label="Comment"
                          placeholder="Add a note (mandatory)"
                          value={comment}
                          onChange={event => setComment(event.currentTarget.value)}
                          autosize
                          minRows={3}
                          withAsterisk
                        />

                        {jiraConfigured && (
                          <Stack gap="sm" className="jira-log-section">
                            <Group justify="space-between" align="center" wrap="wrap">
                              <Text size="sm" c="dimmed">
                                Jira work item
                              </Text>
                              <Switch
                                size="sm"
                                checked={logToJira}
                                onChange={event => {
                                  const next = event.currentTarget.checked
                                  setLogToJira(next)
                                  if (next && !jiraIssueKey && jiraIssueOptions.length) {
                                    setJiraIssueKey(jiraIssueOptions[0].value)
                                  }
                                }}
                                label="Log to Jira"
                                disabled={!jiraConfigured || !mappedEpicKey || jiraLoadingIssues}
                              />
                            </Group>

                            {!customerName && (
                              <Text size="sm" c="dimmed">
                                Select a customer to load Jira work items.
                              </Text>
                            )}

                            {customerName && !mappedEpicKey && (
                              <Text size="sm" c="dimmed">
                                Map this customer to a Jira epic to enable Jira logging.
                              </Text>
                            )}

                            {customerName && mappedEpicKey && (
                              <Select
                                label="Jira work item"
                                placeholder="Choose an issue"
                                data={jiraIssueOptions}
                                value={jiraIssueKey}
                                onChange={value => {
                                  setJiraIssueKey(value)
                                  if (!value) setLogToJira(false)
                                }}
                                searchable
                                clearable
                                nothingFoundMessage="No work items found"
                                disabled={jiraLoadingIssues}
                              />
                            )}

                            {jiraLoadingIssues && (
                              <Group gap="xs">
                                <Loader size="xs" />
                                <Text size="sm" c="dimmed">
                                  Loading Jira work items...
                                </Text>
                              </Group>
                            )}

                            {jiraIssueLoadError && (
                              <Text size="xs" c="dimmed">
                                {jiraIssueLoadError}
                              </Text>
                            )}

                            {jiraIssueKey && jiraWorklogWarning && (
                              <Alert color="yellow" variant="light" radius="md">
                                {jiraWorklogWarning}
                              </Alert>
                            )}

                            {jiraIssueKey && jiraWorklogs.length > 0 && (
                              <Stack gap={6} className="jira-worklog-history">
                                <Text size="xs" c="dimmed">
                                  Recent Jira worklogs
                                </Text>
                                {jiraWorklogs.slice(0, 5).map(entry => (
                                  <Group key={entry.id} justify="space-between" align="center">
                                    <Text size="xs">
                                      {entry.started
                                        ? dayjs(entry.started).format('DD-MM HH:mm')
                                        : '--'}
                                    </Text>
                                    <Text size="xs" c="dimmed">
                                      {formatJiraHours(entry.seconds)}
                                    </Text>
                                  </Group>
                                ))}
                              </Stack>
                            )}
                          </Stack>
                        )}

                        {selectedTask ? (
                          <Text size="sm">
                            Logging for <strong>{selectedTask.taskName}</strong> ·{' '}
                            {selectedTask.projectName}
                          </Text>
                        ) : (
                          <Text size="sm" c="dimmed">
                            Select project, customer, and task to unlock logging.
                          </Text>
                        )}

                        <Group justify="center" className="log-work-actions">
                          <Button
                            radius="md"
                            className="cta-button log-work-submit"
                            loading={logLoading}
                            disabled={
                              !taskIdForLog ||
                              !duration ||
                              !logDate ||
                              comment.trim().length < 3 ||
                              (logToJira &&
                                (!jiraConfigured || (!jiraIssueKey && !mappedEpicKey)))
                            }
                            onClick={() => {
                              if (taskIdForLog && duration) {
                                if (reviewMode) {
                                  openReview()
                                } else {
                                  submitLogWork(taskIdForLog, duration)
                                }
                              }
                            }}
                          >
                            Log work
                          </Button>
                        </Group>
                      </Stack>
                    </div>
                  </Collapse>
                </Stack>

                <div className="calendar-card fade-in work-column work-right">
                  <Stack gap="lg">
                    <Group
                      justify="space-between"
                      align="center"
                      wrap="wrap"
                      className="calendar-toolbar"
                    >
                      <Group
                        gap="sm"
                        className="calendar-nav-row"
                        justify="center"
                        align="center"
                        wrap="nowrap"
                      >
                        <Button
                          size="xs"
                          variant="subtle"
                          className="calendar-nav"
                          onClick={() => shiftReportMonth(-1)}
                        >
                          Prev
                        </Button>
                        <Text className="calendar-month">
                          {dayjs(reportMonth).format('MMMM YYYY')}
                        </Text>
                        <Button
                          size="xs"
                          variant="subtle"
                          className="calendar-nav"
                          onClick={() => shiftReportMonth(1)}
                        >
                          Next
                        </Button>
                      </Group>
                      <Group gap="sm" className="calendar-selected-row" justify="center" align="center">
                        <Badge size="sm" className="calendar-selected-date" variant="light" color="gray">
                          {searchActive
                            ? 'Search results'
                            : selectedReportKey
                              ? dayjs(selectedReportKey).format('DD-MM-YYYY')
                              : 'Select a date'}
                        </Badge>
                        <Badge
                          size="sm"
                          variant="light"
                          color={selectedReportInfo?.day.reports.length ? 'teal' : 'gray'}
                        >
                          {searchActive
                            ? `${filteredReportItems.length} results`
                            : selectedReportInfo
                              ? `${selectedReportInfo.day.reports.length} reports`
                              : 'No data'}
                        </Badge>
                      </Group>
                      <Menu position="bottom-end" withinPortal closeOnItemClick={false}>
                        <Menu.Target>
                          <ActionIcon size="sm" variant="light" aria-label="Calendar settings">
                            <svg
                              viewBox="0 0 24 24"
                              width="14"
                              height="14"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <circle cx="12" cy="12" r="3" />
                              <path d="M19.4 15a1.7 1.7 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.82-.33 1.7 1.7 0 0 0-1 1.51V22a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.51 1.7 1.7 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .33-1.82 1.7 1.7 0 0 0-1.51-1H2a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.51-1 1.7 1.7 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.82.33h.07A1.7 1.7 0 0 0 9 3.09V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.51 1.7 1.7 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.33 1.82v.07A1.7 1.7 0 0 0 20.91 11H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" />
                            </svg>
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Label>Calendar</Menu.Label>
                          <Menu.Item
                            onClick={() => setHeatmapEnabled(prev => !prev)}
                            rightSection={
                              <Text size="xs" c={heatmapEnabled ? 'teal' : 'dimmed'}>
                                {heatmapEnabled ? 'On' : 'Off'}
                              </Text>
                            }
                          >
                            Heatmap
                          </Menu.Item>
                          <Menu.Item
                            onClick={() => setExportFiltered(prev => !prev)}
                            rightSection={
                              <Text size="xs" c={exportFiltered ? 'teal' : 'dimmed'}>
                                {exportFiltered ? 'On' : 'Off'}
                              </Text>
                            }
                          >
                            Filtered export
                          </Menu.Item>
                          <Menu.Item onClick={() => setReportsOpen(prev => !prev)}>
                            {reportsOpen ? 'Collapse reports' : 'Expand reports'}
                          </Menu.Item>
                          <Menu.Divider />
                          <Menu.Label>Export for a specific client</Menu.Label>
                          <Menu.Item
                            onClick={() => {
                              setExportClientFormat('xlsx')
                              setExportClientOpen(true)
                            }}
                          >
                            XLSX
                          </Menu.Item>
                          <Menu.Item
                            onClick={() => {
                              setExportClientFormat('pdf')
                              setExportClientOpen(true)
                            }}
                          >
                            PDF
                          </Menu.Item>
                          <Menu.Divider />
                          <Menu.Label>Export all</Menu.Label>
                          <Menu.Item onClick={handleExportXlsx} disabled={exportingCsv}>
                            XLSX
                          </Menu.Item>
                          <Menu.Item onClick={handleExportPdf} disabled={exportingPdf}>
                            PDF
                          </Menu.Item>
                        </Menu.Dropdown>
                      </Menu>
                    </Group>

                    <Collapse in={reportsOpen} transitionDuration={180}>
                      {reportsError && (
                        <Alert color="red" variant="light" radius="md">
                          {reportsError}
                        </Alert>
                      )}

                      {exportError && (
                        <Alert color="red" variant="light" radius="md">
                          {exportError}
                        </Alert>
                      )}

                      <div className={`calendar-body${reportsLoading ? ' is-loading' : ''}`}>
                        <DatePicker
                          className="calendar-widget"
                          date={reportMonth}
                          onDateChange={value => {
                            const nextDate = toDate(value)
                            if (nextDate) setReportMonth(nextDate)
                          }}
                          value={selectedReportDate}
                          onChange={handleCalendarChange}
                          firstDayOfWeek={0}
                          weekendDays={weekendDays}
                          size="md"
                          highlightToday
                          getDayProps={date => {
                            const key = dayjs(date).format('YYYY-MM-DD')
                            const info = reportsByDate.get(key)
                            return {
                              'data-has-reports': info?.day.reports.length ? true : undefined,
                              'data-holiday': info?.day.isHoliday ? true : undefined
                            }
                          }}
                          renderDay={date => {
                            const key = dayjs(date).format('YYYY-MM-DD')
                            const info = reportsByDate.get(key)
                            const hasReports = Boolean(info?.day.reports.length)
                            const isHoliday = Boolean(info?.day.isHoliday)
                            const isWeekend = weekendDays.includes(dayjs(date).day() as DayOfWeek)
                            const isCurrentMonth = dayjs(date).isSame(reportMonth, 'month')
                            const isFuture = dayjs(date).isAfter(dayjs(), 'day')
                            const isMissing =
                              !hasReports &&
                              isCurrentMonth &&
                              !isWeekend &&
                              !isHoliday &&
                              !isFuture
                            const hoursLabel = info ? formatMinutesToLabel(info.totalMinutes) : ''
                            const heatmapActive =
                              heatmapEnabled && hasReports && info && maxDayMinutes && !isWeekend
                            const intensity = heatmapActive
                              ? Math.min(info.totalMinutes / maxDayMinutes, 1)
                              : 0
                            const tooltipLabel = info?.day.reports.length ? (
                              <div className="calendar-tooltip">
                                {info.day.reports.map((report, index) => {
                                  const meta = taskMetaById.get(report.taskId)
                                  const projectLabel =
                                    meta?.projectName || report.projectInstance || report.taskName
                                  return (
                                    <div
                                      key={`${report.taskId}-${index}`}
                                      className="calendar-tooltip-row"
                                    >
                                      <span className="calendar-tooltip-project">{projectLabel}</span>
                                      <span className="calendar-tooltip-task">{report.taskName}</span>
                                      <span className="calendar-tooltip-hours">{report.hours_HHMM}</span>
                                    </div>
                                  )
                                })}
                              </div>
                            ) : (
                              'No reports'
                            )
                            return (
                              <Tooltip
                                label={tooltipLabel}
                                position="top"
                                withArrow
                                classNames={{
                                  tooltip: 'calendar-tooltip-shell',
                                  arrow: 'calendar-tooltip-arrow'
                                }}
                              >
                                <div
                                  className={[
                                    'calendar-day',
                                    hasReports ? 'has-reports' : '',
                                    isMissing ? 'is-missing' : '',
                                    isHoliday ? 'is-holiday' : '',
                                    isWeekend ? 'is-weekend' : '',
                                    heatmapActive ? 'heatmap' : ''
                                  ]
                                    .join(' ')
                                    .trim()}
                                  style={
                                    heatmapActive ? ({ '--heat': intensity } as CSSProperties) : undefined
                                  }
                                >
                                  <span className="calendar-date">{dayjs(date).date()}</span>
                                  <span className={`calendar-meta${hasReports ? '' : ' is-empty'}`}>
                                    {hasReports ? (
                                      <>
                                        <span className="calendar-dot" />
                                        {hoursLabel && (
                                          <span className="calendar-hours">{hoursLabel}</span>
                                        )}
                                      </>
                                    ) : (
                                      <span className="calendar-hours">&nbsp;</span>
                                    )}
                                  </span>
                                </div>
                              </Tooltip>
                            )
                          }}
                        />

                        {!reportsLoading && (
                          <Stack gap="sm">
                            <Stack gap="xs" className="report-tools">
                              <TextInput
                                placeholder="Search by project, customer, task, comment, or date..."
                                value={searchQuery}
                                onChange={event => setSearchQuery(event.currentTarget.value)}
                              />
                              <Group gap="xs" className="report-filters" wrap="wrap">
                                <Button
                                  size="xs"
                                  variant={searchFilters.includes('jira') ? 'light' : 'subtle'}
                                  onClick={() => toggleSearchFilter('jira')}
                                >
                                  Jira Pending
                                </Button>
                                <Button
                                  size="xs"
                                  variant={searchFilters.includes('week') ? 'light' : 'subtle'}
                                  onClick={() => toggleSearchFilter('week')}
                                >
                                  Current Week
                                </Button>
                                <Button
                                  size="xs"
                                  variant={searchFilters.includes('month') ? 'light' : 'subtle'}
                                  onClick={() => toggleSearchFilter('month')}
                                >
                                  Current Month
                                </Button>
                                <Button
                                  size="xs"
                                  variant={searchFilters.includes('today') ? 'light' : 'subtle'}
                                  onClick={() => toggleSearchFilter('today')}
                                >
                                  Today
                                </Button>
                                {(searchQuery || searchFilters.length) && (
                                  <Button
                                    size="xs"
                                    variant="subtle"
                                    onClick={() => {
                                      setSearchQuery('')
                                      setSearchFilters([])
                                    }}
                                  >
                                    Clear
                                  </Button>
                                )}
                              </Group>
                            </Stack>

                            {editError && (
                              <Alert color="red" variant="light" radius="md">
                                {editError}
                              </Alert>
                            )}

                      {bulkActionError && (
                        <Alert color="red" variant="light" radius="md">
                          {bulkActionError}
                        </Alert>
                      )}

                      {Object.keys(selectedReportEntries).length > 0 && (
                        <Group className="bulk-actions" justify="space-between" align="center" wrap="wrap">
                          <Text size="sm">
                            Selected {Object.keys(selectedReportEntries).length} log
                            {Object.keys(selectedReportEntries).length > 1 ? 's' : ''}
                          </Text>
                          <Group gap="xs">
                            <Button
                              size="xs"
                              variant="light"
                              onClick={() => setBulkEditOpen(true)}
                            >
                              Bulk edit
                            </Button>
                            <Button
                              size="xs"
                              variant="light"
                              onClick={() =>
                                bulkLogToJira(
                                  filteredReportItems.filter(item =>
                                    selectedReportEntries[getReportEntryKey(item, item.dateKey)]
                                  )
                                )
                              }
                            >
                              Bulk Jira sync
                            </Button>
                            <Button
                              size="xs"
                              variant="outline"
                              color="red"
                              onClick={() =>
                                window.confirm('Delete selected logs?') &&
                                bulkDeleteReports(
                                  filteredReportItems.filter(item =>
                                    selectedReportEntries[getReportEntryKey(item, item.dateKey)]
                                  )
                                )
                              }
                            >
                              Delete selected
                            </Button>
                            <Button size="xs" variant="subtle" onClick={clearReportSelection}>
                              Clear
                            </Button>
                          </Group>
                        </Group>
                      )}

                      {filteredReportItems.length ? (
                        shouldVirtualizeReports ? (
                          <div className="report-list" ref={reportListRef}>
                            <FixedSizeList
                              height={reportListHeight}
                              itemCount={filteredReportItems.length}
                              itemSize={reportRowHeight}
                              width={reportListWidth || 720}
                              itemKey={index =>
                                `${filteredReportItems[index]?.taskId ?? 'row'}-${index}`
                              }
                            >
                              {renderReportRow}
                            </FixedSizeList>
                          </div>
                        ) : (
                          <Stack gap="sm">
                            {reportDisplayRows.map((row, index) => {
                              if (row.type === 'group') {
                                return (
                                  <Box key={`group-${row.key}`} className="report-group">
                                    <Group
                                      justify="space-between"
                                      align="flex-start"
                                      className="report-group-header"
                                    >
                                      <Stack gap={4}>
                                        <Text className="report-group-title">
                                          {row.projectLabel}
                                        </Text>
                                        <Text size="xs" c="dimmed" className="report-group-subtitle">
                                          {row.customerLabel} • {row.items.length} logs
                                        </Text>
                                      </Stack>
                                      <Badge
                                        variant="light"
                                        color="teal"
                                        className="report-group-total"
                                      >
                                        Total {minutesToHHMM(row.totalMinutes)}
                                      </Badge>
                                    </Group>
                                    <Stack gap="xs" className="report-group-items">
                                      {row.items.map((item, itemIndex) =>
                                        renderReportItem(item, itemIndex, { inGroup: true })
                                      )}
                                    </Stack>
                                  </Box>
                                )
                              }
                              return renderReportItem(row.item, index)
                            })}
                          </Stack>
                        )
                      ) : (
                        <Text size="sm" c="dimmed">
                          No reports for this day.
                        </Text>
                      )}
                    </Stack>
                  )}
                </div>

                {reportsLoading && (
                  <div className="calendar-loading">
                    <Loader size="sm" />
                    <Text size="sm" c="dimmed">
                      Loading month...
                    </Text>
                  </div>
                )}
                </Collapse>
              </Stack>
                </div>

              </SimpleGrid>

              <Card className="panel-section meetings-card fade-in" radius="lg" p="xl">
                <Stack gap="md">
                  <Group justify="space-between" align="center" wrap="wrap">
                    <Stack gap={6}>
                      <Group gap="sm" align="center" wrap="wrap">
                        <Text className="section-title">Meetings (current month)</Text>
                        {!meetingsCollapsed && (
                          <Button
                            size="xs"
                            variant="light"
                            onClick={() => setMeetingsCredentialsOpen(prev => !prev)}
                          >
                            {meetingsCredentialsOpen ? 'Hide credentials' : 'Edit credentials'}
                          </Button>
                        )}
                      </Group>
                      <Text size="sm" c="dimmed">
                        Teams meetings from Microsoft Graph.
                      </Text>
                    </Stack>
                    <Group gap="sm" wrap="wrap">
                      {!meetingsCollapsed && (
                        <>
                          <Group gap="xs" align="center">
                            <Select
                              value={meetingsBrowser}
                              onChange={value =>
                                setMeetingsBrowser((value as 'safari' | 'chrome') || 'chrome')
                              }
                              data={[
                                { value: 'safari', label: 'Safari' },
                                { value: 'chrome', label: 'Chrome' }
                              ]}
                              size="xs"
                              placeholder="Browser"
                              className="meetings-browser"
                            />
                            <Tooltip
                              label="Choose the browser to run the crawler during the fetch."
                              withArrow
                            >
                              <ActionIcon size="sm" variant="subtle" aria-label="Browser info">
                                <svg
                                  viewBox="0 0 24 24"
                                  width="14"
                                  height="14"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <circle cx="12" cy="12" r="10" />
                                  <line x1="12" y1="16" x2="12" y2="12" />
                                  <line x1="12" y1="8" x2="12.01" y2="8" />
                                </svg>
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                          <Group gap="xs" align="center">
                            <Switch
                              size="sm"
                              checked={meetingsHeadless}
                              onChange={event => setMeetingsHeadless(event.currentTarget.checked)}
                              label="Fetch in background"
                              disabled={meetingsBrowser !== 'chrome'}
                            />
                            <Tooltip
                              label="Toggle this to fetch meetings in the background. When off, you'll see the full browser automation."
                              withArrow
                            >
                              <ActionIcon size="sm" variant="subtle" aria-label="Background info">
                                <svg
                                  viewBox="0 0 24 24"
                                  width="14"
                                  height="14"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <circle cx="12" cy="12" r="10" />
                                  <line x1="12" y1="16" x2="12" y2="12" />
                                  <line x1="12" y1="8" x2="12.01" y2="8" />
                                </svg>
                              </ActionIcon>
                            </Tooltip>
                          </Group>
                          <Button
                            size="xs"
                            variant="light"
                            onClick={() => fetchMeetings()}
                            loading={meetingsLoading}
                          >
                            Fetch meetings
                          </Button>
                        </>
                      )}
                      {meetingsCollapsed && (
                        <Button
                          size="xs"
                          variant="light"
                          onClick={() => fetchMeetings(true)}
                          loading={meetingsLoading}
                        >
                          Refresh
                        </Button>
                      )}
                      <Button
                        size="xs"
                        variant="subtle"
                        onClick={() => setMeetingsCollapsed(prev => !prev)}
                      >
                        {meetingsCollapsed ? 'Expand' : 'Collapse'}
                      </Button>
                    </Group>
                  </Group>

                  {meetingsCollapsed ? (
                    <div className="kpi-mini-grid">
                      <div className="kpi-mini">
                        <span className="kpi-mini-label">Meetings</span>
                        <span className="kpi-mini-value">{meetingsSummary.totalMeetings}</span>
                      </div>
                      <div className="kpi-mini">
                        <span className="kpi-mini-label">Hours</span>
                        <span className="kpi-mini-value">
                          {(meetingsSummary.totalMinutes / 60).toFixed(1)}
                        </span>
                        <span className="kpi-mini-meta">Total meeting time</span>
                      </div>
                      <div className="kpi-mini">
                        <span className="kpi-mini-label">Clients</span>
                        <span className="kpi-mini-value">{meetingsSummary.mappedClients}</span>
                        <span className="kpi-mini-meta">
                          {meetingsSummary.topClients.length
                            ? meetingsSummary.topClients
                                .slice(0, 3)
                                .map(item => `${item.client} (${item.count})`)
                                .join(' · ')
                            : 'No mapped clients yet'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <Collapse in={meetingsCredentialsOpen} transitionDuration={200}>
                        <SimpleGrid
                          cols={{ base: 1, sm: 2 }}
                          spacing="md"
                          className="meetings-credentials"
                        >
                          <TextInput
                            label="Domain User"
                            placeholder="you@company.com"
                            value={meetingsUsername}
                            onChange={event => setMeetingsUsername(event.currentTarget.value)}
                          />
                          <PasswordInput
                            label="Domain Password"
                            placeholder="••••••••"
                            value={meetingsPassword}
                            onChange={event => setMeetingsPassword(event.currentTarget.value)}
                          />
                        </SimpleGrid>
                      </Collapse>

                      {meetingsBrowser !== 'chrome' && (
                        <Text size="xs" c="dimmed">
                          Background mode requires Chrome.
                        </Text>
                      )}

                      {meetingsProgress && (
                        <Text size="xs" c="dimmed">
                          {meetingsProgress}
                        </Text>
                      )}

                      {meetingsError && (
                        <Alert color="red" variant="light" radius="md">
                          {meetingsError}
                        </Alert>
                      )}

                      {meetingsUpdatedAt && (
                        <Text size="xs" c="dimmed">
                          Last updated {dayjs(meetingsUpdatedAt).format('DD-MM-YYYY HH:mm')}
                          {meetingsMonth ? ` · ${meetingsMonth}` : ''}
                        </Text>
                      )}

                      {meetings.length ? (
                        <Table striped highlightOnHover withTableBorder>
                          <Table.Thead>
                            <Table.Tr>
                              <Table.Th>Meeting</Table.Th>
                              <Table.Th className="meetings-date-col">Start</Table.Th>
                              <Table.Th className="meetings-date-col">End</Table.Th>
                              <Table.Th>Participants</Table.Th>
                              <Table.Th className="meetings-action-col">Log</Table.Th>
                            </Table.Tr>
                          </Table.Thead>
                          <Table.Tbody>
	                            {meetingsSorted.map((meeting, index) => {
	                              const meetingKey = getMeetingKey(meeting)
	                              const isLogged = Boolean(
	                                meetingLoggedKeys[meetingKey] || meetingLoggedKeysFromHrs[meetingKey]
	                              )
	                              return (
                              <Table.Tr
                                key={`${meeting.subject}-${index}`}
                                className={isLogged ? 'meeting-row-logged' : undefined}
                              >
                                <Table.Td>{meeting.subject}</Table.Td>
                                <Table.Td className="meetings-date-col">
                                  {meeting.startTime}
                                </Table.Td>
                                <Table.Td className="meetings-date-col">
                                  {meeting.endTime}
                                </Table.Td>
                                <Table.Td>{meeting.participants || '—'}</Table.Td>
                                <Table.Td className="meetings-action-col">
                                  <Button
                                    size="xs"
                                    variant={isLogged ? 'filled' : 'light'}
                                    onClick={() => handleLogMeeting(meeting)}
                                    disabled={isLogged}
                                  >
                                    {isLogged ? 'Logged' : 'Log meeting'}
                                  </Button>
                                </Table.Td>
                              </Table.Tr>
                            )})}
                          </Table.Tbody>
                        </Table>
                      ) : (
                        <Text size="sm" c="dimmed">
                          {meetingsLoading ? 'Fetching meetings…' : 'No meetings yet.'}
                        </Text>
                      )}
                    </>
                  )}
                </Stack>
              </Card>
            </Stack>
          </Card>
        </Stack>
      </Container>

      <Modal
        opened={jiraLogModalOpen}
        onClose={() => setJiraLogModalOpen(false)}
        title="Log to Jira"
        centered
        radius="md"
      >
        <Stack gap="md">
          {jiraLogModalEntry && (
            <Text size="sm" c="dimmed">
              {jiraLogModalEntry.customer} · {dayjs(jiraLogModalEntry.dateKey).format('DD-MM-YYYY')}
            </Text>
          )}

          {jiraLogModalError && (
            <Alert color="red" variant="light" radius="md">
              {jiraLogModalError}
            </Alert>
          )}

          <Select
            label="Jira work item"
            placeholder="Choose an issue"
            data={jiraModalIssueOptions}
            value={jiraLogModalIssueKey}
            onChange={value => setJiraLogModalIssueKey(value)}
            searchable
            clearable
            nothingFoundMessage="No work items found"
            disabled={jiraLogModalLoading || !jiraModalIssueOptions.length}
          />

          {jiraLogModalLoading && (
            <Group gap="xs">
              <Loader size="xs" />
              <Text size="sm" c="dimmed">
                Loading work items...
              </Text>
            </Group>
          )}

          <Group justify="space-between" align="center">
            <Button variant="subtle" onClick={() => setJiraLogModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                if (!jiraLogModalEntry) return
                await logReportEntryToJira(
                  jiraLogModalEntry.entry,
                  jiraLogModalEntry.dateKey,
                  jiraLogModalEntry.customer,
                  jiraLogModalIssueKey
                )
                if (!jiraLogModalError) {
                  setJiraLogModalOpen(false)
                }
              }}
              disabled={!jiraLogModalIssueKey || jiraLogModalLoading}
            >
              Log to Jira
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={meetingMappingOpen}
        onClose={() => {
          setMeetingMappingOpen(false)
          setMeetingMappingMeeting(null)
        }}
        title="Map meeting to client"
        centered
        radius="md"
      >
        <Stack gap="md">
          {meetingMappingMeeting && (
            <Stack gap={4}>
              <Text size="sm" fw={600}>
                {meetingMappingMeeting.subject || 'Meeting'}
              </Text>
              <Text size="xs" c="dimmed">
                {meetingMappingMeeting.startTime} · {meetingMappingMeeting.endTime}
              </Text>
              {meetingMappingMeeting.participants && (
                <Text size="xs" c="dimmed">
                  Attendees: {meetingMappingMeeting.participants}
                </Text>
              )}
            </Stack>
          )}

          <Select
            label="Match by"
            placeholder="Pick an email, domain, or name"
            data={meetingMappingOptions}
            value={meetingMappingKey}
            onChange={value => setMeetingMappingKey(value)}
            searchable
            clearable
            nothingFoundMessage="No attendees found"
          />

          <TextInput
            label="Custom match (optional)"
            placeholder="email:person@client.com or domain:client.com"
            value={meetingMappingCustomKey}
            onChange={event => setMeetingMappingCustomKey(event.currentTarget.value)}
          />

          <Select
            label="Project"
            placeholder="Choose a project"
            data={meetingMappingProjectOptionsForClient}
            value={meetingMappingProject}
            onChange={value => setMeetingMappingProject(value)}
            searchable
            clearable
            nothingFoundMessage="No projects found"
          />

          <Select
            label={meetingMappingProject ? 'Client entry' : 'Client'}
            placeholder="Select a client"
            data={meetingMappingCustomerOptions}
            value={meetingMappingClient}
            onChange={value => setMeetingMappingClient(value)}
            searchable
            clearable
            nothingFoundMessage="No clients found"
          />

          {meetingMappingProject && meetingMappingCustomerOptions.length === 1 && (
            <Text size="xs" c="dimmed">
              Only one client found for this project.
            </Text>
          )}

          <Select
            label="Task"
            placeholder="Select a task"
            data={meetingLogTaskOptions}
            value={meetingLogTaskId}
            onChange={value => setMeetingLogTaskId(value)}
            searchable
            clearable
            nothingFoundMessage="No tasks found"
            disabled={!meetingMappingProject || !meetingMappingClient}
          />

          {meetingMappingProject &&
            meetingMappingClient &&
            !meetingLogTaskOptions.length && (
              <Text size="xs" c="dimmed">
                No tasks found for this client.
              </Text>
            )}

          <Stack gap="xs">
            <Group justify="space-between" align="center">
              <Text size="sm" fw={600}>
                Log to Jira (optional)
              </Text>
              <Switch
                checked={meetingLogToJira}
                onChange={event => setMeetingLogToJira(event.currentTarget.checked)}
                disabled={!meetingMappingClient || !jiraConfigured}
              />
            </Group>

            {!jiraConfigured && (
              <Text size="xs" c="dimmed">
                Connect Jira to enable meeting logging.
              </Text>
            )}

            {meetingLogToJira && meetingMappingClient && !meetingMappedEpicKey && jiraConfigured && (
              <Text size="xs" c="dimmed">
                Map this client to a Jira epic first.
              </Text>
            )}

            {meetingLogToJira && meetingMappedEpicKey && (
              <Text size="xs" c="dimmed">
                Jira target: {meetingMappedEpicKey}
                {meetingMappedEpic ? ` · ${meetingMappedEpic.summary}` : ''}
              </Text>
            )}

            {meetingLogToJira && meetingMappedEpicKey && (
              <Select
                label="Jira work item (optional)"
                placeholder="Choose a task or subtask"
                data={meetingLogIssueOptions}
                value={meetingLogIssueKey}
                onChange={value => setMeetingLogIssueKey(value)}
                searchable
                clearable
                nothingFoundMessage="No work items found"
                disabled={meetingLogLoading}
              />
            )}

            {meetingLogLoading && (
              <Group gap="xs">
                <Loader size="xs" />
                <Text size="xs" c="dimmed">
                  Loading Jira work items…
                </Text>
              </Group>
            )}

            {meetingLogError && (
              <Alert color="red" variant="light" radius="md">
                {meetingLogError}
              </Alert>
            )}
          </Stack>

          {meetingMappingError && (
            <Alert color="red" variant="light" radius="md">
              {meetingMappingError}
            </Alert>
          )}

          <Group justify="space-between" align="center">
            <Button variant="subtle" onClick={() => setMeetingMappingOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveMeetingMapping}>Save &amp; log</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={historyModalOpen}
        onClose={() => {
          setHistoryModalOpen(false)
          setHistoryModalData(null)
          setHistoryModalTitle('')
        }}
        title={`History logs${historyModalTitle ? ` · ${historyModalTitle}` : ''}`}
        centered
        radius="md"
        size="lg"
      >
        <Stack gap="sm">
          {historyModalLoading && (
            <Group gap="xs">
              <Loader size="xs" />
              <Text size="sm" c="dimmed">
                Loading history…
              </Text>
            </Group>
          )}
          {historyModalError && (
            <Alert color="red" variant="light" radius="md">
              {historyModalError}
            </Alert>
          )}
          {!historyModalLoading && !historyModalError && historyModalData && (
            <>
              <Text size="xs" c="dimmed">
                Dates are rows. People are columns. Totals included.
              </Text>
              {(() => {
                const showTotalColumn = historyModalData.people.length > 1
                return (
              <div className="history-table">
                <Table striped highlightOnHover withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Date</Table.Th>
                      {historyModalData.people.map(person => (
                        <Table.Th key={person}>{person}</Table.Th>
                      ))}
                      {showTotalColumn && <Table.Th>Total</Table.Th>}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {historyModalData.rows.map(row => (
                      <Table.Tr key={row.dateKey}>
                        <Table.Td>{dayjs(row.dateKey).format('DD/MM')}</Table.Td>
                        {historyModalData.people.map(person => (
                          <Table.Td key={person}>
                            {formatJiraHours(row.values[person] ?? 0)}
                          </Table.Td>
                        ))}
                        {showTotalColumn && (
                          <Table.Td>{formatJiraHours(row.totalSeconds)}</Table.Td>
                        )}
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                  <Table.Tfoot>
                    <Table.Tr>
                      <Table.Td>Total</Table.Td>
                      {historyModalData.people.map(person => (
                        <Table.Td key={person}>
                          {formatJiraHours(historyModalData.totals[person] ?? 0)}
                        </Table.Td>
                      ))}
                      {showTotalColumn && (
                        <Table.Td>{formatJiraHours(historyModalData.totalSeconds)}</Table.Td>
                      )}
                    </Table.Tr>
                  </Table.Tfoot>
                </Table>
              </div>
                )
              })()}
            </>
          )}
          {!historyModalLoading && !historyModalError && !historyModalData && (
            <Text size="sm" c="dimmed">
              No worklogs found for this item.
            </Text>
          )}
        </Stack>
      </Modal>

      <Modal
        opened={jiraEpicDebugOpen}
        onClose={() => setJiraEpicDebugOpen(false)}
        title={jiraEpicDebugData ? `Epic totals · ${jiraEpicDebugData.epicKey}` : 'Epic totals'}
        size="lg"
        centered
        radius="md"
      >
        <pre
          style={{
            fontSize: '12px',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            margin: 0
          }}
        >
          {jiraEpicDebugData
            ? JSON.stringify(jiraEpicDebugData.fields, null, 2)
            : 'No debug data.'}
        </pre>
      </Modal>

      <Modal
        opened={commandOpen}
        onClose={() => {
          setCommandOpen(false)
          setCommandQuery('')
        }}
        title="Command palette"
        centered
        radius="md"
      >
        <Stack gap="md">
          <TextInput
            placeholder="Type a command..."
            value={commandQuery}
            onChange={event => setCommandQuery(event.currentTarget.value)}
          />
          <Stack gap="xs" className="command-list">
            {filteredCommands.map(action => (
              <Button
                key={action.id}
                variant="light"
                onClick={() => {
                  action.run()
                  setCommandOpen(false)
                  setCommandQuery('')
                }}
              >
                {action.label}
              </Button>
            ))}
          </Stack>
        </Stack>
      </Modal>

      <Modal
        opened={jiraConnectOpen}
        onClose={() => setJiraConnectOpen(false)}
        title="Connect to Jira"
        centered
        radius="md"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Use your Jira email and API token to connect.
          </Text>
          {jiraError && (
            <Alert color="red" variant="light" radius="md">
              {jiraError}
            </Alert>
          )}
          <TextInput
            label="Jira email"
            placeholder="you@company.com"
            value={jiraEmail}
            onChange={event => setJiraEmail(event.currentTarget.value)}
          />
          <PasswordInput
            label="API token"
            placeholder="Paste token"
            value={jiraToken}
            onChange={event => setJiraToken(event.currentTarget.value)}
          />
          <Group justify="space-between" align="center">
            <Button variant="subtle" onClick={() => setJiraConnectOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={saveJiraCredentials}
              loading={jiraSaving}
              disabled={!jiraEmail.trim() || !jiraToken.trim()}
            >
              Connect
            </Button>
          </Group>
          {jiraStatus && (
            <Text size="xs" c="dimmed">
              {jiraStatus.baseUrl} · {jiraStatus.projectName ?? jiraStatus.projectKey}
            </Text>
          )}
        </Stack>
      </Modal>

      <Modal
        opened={exportClientOpen}
        onClose={() => setExportClientOpen(false)}
        title={`Export client (${exportClientFormat.toUpperCase()})`}
        centered
        radius="md"
      >
        <Stack gap="md">
          <Select
            label="Client"
            placeholder="Select a client"
            data={uniqueCustomers.map(customer => ({ value: customer, label: customer }))}
            value={exportClient}
            onChange={value => setExportClient(value)}
            searchable
            clearable
          />
          <Group justify="space-between" align="center">
            <Button variant="subtle" onClick={() => setExportClientOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => handleExportClient(exportClientFormat)}
              disabled={!exportClient}
            >
              Export
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={logSameOpen}
        onClose={() => setLogSameOpen(false)}
        title="Log same as yesterday"
        centered
        radius="md"
      >
        <Stack gap="md">
          {logSameEntry && (
            <Text size="sm" c="dimmed">
              Using yesterday&#39;s entry for {logSameEntry.taskName}.
            </Text>
          )}

          {logSameError && (
            <Alert color="red" variant="light" radius="md">
              {logSameError}
            </Alert>
          )}

          {logSameLoading && (
            <Group gap="xs">
              <Loader size="xs" />
              <Text size="sm" c="dimmed">
                Loading yesterday&#39;s log...
              </Text>
            </Group>
          )}

          <div className="log-work-date">
            <Text size="xs" c="dimmed">
              Date
            </Text>
            <Text size="sm" fw={600}>
              {logSameDate ? dayjs(logSameDate).format('YYYY-MM-DD') : '—'}
            </Text>
            <Text size="xs" c="dimmed">
              Select another day from the calendar first.
            </Text>
          </div>

          <Group grow>
            <TimeInput
              label="From"
              value={logSameFrom}
              onChange={event => setLogSameFrom(event.currentTarget.value)}
            />
            <TimeInput
              label="To"
              value={logSameTo}
              onChange={event => setLogSameTo(event.currentTarget.value)}
            />
          </Group>

          <Text size="sm" c="dimmed" className="duration-pill">
            {logSameDuration
              ? `Duration: ${logSameDuration.hoursHHMM} (${logSameDuration.hours}h)`
              : 'Enter a valid start and end time.'}
          </Text>

          <Textarea
            label="Comment"
            placeholder="Add a note (mandatory)"
            value={logSameComment}
            onChange={event => setLogSameComment(event.currentTarget.value)}
            autosize
            minRows={3}
            withAsterisk
          />

          <Group justify="space-between" align="center">
            <Button variant="subtle" onClick={() => setLogSameOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={confirmLogSame}
              disabled={
                !logSameEntry ||
                !logSameDate ||
                !logSameDuration ||
                logSameComment.trim().length < 3 ||
                logSameLoading
              }
            >
              Log it
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={reviewOpen}
        onClose={() => setReviewOpen(false)}
        title="Review before logging"
        centered
        radius="md"
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Please confirm the details before submitting.
          </Text>
          <Group justify="space-between" align="center">
            <Text size="sm">Task</Text>
            <Text size="sm" fw={600}>
              {selectedTask ? selectedTask.taskName : 'Not selected'}
            </Text>
          </Group>
          <Group justify="space-between" align="center">
            <Text size="sm">Date</Text>
            <Text size="sm" fw={600}>
              {logDate ? dayjs(logDate).format('DD-MM-YYYY') : '—'}
            </Text>
          </Group>
          <Group justify="space-between" align="center">
            <Text size="sm">Time</Text>
            <Text size="sm" fw={600}>
              {fromTime} → {toTime} ({duration?.hoursHHMM ?? '—'})
            </Text>
          </Group>
          <Group justify="space-between" align="center">
            <Text size="sm">Comment</Text>
            <Text size="sm" fw={600}>
              {comment.trim() || '—'}
            </Text>
          </Group>
          <Group justify="space-between" align="center">
            <Text size="sm">Jira logging</Text>
            <Text size="sm" fw={600}>
              {logToJira ? 'On' : 'Off'}
            </Text>
          </Group>

          <Checkbox
            label="Task is correct"
            checked={Boolean(reviewChecks.task)}
            onChange={event =>
              setReviewChecks(prev => ({ ...prev, task: event.currentTarget.checked }))
            }
          />
          <Checkbox
            label="Time range is correct"
            checked={Boolean(reviewChecks.time)}
            onChange={event =>
              setReviewChecks(prev => ({ ...prev, time: event.currentTarget.checked }))
            }
          />
          <Checkbox
            label="Comment is informative"
            checked={Boolean(reviewChecks.comment)}
            onChange={event =>
              setReviewChecks(prev => ({ ...prev, comment: event.currentTarget.checked }))
            }
          />
          {logToJira && (
            <Checkbox
              label="Jira work item is correct"
              checked={Boolean(reviewChecks.jira)}
              onChange={event =>
                setReviewChecks(prev => ({ ...prev, jira: event.currentTarget.checked }))
              }
            />
          )}

          <Group justify="space-between" align="center">
            <Button variant="subtle" onClick={() => setReviewOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirmReview} disabled={!reviewReady}>
              Submit log
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={bulkEditOpen}
        onClose={() => setBulkEditOpen(false)}
        title="Bulk edit logs"
        centered
        radius="md"
      >
        <Stack gap="md">
          <Select
            label="Comment mode"
            data={[
              { value: 'replace', label: 'Replace existing comment' },
              { value: 'append', label: 'Append to existing comment' }
            ]}
            value={bulkEditMode}
            onChange={value => setBulkEditMode((value as 'replace' | 'append') ?? 'replace')}
          />
          <TextInput
            label="Hours (optional)"
            placeholder="HH:MM"
            value={bulkEditHours}
            onChange={event => setBulkEditHours(event.currentTarget.value)}
          />
          <Textarea
            label="Comment"
            placeholder="Enter a comment"
            value={bulkEditComment}
            onChange={event => setBulkEditComment(event.currentTarget.value)}
            autosize
            minRows={3}
          />
          {bulkActionError && (
            <Alert color="red" variant="light" radius="md">
              {bulkActionError}
            </Alert>
          )}
          <Group justify="space-between" align="center">
            <Button variant="subtle" onClick={() => setBulkEditOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                bulkEditReports(
                  filteredReportItems.filter(item =>
                    selectedReportEntries[getReportEntryKey(item, item.dateKey)]
                  )
                )
              }
              disabled={!bulkEditComment.trim() && !bulkEditHours.trim()}
            >
              Apply
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Product Tour - Disabled for now
      <ProductTour
        onComplete={() => {
          console.log('🎉 User completed the product tour!')
        }}
        onSkip={() => {
          console.log('⏭️ User skipped the product tour')
        }}
      />
      */}
    </Box>
  )
}
