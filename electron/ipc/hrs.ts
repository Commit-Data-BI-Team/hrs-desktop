import { BrowserWindow, ipcMain, session, Session } from 'electron'
import dayjs from 'dayjs'
import { clearCustomAuth, getCustomAuth, setCustomAuth } from '../hrs/config'
import { clearHrsCredentials, getHrsCredentials, setHrsCredentials } from '../hrs/credentials'
import {
  validateDate,
  validateExactObject,
  validateNumberRange,
  validateStringLength
} from '../utils/validation'

const HRS_ORIGIN = 'https://hrs.comm-it.co.il'
const ADMIN_KEY_URL = `${HRS_ORIGIN}/admin/reactuserreporting/`
const EMPLOYEE_ADMIN_URL = `${HRS_ORIGIN}/admin/sysmanage/employee/`
const HRS_CACHE_TTL_MS = 5 * 60 * 1000
const HRS_E2E = process.env.HRS_E2E === '1'
const TIME_HHMM_REGEX = /^(?:[01]?\d|2[0-3]):[0-5]\d$/
const HOURS_HHMM_REGEX = /^\d{1,2}:[0-5]\d$/
const MAX_SAFE_ENTITY_ID = 1_000_000_000

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

const E2E_TASKS = [
  {
    taskId: 101,
    taskName: 'Design sync',
    customerName: 'Acme Labs',
    projectName: 'Website revamp',
    projectInstance: 'Website revamp',
    reporting_mode: 'FROM_TO',
    commentsRequired: true,
    projectColor: '#6bd1e7',
    isActiveTask: true
  },
  {
    taskId: 102,
    taskName: 'Bug triage',
    customerName: 'Northwind',
    projectName: 'Core platform',
    projectInstance: 'Core platform',
    reporting_mode: 'FROM_TO',
    commentsRequired: true,
    projectColor: '#f0c36b',
    isActiveTask: true
  },
  {
    taskId: 103,
    taskName: 'Reporting',
    customerName: 'Globex',
    projectName: 'Analytics',
    projectInstance: 'Analytics',
    reporting_mode: 'FROM_TO',
    commentsRequired: false,
    projectColor: '#7bd38a',
    isActiveTask: true
  }
]

function minutesToHHMM(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function buildE2EReport(startDate: string, endDate: string) {
  const start = dayjs(startDate)
  const end = dayjs(endDate)
  const days = []
  let totalMinutes = 0
  let cursor = start

  while (cursor.isSame(end, 'day') || cursor.isBefore(end, 'day')) {
    const date = cursor.format('YYYY-MM-DD')
    const weekday = cursor.day()
    const reports = []

    if (weekday !== 0 && weekday !== 6 && cursor.date() % 3 === 0) {
      const task = E2E_TASKS[cursor.date() % E2E_TASKS.length]
      const minutes = 90
      reports.push({
        taskId: task.taskId,
        taskName: task.taskName,
        projectInstance: task.projectInstance,
        hours_HHMM: minutesToHHMM(minutes),
        comment: 'E2E log',
        reporting_from: 'HRS'
      })
      totalMinutes += minutes
    }

    if (cursor.date() === 1) {
      const task = E2E_TASKS[1]
      const minutes = 120
      reports.push({
        taskId: task.taskId,
        taskName: task.taskName,
        projectInstance: task.projectInstance,
        hours_HHMM: minutesToHHMM(minutes),
        comment: 'Kickoff',
        reporting_from: 'HRS'
      })
      totalMinutes += minutes
    }

    days.push({
      date,
      minWorkLog: 0,
      isHoliday: false,
      reports
    })

    cursor = cursor.add(1, 'day')
  }

  const totalHours = Math.round((totalMinutes / 60) * 10) / 10

  return {
    totalHoursNeeded: 160,
    totalHours,
    closed_date: end.format('YYYY-MM-DD'),
    totalDays: days.length,
    days,
    weekend: 'Sat-Sun'
  }
}

const hrsCache = new Map<string, { expiresAt: number; value: unknown }>()

function getCachedValue<T>(key: string): T | null {
  const entry = hrsCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    hrsCache.delete(key)
    return null
  }
  return entry.value as T
}

function setCachedValue(key: string, value: unknown) {
  hrsCache.set(key, { expiresAt: Date.now() + HRS_CACHE_TTL_MS, value })
}

function validateTime(value: unknown, fieldName: string): string {
  const safe = validateStringLength(value, 4, 5)
  if (!TIME_HHMM_REGEX.test(safe)) {
    throw new Error(`Invalid ${fieldName}: expected HH:MM`)
  }
  return safe
}

function validateHoursHHMM(value: unknown): string {
  const safe = validateStringLength(value, 4, 5)
  if (!HOURS_HHMM_REGEX.test(safe)) {
    throw new Error('Invalid hours_HHMM format')
  }
  return safe
}

function validateLogWorkPayload(payload: unknown) {
  const safePayload = validateExactObject<{ date?: unknown; workLogs?: unknown }>(
    payload ?? {},
    ['date', 'workLogs'],
    'log work payload'
  )
  const date = validateDate(safePayload.date)
  if (!Array.isArray(safePayload.workLogs)) {
    throw new Error('Invalid workLogs: expected array')
  }
  if (safePayload.workLogs.length > 200) {
    throw new Error('Too many work logs in one request')
  }
  const workLogs = safePayload.workLogs.map(item => {
    const safeItem = validateExactObject<{
      id?: unknown
      from?: unknown
      to?: unknown
      hours_HHMM?: unknown
      hours?: unknown
      comment?: unknown
      notSaved?: unknown
      reporting_from?: unknown
      taskId?: unknown
    }>(
      item,
      ['id', 'from', 'to', 'hours_HHMM', 'hours', 'comment', 'notSaved', 'reporting_from', 'taskId'],
      'work log item'
    )
    return {
      id: validateNumberRange(safeItem.id, 1, MAX_SAFE_ENTITY_ID, { integer: true }),
      from: validateTime(safeItem.from, 'from'),
      to: validateTime(safeItem.to, 'to'),
      hours_HHMM: validateHoursHHMM(safeItem.hours_HHMM),
      hours: validateNumberRange(safeItem.hours, 0, 24),
      comment: validateStringLength(safeItem.comment, 0, 2000),
      notSaved: typeof safeItem.notSaved === 'boolean' ? safeItem.notSaved : false,
      reporting_from: validateStringLength(safeItem.reporting_from, 1, 100),
      taskId: validateNumberRange(safeItem.taskId, 1, MAX_SAFE_ENTITY_ID, { integer: true })
    }
  })
  return { date, workLogs }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function extractFirstMatch(html: string, pattern: RegExp): string {
  const match = html.match(pattern)
  return match?.[1] ? stripHtml(match[1]) : ''
}

function extractBooleanIcon(rowHtml: string, className: string): boolean {
  const cellPattern = new RegExp(`<td[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>([\\s\\S]*?)<\\/td>`, 'i')
  const cell = rowHtml.match(cellPattern)?.[1] ?? ''
  return /alt=["']True["']/i.test(cell) || /icon-yes/i.test(cell)
}

function normalizeEmployeeIdentity(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/@.*$/, '')
    .replace(/[^a-z0-9א-ת]+/gi, '')
    .trim()
}

function parseEmployeeRows(html: string): EmployeeAdminItem[] {
  const tbody = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)?.[1] ?? ''
  const rows = Array.from(tbody.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)).map(match => match[1])
  return rows
    .map(rowHtml => {
      const href = decodeHtml(
        rowHtml.match(/<th[^>]*class=["'][^"']*field-id[^"']*["'][^>]*>[\s\S]*?<a[^>]*href=["']([^"']+)["']/i)?.[1] ?? ''
      )
      return {
        id: extractFirstMatch(rowHtml, /<th[^>]*class=["'][^"']*field-id[^"']*["'][^>]*>([\s\S]*?)<\/th>/i),
        priorityId: extractFirstMatch(rowHtml, /<td[^>]*class=["'][^"']*field-priority_id[^"']*["'][^>]*>([\s\S]*?)<\/td>/i),
        fullName: extractFirstMatch(rowHtml, /<td[^>]*class=["'][^"']*field-full_name[^"']*["'][^>]*>([\s\S]*?)<\/td>/i),
        role: extractFirstMatch(rowHtml, /<td[^>]*class=["'][^"']*field-job_title[^"']*["'][^>]*>([\s\S]*?)<\/td>/i),
        internalId: extractFirstMatch(rowHtml, /<td[^>]*class=["'][^"']*field-internal_id[^"']*["'][^>]*>([\s\S]*?)<\/td>/i),
        username: extractFirstMatch(rowHtml, /<td[^>]*class=["'][^"']*field-username[^"']*["'][^>]*>([\s\S]*?)<\/td>/i),
        email: extractFirstMatch(rowHtml, /<td[^>]*class=["'][^"']*field-email[^"']*["'][^>]*>([\s\S]*?)<\/td>/i),
        phone: extractFirstMatch(rowHtml, /<td[^>]*class=["'][^"']*field-phone[^"']*["'][^>]*>([\s\S]*?)<\/td>/i),
        pnl: extractFirstMatch(rowHtml, /<td[^>]*class=["'][^"']*field-pnl[^"']*["'][^>]*>([\s\S]*?)<\/td>/i),
        nextPnl: extractFirstMatch(rowHtml, /<td[^>]*class=["'][^"']*field-next_pnl[^"']*["'][^>]*>([\s\S]*?)<\/td>/i),
        userRoles: extractFirstMatch(rowHtml, /<td[^>]*class=["'][^"']*field-user_roles_to_display[^"']*["'][^>]*>([\s\S]*?)<\/td>/i),
        reportsTo: extractFirstMatch(rowHtml, /<td[^>]*class=["'][^"']*field-reports_to[^"']*["'][^>]*>([\s\S]*?)<\/td>/i),
        positionType: extractFirstMatch(rowHtml, /<td[^>]*class=["'][^"']*field-partial_position_type[^"']*["'][^>]*>([\s\S]*?)<\/td>/i),
        maximumHours: extractFirstMatch(rowHtml, /<td[^>]*class=["'][^"']*field-Maximum_hours[^"']*["'][^>]*>([\s\S]*?)<\/td>/i),
        isSubContractor: extractBooleanIcon(rowHtml, 'field-is_sub_contractor'),
        isActive: extractBooleanIcon(rowHtml, 'field-is_active'),
        href: href.startsWith('http') ? href : `${HRS_ORIGIN}${href}`
      }
    })
    .filter(employee => employee.id && employee.fullName)
}

function ddmmyyyyToIso(value: string): string | null {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!match) return null
  return `${match[3]}-${match[2]}-${match[1]}`
}

function parseHoursToMinutes(value: string): number | null {
  const clean = stripHtml(value).trim()
  if (!clean || clean === '-' || clean === '–') return null
  const hhmm = clean.match(/^(\d{1,3}):([0-5]\d)$/)
  if (hhmm) {
    return Number(hhmm[1]) * 60 + Number(hhmm[2])
  }
  const decimal = clean.replace(',', '.').match(/^(\d+(?:\.\d+)?)$/)
  if (decimal) {
    return Math.round(Number(decimal[1]) * 60)
  }
  return null
}

function formatMinutesHHMM(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = Math.abs(totalMinutes % 60)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function parseSelectOptions(html: string, selectId: string): Array<{ value: string; label: string }> {
  const select = html.match(
    new RegExp(`<select[^>]*id=["']${selectId}["'][^>]*>([\\s\\S]*?)<\\/select>`, 'i')
  )?.[1]
  if (!select) return []
  return Array.from(select.matchAll(/<option[^>]*value=["']([^"']*)["'][^>]*>([\s\S]*?)<\/option>/gi))
    .map(match => ({
      value: decodeHtml(match[1] ?? ''),
      label: stripHtml(match[2] ?? '')
    }))
    .filter(option => option.label || option.value)
}

function parseNestedMetaCells(leftCellHtml: string): string[] {
  const innerRow =
    leftCellHtml.match(/<table[^>]*>[\s\S]*?<tr[^>]*>([\s\S]*?)<\/tr>[\s\S]*?<\/table>/i)?.[1] ??
    leftCellHtml
  return Array.from(innerRow.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi))
    .map(match => stripHtml(match[1] ?? ''))
}

function extractElementInner(html: string, tagName: string, openPattern: RegExp): string | null {
  const openMatch = openPattern.exec(html)
  if (!openMatch) return null
  const tokenPattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'gi')
  tokenPattern.lastIndex = openMatch.index
  let depth = 0
  let openEnd = -1
  let tokenMatch: RegExpExecArray | null
  while ((tokenMatch = tokenPattern.exec(html))) {
    const token = tokenMatch[0]
    if (token.startsWith('</')) {
      depth -= 1
      if (depth === 0 && openEnd >= 0) {
        return html.slice(openEnd, tokenMatch.index)
      }
    } else {
      depth += 1
      if (depth === 1 && openEnd < 0) {
        openEnd = tokenPattern.lastIndex
      }
    }
  }
  return null
}

function extractTopLevelElementInners(html: string, tagName: string): string[] {
  const tokenPattern = new RegExp(`<\\/?${tagName}\\b[^>]*>`, 'gi')
  const items: string[] = []
  let depth = 0
  let openEnd = -1
  let tokenMatch: RegExpExecArray | null
  while ((tokenMatch = tokenPattern.exec(html))) {
    const token = tokenMatch[0]
    if (token.startsWith('</')) {
      depth -= 1
      if (depth === 0 && openEnd >= 0) {
        items.push(html.slice(openEnd, tokenMatch.index))
        openEnd = -1
      }
    } else {
      if (depth === 0) {
        openEnd = tokenPattern.lastIndex
      }
      depth += 1
    }
  }
  return items
}

function parseEmployeeHoursReportHtml(
  html: string,
  options: { employeeId: string; fromDate: string; toDate: string; customerId: string; sourceUrl: string }
): EmployeeHoursReport {
  const table = extractElementInner(html, 'table', /<table[^>]*id=["']result_list["'][^>]*>/i)
  if (!table) {
    throw new Error('Employee hours table not found')
  }

  const header = extractElementInner(table, 'thead', /<thead[^>]*>/i) ?? ''
  const dateColumns = Array.from(header.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi))
    .map(match => ddmmyyyyToIso(stripHtml(match[1] ?? '')))
    .filter((date): date is string => Boolean(date))

  const tbody = extractElementInner(table, 'tbody', /<tbody[^>]*>/i) ?? ''
  const rows = extractTopLevelElementInners(tbody, 'tr')
  const entries: EmployeeHoursEntry[] = []
  let employeeName = ''

  for (const rowHtml of rows) {
    if (/>\s*Total\s*</i.test(rowHtml)) continue
    const leftMatch = rowHtml.match(/<td[^>]*colspan=["']5["'][^>]*>([\s\S]*?<\/table>)\s*<\/td>/i)
    if (!leftMatch?.[0]) continue
    const [employee = '', customer = '', task = '', milestone = ''] = parseNestedMetaCells(leftMatch[1])
    if (!employeeName && employee) employeeName = employee
    const taskId =
      rowHtml.match(/date_click\(["']?[^,"']+,([^,"']+),/i)?.[1] ??
      rowHtml.match(/task_move_all\(["']?[^,"']+,([^,"']+)/i)?.[1] ??
      null
    const remainder = rowHtml.slice((leftMatch.index ?? 0) + leftMatch[0].length)
    const cells = Array.from(remainder.matchAll(/<td[^>]*?(?:title=["']([^"']*)["'])?[^>]*>([\s\S]*?)<\/td>/gi))

    dateColumns.forEach((date, index) => {
      const cell = cells[index]
      if (!cell) return
      const rawValue = stripHtml(cell[1] || cell[2] || '')
      const minutes = parseHoursToMinutes(rawValue)
      if (minutes === null || minutes <= 0) return
      entries.push({
        date,
        employee,
        customer,
        task,
        milestone,
        hoursHHMM: formatMinutesHHMM(minutes),
        minutes,
        rawValue,
        taskId
      })
    })
  }

  const days = dateColumns.map(date => {
    const dayEntries = entries.filter(entry => entry.date === date)
    const totalMinutes = dayEntries.reduce((sum, entry) => sum + entry.minutes, 0)
    return { date, totalMinutes, entries: dayEntries }
  })

  return {
    employeeId: options.employeeId,
    employeeName,
    fromDate: options.fromDate,
    toDate: options.toDate,
    customerId: options.customerId,
    customerOptions: parseSelectOptions(html, 'customer_select'),
    dateColumns,
    days,
    entries,
    totalMinutes: entries.reduce((sum, entry) => sum + entry.minutes, 0),
    sourceUrl: options.sourceUrl
  }
}

function validateEmployeeHoursPayload(payload: unknown) {
  const safe = validateExactObject<{
    employeeId?: unknown
    fromDate?: unknown
    toDate?: unknown
    customerId?: unknown
  }>(payload ?? {}, ['employeeId', 'fromDate', 'toDate', 'customerId'], 'employee hours payload')
  const employeeId = validateStringLength(safe.employeeId, 1, 40)
  if (!/^\d+$/.test(employeeId)) {
    throw new Error('Invalid employeeId')
  }
  const fromDate = validateDate(safe.fromDate)
  const toDate = validateDate(safe.toDate)
  if (toDate < fromDate) {
    throw new Error('Invalid period: toDate is before fromDate')
  }
  const customerIdRaw = safe.customerId === undefined || safe.customerId === null ? '' : validateStringLength(safe.customerId, 0, 40)
  if (customerIdRaw && !/^\d+$/.test(customerIdRaw)) {
    throw new Error('Invalid customerId')
  }
  return { employeeId, fromDate, toDate, customerId: customerIdRaw }
}

async function fetchEmployeeAccess(cookieHeader: string): Promise<EmployeeAccessResult> {
  console.log('[EMPLOYEES ACCESS DEBUG] probing employee admin page')
  const res = await fetch(EMPLOYEE_ADMIN_URL, {
    headers: {
      Cookie: cookieHeader,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Referer: EMPLOYEE_ADMIN_URL,
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache'
    }
  })
  if (res.status === 401 || res.status === 403 || res.redirected || res.url.includes('/admin/login/')) {
    console.log(
      `[EMPLOYEES ACCESS DEBUG] no employee access status=${res.status} redirected=${res.redirected} url=${res.url}`
    )
    return {
      hasAccess: false,
      hasEmployees: false,
      currentEmployeeName: null,
      employees: [],
      allEmployeesCount: 0,
      source: 'none'
    }
  }
  if (!res.ok) {
    throw new Error(`employee admin ${res.status}`)
  }

  const html = await res.text()
  const looksLikeEmployeeAdmin =
    /Select employee to change/i.test(html) &&
    /id=["']result_list["']/i.test(html) &&
    /field-full_name/i.test(html)
  if (!looksLikeEmployeeAdmin) {
    console.log('[EMPLOYEES ACCESS DEBUG] employee admin markers missing')
    return {
      hasAccess: false,
      hasEmployees: false,
      currentEmployeeName: null,
      employees: [],
      allEmployeesCount: 0,
      source: 'none'
    }
  }

  const employees = parseEmployeeRows(html)
  const creds = await getHrsCredentials()
  const loginIdentity = normalizeEmployeeIdentity(creds.username)
  const currentEmployee =
    employees.find(employee => normalizeEmployeeIdentity(employee.username) === loginIdentity) ??
    employees.find(employee => normalizeEmployeeIdentity(employee.email) === loginIdentity)
  const currentEmployeeName = currentEmployee?.fullName ?? null
  const directReports = currentEmployeeName
    ? employees.filter(employee => employee.id !== currentEmployee.id && employee.reportsTo === currentEmployeeName)
    : []
  const visibleEmployees = directReports.length
    ? directReports
    : employees.filter(employee => employee.id !== currentEmployee?.id)

  console.log(
    `[EMPLOYEES ACCESS DEBUG] parsed rows=${employees.length} current=${currentEmployeeName ?? 'unknown'} directReports=${directReports.length} visible=${visibleEmployees.length}`
  )

  return {
    hasAccess: true,
    hasEmployees: visibleEmployees.length > 0,
    currentEmployeeName,
    employees: visibleEmployees,
    allEmployeesCount: employees.length,
    source: directReports.length ? 'directReports' : visibleEmployees.length ? 'accessibleRows' : 'none'
  }
}

async function fetchEmployeeHoursReport(
  cookieHeader: string,
  payload: { employeeId: string; fromDate: string; toDate: string; customerId: string }
): Promise<EmployeeHoursReport> {
  const url = new URL(`${HRS_ORIGIN}/admin/edithoursreport/`)
  url.searchParams.set('from_date', payload.fromDate)
  url.searchParams.set('to_date', payload.toDate)
  url.searchParams.set('employee_id', payload.employeeId)
  url.searchParams.set('customer_select', payload.customerId)

  console.log(
    `[EMPLOYEE HOURS DEBUG] fetching employee=${payload.employeeId} from=${payload.fromDate} to=${payload.toDate} customer=${payload.customerId || 'all'}`
  )
  const res = await fetch(url.toString(), {
    headers: {
      Cookie: cookieHeader,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Referer: `${HRS_ORIGIN}/admin/hoursreport/`,
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache'
    }
  })
  if (res.status === 401 || res.status === 403 || res.redirected || res.url.includes('/admin/login/')) {
    console.log(
      `[EMPLOYEE HOURS DEBUG] auth required status=${res.status} redirected=${res.redirected} url=${res.url}`
    )
    throw new Error('AUTH_REQUIRED')
  }
  if (!res.ok) {
    throw new Error(`employee hours ${res.status}`)
  }
  const html = await res.text()
  const report = parseEmployeeHoursReportHtml(html, {
    ...payload,
    sourceUrl: url.toString()
  })
  console.log(
    `[EMPLOYEE HOURS DEBUG] parsed employee=${report.employeeName || payload.employeeId} dates=${report.dateColumns.length} entries=${report.entries.length} totalMinutes=${report.totalMinutes}`
  )
  return report
}

function invalidateHrsCache(date?: string) {
  if (!date) {
    hrsCache.clear()
    return
  }
  const normalized = date.trim()
  for (const key of hrsCache.keys()) {
    if (key.startsWith('worklogs:')) {
      if (key === `worklogs:${normalized}`) hrsCache.delete(key)
    } else if (key.startsWith('reports:')) {
      const parts = key.split(':')
      if (parts.length === 3) {
        const start = parts[1]
        const end = parts[2]
        if (normalized >= start && normalized <= end) {
          hrsCache.delete(key)
        }
      }
    }
  }
}

export function registerHrsIpc(
  openLoginWindow: (options?: { username?: string; password?: string; autoSubmit?: boolean }) => Promise<boolean>
) {
  console.log('[ipc] registerHrsIpc')

  if (HRS_E2E) {
    ipcMain.handle('hrs:connectViaAdminLogin', async () => true)
    ipcMain.handle('hrs:getCredentials', async () => ({
      username: 'e2e@hrs.local',
      hasPassword: false
    }))
    ipcMain.handle('hrs:setCredentials', async () => true)
    ipcMain.handle('hrs:clearCredentials', async () => true)
    ipcMain.handle('hrs:autoLogin', async () => true)
    ipcMain.handle('hrs:checkSession', async () => true)
    ipcMain.handle('hrs:getWorkLogs', async () => E2E_TASKS)
    ipcMain.handle('hrs:getReports', async (_event, startDate: string, endDate: string) =>
      buildE2EReport(startDate, endDate)
    )
    ipcMain.handle('hrs:getEmployees', async () => ({
      hasAccess: true,
      hasEmployees: true,
      currentEmployeeName: 'E2E Manager',
      allEmployeesCount: 2,
      source: 'directReports',
      employees: [
        {
          id: '1001',
          priorityId: '1001',
          fullName: 'E2E Employee',
          role: 'Engineer',
          internalId: 'E2E-1',
          username: 'e2e.employee',
          email: 'employee@hrs.local',
          phone: '',
          pnl: 'E2E',
          nextPnl: '',
          userRoles: 'Employee',
          reportsTo: 'E2E Manager',
          positionType: 'Full position',
          maximumHours: '0',
          isSubContractor: false,
          isActive: true,
          href: `${HRS_ORIGIN}/admin/sysmanage/employee/1001/change/`
        }
      ]
    }))
    ipcMain.handle('hrs:getEmployeeHoursReport', async (_event, payload: unknown) => {
      const safe = validateEmployeeHoursPayload(payload)
      const dateColumns = []
      let cursor = dayjs(safe.fromDate)
      const end = dayjs(safe.toDate)
      while (cursor.isSame(end, 'day') || cursor.isBefore(end, 'day')) {
        dateColumns.push(cursor.format('YYYY-MM-DD'))
        cursor = cursor.add(1, 'day')
      }
      const entries: EmployeeHoursEntry[] = [
        {
          date: dateColumns[0] ?? safe.fromDate,
          employee: 'E2E Employee',
          customer: 'Acme Labs',
          task: 'Design sync',
          milestone: 'Implementation',
          hoursHHMM: '02:30',
          minutes: 150,
          rawValue: '2:30',
          taskId: '101'
        }
      ]
      return {
        employeeId: safe.employeeId,
        employeeName: 'E2E Employee',
        fromDate: safe.fromDate,
        toDate: safe.toDate,
        customerId: safe.customerId,
        customerOptions: [
          { value: '', label: 'All' },
          { value: '1', label: 'Acme Labs' }
        ],
        dateColumns,
        days: dateColumns.map(date => {
          const dayEntries = entries.filter(entry => entry.date === date)
          return {
            date,
            entries: dayEntries,
            totalMinutes: dayEntries.reduce((sum, entry) => sum + entry.minutes, 0)
          }
        }),
        entries,
        totalMinutes: entries.reduce((sum, entry) => sum + entry.minutes, 0),
        sourceUrl: `${HRS_ORIGIN}/admin/edithoursreport/`
      }
    })
    ipcMain.handle('hrs:logWork', async () => true)
    ipcMain.handle('hrs:deleteLog', async () => true)
    return
  }

  ipcMain.handle('hrs:connectViaAdminLogin', async () => {
    await openLoginWindow()
    try {
      await ensureCustomAuth(getLoginSession())
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[hrs] CustomAuth not available yet:', message)
    }
    return true
  })

  ipcMain.handle('hrs:getCredentials', async () => {
    const creds = await getHrsCredentials()
    return {
      username: creds.username,
      hasPassword: Boolean(creds.password)
    }
  })

  ipcMain.handle('hrs:setCredentials', async (_event, username: string, password: string) => {
    const safeUsername = validateStringLength(username, 1, 200)
    const safePassword = validateStringLength(password, 1, 300)
    await setHrsCredentials(safeUsername, safePassword)
    return true
  })

  ipcMain.handle('hrs:clearCredentials', async () => {
    await clearHrsCredentials()
    return true
  })

  ipcMain.handle('hrs:autoLogin', async () => {
    const creds = await getHrsCredentials()
    if (!creds.username || !creds.password) return false
    try {
      await openLoginWindow({
        username: creds.username,
        password: creds.password,
        autoSubmit: true
      })
      await ensureCustomAuth(getLoginSession())
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('hrs:checkSession', async () => {
    try {
      const loginSession = getLoginSession()
      const cookieHeader = await getCookieHeader(loginSession)
      const targetDate = getLocalIsoDate()
      const res = await fetch(
        `${HRS_ORIGIN}/api/user_work_logs/?date=${encodeURIComponent(targetDate)}`,
        {
          headers: {
            Cookie: cookieHeader,
            Accept: 'application/json'
          }
        }
      )
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          clearCustomAuth()
          return false
        }
        return false
      }
      void ensureCustomAuth(loginSession).catch(() => {})
      return true
    } catch (err) {
      if (err instanceof Error && err.message === 'AUTH_REQUIRED') {
        return false
      }
      return false
    }
  })

  ipcMain.handle('hrs:getWorkLogs', async (_event, date?: string) => {
    const cookieHeader = await getCookieHeader(getLoginSession())

    const targetDate = date ? validateDate(date) : getLocalIsoDate()
    const cacheKey = `worklogs:${targetDate}`
    const cached = getCachedValue(cacheKey)
    if (cached) return cached
    const res = await fetch(
      `${HRS_ORIGIN}/api/user_work_logs/?date=${encodeURIComponent(targetDate)}`,
      {
        headers: {
          Cookie: cookieHeader,
          Accept: 'application/json'
        }
      }
    )

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        clearCustomAuth()
        throw new Error('AUTH_REQUIRED')
      }
      throw new Error(`API failed ${res.status}`)
    }

    const payload = await res.json()
    setCachedValue(cacheKey, payload)
    return payload
  })

  ipcMain.handle('hrs:getReports', async (_event, startDate: string, endDate: string) => {
    const safeStartDate = validateDate(startDate)
    const safeEndDate = validateDate(endDate)
    const loginSession = getLoginSession()
    const customAuth = await ensureCustomAuth(loginSession)
    const cookieHeader = await getCookieHeader(loginSession)
    const cacheKey = `reports:${safeStartDate}:${safeEndDate}`
    const cached = getCachedValue(cacheKey)
    if (cached) return cached

    const res = await fetch(
      `${HRS_ORIGIN}/api/getReports/?startDate=${encodeURIComponent(safeStartDate)}&endDate=${encodeURIComponent(safeEndDate)}`,
      {
        headers: {
          Cookie: cookieHeader,
          Accept: 'application/json',
          CustomAuth: customAuth
        }
      }
    )

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        clearCustomAuth()
        throw new Error('AUTH_REQUIRED')
      }
      throw new Error(`getReports ${res.status}`)
    }

    const payload = await res.json()
    setCachedValue(cacheKey, payload)
    return payload
  })

  ipcMain.handle('hrs:getEmployees', async () => {
    const cookieHeader = await getCookieHeader(getLoginSession())
    const cached = getCachedValue<EmployeeAccessResult>('employees:access')
    if (cached) return cached
    const result = await fetchEmployeeAccess(cookieHeader)
    setCachedValue('employees:access', result)
    return result
  })

  ipcMain.handle('hrs:getEmployeeHoursReport', async (_event, payload: unknown) => {
    const safePayload = validateEmployeeHoursPayload(payload)
    const cookieHeader = await getCookieHeader(getLoginSession())
    const cacheKey = `employee-hours:${safePayload.employeeId}:${safePayload.fromDate}:${safePayload.toDate}:${safePayload.customerId}`
    const cached = getCachedValue<EmployeeHoursReport>(cacheKey)
    if (cached) return cached
    const result = await fetchEmployeeHoursReport(cookieHeader, safePayload)
    setCachedValue(cacheKey, result)
    return result
  })

  ipcMain.handle('hrs:logWork', async (_event, payload: unknown) => {
    const safePayload = validateLogWorkPayload(payload)
    const loginSession = getLoginSession()
    const customAuth = await ensureCustomAuth(loginSession)
    const cookieHeader = await getCookieHeader(loginSession)

    const result = await postLogWork(cookieHeader, customAuth, safePayload)
    invalidateHrsCache(safePayload.date)
    return result
  })

  ipcMain.handle('hrs:deleteLog', async (_event, date: string) => {
    const safeDate = validateDate(date)
    const loginSession = getLoginSession()
    const customAuth = await ensureCustomAuth(loginSession)
    const cookieHeader = await getCookieHeader(loginSession)

    const result = await postLogWork(cookieHeader, customAuth, {
      date: safeDate,
      workLogs: []
    })
    invalidateHrsCache(safeDate)
    return result
  })
}

function getLocalIsoDate(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function formatIsoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getMonthRange(date: Date) {
  const startDate = new Date(date.getFullYear(), date.getMonth(), 1)
  const endDate = new Date(date.getFullYear(), date.getMonth() + 1, 0)
  return { start: formatIsoDate(startDate), end: formatIsoDate(endDate) }
}

function getLoginSession() {
  return session.fromPartition('persist:hrs')
}

async function getCookieHeader(loginSession: Session): Promise<string> {
  const cookies = await loginSession.cookies.get({ domain: 'hrs.comm-it.co.il' })
  if (!cookies.length) {
    throw new Error('AUTH_REQUIRED')
  }
  return cookies.map(c => `${c.name}=${c.value}`).join('; ')
}

async function ensureCustomAuth(loginSession: Session): Promise<string> {
  const existing = getCustomAuth()
  if (existing) return existing

  try {
    const key = await fetchCustomAuth(loginSession)
    setCustomAuth(key)
    return key
  } catch (err) {
    clearCustomAuth()
    throw err instanceof Error ? err : new Error('AUTH_REQUIRED')
  }
}

function extractKeyFromHtmlOrDom(): string | null {
  const links = Array.from(document.querySelectorAll('a')) as HTMLAnchorElement[]
  for (const a of links) {
    const href = a.href || ''
    const idx = href.indexOf('key=')
    if (idx >= 0) {
      const key = new URL(href).searchParams.get('key')
      if (key && key.length > 10) return key
    }
  }

  const text = document.documentElement?.innerHTML || ''
  const m = text.match(/key=([0-9a-f]{20,64})/i)
  if (m?.[1]) return m[1]

  return null
}

async function fetchCustomAuth(loginSession: Session): Promise<string> {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        session: loginSession
      }
    })

    let done = false
    let timeoutId: NodeJS.Timeout | null = null

    const fail = (err: unknown) => {
      if (done) return
      done = true
      if (timeoutId) clearTimeout(timeoutId)
      try { win.close() } catch {}
      reject(err instanceof Error ? err : new Error('AUTH_REQUIRED'))
    }
    const succeed = (key: string) => {
      if (done) return
      done = true
      if (timeoutId) clearTimeout(timeoutId)
      try { win.close() } catch {}
      resolve(key)
    }
    timeoutId = setTimeout(() => {
      fail(new Error('AUTH_REQUIRED'))
    }, 20000)

    const tryExtract = async () => {
      try {
        const key = await win.webContents.executeJavaScript(
          `(${extractKeyFromHtmlOrDom.toString()})()`,
          true
        )
        if (key) succeed(key)
      } catch {}
    }

    const onNav = () => {
      void tryExtract()
    }

    win.webContents.on('did-navigate', onNav)
    win.webContents.on('did-finish-load', onNav)
    win.webContents.on('did-redirect-navigation', onNav)

    win.loadURL(ADMIN_KEY_URL).catch(fail)
  })
}

async function postLogWork(cookieHeader: string, customAuth: string, payload: unknown) {
  const res = await fetch(`${HRS_ORIGIN}/api/log_work/`, {
    method: 'POST',
    headers: {
      Cookie: cookieHeader,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      CustomAuth: customAuth
    },
    body: JSON.stringify(payload ?? {})
  })

  if (!res.ok) {
    let details = ''
    try {
      details = await res.text()
    } catch {
      details = ''
    }
    if (res.status === 401 || res.status === 403) {
      clearCustomAuth()
      throw new Error('AUTH_REQUIRED')
    }
    const trimmed = details.trim()
    const suffix = trimmed ? `: ${trimmed.slice(0, 400)}` : ''
    throw new Error(`log_work ${res.status}${suffix}`)
  }

  return true
}
