import { ipcMain } from 'electron'
import Store from 'electron-store'
import {
  clearJiraCredentials,
  getJiraCredentials,
  getJiraMappings,
  setJiraCredentials,
  setJiraMapping
} from '../jira/config'

const PROJECT_KEY = 'VDA'
const PROJECT_NAME = 'Data Analytics Tasks'
const JIRA_CACHE_TTL_MS = 5 * 60 * 1000
const JIRA_PERSIST_TTL_MS = 6 * 60 * 60 * 1000

type JiraWorkItemDetailsPayload = {
  items: JiraWorkItem[]
  partial: boolean
}

type JiraWorkItemDetailsCacheEntry = JiraWorkItemDetailsPayload & {
  fetchedAt: string
}

type JiraWorkItemsLightCacheEntry = {
  items: JiraWorkItem[]
  fetchedAt: string
}

const jiraStore = new Store<{
  workItemDetails: Record<string, JiraWorkItemDetailsCacheEntry>
  workItemsLight: Record<string, JiraWorkItemsLightCacheEntry>
}>({
  name: 'jira-cache'
})

const jiraCache = new Map<string, { expiresAt: number; value: unknown }>()
const workItemsLightRefreshInFlight = new Map<string, Promise<void>>()

function getCachedValue<T>(key: string): T | null {
  const entry = jiraCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    jiraCache.delete(key)
    return null
  }
  return entry.value as T
}

function setCachedValue(key: string, value: unknown, ttlMs = JIRA_CACHE_TTL_MS) {
  jiraCache.set(key, { expiresAt: Date.now() + ttlMs, value })
}

function getPersistedWorkItemsLight(epicKey: string): JiraWorkItemsLightCacheEntry | null {
  const store = jiraStore.get('workItemsLight')
  if (!store) return null
  return store[epicKey] ?? null
}

function setPersistedWorkItemsLight(epicKey: string, items: JiraWorkItem[]) {
  const store = jiraStore.get('workItemsLight') ?? {}
  store[epicKey] = { items, fetchedAt: new Date().toISOString() }
  jiraStore.set('workItemsLight', store)
}

function isPersistedLightFresh(entry: JiraWorkItemsLightCacheEntry) {
  const fetchedAt = Date.parse(entry.fetchedAt)
  return Number.isFinite(fetchedAt) && Date.now() - fetchedAt < JIRA_PERSIST_TTL_MS
}

function getPersistedWorkItemDetails(epicKey: string): JiraWorkItemDetailsCacheEntry | null {
  const store = jiraStore.get('workItemDetails')
  if (!store) return null
  return store[epicKey] ?? null
}

function setPersistedWorkItemDetails(epicKey: string, payload: JiraWorkItemDetailsPayload) {
  const store = jiraStore.get('workItemDetails') ?? {}
  store[epicKey] = { ...payload, fetchedAt: new Date().toISOString() }
  jiraStore.set('workItemDetails', store)
}

function isPersistedFresh(entry: JiraWorkItemDetailsCacheEntry) {
  const fetchedAt = Date.parse(entry.fetchedAt)
  return Number.isFinite(fetchedAt) && Date.now() - fetchedAt < JIRA_PERSIST_TTL_MS
}

function formatJqlDate(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  const year = date.getUTCFullYear()
  const month = pad(date.getUTCMonth() + 1)
  const day = pad(date.getUTCDate())
  const hour = pad(date.getUTCHours())
  const minute = pad(date.getUTCMinutes())
  return `${year}/${month}/${day} ${hour}:${minute}`
}

function mergeWorkItems(
  existing: JiraWorkItem[],
  updates: JiraWorkItem[]
): JiraWorkItem[] {
  const map = new Map<string, JiraWorkItem>()
  for (const item of existing) {
    map.set(item.key, item)
  }
  for (const item of updates) {
    map.set(item.key, item)
  }
  return Array.from(map.values())
}

function mergeWorkItemsDeep(existing: JiraWorkItem[], updates: JiraWorkItem[]): JiraWorkItem[] {
  const map = new Map<string, JiraWorkItem>()
  for (const item of existing) {
    const subtasks = item.subtasks ?? []
    map.set(item.key, {
      ...item,
      subtasks: subtasks.length
        ? Array.from(new Map(subtasks.map(subtask => [subtask.key, subtask])).values())
        : []
    })
  }
  for (const item of updates) {
    const current = map.get(item.key)
    const currentSubtasks = current?.subtasks ?? []
    const incomingSubtasks = item.subtasks ?? []
    const mergedSubtasks = Array.from(
      new Map(
        [...currentSubtasks, ...incomingSubtasks].map(subtask => [subtask.key, subtask])
      ).values()
    )
    map.set(item.key, {
      ...(current ?? {}),
      ...item,
      subtasks: mergedSubtasks
    })
  }
  return Array.from(map.values())
}

type JiraSearchIssue = {
  key: string
  fields?: {
    summary?: string
    status?: {
      name?: string | null
    } | null
    aggregatetimetracking?: {
      originalEstimateSeconds?: number | null
      timeSpentSeconds?: number | null
    } | null
    aggregatetimeoriginalestimate?: number | null
    aggregatetimespent?: number | null
    timespent?: number | null
    timeoriginalestimate?: number | null
    timetracking?: {
      originalEstimateSeconds?: number | null
      timeSpentSeconds?: number | null
    }
    assignee?: {
      displayName?: string | null
      accountId?: string | null
    } | null
    subtasks?: Array<{
      key: string
      fields?: {
        summary?: string
        assignee?: {
          displayName?: string | null
        } | null
      }
    }>
    worklog?: {
      total?: number
      worklogs?: JiraWorklogEntry[]
    }
  }
}

type JiraSearchResponse = {
  issues?: JiraSearchIssue[]
  total?: number
  startAt?: number
  maxResults?: number
}

type JiraWorklogEntry = {
  id: string
  started?: string | null
  timeSpentSeconds?: number | null
  comment?: unknown | null
  author?: {
    displayName?: string | null
    accountId?: string | null
  } | null
}

type JiraWorkItem = {
  key: string
  summary: string
  timespent: number
  estimateSeconds: number
  statusName?: string | null
  worklogTotal?: number
  lastWorklog?: JiraWorklogEntry | null
  worklogs?: Array<{
    id: string
    started: string | null
    seconds: number
    comment: unknown | null
    authorName?: string | null
    authorId?: string | null
  }>
  subtasks?: JiraWorkItem[]
  assigneeName?: string | null
}

export function registerJiraIpc() {
  ipcMain.handle('jira:getStatus', async () => {
    const { baseUrl, email, token } = await getJiraCredentials()
    const hasCredentials = Boolean(email && token)
    let configured = false
    if (hasCredentials) {
      try {
        await jiraRequest('/rest/api/3/myself')
        configured = true
      } catch {
        configured = false
      }
    }
    return {
      baseUrl,
      email: hasCredentials ? email : null,
      configured,
      hasCredentials,
      projectKey: PROJECT_KEY,
      projectName: PROJECT_NAME
    }
  })

  ipcMain.handle('jira:setCredentials', async (_event, email: string, token: string) => {
    if (!email || !token) {
      throw new Error('JIRA_AUTH_REQUIRED')
    }
    await setJiraCredentials(email, token)
    jiraCache.clear()
    return true
  })

  ipcMain.handle('jira:clearCredentials', async () => {
    await clearJiraCredentials()
    jiraCache.clear()
    jiraStore.clear()
    return true
  })

  ipcMain.handle('jira:getMappings', async () => {
    return getJiraMappings()
  })

  ipcMain.handle('jira:setMapping', async (_event, customer: string, epicKey: string | null) => {
    return setJiraMapping(customer, epicKey ?? null)
  })

  ipcMain.handle('jira:getEpics', async () => {
    const cached = getCachedValue<JiraEpic[]>('epics')
    if (cached) return cached
    const EPIC_FETCH_LIMIT = 200
    const jql = `project = ${PROJECT_KEY} AND issuetype = Epic ORDER BY updated DESC`
    const data = await searchIssues(jql, ['summary'], { limit: EPIC_FETCH_LIMIT })
    const epics = data.map(issue => ({
      key: issue.key,
      summary: issue.fields?.summary ?? issue.key
    }))
    setCachedValue('epics', epics, 30 * 60 * 1000)
    return epics
  })

  ipcMain.handle('jira:getWorkItems', async (_event, epicKey: string) => {
    if (!epicKey) return []
    const WORK_ITEM_LIMIT = 200
    const cacheKey = `workitems:${epicKey}:limit:${WORK_ITEM_LIMIT}`
    // Light fetch - just return cached data, don't validate completeness
    // Full fetch with worklogs happens when user expands a row
    const cached = getCachedValue<JiraWorkItem[]>(cacheKey)
    if (cached) return cached
    const persisted = getPersistedWorkItemsLight(epicKey)
    if (persisted) {
      setCachedValue(cacheKey, persisted.items ?? [], JIRA_PERSIST_TTL_MS)
      const fetchedAt = Date.parse(persisted.fetchedAt)
      const ageMs = Number.isFinite(fetchedAt) ? Date.now() - fetchedAt : Number.POSITIVE_INFINITY
      const shouldRefresh = ageMs > 15 * 60 * 1000
      if (shouldRefresh && !workItemsLightRefreshInFlight.has(epicKey)) {
        const promise = (async () => {
          try {
            const since = Number.isFinite(fetchedAt) ? new Date(fetchedAt) : undefined
            const delta = await fetchWorkItemsLight(epicKey, {
              limit: WORK_ITEM_LIMIT,
              updatedSince: since
            })
            const merged = mergeWorkItemsDeep(persisted.items ?? [], delta)
            setPersistedWorkItemsLight(epicKey, merged)
            setCachedValue(cacheKey, merged, JIRA_PERSIST_TTL_MS)
          } catch {
            // Ignore refresh errors; keep serving the cached payload.
          } finally {
            workItemsLightRefreshInFlight.delete(epicKey)
          }
        })()
        workItemsLightRefreshInFlight.set(epicKey, promise)
      }
      return persisted.items ?? []
    }

    const items = await fetchWorkItemsLight(epicKey, { limit: WORK_ITEM_LIMIT })
    setPersistedWorkItemsLight(epicKey, items)
    setCachedValue(cacheKey, items, JIRA_PERSIST_TTL_MS)
    return items
  })

  ipcMain.handle('jira:getWorkItemsSummary', async (_event, epicKey: string) => {
    if (!epicKey) return { spentSeconds: 0, estimateSeconds: 0, partial: false }
    const cacheKey = `workitemsummary:${epicKey}`
    const cached = getCachedValue<{ spentSeconds: number; estimateSeconds: number; partial: boolean }>(
      cacheKey
    )
    if (cached) return cached
    const epicFields = [
      'aggregatetimetracking',
      'aggregatetimeoriginalestimate',
      'aggregatetimespent',
      'timetracking',
      'timeoriginalestimate',
      'timespent'
    ]
    try {
      const epicData = (await jiraRequest(
        `/rest/api/3/issue/${encodeURIComponent(epicKey)}?fields=${epicFields.join(',')}`
      )) as {
        fields?: {
          aggregatetimetracking?: {
            originalEstimateSeconds?: number | null
            timeSpentSeconds?: number | null
          }
          aggregatetimeoriginalestimate?: number | null
          aggregatetimespent?: number | null
          timetracking?: {
            originalEstimateSeconds?: number | null
            timeSpentSeconds?: number | null
          }
          timeoriginalestimate?: number | null
          timespent?: number | null
        }
      }
      const fields = epicData.fields ?? {}
      const aggregateTracking = fields.aggregatetimetracking ?? null
      const tracking = fields.timetracking ?? null
      const estimateSeconds =
        tracking?.originalEstimateSeconds ??
        fields.timeoriginalestimate ??
        aggregateTracking?.originalEstimateSeconds ??
        fields.aggregatetimeoriginalestimate ??
        0
      const spentSeconds =
        aggregateTracking?.timeSpentSeconds ??
        fields.aggregatetimespent ??
        tracking?.timeSpentSeconds ??
        fields.timespent ??
        0
      if (estimateSeconds || spentSeconds) {
        const summary = { spentSeconds, estimateSeconds, partial: false }
        setCachedValue(cacheKey, summary, 15 * 60 * 1000)
        return summary
      }
    } catch {
      // fall back to summary search below
    }
    const limit = 300
    const primaryJql = `parent = ${epicKey} AND issuetype != Epic ORDER BY updated DESC`
    const fallbackJql = `"Epic Link" = ${epicKey} AND issuetype != Epic ORDER BY updated DESC`
    let issues: JiraSearchIssue[] = []
    let reachedLimit = false
    const fields = ['timespent', 'timeoriginalestimate', 'timetracking']
    try {
      const result = await searchIssuesWithLimit(primaryJql, fields, limit)
      issues = result.issues
      reachedLimit = result.reachedLimit
    } catch {
      // Ignore and fall back below.
    }
    if (!issues.length) {
      const result = await searchIssuesWithLimit(fallbackJql, fields, limit)
      issues = result.issues
      reachedLimit = result.reachedLimit
    }
    const estimateSeconds = issues.reduce((sum, issue) => {
      return (
        sum +
        (issue.fields?.timeoriginalestimate ??
          issue.fields?.timetracking?.originalEstimateSeconds ??
          0)
      )
    }, 0)
    const spentSeconds = issues.reduce(
      (sum, issue) =>
        sum +
        (issue.fields?.timespent ??
          issue.fields?.timetracking?.timeSpentSeconds ??
          0),
      0
    )
    const summary = { spentSeconds, estimateSeconds, partial: reachedLimit }
    setCachedValue(cacheKey, summary, 15 * 60 * 1000)
    return summary
  })

  ipcMain.handle('jira:getEpicDebug', async (_event, epicKey: string) => {
    if (!epicKey) return null
    const epicFields = [
      'aggregatetimetracking',
      'aggregatetimeoriginalestimate',
      'aggregatetimespent',
      'timetracking',
      'timeoriginalestimate',
      'timespent'
    ]
    const data = (await jiraRequest(
      `/rest/api/3/issue/${encodeURIComponent(epicKey)}?fields=${epicFields.join(',')}`
    )) as { fields?: Record<string, unknown> }
    return {
      epicKey,
      fields: data.fields ?? {}
    }
  })

  ipcMain.handle('jira:getTimeTrackingConfig', async () => {
    const cacheKey = 'timetracking:config'
    const cached = getCachedValue<{ hoursPerDay: number; daysPerWeek: number }>(cacheKey)
    if (cached) return cached
    const data = (await jiraRequest('/rest/api/3/configuration')) as {
      timeTrackingConfiguration?: {
        workingHoursPerDay?: number
        workingDaysPerWeek?: number
      }
    }
    const hoursPerDay =
      data.timeTrackingConfiguration?.workingHoursPerDay ?? 8
    const daysPerWeek =
      data.timeTrackingConfiguration?.workingDaysPerWeek ?? 5
    const config = { hoursPerDay, daysPerWeek }
    setCachedValue(cacheKey, config, 24 * 60 * 60 * 1000)
    return config
  })

  ipcMain.handle('jira:getWorkItemDetails', async (_event, epicKey: string, forceRefresh = false) => {
    if (!epicKey) return { items: [], partial: false }
    const cacheKey = `workitemdetails:${epicKey}`

    // Helper to check if ALL items and subtasks have complete data
    // (either worklogs loaded OR non-zero timespent)
    const hasCompleteData = (items: JiraWorkItem[]) => {
      if (!items.length) return false
      // Check if all items and subtasks have worklogs array defined
      // This ensures we actually fetched the worklog data, not just timespent
      return items.every(item => {
        // Item must have worklogs property (even if empty array)
        if (item.worklogs === undefined) return false
        const subtasks = item.subtasks ?? []
        // All subtasks must also have worklogs property
        return subtasks.every(sub => sub.worklogs !== undefined)
      })
    }

    // Force refresh: clear all caches
    if (forceRefresh) {
      jiraCache.delete(cacheKey)
      const store = jiraStore.get('workItemDetails') ?? {}
      delete store[epicKey]
      jiraStore.set('workItemDetails', store)
    }

    if (!forceRefresh) {
      const cached = getCachedValue<JiraWorkItemDetailsPayload>(cacheKey)
      const cachedHasCompleteData = cached ? hasCompleteData(cached.items) : false
      
      if (cached && cachedHasCompleteData) {
        return cached
      }

      // Clear in-memory cache if incomplete
      if (cached) {
        jiraCache.delete(cacheKey)
      }

      const persisted = getPersistedWorkItemDetails(epicKey)
      const persistedHasCompleteData = persisted ? hasCompleteData(persisted.items) : false
      const persistedIsFresh = persisted ? isPersistedFresh(persisted) : false
      
      if (persisted && persistedIsFresh && persistedHasCompleteData) {
        const payload = { items: persisted.items, partial: persisted.partial }
        setCachedValue(cacheKey, payload, JIRA_PERSIST_TTL_MS)
        return payload
      }

      // Clear persisted cache if incomplete (will be replaced with fresh data)
      if (persisted && !persistedHasCompleteData) {
        const store = jiraStore.get('workItemDetails') ?? {}
        delete store[epicKey]
        jiraStore.set('workItemDetails', store)
      }
    }

    // Always do a full fetch if we don't have valid cached data
    try {
      const payload = await fetchWorkItemDetails(epicKey)
      setPersistedWorkItemDetails(epicKey, payload)
      setCachedValue(cacheKey, payload, JIRA_PERSIST_TTL_MS)
      return payload
    } catch (error) {
      console.error('[jira:getWorkItemDetails] Error fetching for', epicKey, error)
      throw error
    }
  })

  ipcMain.handle('jira:getIssueWorklogs', async (_event, issueKey: string) => {
    if (!issueKey) return []
    const worklogs = await fetchAllWorklogs(issueKey)
    return normalizeWorklogs(worklogs)
  })

  ipcMain.handle(
    'jira:addWorklog',
    async (_event, payload: { issueKey: string; started: string; seconds: number; comment?: string }) => {
      const { issueKey, started, seconds, comment } = payload ?? {}
      if (!issueKey || !started || !seconds) {
        throw new Error('JIRA_BAD_REQUEST')
      }
      const created = (await jiraRequest(
        `/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog`,
        {
          method: 'POST',
          body: JSON.stringify({
            timeSpentSeconds: seconds,
            started,
            comment: comment
              ? {
                  type: 'doc',
                  version: 1,
                  content: [
                    {
                      type: 'paragraph',
                      content: [
                        {
                          type: 'text',
                          text: comment
                        }
                      ]
                    }
                  ]
                }
              : undefined
          })
        }
      )) as JiraWorklogEntry
      const normalized = normalizeWorklogs(created ? [created] : [])
      return normalized[0] ?? null
    }
  )

  ipcMain.handle(
    'jira:deleteWorklog',
    async (_event, payload: { issueKey: string; worklogId: string }) => {
      const { issueKey, worklogId } = payload ?? {}
      if (!issueKey || !worklogId) {
        throw new Error('JIRA_BAD_REQUEST')
      }
      await jiraRequest(
        `/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog/${encodeURIComponent(
          worklogId
        )}`,
        {
          method: 'DELETE'
        }
      )
      return true
    }
  )

  ipcMain.handle('jira:getWorklogHistory', async (_event, issueKey: string) => {
    if (!issueKey) return []
    const data = await jiraRequest(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog?maxResults=20`
    )
    const worklogs = (data as { worklogs?: JiraWorklogEntry[] }).worklogs ?? []
    return normalizeWorklogs(worklogs)
  })
}

async function fetchWorkItemDetails(
  epicKey: string,
  updatedSince?: Date
): Promise<JiraWorkItemDetailsPayload> {
  const detailsLimit = 50
  const subtaskLimit = 100
  const updatedClause = updatedSince
    ? ` AND updated >= "${formatJqlDate(updatedSince)}"`
    : ''
  const baseJql =
    `parent = ${epicKey} AND issuetype != Epic AND issuetype not in subTaskIssueTypes()` +
    `${updatedClause} ORDER BY updated DESC`
  const fallbackJql =
    `"Epic Link" = ${epicKey} AND issuetype != Epic AND issuetype not in subTaskIssueTypes()` +
    `${updatedClause} ORDER BY updated DESC`
    let issues: JiraSearchIssue[] = []
    let detailsPartial = false
    const fields = [
      'summary',
      'status',
      'timespent',
      'timeoriginalestimate',
      'timetracking',
      'assignee',
      'subtasks'
    ]
    try {
      const result = await searchIssuesWithLimit(baseJql, fields, detailsLimit)
      issues = result.issues
      detailsPartial = result.reachedLimit
    } catch (error) {
      // Ignore and fall back below.
    }
    if (!issues.length) {
      const result = await searchIssuesWithLimit(
        fallbackJql,
        [...fields, 'worklog'],
        detailsLimit
      )
      issues = result.issues
      detailsPartial = result.reachedLimit
    }
    if (!issues.length) {
      return { items: [], partial: detailsPartial }
    }
  if (issues.length > 1) {
    const unique = new Map<string, JiraSearchIssue>()
    for (const issue of issues) {
      if (!unique.has(issue.key)) unique.set(issue.key, issue)
    }
    issues = Array.from(unique.values())
  }

  const subtaskRefsByIssue = new Map<string, JiraSearchIssue['fields']['subtasks']>()
  const subtaskKeySet = new Set<string>()
  for (const issue of issues) {
    const refs = (issue.fields?.subtasks ?? []).slice(0, subtaskLimit)
    if ((issue.fields?.subtasks?.length ?? 0) > subtaskLimit) {
      detailsPartial = true
    }
    subtaskRefsByIssue.set(issue.key, refs)
    for (const ref of refs) {
      subtaskKeySet.add(ref.key)
    }
  }
  
  // OPTIMIZATION: Skip fetching full subtask details - Jira API is too slow
  // Use the basic subtask info from parent issue search instead
  const subtaskLookup = new Map<string, JiraSearchIssue>()

    const worklogKeys = Array.from(
      new Set([
        ...issues.map(issue => issue.key),
        ...subtaskKeySet
      ])
    )
    
    const worklogMap = await fetchWorklogsForKeys(worklogKeys)

  const items = issues.map(issue => {
      const subtasks = (subtaskRefsByIssue.get(issue.key) ?? []).map(subtask => {
        const detail = subtaskLookup.get(subtask.key)
        const detailWorklogs = normalizeWorklogs(worklogMap.get(subtask.key) ?? [])
      const detailWorklogTotal = detailWorklogs.length
        const spentFromLogs = sumWorklogSeconds(detailWorklogs)
        const lastWorklog = getLatestWorklog(detailWorklogs)
        // Use || instead of ?? to fall back to spentFromLogs when timespent is 0
        const subtaskTimespent =
          detail?.fields?.timespent ||
          detail?.fields?.timetracking?.timeSpentSeconds ||
          spentFromLogs
        
        return {
          key: subtask.key,
          summary: detail?.fields?.summary ?? subtask.fields?.summary ?? subtask.key,
          timespent: subtaskTimespent,
          estimateSeconds:
            detail?.fields?.timeoriginalestimate ??
            detail?.fields?.timetracking?.originalEstimateSeconds ??
            0,
        assigneeName:
          detail?.fields?.assignee?.displayName ??
          subtask.fields?.assignee?.displayName ??
          null,
        statusName: detail?.fields?.status?.name ?? null,
        worklogs: detailWorklogs,
        worklogTotal: detailWorklogTotal,
        lastWorklog
      }
    })
      const worklogs = normalizeWorklogs(worklogMap.get(issue.key) ?? [])
      const worklogTotal = worklogs.length
    const spentFromLogs = sumWorklogSeconds(worklogs)
    const lastWorklog = getLatestWorklog(worklogs)
    // Use || instead of ?? to fall back to spentFromLogs when timespent is 0
    const issueTimespent =
      issue.fields?.timespent ||
      issue.fields?.timetracking?.timeSpentSeconds ||
      spentFromLogs
    return {
      key: issue.key,
      summary: issue.fields?.summary ?? issue.key,
      timespent: issueTimespent,
      estimateSeconds:
        issue.fields?.timeoriginalestimate ??
        issue.fields?.timetracking?.originalEstimateSeconds ??
        0,
      assigneeName: issue.fields?.assignee?.displayName ?? null,
      statusName: issue.fields?.status?.name ?? null,
      worklogs,
      worklogTotal,
      lastWorklog,
      subtasks
    }
  })

  return { items, partial: detailsPartial }
}

async function fetchWorkItemsLight(
  epicKey: string,
  options: { limit: number; updatedSince?: Date } = { limit: 200 }
): Promise<JiraWorkItem[]> {
  const { limit, updatedSince } = options
  const updatedClause = updatedSince ? ` AND updated >= "${formatJqlDate(updatedSince)}"` : ''
  const primaryJql =
    `parent = ${epicKey} AND issuetype != Epic AND issuetype not in subTaskIssueTypes()` +
    `${updatedClause} ORDER BY updated DESC`
  const fallbackJql =
    `"Epic Link" = ${epicKey} AND issuetype != Epic AND issuetype not in subTaskIssueTypes()` +
    `${updatedClause} ORDER BY updated DESC`
  const fields = [
    'summary',
    'status',
    'assignee',
    'timespent',
    'timeoriginalestimate',
    'timetracking',
    'aggregatetimetracking',
    'aggregatetimeoriginalestimate',
    'aggregatetimespent',
    'subtasks'
  ]
  let issues: JiraSearchIssue[] = []
  try {
    const result = await searchIssuesWithLimit(primaryJql, fields, limit)
    issues = result.issues
  } catch {
    // Ignore and fall back below.
  }
  if (!issues.length) {
    const result = await searchIssuesWithLimit(fallbackJql, fields, limit)
    issues = result.issues
  }

  const unique = new Map<string, JiraWorkItem>()
  for (const issue of issues) {
    const aggregateTracking = issue.fields?.aggregatetimetracking ?? null
    const aggregateEstimateSeconds =
      aggregateTracking?.originalEstimateSeconds ??
      issue.fields?.aggregatetimeoriginalestimate ??
      null
    const aggregateSpentSeconds =
      aggregateTracking?.timeSpentSeconds ??
      issue.fields?.aggregatetimespent ??
      null
    // Light fetch: just use subtask references, don't fetch additional details
    // Full details with worklogs are fetched when user expands the row
    const subtasks =
      (issue.fields?.subtasks ?? []).map(ref => ({
        key: ref.key,
        summary: ref.fields?.summary ?? ref.key,
        statusName: null,
        assigneeName: ref.fields?.assignee?.displayName ?? null,
        timespent: 0,
        estimateSeconds: 0
      })) ?? []
    unique.set(issue.key, {
      key: issue.key,
      summary: issue.fields?.summary ?? issue.key,
      statusName: issue.fields?.status?.name ?? null,
      assigneeName: issue.fields?.assignee?.displayName ?? null,
      timespent:
        aggregateSpentSeconds ??
        issue.fields?.timespent ??
        issue.fields?.timetracking?.timeSpentSeconds ??
        0,
      estimateSeconds:
        aggregateEstimateSeconds ??
        issue.fields?.timeoriginalestimate ??
        issue.fields?.timetracking?.originalEstimateSeconds ??
        0,
      subtasks
    })
  }
  return Array.from(unique.values())
}

async function searchIssues(
  jql: string,
  fields: string[],
  options: { limit?: number } = {}
): Promise<JiraSearchIssue[]> {
  const maxResults = 100
  const limit = options.limit ?? Number.POSITIVE_INFINITY
  let startAt = 0
  const results: JiraSearchIssue[] = []
  while (true) {
    const params = new URLSearchParams({
      jql,
      startAt: String(startAt),
      maxResults: String(maxResults),
      fields: fields.join(',')
    })
    const data = (await jiraRequest(
      `/rest/api/3/search/jql?${params.toString()}`
    )) as JiraSearchResponse
    const issues = data.issues ?? []
    if (issues.length === 0) break
    const remaining = limit - results.length
    if (remaining <= 0) break
    results.push(...issues.slice(0, remaining))
    startAt += issues.length
    if (data.total !== undefined && results.length >= data.total) break
    if (results.length >= limit) break
  }
  return results
}

async function searchIssuesWithLimit(
  jql: string,
  fields: string[],
  limit: number
): Promise<{ issues: JiraSearchIssue[]; reachedLimit: boolean }> {
  const maxResults = 100
  let startAt = 0
  const results: JiraSearchIssue[] = []
  while (true) {
    const params = new URLSearchParams({
      jql,
      startAt: String(startAt),
      maxResults: String(maxResults),
      fields: fields.join(',')
    })
    const data = (await jiraRequest(
      `/rest/api/3/search/jql?${params.toString()}`
    )) as JiraSearchResponse
    const issues = data.issues ?? []
    if (!issues.length) break
    const remaining = limit - results.length
    if (remaining <= 0) break
    results.push(...issues.slice(0, remaining))
    startAt += issues.length
    if (data.total !== undefined && results.length >= data.total) break
    if (results.length >= limit) break
  }
  return { issues: results, reachedLimit: results.length >= limit }
}

async function fetchIssuesByKeys(keys: string[], fields: string[]): Promise<JiraSearchIssue[]> {
  if (!keys.length) return []
  const chunkSize = 50
  const queue: string[][] = []
  for (let index = 0; index < keys.length; index += chunkSize) {
    queue.push(keys.slice(index, index + chunkSize))
  }
  const results: JiraSearchIssue[] = []
  const concurrency = Math.min(2, queue.length)
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const chunk = queue.shift()
        if (!chunk) return
        const jql = `issue in (${chunk.join(',')})`
        const issues = await searchIssues(jql, fields)
        results.push(...issues)
      }
    })
  )
  return results
}

async function fetchAllWorklogs(issueKey: string): Promise<JiraWorklogEntry[]> {
  const all: JiraWorklogEntry[] = []
  let startAt = 0
  const maxResults = 100
  while (true) {
    const data = (await jiraRequest(
      `/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog?startAt=${startAt}&maxResults=${maxResults}`
    )) as { worklogs?: JiraWorklogEntry[]; total?: number }
    const worklogs = data.worklogs ?? []
    all.push(...worklogs)
    const total = data.total ?? worklogs.length
    startAt += worklogs.length
    if (startAt >= total || worklogs.length === 0) break
  }
  return all
}

async function fetchWorklogsForKeys(keys: string[]) {
  const map = new Map<string, JiraWorklogEntry[]>()
  if (!keys.length) return map
  const queue = [...keys]
  const concurrency = Math.min(6, queue.length)
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const key = queue.shift()
        if (!key) return
        const logs = await fetchAllWorklogs(key)
        map.set(key, logs)
      }
    })
  )
  return map
}

function normalizeWorklogs(worklogs: JiraWorklogEntry[]) {
  return worklogs.map(entry => ({
    id: entry.id,
    started: entry.started ?? null,
    seconds: entry.timeSpentSeconds ?? 0,
    comment: entry.comment ?? null,
    authorName: entry.author?.displayName ?? null,
    authorId: entry.author?.accountId ?? null
  }))
}

function sumWorklogSeconds(worklogs: ReturnType<typeof normalizeWorklogs>) {
  return worklogs.reduce((sum, entry) => sum + (entry.seconds ?? 0), 0)
}

function getLatestWorklog(worklogs: ReturnType<typeof normalizeWorklogs>) {
  let latest: ReturnType<typeof normalizeWorklogs>[number] | null = null
  let latestTime = 0
  for (const entry of worklogs) {
    if (!entry.started) continue
    const ts = Date.parse(entry.started)
    if (!Number.isNaN(ts) && ts >= latestTime) {
      latestTime = ts
      latest = entry
    }
  }
  return latest
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const JIRA_REQUEST_TIMEOUT_MS = 120000

async function jiraRequest(path: string, options: RequestInit = {}, attempt = 0) {
  const { baseUrl, email, token } = await getJiraCredentials()
  if (!email || !token) {
    throw new Error('JIRA_AUTH_REQUIRED')
  }
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), JIRA_REQUEST_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`,
        ...(options.headers ?? {})
      },
      signal: controller.signal
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('JIRA_REQUEST_TIMEOUT')
    }
    throw err
  } finally {
    clearTimeout(timeoutId)
  }
  if (res.status === 429 && attempt < 3) {
    const retryAfter = Number(res.headers.get('retry-after'))
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 1000 * Math.pow(2, attempt)
    await res.text().catch(() => {})
    await sleep(delayMs)
    return jiraRequest(path, options, attempt + 1)
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      await res.text().catch(() => {})
      throw new Error('JIRA_AUTH_REQUIRED')
    }
    const text = await res.text()
    throw new Error(`JIRA ${res.status}: ${text}`)
  }
  if (res.status === 204) return {}
  return res.json()
}
