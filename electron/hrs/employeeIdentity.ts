// Only authenticated self metadata is eligible. Task IDs, Django user IDs,
// and employees mentioned in report rows are not HRS employee IDs.
export type EmployeeIdentity = {
  employeeId: string
  employeeName: string | null
  username: string | null
  email: string | null
}

const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null

function positiveId(value: unknown): string | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null
  const text = String(value).trim()
  return /^[1-9]\d*$/.test(text) && Number.isSafeInteger(Number(text)) ? text : null
}

function field(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

export function employeeFromSelfPayload(payload: unknown): EmployeeIdentity | null {
  const root = object(payload)
  if (!root || 'taskId' in root || 'task_id' in root) return null
  const candidates: EmployeeIdentity[] = []
  function collect(value: unknown, employeeObject = false, account?: Record<string, unknown>) {
    const record = object(value)
    if (!record || 'taskId' in record || 'task_id' in record) return
    const ids = [record.currentEmployeeId, record.current_employee_id, record.employeeId, record.employee_id]
    if (employeeObject) ids.push(record.id)
    for (const raw of ids) {
      const employeeId = positiveId(raw)
      if (employeeId) candidates.push({
        employeeId, employeeName: field(record, 'employeeName', 'employee_name', 'full_name', 'fullName'),
        email: field(record, 'email', 'userEmail', 'user_email') ?? (account ? field(account, 'email') : null),
        username: field(record, 'username', 'user_name') ?? (account ? field(account, 'username') : null)
      })
    }
  }
  collect(root)
  for (const key of ['currentEmployee', 'current_employee', 'employee']) collect(root[key], true)
  for (const key of ['currentUser', 'current_user', 'user', 'me']) {
    const user = object(root[key])
    collect(user)
    collect(user?.employee, true, user ?? undefined)
  }
  if (new Set(candidates.map(x => x.employeeId)).size !== 1) return null
  return candidates.find(candidate => candidate.email) ?? candidates[0]
}

export function employeeFromSelfPage(html: string): EmployeeIdentity | null {
  // Inspect explicit self markers, not arbitrary links (which may refer to a colleague).
  const hits: EmployeeIdentity[] = []
  for (const tag of html.matchAll(/<(?:body|main|div)\b[^>]*>/gi)) {
    if (!/^<body\b|\bid=["'](?:root|app)["']/i.test(tag[0])) continue
    const marker = tag[0].match(/\bdata-current-employee-id\s*=\s*["'](\d+)["']/i)
    const identity = employeeFromSelfPayload({ employee_id: marker?.[1] })
    if (identity) hits.push(identity)
  }
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\btype=["']application\/json["']/i.test(match[1])) continue
    try {
      const identity = employeeFromSelfPayload(JSON.parse(match[2]))
      if (identity) hits.push(identity)
    } catch { /* Not self metadata. */ }
  }
  return new Set(hits.map(x => x.employeeId)).size === 1 ? hits[0] : null
}

export function adminSessionLogin(html: string): string | null {
  const tools = html.match(/<div\b[^>]*\bid=["']user-tools["'][^>]*>([\s\S]*?)<\/div>/i)?.[1]
  const login = tools?.match(/<strong\b[^>]*>\s*([^<>]+?)\s*<\/strong>/i)?.[1]?.trim()
  return login && login.length <= 200 ? login : null
}

export function selectSessionEmployee<T extends { username: string; email: string; isActive: boolean }>(
  rows: T[], login: string | null
): T | null {
  const key = login?.trim().toLowerCase()
  if (!key) return null
  const matches = rows.filter(row => row.isActive && [row.username, row.email].some(
    value => value.trim().toLowerCase() === key
  ))
  return matches.length === 1 ? matches[0] : null
}
