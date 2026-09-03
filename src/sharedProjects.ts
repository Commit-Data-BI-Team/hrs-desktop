export type SharedProjectSourceEntry = {
  employee: string
  customer: string
  rawCustomer?: string
  project?: string | null
  task: string
  minutes: number
  taskId?: string | null
}

export type SharedProjectTaskTotal = {
  task: string
  totalMinutes: number
}

export type SharedProjectEmployeeTotal = {
  employee: string
  totalMinutes: number
  tasks: SharedProjectTaskTotal[]
}

export type SharedProjectSummary = {
  key: string
  customer: string
  rawCustomer: string
  project: string
  totalMinutes: number
  taskIds: string[]
  tasks: SharedProjectTaskTotal[]
  employees: SharedProjectEmployeeTotal[]
}

export type EmployeeProjectSummary = {
  employee: string
  totalMinutes: number
  customers: Array<{
    customer: string
    rawCustomer: string
    project: string
    projectKey: string
    totalMinutes: number
    tasks: SharedProjectTaskTotal[]
  }>
}

export type SharedProjectCapSource = {
  customerName: string
  projectName?: string | null
  cappedHours?: number | null
  projectCappedHours?: number | null
}

export function replaceEmployeeEntriesWithLive<
  T extends { employeeId: string | null | undefined }
>(sharedEntries: T[], employeeId: string, liveEntries: T[]) {
  if (!employeeId) return sharedEntries
  return [
    ...sharedEntries.filter(entry => String(entry.employeeId ?? '') !== employeeId),
    ...liveEntries
  ]
}

function normalizeProjectKeyPart(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function getSharedProjectKey(customer: string, project?: string | null) {
  const normalizedCustomer = customer.trim() || 'No customer'
  const normalizedProject = project?.trim() || normalizedCustomer
  return `${normalizeProjectKeyPart(normalizedCustomer)}\u0000${normalizeProjectKeyPart(normalizedProject)}`
}

export function getSharedProjectCapMinutes(
  missions: SharedProjectCapSource[],
  customer: string,
  project?: string | null
) {
  const globalCapMinutes = getGlobalProjectCapMinutes(missions, customer, project)
  if (globalCapMinutes > 0) return globalCapMinutes

  const projectKey = getSharedProjectKey(customer, project)
  const matchingMissions = missions.filter(
    mission => getSharedProjectKey(mission.customerName, mission.projectName) === projectKey
  )
  return matchingMissions.reduce((sum, mission) => {
    if (!mission.cappedHours || mission.cappedHours <= 0) return sum
    return sum + Math.round(mission.cappedHours * 60)
  }, 0)
}

export function getGlobalProjectCapMinutes(
  missions: SharedProjectCapSource[],
  customer: string,
  project?: string | null
) {
  const projectKey = getSharedProjectKey(customer, project)
  const globalCap = missions.find(
    mission =>
      mission.projectCappedHours &&
      mission.projectCappedHours > 0 &&
      getSharedProjectKey(mission.customerName, mission.projectName) === projectKey
  )?.projectCappedHours
  return globalCap ? Math.round(globalCap * 60) : 0
}

export function aggregateSharedProjects(
  entries: SharedProjectSourceEntry[]
): SharedProjectSummary[] {
  const projects = new Map<
    string,
    {
      key: string
      customer: string
      rawCustomer: string
      project: string
      totalMinutes: number
      taskIds: Set<string>
      tasks: Map<string, number>
      employees: Map<string, { totalMinutes: number; tasks: Map<string, number> }>
    }
  >()

  for (const entry of entries) {
    if (!Number.isFinite(entry.minutes) || entry.minutes <= 0) continue
    const employee = entry.employee.trim() || 'Employee'
    const rawCustomer = entry.rawCustomer?.trim() || entry.customer.trim() || 'No customer'
    const customer = entry.customer.trim() || rawCustomer
    const project = entry.project?.trim() || rawCustomer
    const task = entry.task.trim() || 'No task'
    const key = getSharedProjectKey(rawCustomer, project)
    const row =
      projects.get(key) ?? {
        key,
        customer,
        rawCustomer,
        project,
        totalMinutes: 0,
        taskIds: new Set<string>(),
        tasks: new Map<string, number>(),
        employees: new Map<string, { totalMinutes: number; tasks: Map<string, number> }>()
      }

    row.totalMinutes += entry.minutes
    if (entry.taskId) row.taskIds.add(String(entry.taskId))
    row.tasks.set(task, (row.tasks.get(task) ?? 0) + entry.minutes)
    const employeeRow = row.employees.get(employee) ?? {
      totalMinutes: 0,
      tasks: new Map<string, number>()
    }
    employeeRow.totalMinutes += entry.minutes
    employeeRow.tasks.set(task, (employeeRow.tasks.get(task) ?? 0) + entry.minutes)
    row.employees.set(employee, employeeRow)
    projects.set(key, row)
  }

  const toTaskTotals = (tasks: Map<string, number>) =>
    Array.from(tasks, ([task, totalMinutes]) => ({ task, totalMinutes })).sort(
      (a, b) => b.totalMinutes - a.totalMinutes || a.task.localeCompare(b.task)
    )

  return Array.from(projects.values())
    .map(row => ({
      key: row.key,
      customer: row.customer,
      rawCustomer: row.rawCustomer,
      project: row.project,
      totalMinutes: row.totalMinutes,
      taskIds: Array.from(row.taskIds),
      tasks: toTaskTotals(row.tasks),
      employees: Array.from(row.employees, ([employee, employeeRow]) => ({
        employee,
        totalMinutes: employeeRow.totalMinutes,
        tasks: toTaskTotals(employeeRow.tasks)
      })).sort((a, b) => b.totalMinutes - a.totalMinutes || a.employee.localeCompare(b.employee))
    }))
    .sort(
      (a, b) =>
        b.totalMinutes - a.totalMinutes ||
        a.customer.localeCompare(b.customer) ||
        a.project.localeCompare(b.project)
    )
}

export function aggregateEmployeeProjects(
  entries: SharedProjectSourceEntry[]
): EmployeeProjectSummary[] {
  const employees = new Map<string, SharedProjectSourceEntry[]>()
  for (const entry of entries) {
    const employee = entry.employee.trim() || 'Employee'
    const list = employees.get(employee) ?? []
    list.push(entry)
    employees.set(employee, list)
  }

  return Array.from(employees, ([employee, employeeEntries]) => {
    const projects = aggregateSharedProjects(employeeEntries)
    return {
      employee,
      totalMinutes: projects.reduce((sum, project) => sum + project.totalMinutes, 0),
      customers: projects.map(project => ({
        customer: project.customer,
        rawCustomer: project.rawCustomer,
        project: project.project,
        projectKey: project.key,
        totalMinutes: project.totalMinutes,
        tasks: project.tasks
      }))
    }
  }).sort((a, b) => b.totalMinutes - a.totalMinutes || a.employee.localeCompare(b.employee))
}
