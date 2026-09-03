import { randomUUID } from 'node:crypto'
import Store from 'electron-store'

export type ReportingSource = 'hrs' | 'jira'
export type ProjectSyncMode = 'manual' | 'automatic'
export type MissionStatus = 'todo' | 'in_progress' | 'blocked' | 'done' | 'archived'

export type CustomerProjectMapping = {
  id: string
  hrsCustomerName: string
  jiraProjectKeys: string[]
  jiraEpicKeys: string[]
  defaultJiraIssueKey?: string
  active: boolean
  notes?: string
  updatedAt: string
}

export type ProjectMission = {
  id: string
  customerName: string
  projectName?: string | null
  name: string
  jiraIssueKey: string
  hrsTaskIds: string[]
  virtual: boolean
  parentMissionId?: string
  assignedEmployees: string[]
  plannedHours: number | null
  cappedHours: number | null
  projectCappedHours?: number | null
  status: MissionStatus
  startDate?: string
  dueDate?: string
  dependencies: string[]
  notes?: string
  createdAt: string
  updatedAt: string
}

export type SyncAuditStatus = 'pending' | 'applied' | 'skipped' | 'failed' | 'dry_run'
export type SyncAuditAction = 'create' | 'update' | 'delete' | 'skip' | 'error'
export type SyncAuditEntity = 'worklog' | 'mapping' | 'mission' | 'cap_validation'

export type SyncAuditEntry = {
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

export type ProjectManagementConfig = {
  reportingSource: ReportingSource
  syncMode: ProjectSyncMode
  utilizationThresholds: number[]
  customerMappings: CustomerProjectMapping[]
  missions: ProjectMission[]
  updatedAt: string
}

type Schema = {
  config?: ProjectManagementConfig
  auditLog?: SyncAuditEntry[]
}

const DEFAULT_THRESHOLDS = [50, 60, 70, 80, 90, 100]
const MAX_AUDIT_ENTRIES = 1000

const store = new Store<Schema>({
  name: 'project-management'
})

function nowIso() {
  return new Date().toISOString()
}

function defaultConfig(): ProjectManagementConfig {
  return {
    reportingSource: 'hrs',
    syncMode: 'manual',
    utilizationThresholds: DEFAULT_THRESHOLDS,
    customerMappings: [],
    missions: [],
    updatedAt: nowIso()
  }
}

export function getProjectManagementConfig(): ProjectManagementConfig {
  const stored = store.get('config')
  const defaults = defaultConfig()
  return {
    reportingSource: stored?.reportingSource ?? defaults.reportingSource,
    syncMode: stored?.syncMode ?? defaults.syncMode,
    utilizationThresholds: stored?.utilizationThresholds ?? defaults.utilizationThresholds,
    customerMappings: stored?.customerMappings ?? defaults.customerMappings,
    missions: stored?.missions ?? defaults.missions,
    updatedAt: stored?.updatedAt ?? defaults.updatedAt
  }
}

function setProjectManagementConfig(config: ProjectManagementConfig): ProjectManagementConfig {
  const updated = { ...config, updatedAt: nowIso() }
  store.set('config', updated)
  return updated
}

export function setReportingSource(source: ReportingSource): ProjectManagementConfig {
  const config = getProjectManagementConfig()
  return setProjectManagementConfig({ ...config, reportingSource: source })
}

export function setSyncMode(mode: ProjectSyncMode): ProjectManagementConfig {
  const config = getProjectManagementConfig()
  return setProjectManagementConfig({ ...config, syncMode: mode })
}

export function upsertCustomerMapping(
  mapping: Omit<CustomerProjectMapping, 'id' | 'updatedAt'> & {
    id?: string
    updatedAt?: string
  }
): CustomerProjectMapping {
  const config = getProjectManagementConfig()
  const id = mapping.id || randomUUID()
  const updated: CustomerProjectMapping = {
    id,
    hrsCustomerName: mapping.hrsCustomerName,
    jiraProjectKeys: mapping.jiraProjectKeys,
    jiraEpicKeys: mapping.jiraEpicKeys,
    defaultJiraIssueKey: mapping.defaultJiraIssueKey,
    active: mapping.active,
    notes: mapping.notes,
    updatedAt: nowIso()
  }
  const others = config.customerMappings.filter(item => item.id !== id)
  setProjectManagementConfig({
    ...config,
    customerMappings: [...others, updated].sort((a, b) =>
      a.hrsCustomerName.localeCompare(b.hrsCustomerName)
    )
  })
  return updated
}

export function removeCustomerMapping(id: string): ProjectManagementConfig {
  const config = getProjectManagementConfig()
  return setProjectManagementConfig({
    ...config,
    customerMappings: config.customerMappings.filter(item => item.id !== id)
  })
}

export function upsertMission(
  mission: Omit<ProjectMission, 'id' | 'createdAt' | 'updatedAt'> & {
    id?: string
    createdAt?: string
    updatedAt?: string
  }
): ProjectMission {
  const config = getProjectManagementConfig()
  const existing = mission.id
    ? config.missions.find(item => item.id === mission.id)
    : undefined
  const id = mission.id || randomUUID()
  const timestamp = nowIso()
  const updated: ProjectMission = {
    id,
    customerName: mission.customerName,
    projectName: mission.projectName ?? existing?.projectName ?? null,
    name: mission.name,
    jiraIssueKey: mission.jiraIssueKey,
    hrsTaskIds: mission.hrsTaskIds ?? [],
    virtual: mission.virtual,
    parentMissionId: mission.parentMissionId,
    assignedEmployees: mission.assignedEmployees,
    plannedHours: mission.plannedHours,
    cappedHours: mission.cappedHours,
    projectCappedHours: mission.projectCappedHours ?? existing?.projectCappedHours ?? null,
    status: mission.status,
    startDate: mission.startDate,
    dueDate: mission.dueDate,
    dependencies: mission.dependencies,
    notes: mission.notes,
    createdAt: existing?.createdAt ?? mission.createdAt ?? timestamp,
    updatedAt: timestamp
  }
  const others = config.missions.filter(item => item.id !== id)
  setProjectManagementConfig({
    ...config,
    missions: [...others, updated].sort((a, b) => a.name.localeCompare(b.name))
  })
  return updated
}

export function removeMission(id: string): ProjectManagementConfig {
  const config = getProjectManagementConfig()
  return setProjectManagementConfig({
    ...config,
    missions: config.missions.filter(item => item.id !== id)
  })
}

export function addSyncAuditEntry(
  entry: Omit<SyncAuditEntry, 'id' | 'createdAt'> & {
    id?: string
    createdAt?: string
  }
): SyncAuditEntry {
  const updated: SyncAuditEntry = {
    id: entry.id || randomUUID(),
    action: entry.action,
    entity: entry.entity,
    source: entry.source,
    status: entry.status,
    employee: entry.employee,
    customerName: entry.customerName,
    taskName: entry.taskName,
    jiraIssueKey: entry.jiraIssueKey,
    hrsTaskId: entry.hrsTaskId,
    reportingDate: entry.reportingDate,
    previousSeconds: entry.previousSeconds,
    nextSeconds: entry.nextSeconds,
    message: entry.message,
    createdAt: entry.createdAt || nowIso()
  }
  const current = store.get('auditLog') ?? []
  store.set('auditLog', [updated, ...current].slice(0, MAX_AUDIT_ENTRIES))
  return updated
}

export function getSyncAuditLog(limit = 200): SyncAuditEntry[] {
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)))
  return (store.get('auditLog') ?? []).slice(0, safeLimit)
}

export function validateMissionCap(
  missionId: string,
  usedHours: number,
  additionalHours = 0
) {
  const mission = getProjectManagementConfig().missions.find(item => item.id === missionId)
  if (!mission) {
    throw new Error('Mission not found')
  }
  const nextHours = usedHours + additionalHours
  const cappedHours = mission.cappedHours
  if (!cappedHours || cappedHours <= 0) {
    return {
      mission,
      capped: false,
      usedHours,
      additionalHours,
      nextHours,
      utilizationPercent: null,
      exceeded: false,
      crossedThresholds: [],
      requiresSeventyPercentPrompt: false
    }
  }
  const currentPercent = Math.floor((usedHours / cappedHours) * 100)
  const nextPercent = Math.floor((nextHours / cappedHours) * 100)
  const thresholds = getProjectManagementConfig().utilizationThresholds
  const crossedThresholds = thresholds.filter(
    threshold => currentPercent < threshold && nextPercent >= threshold
  )
  return {
    mission,
    capped: true,
    usedHours,
    additionalHours,
    nextHours,
    utilizationPercent: Math.max(0, Math.min(999, nextPercent)),
    exceeded: nextHours > cappedHours,
    crossedThresholds,
    requiresSeventyPercentPrompt: currentPercent < 70 && nextPercent >= 70
  }
}
