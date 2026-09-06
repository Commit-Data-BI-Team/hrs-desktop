import { expect, test } from '@playwright/test'
import * as XLSX from 'xlsx'
import {
  buildDetailedReportWorkbookBase64,
  sanitizeReportFilePart,
  type DetailedReportEntry
} from '../../src/reportExport'

const rows: DetailedReportEntry[] = [
  {
    date: '2026-09-03',
    employee: 'Dror Rahamim',
    customer: 'Telos',
    rawCustomer: 'Telos',
    project: 'Price transparency',
    task: 'Monthly report',
    minutes: 90,
    hoursHHMM: '01:30',
    fromTime: '09:00:00',
    toTime: '10:30:00',
    comment: 'Prepared the customer report',
    reportingFrom: 'OFFICE',
    source: 'hrs'
  },
  {
    date: '2026-09-04',
    employee: 'Chen Aharon',
    customer: 'Telos',
    rawCustomer: 'Telos',
    project: 'Price transparency',
    task: 'QA',
    minutes: 60,
    hoursHHMM: '01:00',
    fromTime: '11:15',
    toTime: '12:15',
    comment: 'בדיקות ותיקונים',
    reportingFrom: 'HOME',
    source: 'supabase'
  }
]

test('builds a detailed monthly workbook with times, comments, and totals', () => {
  const content = buildDetailedReportWorkbookBase64(rows, {
    monthKey: '2026-09',
    monthLabel: 'September 2026',
    generatedAt: new Date('2026-09-06T08:00:00Z')
  })
  const workbook = XLSX.read(content, { type: 'base64' })

  expect(workbook.SheetNames).toEqual(['Summary', 'Detailed hours'])
  const details = XLSX.utils.sheet_to_json<Array<string | number>>(
    workbook.Sheets['Detailed hours'],
    { header: 1, raw: true }
  )
  expect(details[0]).toEqual([
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
  ])
  expect(details[1]).toContain('Prepared the customer report')
  expect(details[1]).toContain('09:00')
  expect(details[2]).toContain('בדיקות ותיקונים')
  expect(details.at(-1)).toContain('02:30')
})

test('creates safe cross-platform customer filenames', () => {
  expect(sanitizeReportFilePart(' Telos: Prices / Hours? ')).toBe('Telos-Prices-Hours')
  expect(sanitizeReportFilePart('ביקורופא')).toBe('ביקורופא')
})
