import * as XLSX from 'xlsx'

export type DetailedReportEntry = {
  date: string
  employee: string
  customer: string
  rawCustomer: string
  project: string
  task: string
  minutes: number
  hoursHHMM: string
  fromTime: string
  toTime: string
  comment: string
  reportingFrom: string
  source: string
}

export type DetailedReportWorkbookOptions = {
  monthKey: string
  monthLabel: string
  customer?: string | null
  generatedAt?: Date
}

function minutesToHHMM(totalMinutes: number) {
  const safeMinutes = Math.max(0, Math.round(totalMinutes))
  const hours = Math.floor(safeMinutes / 60)
  const minutes = safeMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

function cleanTime(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})/)
  if (!match) return value.trim()
  return `${match[1].padStart(2, '0')}:${match[2]}`
}

export function sanitizeReportFilePart(value: string) {
  return (
    value
      .normalize('NFKC')
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^[.-]+|[.-]+$/g, '')
      .slice(0, 80) || 'customer'
  )
}

export function buildDetailedReportWorkbookBase64(
  entries: DetailedReportEntry[],
  options: DetailedReportWorkbookOptions
) {
  const rows = [...entries].sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      cleanTime(a.fromTime).localeCompare(cleanTime(b.fromTime)) ||
      a.employee.localeCompare(b.employee) ||
      a.customer.localeCompare(b.customer) ||
      a.project.localeCompare(b.project) ||
      a.task.localeCompare(b.task)
  )
  const totalMinutes = rows.reduce((sum, row) => sum + Math.max(0, row.minutes), 0)
  const generatedAt = options.generatedAt ?? new Date()
  const sources = Array.from(new Set(rows.map(row => row.source).filter(Boolean))).sort()

  const summaryGroups = new Map<
    string,
    { customer: string; project: string; employee: string; entries: number; minutes: number }
  >()
  for (const row of rows) {
    const key = `${row.rawCustomer}\u0000${row.project}\u0000${row.employee}`
    const current = summaryGroups.get(key) ?? {
      customer: row.customer,
      project: row.project,
      employee: row.employee,
      entries: 0,
      minutes: 0
    }
    current.entries += 1
    current.minutes += Math.max(0, row.minutes)
    summaryGroups.set(key, current)
  }

  const groupedRows = Array.from(summaryGroups.values()).sort(
    (a, b) =>
      a.customer.localeCompare(b.customer) ||
      a.project.localeCompare(b.project) ||
      a.employee.localeCompare(b.employee)
  )
  const summaryHeaderRow = 11
  const summaryData = [
    ['HRS Desktop detailed report'],
    ['Month', options.monthLabel],
    ['Scope', options.customer ? 'Customer' : 'All customers'],
    ['Customer', options.customer ?? 'All customers'],
    ['Employees', new Set(rows.map(row => row.employee)).size],
    ['Entries', rows.length],
    ['Total duration', minutesToHHMM(totalMinutes)],
    ['Total decimal hours', Number((totalMinutes / 60).toFixed(2))],
    ['Generated', generatedAt.toISOString()],
    ['Sources', sources.join(', ')],
    [],
    ['Customer', 'Project', 'Employee', 'Entries', 'Duration', 'Decimal hours'],
    ...groupedRows.map(row => [
      row.customer,
      row.project,
      row.employee,
      row.entries,
      minutesToHHMM(row.minutes),
      Number((row.minutes / 60).toFixed(2))
    ]),
    ['TOTAL', '', '', rows.length, minutesToHHMM(totalMinutes), Number((totalMinutes / 60).toFixed(2))]
  ]
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData)
  summarySheet['!cols'] = [
    { wch: 28 },
    { wch: 30 },
    { wch: 24 },
    { wch: 12 },
    { wch: 14 },
    { wch: 16 }
  ]
  if (groupedRows.length) {
    summarySheet['!autofilter'] = {
      ref: `A${summaryHeaderRow + 1}:F${summaryHeaderRow + groupedRows.length + 1}`
    }
  }

  const detailHeaders = [
    'Date',
    'Day',
    'Employee',
    'Customer',
    'Project',
    'Task',
    'From',
    'To',
    'Duration',
    'Decimal hours',
    'Comment',
    'Reporting from',
    'Source'
  ]
  const detailData = rows.map(row => {
    const parsedDate = new Date(`${row.date}T12:00:00`)
    const day = Number.isNaN(parsedDate.valueOf())
      ? ''
      : parsedDate.toLocaleDateString('en-US', { weekday: 'long' })
    return [
      row.date,
      day,
      row.employee,
      row.customer,
      row.project,
      row.task,
      cleanTime(row.fromTime),
      cleanTime(row.toTime),
      row.hoursHHMM || minutesToHHMM(row.minutes),
      Number((Math.max(0, row.minutes) / 60).toFixed(2)),
      row.comment,
      row.reportingFrom,
      row.source
    ]
  })
  detailData.push([
    'TOTAL',
    '',
    '',
    '',
    '',
    '',
    '',
    '',
    minutesToHHMM(totalMinutes),
    Number((totalMinutes / 60).toFixed(2)),
    '',
    '',
    ''
  ])
  const detailsSheet = XLSX.utils.aoa_to_sheet([detailHeaders, ...detailData])
  detailsSheet['!cols'] = [
    { wch: 12 },
    { wch: 12 },
    { wch: 24 },
    { wch: 26 },
    { wch: 28 },
    { wch: 30 },
    { wch: 9 },
    { wch: 9 },
    { wch: 11 },
    { wch: 14 },
    { wch: 55 },
    { wch: 18 },
    { wch: 18 }
  ]
  if (rows.length) {
    detailsSheet['!autofilter'] = { ref: `A1:M${rows.length + 1}` }
  }

  const workbook = XLSX.utils.book_new()
  workbook.Props = {
    Title: `HRS Desktop report ${options.monthKey}`,
    Subject: options.customer
      ? `Detailed hours for ${options.customer}`
      : `Detailed monthly hours for ${options.monthLabel}`,
    Author: 'HRS Desktop',
    CreatedDate: generatedAt
  }
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary')
  XLSX.utils.book_append_sheet(workbook, detailsSheet, 'Detailed hours')
  return XLSX.write(workbook, { bookType: 'xlsx', type: 'base64', compression: true })
}
