import { ipcMain } from 'electron'
import {
  addSyncAuditEntry,
  getProjectManagementConfig,
  getSyncAuditLog,
  removeCustomerMapping,
  removeMission,
  setReportingSource,
  setSyncMode,
  upsertCustomerMapping,
  upsertMission,
  validateMissionCap,
  type MissionStatus,
  type ProjectSyncMode,
  type ReportingSource,
  type SyncAuditAction,
  type SyncAuditEntity,
  type SyncAuditStatus
} from '../projectManagement/config'
import {
  validateDate,
  validateEnum,
  validateExactObject,
  validateJiraIssueKey,
  validateNumberRange,
  validateOptionalString,
  validateStringLength
} from '../utils/validation'

const JIRA_PROJECT_KEY_REGEX = /^[A-Z][A-Z0-9_]{0,14}$/

function validateStringList(value: unknown, label: string, maxItems = 200) {
  if (!Array.isArray(value)) throw new Error(`Invalid ${label}: expected array`)
  return Array.from(
    new Set(
      value
        .slice(0, maxItems)
        .map(item => validateStringLength(item, 1, 240))
        .filter(Boolean)
    )
  )
}

function validateProjectKeys(value: unknown) {
  return validateStringList(value, 'jiraProjectKeys', 50).map(projectKey => {
    const key = projectKey.toUpperCase()
    if (!JIRA_PROJECT_KEY_REGEX.test(key)) {
      throw new Error('Invalid Jira project key format')
    }
    return key
  })
}

function validateIssueKeys(value: unknown, label: string) {
  return validateStringList(value, label, 100).map(issueKey => validateJiraIssueKey(issueKey))
}

function validateOptionalIssueKey(value: unknown) {
  const raw = validateOptionalString(value, { min: 1, max: 64 })
  return raw ? validateJiraIssueKey(raw) : undefined
}

function validateOptionalDate(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined
  return validateDate(value)
}

function validateNullableHours(value: unknown, label: string) {
  if (value === null || value === undefined || value === '') return null
  return validateNumberRange(value, 0, 100_000)
}

function validateCustomerMappingPayload(payload: unknown) {
  const safe = validateExactObject<{
    id?: unknown
    hrsCustomerName?: unknown
    jiraProjectKeys?: unknown
    jiraEpicKeys?: unknown
    defaultJiraIssueKey?: unknown
    active?: unknown
    notes?: unknown
  }>(
    payload ?? {},
    ['id', 'hrsCustomerName', 'jiraProjectKeys', 'jiraEpicKeys', 'defaultJiraIssueKey', 'active', 'notes'],
    'customer project mapping'
  )
  const jiraProjectKeys = validateProjectKeys(safe.jiraProjectKeys ?? [])
  const jiraEpicKeys = validateIssueKeys(safe.jiraEpicKeys ?? [], 'jiraEpicKeys')
  if (!jiraProjectKeys.length && !jiraEpicKeys.length) {
    throw new Error('Customer mapping must include at least one Jira project or epic')
  }
  return {
    id: validateOptionalString(safe.id, { min: 1, max: 120 }) ?? undefined,
    hrsCustomerName: validateStringLength(safe.hrsCustomerName, 1, 200),
    jiraProjectKeys,
    jiraEpicKeys,
    defaultJiraIssueKey: validateOptionalIssueKey(safe.defaultJiraIssueKey),
    active: typeof safe.active === 'boolean' ? safe.active : true,
    notes: validateOptionalString(safe.notes, { min: 0, max: 2000 }) ?? undefined
  }
}

function validateMissionPayload(payload: unknown) {
  const safe = validateExactObject<{
    id?: unknown
    customerName?: unknown
    name?: unknown
    jiraIssueKey?: unknown
    hrsTaskIds?: unknown
    virtual?: unknown
    parentMissionId?: unknown
    assignedEmployees?: unknown
    plannedHours?: unknown
    cappedHours?: unknown
    status?: unknown
    startDate?: unknown
    dueDate?: unknown
    dependencies?: unknown
    notes?: unknown
  }>(
    payload ?? {},
    [
      'id',
      'customerName',
      'name',
      'jiraIssueKey',
      'hrsTaskIds',
      'virtual',
      'parentMissionId',
      'assignedEmployees',
      'plannedHours',
      'cappedHours',
      'status',
      'startDate',
      'dueDate',
      'dependencies',
      'notes'
    ],
    'project mission'
  )
  return {
    id: validateOptionalString(safe.id, { min: 1, max: 120 }) ?? undefined,
    customerName: validateStringLength(safe.customerName, 1, 200),
    name: validateStringLength(safe.name, 1, 240),
    jiraIssueKey: validateJiraIssueKey(safe.jiraIssueKey),
    hrsTaskIds: validateStringList(safe.hrsTaskIds ?? [], 'hrsTaskIds', 100),
    virtual: typeof safe.virtual === 'boolean' ? safe.virtual : false,
    parentMissionId:
      validateOptionalString(safe.parentMissionId, { min: 1, max: 120 }) ?? undefined,
    assignedEmployees: validateStringList(safe.assignedEmployees ?? [], 'assignedEmployees', 100),
    plannedHours: validateNullableHours(safe.plannedHours, 'plannedHours'),
    cappedHours: validateNullableHours(safe.cappedHours, 'cappedHours'),
    status: validateEnum(
      safe.status ?? 'todo',
      ['todo', 'in_progress', 'blocked', 'done', 'archived'] as const
    ) as MissionStatus,
    startDate: validateOptionalDate(safe.startDate),
    dueDate: validateOptionalDate(safe.dueDate),
    dependencies: validateStringList(safe.dependencies ?? [], 'dependencies', 100),
    notes: validateOptionalString(safe.notes, { min: 0, max: 4000 }) ?? undefined
  }
}

function validateAuditPayload(payload: unknown) {
  const safe = validateExactObject<{
    action?: unknown
    entity?: unknown
    source?: unknown
    status?: unknown
    employee?: unknown
    customerName?: unknown
    taskName?: unknown
    jiraIssueKey?: unknown
    hrsTaskId?: unknown
    reportingDate?: unknown
    previousSeconds?: unknown
    nextSeconds?: unknown
    message?: unknown
  }>(
    payload ?? {},
    [
      'action',
      'entity',
      'source',
      'status',
      'employee',
      'customerName',
      'taskName',
      'jiraIssueKey',
      'hrsTaskId',
      'reportingDate',
      'previousSeconds',
      'nextSeconds',
      'message'
    ],
    'sync audit entry'
  )
  return {
    action: validateEnum(
      safe.action,
      ['create', 'update', 'delete', 'skip', 'error'] as const
    ) as SyncAuditAction,
    entity: validateEnum(
      safe.entity,
      ['worklog', 'mapping', 'mission', 'cap_validation'] as const
    ) as SyncAuditEntity,
    source: validateEnum(safe.source, ['hrs', 'jira', 'system'] as const),
    status: validateEnum(
      safe.status,
      ['pending', 'applied', 'skipped', 'failed', 'dry_run'] as const
    ) as SyncAuditStatus,
    employee: validateOptionalString(safe.employee, { min: 0, max: 200 }) ?? undefined,
    customerName: validateOptionalString(safe.customerName, { min: 0, max: 200 }) ?? undefined,
    taskName: validateOptionalString(safe.taskName, { min: 0, max: 240 }) ?? undefined,
    jiraIssueKey: validateOptionalIssueKey(safe.jiraIssueKey),
    hrsTaskId: validateOptionalString(safe.hrsTaskId, { min: 0, max: 120 }) ?? undefined,
    reportingDate: validateOptionalDate(safe.reportingDate),
    previousSeconds:
      safe.previousSeconds === null || safe.previousSeconds === undefined
        ? null
        : validateNumberRange(safe.previousSeconds, 0, 10_000_000, { integer: true }),
    nextSeconds:
      safe.nextSeconds === null || safe.nextSeconds === undefined
        ? null
        : validateNumberRange(safe.nextSeconds, 0, 10_000_000, { integer: true }),
    message: validateOptionalString(safe.message, { min: 0, max: 4000 }) ?? undefined
  }
}

export function registerProjectManagementIpc() {
  ipcMain.handle('pm:getConfig', async () => getProjectManagementConfig())

  ipcMain.handle('pm:setReportingSource', async (_event, source: ReportingSource) => {
    const safeSource = validateEnum(source, ['hrs', 'jira'] as const)
    return setReportingSource(safeSource)
  })

  ipcMain.handle('pm:setSyncMode', async (_event, mode: ProjectSyncMode) => {
    const safeMode = validateEnum(mode, ['manual', 'automatic'] as const)
    return setSyncMode(safeMode)
  })

  ipcMain.handle('pm:upsertCustomerMapping', async (_event, payload: unknown) => {
    return upsertCustomerMapping(validateCustomerMappingPayload(payload))
  })

  ipcMain.handle('pm:removeCustomerMapping', async (_event, id: string) => {
    return removeCustomerMapping(validateStringLength(id, 1, 120))
  })

  ipcMain.handle('pm:upsertMission', async (_event, payload: unknown) => {
    return upsertMission(validateMissionPayload(payload))
  })

  ipcMain.handle('pm:removeMission', async (_event, id: string) => {
    return removeMission(validateStringLength(id, 1, 120))
  })

  ipcMain.handle('pm:validateMissionCap', async (_event, payload: unknown) => {
    const safe = validateExactObject<{
      missionId?: unknown
      usedHours?: unknown
      additionalHours?: unknown
    }>(
      payload ?? {},
      ['missionId', 'usedHours', 'additionalHours'],
      'mission cap validation'
    )
    return validateMissionCap(
      validateStringLength(safe.missionId, 1, 120),
      validateNumberRange(safe.usedHours, 0, 100_000),
      safe.additionalHours === undefined
        ? 0
        : validateNumberRange(safe.additionalHours, 0, 100_000)
    )
  })

  ipcMain.handle('pm:getSyncAuditLog', async (_event, limit?: number) => {
    return getSyncAuditLog(
      limit === undefined ? 200 : validateNumberRange(limit, 1, 1000, { integer: true })
    )
  })

  ipcMain.handle('pm:addSyncAuditEntry', async (_event, payload: unknown) => {
    return addSyncAuditEntry(validateAuditPayload(payload))
  })
}
