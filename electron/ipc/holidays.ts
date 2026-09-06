import { ipcMain } from 'electron'
import Store from 'electron-store'

type IsraeliHoliday = {
  date: string
  name: string
  nameEnglish: string
  category: string
  yomTov: boolean
}

type HolidayCacheEntry = {
  fetchedAt: string
  holidays: IsraeliHoliday[]
}

type HolidayCacheSchema = {
  months: Record<string, HolidayCacheEntry>
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/
const cache = new Store<HolidayCacheSchema>({ name: 'israeli-holidays-cache' })

function monthRange(month: string) {
  if (!MONTH_PATTERN.test(month)) throw new Error('Invalid holiday month')
  const [yearValue, monthValue] = month.split('-').map(Number)
  const endDay = new Date(Date.UTC(yearValue, monthValue, 0)).getUTCDate()
  return { start: `${month}-01`, end: `${month}-${String(endDay).padStart(2, '0')}` }
}

function cleanText(value: unknown, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function normalizeHolidayItems(value: unknown): IsraeliHoliday[] {
  const items = value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)
    ? (value as { items: unknown[] }).items
    : []
  const seen = new Set<string>()
  const holidays: IsraeliHoliday[] = []
  for (const item of items) {
    const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : {}
    if (record.category !== 'holiday') continue
    const date = cleanText(record.date, 10)
    const name = cleanText(record.hebrew || record.title, 160)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name) continue
    const key = `${date}\u0000${name}`
    if (seen.has(key)) continue
    seen.add(key)
    holidays.push({
      date,
      name,
      nameEnglish: cleanText(record.title_orig, 160),
      category: cleanText(record.subcat, 40) || 'holiday',
      yomTov: record.yomtov === true
    })
  }
  return holidays.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name, 'he'))
}

async function fetchIsraeliHolidays(month: string) {
  const { start, end } = monthRange(month)
  const query = new URLSearchParams({
    v: '1',
    cfg: 'json',
    start,
    end,
    i: 'on',
    maj: 'on',
    min: 'on',
    mod: 'on',
    lg: 'he'
  })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 12_000)
  try {
    const response = await fetch(`https://www.hebcal.com/hebcal?${query.toString()}`, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    })
    if (!response.ok) throw new Error(`Hebcal request failed (${response.status})`)
    return normalizeHolidayItems(await response.json())
  } finally {
    clearTimeout(timeout)
  }
}

export function registerIsraeliHolidaysIpc() {
  ipcMain.handle('holidays:getIsraeli', async (_event, monthValue: unknown) => {
    const month = cleanText(monthValue, 7)
    monthRange(month)
    const months = cache.get('months') ?? {}
    const cached = months[month]
    if (cached && Array.isArray(cached.holidays)) return cached.holidays

    try {
      const holidays = await fetchIsraeliHolidays(month)
      cache.set('months', {
        ...months,
        [month]: { fetchedAt: new Date().toISOString(), holidays }
      })
      return holidays
    } catch (error) {
      if (cached) return cached.holidays
      throw error
    }
  })
}
