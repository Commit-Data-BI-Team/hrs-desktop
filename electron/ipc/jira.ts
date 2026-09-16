import { app, ipcMain, shell } from 'electron'
import Store from 'electron-store'
import {
  clearJiraCredentials,
  getJiraCredentials,
  getJiraMappings,
  setJiraCredentials,
  setJiraMapping
} from '../jira/config'
import {
  sanitizeString,
  validateDate,
  validateEmail,
  validateExactObject,
  validateJiraIssueKey,
  validateNumberRange,
  validateOptionalString,
  validateStringLength
} from '../utils/validation'
import { resolveIntegrationAttachments } from '../integration/attachments'
import {
  requireSprintTaskCompletionConsensus,
  requireSupabaseManager,
  requireSupabaseUser
} from './supabase'

const DEFAULT_PROJECT_KEYS = ['VDA', 'LSM']
const JIRA_PROJECT_KEY_REGEX = /^[A-Z][A-Z0-9_]{0,14}$/
const configuredProjectKeys = (process.env.HRS_JIRA_PROJECT_KEYS ?? DEFAULT_PROJECT_KEYS.join(','))
  .split(',')
  .map(value => value.trim().toUpperCase())
  .filter(value => JIRA_PROJECT_KEY_REGEX.test(value))
const PROJECT_KEYS = configuredProjectKeys.length
  ? Array.from(new Set(configuredProjectKeys))
  : DEFAULT_PROJECT_KEYS
const PRIMARY_PROJECT_KEY = PROJECT_KEYS[0]
const PROJECT_NAME = PROJECT_KEYS.join(' + ')
const JIRA_CACHE_TTL_MS = 5 * 60 * 1000
const JIRA_PERSIST_TTL_MS = 6 * 60 * 60 * 1000
const JIRA_KEY_REGEX = /^[A-Z][A-Z0-9_]{0,14}-[0-9]+$/
const JIRA_E2E = !app.isPackaged && (process.env.HRS_E2E === '1' || process.env.JIRA_E2E === '1')

function projectJql(projectKey: string) {
  return `project = ${projectKey}`
}

function redactSensitiveText(input: string): string {
  let text = input
  text = text.replace(
    /("?(?:authorization|cookie|set-cookie|x-api-key|api[_-]?key|token|password|passwd|secret|customauth|sessionid|csrftoken)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;}\]]+)/gi,
    '$1[REDACTED]'
  )
  text = text.replace(/\b(Bearer)\s+[A-Za-z0-9\-._~+/]+=*/gi, '$1 [REDACTED]')
  text = text.replace(
    /([?&](?:token|password|passwd|auth|authorization|cookie|session|apikey|api_key|customauth)=)[^&\s]+/gi,
    '$1[REDACTED]'
  )
  return text
}

function safeLogLine(value: string) {
  return redactSensitiveText(value).replace(/\s+/g, ' ').trim().slice(0, 500)
}

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
      statusCategory?: {
        key?: string | null
        name?: string | null
      } | null
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
        status?: {
          name?: string | null
        } | null
        timespent?: number | null
        timeoriginalestimate?: number | null
        timetracking?: {
          originalEstimateSeconds?: number | null
          timeSpentSeconds?: number | null
        } | null
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

type JiraEpic = {
  key: string
  summary: string
}

type JiraAgileBoard = {
  id: number
  name: string
  type: string
  projectKey: string | null
}

type JiraSprint = {
  id: number
  name: string
  state: 'active' | 'future' | 'closed'
  goal: string | null
  startDate: string | null
  endDate: string | null
  originBoardId: number | null
}

type JiraSprintIssue = {
  key: string
  summary: string
  statusName: string
  statusCategoryKey: 'todo' | 'indeterminate' | 'done'
  assigneeName: string | null
  timespent: number
  estimateSeconds: number
}

type JiraSprintIssueDetails = {
  issueKey: string
  description: string
  attachments: Array<{
    id: string
    name: string
    mimeType: string | null
    previewDataUrl?: string | null
  }>
  comments: ReturnType<typeof normalizeJiraComment>[]
}

type JiraIssueCreatePayload = {
  parentIssueKey: string
  summary: string
  description?: string
  estimateSeconds?: number | null
}

type JiraCreatedIssue = {
  id?: string
  key: string
  summary: string
  parentIssueKey: string
  estimateSeconds: number
}

type JiraDirectoryUser = {
  accountId: string
  displayName: string
  emailAddress?: string | null
  active?: boolean
  avatarUrls?: Record<string, string>
}

type JiraMentionInput = {
  accountId: string
  label: string
}

type JiraCommentAttachmentInput = {
  id: string
  filename: string
}

type JiraTransition = {
  id: string
  name: string
  to?: {
    name?: string | null
  } | null
}

type JiraCommentAuthor = {
  accountId?: string | null
  displayName?: string | null
  avatarUrls?: Record<string, string>
}

type JiraComment = {
  id?: string
  body?: unknown
  created?: string | null
  updated?: string | null
  author?: JiraCommentAuthor | null
}

type JiraIssueAttachment = {
  id?: string | number
  filename?: string | null
  mimeType?: string | null
  created?: string | null
  author?: {
    accountId?: string | null
  } | null
}

type JiraCommentAttachmentCandidate = {
  id?: string
  name?: string
}

const E2E_EPICS: JiraEpic[] = [
  { key: 'VDA-98', summary: 'Weizmann Institute of Science' },
  { key: 'VDA-147', summary: 'Microsoft' },
  { key: 'LSM-10', summary: 'LSM delivery' }
]

const E2E_WORK_ITEMS_BY_EPIC: Record<string, JiraWorkItem[]> = {
  'VDA-98': [
    {
      key: 'VDA-402',
      summary: 'Medallion design',
      timespent: 14 * 3600,
      estimateSeconds: 40 * 3600,
      assigneeName: 'Talia Sela',
      statusName: 'In Progress',
      subtasks: [
        {
          key: 'VDA-417',
          summary: 'Bronze stage',
          timespent: 8 * 3600,
          estimateSeconds: 12 * 3600,
          assigneeName: 'Talia Sela',
          statusName: 'In Progress',
          worklogs: [],
          worklogTotal: 0,
          lastWorklog: null
        },
        {
          key: 'VDA-418',
          summary: 'Silver stage',
          timespent: 6 * 3600,
          estimateSeconds: 10 * 3600,
          assigneeName: 'Unassigned',
          statusName: 'To Do',
          worklogs: [],
          worklogTotal: 0,
          lastWorklog: null
        }
      ],
      worklogs: [],
      worklogTotal: 0,
      lastWorklog: null
    }
  ],
  'VDA-147': [
    {
      key: 'VDA-501',
      summary: 'Essence dashboards',
      timespent: 7 * 3600,
      estimateSeconds: 20 * 3600,
      assigneeName: 'Vitaly Shechtman',
      statusName: 'In Progress',
      subtasks: [
        {
          key: 'VDA-519',
          summary: 'Usage model',
          timespent: 4 * 3600,
          estimateSeconds: 8 * 3600,
          assigneeName: 'Vitaly Shechtman',
          statusName: 'In Progress',
          worklogs: [],
          worklogTotal: 0,
          lastWorklog: null
        }
      ],
      worklogs: [],
      worklogTotal: 0,
      lastWorklog: null
    }
  ],
  'LSM-10': [
    {
      key: 'LSM-21',
      summary: 'LSM discovery',
      timespent: 2 * 3600,
      estimateSeconds: 16 * 3600,
      assigneeName: 'Unassigned',
      statusName: 'To Do',
      subtasks: [],
      worklogs: [],
      worklogTotal: 0,
      lastWorklog: null
    }
  ]
}

const E2E_SPRINT_BOARDS: JiraAgileBoard[] = [
  { id: 101, name: 'VDA Scrum', type: 'scrum', projectKey: 'VDA' },
  { id: 202, name: 'LSM Scrum', type: 'scrum', projectKey: 'LSM' }
]

const E2E_SPRINTS: Record<number, JiraSprint[]> = {
  101: [
    {
      id: 1001,
      name: 'VDA Sprint 12',
      state: 'active',
      goal: 'Ship reporting improvements',
      startDate: '2026-09-01T08:00:00.000Z',
      endDate: '2026-09-14T17:00:00.000Z',
      originBoardId: 101
    },
    {
      id: 901,
      name: 'VDA Sprint 11',
      state: 'closed',
      goal: 'Complete the previous reporting milestone',
      startDate: '2026-08-15T08:00:00.000Z',
      endDate: '2026-08-31T17:00:00.000Z',
      originBoardId: 101
    }
  ],
  202: [
    {
      id: 2001,
      name: 'LSM Sprint 3',
      state: 'active',
      goal: 'Deliver LSM milestones',
      startDate: '2026-09-01T08:00:00.000Z',
      endDate: '2026-09-14T17:00:00.000Z',
      originBoardId: 202
    }
  ]
}

let e2eSprintBacklog: Record<number, JiraSprintIssue[]> = {
  101: [
    {
      key: 'VDA-600',
      summary: 'Backlog discovery',
      statusName: 'To Do',
      statusCategoryKey: 'todo',
      assigneeName: 'Dror Rahamim',
      timespent: 0,
      estimateSeconds: 8 * 3600
    }
  ],
  202: [
    {
      key: 'LSM-30',
      summary: 'LSM backlog item',
      statusName: 'To Do',
      statusCategoryKey: 'todo',
      assigneeName: null,
      timespent: 0,
      estimateSeconds: 4 * 3600
    }
  ]
}

let e2eSprintIssues: Record<number, JiraSprintIssue[]> = {
  1001: [
    {
      key: 'VDA-601',
      summary: 'Active sprint task',
      statusName: 'In Progress',
      statusCategoryKey: 'indeterminate',
      assigneeName: 'Vitaly Shechtman',
      timespent: 2 * 3600,
      estimateSeconds: 8 * 3600
    },
    {
      key: 'VDA-602',
      summary: 'Employee-startable task',
      statusName: 'To Do',
      statusCategoryKey: 'todo',
      assigneeName: 'Vitaly Shechtman',
      timespent: 45 * 60,
      estimateSeconds: 4 * 3600
    }
  ],
  901: [
    {
      key: 'VDA-590',
      summary: 'Previous sprint delivery',
      statusName: 'Done',
      statusCategoryKey: 'done',
      assigneeName: 'Dror Rahamim',
      timespent: 6 * 3600,
      estimateSeconds: 8 * 3600
    }
  ],
  2001: []
}

function validateEpicKey(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Invalid epic key: expected string')
  }
  const key = sanitizeString(value).toUpperCase()
  if (!JIRA_KEY_REGEX.test(key)) {
    throw new Error('Invalid epic key format')
  }
  return key
}

function adfTextDocument(text: string) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)

  return {
    type: 'doc',
    version: 1,
    content: (paragraphs.length ? paragraphs : ['']).map(paragraph => ({
      type: 'paragraph',
      content: paragraph
        ? [
            {
              type: 'text',
              text: paragraph
            }
          ]
        : []
    }))
  }
}

function validateJiraMentions(value: unknown): JiraMentionInput[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 50) {
    throw new Error('Invalid Jira mentions.')
  }
  return value.map(entry => {
    const safe = validateExactObject<{ accountId?: unknown; label?: unknown }>(
      entry,
      ['accountId', 'label'],
      'Jira mention'
    )
    return {
      accountId: validateStringLength(safe.accountId, 1, 200),
      label: validateStringLength(safe.label, 1, 200)
    }
  })
}

function validateJiraCommentAttachments(value: unknown): JiraCommentAttachmentInput[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 10) {
    throw new Error('Invalid Jira comment attachments.')
  }
  return value.map(entry => {
    const safe = validateExactObject<{ id?: unknown; filename?: unknown }>(
      entry,
      ['id', 'filename'],
      'Jira comment attachment'
    )
    const id = validateStringLength(safe.id, 1, 200)
    if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error('Invalid Jira attachment ID.')
    return {
      id,
      filename: validateStringLength(safe.filename, 1, 500)
    }
  })
}

function validateJiraCommentText(value: unknown) {
  if (typeof value !== 'string') throw new Error('Invalid Jira comment text.')
  const text = value
    .replace(/\0/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
  if (!text) throw new Error('Jira comment cannot be empty.')
  if (text.length > 10000) throw new Error('Jira comment is too long.')
  return text
}

function jiraCommentBodyToText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(jiraCommentBodyToText).join('')
  if (!value || typeof value !== 'object') return ''
  const node = value as {
    type?: unknown
    text?: unknown
    attrs?: { text?: unknown }
    content?: unknown
  }
  if (node.type === 'hardBreak') return '\n'
  if (node.type === 'mention' && typeof node.attrs?.text === 'string') return node.attrs.text
  const ownText = typeof node.text === 'string' ? node.text : ''
  const contentText = jiraCommentBodyToText(node.content)
  const suffix =
    node.type === 'paragraph' || node.type === 'heading' || node.type === 'listItem'
      ? '\n'
      : ''
  return `${ownText}${contentText}${suffix}`
}

function extractJiraCommentAttachmentCandidates(value: unknown) {
  const candidates: JiraCommentAttachmentCandidate[] = []
  const addUrlCandidate = (urlValue: unknown, nameValue?: unknown) => {
    if (typeof urlValue !== 'string') return
    const match = urlValue.match(
      /\/(?:secure\/attachment\/|rest\/api\/3\/attachment\/content\/)([A-Za-z0-9-]+)(?:\/([^?#]+))?/i
    )
    if (!match) return
    let decodedName = typeof nameValue === 'string' ? nameValue.trim() : ''
    if (!decodedName && match[2]) {
      try {
        decodedName = decodeURIComponent(match[2])
      } catch {
        decodedName = match[2]
      }
    }
    candidates.push({ id: match[1], name: decodedName || undefined })
  }
  const visit = (nodeValue: unknown) => {
    if (Array.isArray(nodeValue)) {
      nodeValue.forEach(visit)
      return
    }
    if (!nodeValue || typeof nodeValue !== 'object') return
    const node = nodeValue as {
      type?: unknown
      text?: unknown
      attrs?: Record<string, unknown>
      marks?: Array<{ type?: unknown; attrs?: Record<string, unknown> }>
      content?: unknown
    }
    if (node.type === 'inlineCard') addUrlCandidate(node.attrs?.url)
    if (node.type === 'media') {
      const alt = typeof node.attrs?.alt === 'string' ? node.attrs.alt.trim() : ''
      candidates.push({
        id: typeof node.attrs.id === 'string' ? node.attrs.id : undefined,
        name: alt || undefined
      })
    }
    for (const mark of node.marks ?? []) {
      if (mark.type === 'link') addUrlCandidate(mark.attrs?.href, node.text)
    }
    visit(node.content)
  }
  visit(value)
  return candidates
}

function normalizeJiraComment(comment: JiraComment, issueAttachments: JiraIssueAttachment[] = []) {
  const text = jiraCommentBodyToText(comment.body)
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 4000)
  const attachmentCandidates = extractJiraCommentAttachmentCandidates(comment.body)
  const attachmentsById = new Map(
    issueAttachments
      .filter(attachment => attachment.id !== undefined && attachment.id !== null)
      .map(attachment => [String(attachment.id), attachment])
  )
  const attachmentsByName = new Map(
    issueAttachments
      .filter(attachment => attachment.filename?.trim())
      .map(attachment => [attachment.filename!.trim().toLocaleLowerCase(), attachment])
  )
  const resolvedAttachments = new Map<
    string,
    { id: string; name: string; mimeType: string | null }
  >()
  let unresolvedMediaCount = 0
  for (const candidate of attachmentCandidates) {
    const issueAttachment =
      (candidate.id ? attachmentsById.get(candidate.id) : undefined) ??
      (candidate.name ? attachmentsByName.get(candidate.name.toLocaleLowerCase()) : undefined)
    const id = issueAttachment?.id ?? (candidate.name ? candidate.id : undefined)
    const name = issueAttachment?.filename?.trim() || candidate.name?.trim()
    if (id !== undefined && id !== null && name) {
      resolvedAttachments.set(String(id), {
        id: String(id),
        name,
        mimeType: issueAttachment?.mimeType?.trim() || null
      })
    } else {
      unresolvedMediaCount += 1
    }
  }

  if (unresolvedMediaCount > 0) {
    const commentTime = Date.parse(comment.created ?? comment.updated ?? '')
    if (Number.isFinite(commentTime)) {
      const matchingAuthorId = comment.author?.accountId ?? null
      const nearbyAttachments = issueAttachments
        .filter(attachment => {
          if (attachment.id === undefined || attachment.id === null || !attachment.filename?.trim()) {
            return false
          }
          if (resolvedAttachments.has(String(attachment.id))) return false
          const attachmentTime = Date.parse(attachment.created ?? '')
          if (!Number.isFinite(attachmentTime)) return false
          const delayMs = commentTime - attachmentTime
          if (delayMs < -5000 || delayMs > 5 * 60 * 1000) return false
          const attachmentAuthorId = attachment.author?.accountId ?? null
          return !matchingAuthorId || !attachmentAuthorId || matchingAuthorId === attachmentAuthorId
        })
        .sort((left, right) => {
          const leftDistance = Math.abs(commentTime - Date.parse(left.created ?? ''))
          const rightDistance = Math.abs(commentTime - Date.parse(right.created ?? ''))
          return leftDistance - rightDistance
        })
        .slice(0, unresolvedMediaCount)
      for (const attachment of nearbyAttachments) {
        resolvedAttachments.set(String(attachment.id), {
          id: String(attachment.id),
          name: attachment.filename!.trim(),
          mimeType: attachment.mimeType?.trim() || null
        })
      }
    }
  }
  const attachments = Array.from(resolvedAttachments.values())
  return {
    id: comment.id ?? '',
    source: 'jira' as const,
    authorId: comment.author?.accountId ?? null,
    authorName: comment.author?.displayName?.trim() || 'Jira user',
    avatarUrl:
      comment.author?.avatarUrls?.['48x48'] ??
      comment.author?.avatarUrls?.['32x32'] ??
      null,
    text,
    attachments,
    createdAt: comment.created ?? comment.updated ?? new Date(0).toISOString()
  }
}

function adfCommentDocument(
  text: string,
  mentions: JiraMentionInput[],
  attachments: Array<JiraCommentAttachmentInput & { downloadUrl: string }> = []
) {
  const mentionsByLabel = new Map(
    mentions.map(mention => [mention.label.trim().toLocaleLowerCase(), mention])
  )
  const buildInlineContent = (line: string) => {
    const content: Array<Record<string, unknown>> = []
    const tokenPattern = /@\[([^\]\n]{1,200})\]|\*([^*\n]+)\*|_([^_\n]+)_|`([^`\n]+)`/g
    let cursor = 0
    let match: RegExpExecArray | null
    while ((match = tokenPattern.exec(line)) !== null) {
      if (match.index > cursor) {
        content.push({ type: 'text', text: line.slice(cursor, match.index) })
      }
      if (match[1]) {
        const label = match[1].trim()
        const mention = mentionsByLabel.get(label.toLocaleLowerCase())
        if (mention) {
          content.push({
            type: 'mention',
            attrs: {
              id: mention.accountId,
              text: `@${mention.label}`,
              userType: 'DEFAULT'
            }
          })
        } else {
          content.push({ type: 'text', text: match[0] })
        }
      } else {
        const formattedText = match[2] ?? match[3] ?? match[4] ?? ''
        const markType = match[2] ? 'strong' : match[3] ? 'em' : 'code'
        content.push({
          type: 'text',
          text: formattedText,
          marks: [{ type: markType }]
        })
      }
      cursor = match.index + match[0].length
    }
    if (cursor < line.length) content.push({ type: 'text', text: line.slice(cursor) })
    return content
  }

  const content: Array<Record<string, unknown>> = text.split('\n').map(line => ({
    type: 'paragraph',
    content: buildInlineContent(line)
  }))
  if (attachments.length) {
    content.push({ type: 'rule' })
    content.push({
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'Attachments',
          marks: [{ type: 'strong' }]
        }
      ]
    })
    for (const attachment of attachments) {
      content.push({
        type: 'paragraph',
        content: [
          { type: 'text', text: '📎 ' },
          {
            type: 'inlineCard',
            attrs: { url: attachment.downloadUrl }
          },
          { type: 'text', text: ' · ' },
          {
            type: 'text',
            text: attachment.filename,
            marks: [
              {
                type: 'link',
                attrs: { href: attachment.downloadUrl }
              }
            ]
          },
          { type: 'text', text: ' (download)' }
        ]
      })
    }
  }

  return {
    type: 'doc',
    version: 1,
    content
  }
}

function clearWorkItemCaches(parentIssueKey: string) {
  for (const key of Array.from(jiraCache.keys())) {
    if (key.includes(parentIssueKey)) {
      jiraCache.delete(key)
    }
  }
  const detailsStore = jiraStore.get('workItemDetails') ?? {}
  delete detailsStore[parentIssueKey]
  jiraStore.set('workItemDetails', detailsStore)
  const lightStore = jiraStore.get('workItemsLight') ?? {}
  delete lightStore[parentIssueKey]
  jiraStore.set('workItemsLight', lightStore)
}

function clearAllWorkItemCaches() {
  jiraCache.clear()
  workItemsLightRefreshInFlight.clear()
  jiraStore.set('workItemDetails', {})
  jiraStore.set('workItemsLight', {})
}

function validateAgileId(value: unknown, _label: string) {
  return validateNumberRange(value, 1, Number.MAX_SAFE_INTEGER, { integer: true })
}

function validateIssueKeyList(value: unknown, label: string) {
  if (!Array.isArray(value) || !value.length || value.length > 50) {
    throw new Error(`Invalid ${label}: expected 1-50 issue keys`)
  }
  return Array.from(new Set(value.map(issueKey => validateJiraIssueKey(issueKey))))
}

function normalizeSprintStatusCategory(
  categoryKey: string | null | undefined,
  statusName: string | null | undefined
): JiraSprintIssue['statusCategoryKey'] {
  const normalizedCategory = (categoryKey ?? '').toLowerCase()
  if (normalizedCategory === 'done') return 'done'
  if (normalizedCategory === 'indeterminate') return 'indeterminate'
  if (normalizedCategory === 'new') return 'todo'
  const normalizedStatus = (statusName ?? '').toLowerCase()
  if (/done|closed|resolved|complete/.test(normalizedStatus)) return 'done'
  if (/progress|review|testing|blocked/.test(normalizedStatus)) return 'indeterminate'
  return 'todo'
}

function normalizeSprintIssue(issue: JiraSearchIssue): JiraSprintIssue {
  const statusName = issue.fields?.status?.name?.trim() || 'To Do'
  return {
    key: validateJiraIssueKey(issue.key),
    summary: issue.fields?.summary?.trim() || issue.key,
    statusName,
    statusCategoryKey: normalizeSprintStatusCategory(
      issue.fields?.status?.statusCategory?.key,
      statusName
    ),
    assigneeName: issue.fields?.assignee?.displayName?.trim() || null,
    timespent:
      issue.fields?.timespent ?? issue.fields?.timetracking?.timeSpentSeconds ?? 0,
    estimateSeconds:
      issue.fields?.timeoriginalestimate ??
      issue.fields?.timetracking?.originalEstimateSeconds ??
      0
  }
}

async function fetchAgileValues<T>(path: string, limit = 200): Promise<T[]> {
  const values: T[] = []
  let startAt = 0
  while (values.length < limit) {
    const separator = path.includes('?') ? '&' : '?'
    const data = (await jiraRequest(
      `${path}${separator}startAt=${startAt}&maxResults=100`
    )) as {
      values?: T[]
      startAt?: number
      maxResults?: number
      total?: number
      isLast?: boolean
    }
    const page = data.values ?? []
    values.push(...page.slice(0, limit - values.length))
    if (!page.length || data.isLast) break
    startAt += page.length
    if (data.total !== undefined && startAt >= data.total) break
  }
  return values
}

async function fetchAgileIssues(path: string, limit = 500): Promise<JiraSprintIssue[]> {
  const issues: JiraSearchIssue[] = []
  let startAt = 0
  const fields = 'summary,status,assignee,timespent,timeoriginalestimate,timetracking'
  while (issues.length < limit) {
    const separator = path.includes('?') ? '&' : '?'
    const data = (await jiraRequest(
      `${path}${separator}startAt=${startAt}&maxResults=100&fields=${encodeURIComponent(fields)}`
    )) as JiraSearchResponse
    const page = data.issues ?? []
    issues.push(...page.slice(0, limit - issues.length))
    if (!page.length) break
    startAt += page.length
    if (data.total !== undefined && startAt >= data.total) break
  }
  return issues.map(normalizeSprintIssue)
}

function validateCreateIssuePayload(payload: unknown): JiraIssueCreatePayload {
  const safe = validateExactObject<{
    parentIssueKey?: unknown
    summary?: unknown
    description?: unknown
    estimateSeconds?: unknown
  }>(
    payload ?? {},
    ['parentIssueKey', 'summary', 'description', 'estimateSeconds'],
    'jira issue create payload'
  )
  const estimateSeconds =
    safe.estimateSeconds === null || safe.estimateSeconds === undefined
      ? null
      : validateNumberRange(safe.estimateSeconds, 0, 60 * 60 * 24 * 365, { integer: true })
  return {
    parentIssueKey: validateEpicKey(safe.parentIssueKey),
    summary: validateStringLength(safe.summary, 1, 255),
    description: validateOptionalString(safe.description, { min: 0, max: 10000 }) ?? undefined,
    estimateSeconds
  }
}

function formatJiraEstimateText(seconds: number) {
  const totalMinutes = Math.max(1, Math.round(seconds / 60))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h`
  return `${minutes}m`
}

async function fetchJiraIssueEstimateSeconds(issueKey: string) {
  const issue = (await jiraRequest(
    `/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=timeoriginalestimate,timetracking`
  )) as {
    fields?: {
      timeoriginalestimate?: number | null
      timetracking?: {
        originalEstimateSeconds?: number | null
      } | null
    }
  }
  return (
    issue.fields?.timeoriginalestimate ??
    issue.fields?.timetracking?.originalEstimateSeconds ??
    0
  )
}

async function setJiraIssueOriginalEstimate(issueKey: string, estimateSeconds: number) {
  const estimateText = formatJiraEstimateText(estimateSeconds)
  console.log(
    '[FICTIVE TASK JIRA ESTIMATE]',
    `issue=${issueKey}`,
    `estimateSeconds=${estimateSeconds}`,
    `estimateText=${estimateText}`
  )
  await jiraRequest(`/rest/api/3/issue/${encodeURIComponent(issueKey)}`, {
    method: 'PUT',
    body: JSON.stringify({
      fields: {
        timetracking: {
          originalEstimate: estimateText,
          remainingEstimate: estimateText
        }
      }
    })
  })
  const storedEstimateSeconds = await fetchJiraIssueEstimateSeconds(issueKey)
  console.log(
    '[FICTIVE TASK JIRA ESTIMATE]',
    `issue=${issueKey}`,
    `storedEstimateSeconds=${storedEstimateSeconds}`
  )
  if (storedEstimateSeconds !== estimateSeconds) {
    throw new Error(
      `Jira created ${issueKey}, but stored original estimate is ${formatJiraEstimateText(storedEstimateSeconds)} instead of ${estimateText}. Check that Time Tracking is editable for this Jira issue type.`
    )
  }
}

async function createJiraIssueUnderParent(payload: JiraIssueCreatePayload): Promise<JiraCreatedIssue> {
  const parent = (await jiraRequest(
    `/rest/api/3/issue/${encodeURIComponent(payload.parentIssueKey)}?fields=project,issuetype`
  )) as {
    fields?: {
      project?: {
        key?: string | null
      } | null
    }
  }
  const projectKey = parent.fields?.project?.key
  if (!projectKey) {
    throw new Error(`Jira parent ${payload.parentIssueKey} does not expose a project key`)
  }

  const fields: Record<string, unknown> = {
    project: { key: projectKey },
    parent: { key: payload.parentIssueKey },
    summary: payload.summary,
    issuetype: { name: 'Task' },
    description: adfTextDocument(payload.description || payload.summary)
  }
  const created = (await jiraRequest('/rest/api/3/issue', {
    method: 'POST',
    body: JSON.stringify({ fields })
  })) as { id?: string; key?: string }

  if (!created.key) {
    throw new Error('Jira did not return a key for the created issue')
  }
  const createdIssueKey = validateJiraIssueKey(created.key)
  if (payload.estimateSeconds && payload.estimateSeconds > 0) {
    await setJiraIssueOriginalEstimate(createdIssueKey, payload.estimateSeconds)
  }
  clearWorkItemCaches(payload.parentIssueKey)
  return {
    id: created.id,
    key: createdIssueKey,
    summary: payload.summary,
    parentIssueKey: payload.parentIssueKey,
    estimateSeconds: payload.estimateSeconds ?? 0
  }
}

export function registerJiraIpc() {
  if (JIRA_E2E) {
    let mappings: Record<string, string> = {
      'Weizmann Institute of Science': 'VDA-98',
      Microsoft: 'VDA-147',
      LSM: 'LSM-10'
    }
    ipcMain.handle('jira:getStatus', async () => ({
      baseUrl: 'https://jira.local',
      email: 'e2e@jira.local',
      configured: true,
      hasCredentials: true,
      projectKey: PRIMARY_PROJECT_KEY,
      projectKeys: PROJECT_KEYS,
      projectName: PROJECT_NAME
    }))
    ipcMain.handle('jira:setCredentials', async () => true)
    ipcMain.handle('jira:clearCredentials', async () => true)
    ipcMain.handle('jira:getMappings', async () => mappings)
    ipcMain.handle('jira:setMapping', async (_event, customer: string, epicKey: string | null) => {
      const safeCustomer = validateStringLength(customer, 1, 160)
      if (epicKey) {
        mappings = { ...mappings, [safeCustomer]: validateEpicKey(epicKey) }
      } else {
        const next = { ...mappings }
        delete next[safeCustomer]
        mappings = next
      }
      return true
    })
    ipcMain.handle('jira:getEpics', async () => E2E_EPICS)
    ipcMain.handle('jira:getWorkItems', async (_event, epicKey: string) => {
      const safeEpicKey = validateEpicKey(epicKey)
      return E2E_WORK_ITEMS_BY_EPIC[safeEpicKey] ?? []
    })
    ipcMain.handle('jira:getWorkItemsSummary', async (_event, epicKey: string) => {
      const safeEpicKey = validateEpicKey(epicKey)
      const items = E2E_WORK_ITEMS_BY_EPIC[safeEpicKey] ?? []
      let spentSeconds = 0
      let estimateSeconds = 0
      for (const item of items) {
        spentSeconds += item.timespent ?? 0
        estimateSeconds += item.estimateSeconds ?? 0
        for (const subtask of item.subtasks ?? []) {
          spentSeconds += subtask.timespent ?? 0
          estimateSeconds += subtask.estimateSeconds ?? 0
        }
      }
      return { spentSeconds, estimateSeconds, partial: false }
    })
    ipcMain.handle('jira:getEpicDebug', async (_event, epicKey: string) => ({
      epicKey: validateEpicKey(epicKey),
      fields: {}
    }))
    ipcMain.handle('jira:getTimeTrackingConfig', async () => ({
      hoursPerDay: 8,
      daysPerWeek: 5
    }))
    ipcMain.handle('jira:getWorkItemDetails', async (_event, epicKey: string) => {
      const safeEpicKey = validateEpicKey(epicKey)
      return { items: E2E_WORK_ITEMS_BY_EPIC[safeEpicKey] ?? [], partial: false }
    })
    ipcMain.handle('jira:createIssue', async (_event, payload: unknown) => {
      const safe = validateCreateIssuePayload(payload)
      const issueKey = `${safe.parentIssueKey.split('-')[0]}-${Date.now()}`
      const created: JiraWorkItem = {
        key: issueKey,
        summary: safe.summary,
        timespent: 0,
        estimateSeconds: safe.estimateSeconds ?? 0,
        assigneeName: 'Unassigned',
        statusName: 'To Do',
        subtasks: [],
        worklogs: [],
        worklogTotal: 0,
        lastWorklog: null
      }
      E2E_WORK_ITEMS_BY_EPIC[safe.parentIssueKey] = [
        created,
        ...(E2E_WORK_ITEMS_BY_EPIC[safe.parentIssueKey] ?? [])
      ]
      return {
        id: `e2e-${Date.now()}`,
        key: created.key,
        summary: created.summary,
        parentIssueKey: safe.parentIssueKey,
        estimateSeconds: created.estimateSeconds
      }
    })
    ipcMain.handle('jira:getIssueWorklogs', async () => [])
    ipcMain.handle('jira:findWorklogsForDate', async () => ({ worklogs: [], partial: false }))
    ipcMain.handle('jira:addWorklog', async () => ({
      id: `e2e-${Date.now()}`,
      started: new Date().toISOString(),
      seconds: 3600,
      comment: null,
      authorName: 'E2E',
      authorId: 'e2e'
    }))
    ipcMain.handle('jira:deleteWorklog', async () => true)
    ipcMain.handle('jira:getWorklogHistory', async () => [])
    ipcMain.handle('jira:searchUsers', async (_event, query: unknown) => {
      const safeQuery = validateStringLength(query, 1, 100).toLocaleLowerCase()
      return [
        {
          accountId: 'e2e-dror',
          displayName: 'Dror Rahamim',
          emailAddress: 'dror@example.com',
          avatarUrl: null
        },
        {
          accountId: 'e2e-vitaly',
          displayName: 'Vitaly Shechtman',
          emailAddress: 'vitaly@example.com',
          avatarUrl: null
        }
      ].filter(user =>
        `${user.displayName} ${user.emailAddress}`.toLocaleLowerCase().includes(safeQuery)
      )
    })
    ipcMain.handle('jira:getTransitions', async (_event, issueKey: unknown) => {
      validateJiraIssueKey(issueKey)
      return [
        { id: '11', name: 'To Do', toStatusName: 'To Do' },
        { id: '21', name: 'In Progress', toStatusName: 'In Progress' },
        { id: '31', name: 'Done', toStatusName: 'Done' }
      ]
    })
    ipcMain.handle('jira:getRecentComments', async (_event, issueKey: unknown) => {
      const safeIssueKey = validateJiraIssueKey(issueKey)
      const normalizedComment = normalizeJiraComment(
        {
          id: 'e2e-jira-comment-1',
          author: {
            accountId: 'e2e-vitaly',
            displayName: 'Vitaly Shechtman'
          },
          created: '2026-09-03T14:40:00.000Z',
          body: {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'mediaGroup',
                content: [
                  {
                    type: 'media',
                    attrs: {
                      id: 'e2e-media-services-id',
                      type: 'file',
                      collection: ''
                    }
                  }
                ]
              },
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: `The latest Jira update for ${safeIssueKey} is ready for review.`
                  }
                ]
              }
            ]
          }
        },
        [
          {
            id: 10000,
            filename: 'hrs-e2e-image.png',
            mimeType: 'image/png',
            created: '2026-09-03T14:39:59.700Z',
            author: { accountId: 'e2e-vitaly' }
          }
        ]
      )
      return [
        {
          ...normalizedComment,
          attachments: normalizedComment.attachments.map(attachment => ({
            ...attachment,
            previewDataUrl:
              'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
          }))
        }
      ]
    })
    ipcMain.handle('jira:openAttachment', async (_event, payload: unknown) => {
      const safe = validateExactObject<{ id?: unknown; filename?: unknown }>(
        payload ?? {},
        ['id', 'filename'],
        'Jira attachment'
      )
      validateStringLength(safe.id, 1, 200)
      validateStringLength(safe.filename, 1, 500)
      return true
    })
    ipcMain.handle('jira:addComment', async (_event, payload: unknown) => {
      const safe = validateExactObject<{
        issueKey?: unknown
        text?: unknown
        mentions?: unknown
        attachments?: unknown
      }>(
        payload ?? {},
        ['issueKey', 'text', 'mentions', 'attachments'],
        'Jira comment'
      )
      const attachments = validateJiraCommentAttachments(safe.attachments)
      return {
        id: `e2e-comment-${Date.now()}`,
        issueKey: validateJiraIssueKey(safe.issueKey),
        text: validateJiraCommentText(safe.text),
        mentions: validateJiraMentions(safe.mentions),
        attachments
      }
    })
    ipcMain.handle('jira:uploadAttachments', async (_event, payload: unknown) => {
      const safe = validateExactObject<{ issueKey?: unknown; attachmentIds?: unknown }>(
        payload ?? {},
        ['issueKey', 'attachmentIds'],
        'Jira attachments'
      )
      const attachments = await resolveIntegrationAttachments(safe.attachmentIds)
      return attachments.map((attachment, index) => ({
        id: 10000 + index,
        filename: attachment.name,
        size: attachment.size,
        issueKey: validateJiraIssueKey(safe.issueKey)
      }))
    })
    ipcMain.handle('jira:transitionIssue', async (_event, payload: unknown) => {
      const safe = validateExactObject<{ issueKey?: unknown; transitionId?: unknown }>(
        payload ?? {},
        ['issueKey', 'transitionId'],
        'Jira transition'
      )
      const issueKey = validateJiraIssueKey(safe.issueKey)
      const transitionId = validateStringLength(safe.transitionId, 1, 32)
      if (!/^\d+$/.test(transitionId)) throw new Error('Invalid Jira transition ID.')
      const nextStatus =
        transitionId === '31'
          ? { statusName: 'Done', statusCategoryKey: 'done' as const }
          : transitionId === '21'
            ? { statusName: 'In Progress', statusCategoryKey: 'indeterminate' as const }
            : { statusName: 'To Do', statusCategoryKey: 'todo' as const }
      for (const issues of [
        ...Object.values(e2eSprintBacklog),
        ...Object.values(e2eSprintIssues)
      ]) {
        const issue = issues.find(item => item.key === issueKey)
        if (issue) Object.assign(issue, nextStatus)
      }
      return true
    })
    ipcMain.handle('jira:transitionSprintIssue', async (_event, payload: unknown) => {
      await requireSupabaseManager()
      const safe = validateExactObject<{ issueKey?: unknown; transitionId?: unknown }>(
        payload ?? {},
        ['issueKey', 'transitionId'],
        'Jira sprint transition'
      )
      const issueKey = validateJiraIssueKey(safe.issueKey)
      const transitionId = validateStringLength(safe.transitionId, 1, 32)
      if (!/^\d+$/.test(transitionId)) throw new Error('Invalid Jira transition ID.')
      const nextStatus =
        transitionId === '31'
          ? { statusName: 'Done', statusCategoryKey: 'done' as const }
          : transitionId === '21'
            ? { statusName: 'In Progress', statusCategoryKey: 'indeterminate' as const }
            : { statusName: 'To Do', statusCategoryKey: 'todo' as const }
      for (const issues of [...Object.values(e2eSprintBacklog), ...Object.values(e2eSprintIssues)]) {
        const issue = issues.find(item => item.key === issueKey)
        if (issue) Object.assign(issue, nextStatus)
      }
      return true
    })
    ipcMain.handle('jira:getBoards', async (_event, projectKey: unknown) => {
      const key = validateStringLength(projectKey, 1, 15).toUpperCase()
      return E2E_SPRINT_BOARDS.filter(board => board.projectKey === key)
    })
    ipcMain.handle('jira:getSprints', async (_event, boardId: unknown) => {
      const id = validateNumberRange(boardId, 1, Number.MAX_SAFE_INTEGER, { integer: true })
      return E2E_SPRINTS[id] ?? []
    })
    ipcMain.handle('jira:getBacklogIssues', async (_event, boardId: unknown) => {
      const id = validateNumberRange(boardId, 1, Number.MAX_SAFE_INTEGER, { integer: true })
      return e2eSprintBacklog[id] ?? []
    })
    ipcMain.handle(
      'jira:getSprintIssues',
      async (_event, boardId: unknown, sprintId: unknown) => {
        validateNumberRange(boardId, 1, Number.MAX_SAFE_INTEGER, { integer: true })
        const id = validateNumberRange(sprintId, 1, Number.MAX_SAFE_INTEGER, { integer: true })
        return e2eSprintIssues[id] ?? []
      }
    )
    ipcMain.handle('jira:getSprintIssueDetails', async (_event, issueKey: unknown) => {
      const key = validateJiraIssueKey(issueKey)
      return {
        issueKey: key,
        description: `Detailed Jira description for ${key}.`,
        attachments:
          key === 'VDA-601'
            ? [
                {
                  id: '10000',
                  name: 'sprint-spec.png',
                  mimeType: 'image/png',
                  previewDataUrl:
                    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
                }
              ]
            : [],
        comments: [
          {
            id: `detail-${key}`,
            source: 'jira' as const,
            authorId: 'e2e-vitaly',
            authorName: 'Vitaly Shechtman',
            avatarUrl: null,
            text: `Sprint comment for ${key}.`,
            attachments: [],
            createdAt: '2026-09-15T09:15:00.000Z'
          }
        ]
      } satisfies JiraSprintIssueDetails
    })
    ipcMain.handle('jira:startSprintIssue', async (_event, issueKey: unknown) => {
      await requireSupabaseUser()
      const key = validateJiraIssueKey(issueKey)
      if (!PROJECT_KEYS.includes(key.split('-')[0])) {
        throw new Error('This Jira project is not enabled for HRS sprint management.')
      }
      for (const issues of Object.values(e2eSprintIssues)) {
        const issue = issues.find(item => item.key === key)
        if (issue) Object.assign(issue, { statusName: 'In Progress', statusCategoryKey: 'indeterminate' })
      }
      return true
    })
    ipcMain.handle('jira:completeSprintIssueByConsensus', async (_event, payload: unknown) => {
      const safe = validateExactObject<{ issueKey?: unknown; taskId?: unknown }>(
        payload ?? {},
        ['issueKey', 'taskId'],
        'Jira sprint completion'
      )
      const key = validateJiraIssueKey(safe.issueKey)
      const taskId = validateStringLength(safe.taskId, 1, 64)
      await requireSprintTaskCompletionConsensus(taskId, key)
      for (const issues of Object.values(e2eSprintIssues)) {
        const issue = issues.find(item => item.key === key)
        if (issue) Object.assign(issue, { statusName: 'Done', statusCategoryKey: 'done' })
      }
      return true
    })
    ipcMain.handle('jira:moveIssuesToSprint', async (_event, payload: unknown) => {
      await requireSupabaseManager()
      const safe = validateExactObject<{ sprintId?: unknown; issueKeys?: unknown }>(
        payload ?? {},
        ['sprintId', 'issueKeys'],
        'Jira sprint move'
      )
      const sprintId = validateNumberRange(safe.sprintId, 1, Number.MAX_SAFE_INTEGER, {
        integer: true
      })
      if (!Array.isArray(safe.issueKeys) || !safe.issueKeys.length || safe.issueKeys.length > 50) {
        throw new Error('Invalid Jira sprint issue list.')
      }
      const keys = safe.issueKeys.map(validateJiraIssueKey)
      const moved: JiraSprintIssue[] = []
      for (const key of keys) {
        for (const [boardId, issues] of Object.entries(e2eSprintBacklog)) {
          const index = issues.findIndex(issue => issue.key === key)
          if (index >= 0) {
            moved.push(...issues.splice(index, 1))
            e2eSprintBacklog[Number(boardId)] = issues
          }
        }
        for (const [existingSprintId, issues] of Object.entries(e2eSprintIssues)) {
          const index = issues.findIndex(issue => issue.key === key)
          if (index >= 0) {
            moved.push(...issues.splice(index, 1))
            e2eSprintIssues[Number(existingSprintId)] = issues
          }
        }
      }
      e2eSprintIssues[sprintId] = [
        ...(e2eSprintIssues[sprintId] ?? []),
        ...moved
      ]
      return true
    })
    ipcMain.handle('jira:moveIssuesToBacklog', async (_event, issueKeys: unknown) => {
      await requireSupabaseManager()
      if (!Array.isArray(issueKeys) || !issueKeys.length || issueKeys.length > 50) {
        throw new Error('Invalid Jira backlog issue list.')
      }
      const keys = issueKeys.map(validateJiraIssueKey)
      for (const key of keys) {
        let moved: JiraSprintIssue | null = null
        for (const [sprintId, issues] of Object.entries(e2eSprintIssues)) {
          const index = issues.findIndex(issue => issue.key === key)
          if (index >= 0) {
            moved = issues.splice(index, 1)[0]
            e2eSprintIssues[Number(sprintId)] = issues
            break
          }
        }
        if (!moved) continue
        const board = E2E_SPRINT_BOARDS.find(item => item.projectKey === key.split('-')[0])
        if (board) e2eSprintBacklog[board.id] = [...(e2eSprintBacklog[board.id] ?? []), moved]
      }
      return true
    })
    ipcMain.handle('jira:rankIssues', async (_event, payload: unknown) => {
      await requireSupabaseManager()
      const safe = validateExactObject<{
        issueKeys?: unknown
        rankBeforeIssue?: unknown
        rankAfterIssue?: unknown
      }>(
        payload ?? {},
        ['issueKeys', 'rankBeforeIssue', 'rankAfterIssue'],
        'Jira issue ranking'
      )
      if (!Array.isArray(safe.issueKeys) || safe.issueKeys.length !== 1) {
        throw new Error('Invalid Jira ranking issue list.')
      }
      const issueKey = validateJiraIssueKey(safe.issueKeys[0])
      const before = safe.rankBeforeIssue
        ? validateJiraIssueKey(safe.rankBeforeIssue)
        : null
      const after = safe.rankAfterIssue ? validateJiraIssueKey(safe.rankAfterIssue) : null
      for (const issues of [
        ...Object.values(e2eSprintBacklog),
        ...Object.values(e2eSprintIssues)
      ]) {
        const from = issues.findIndex(issue => issue.key === issueKey)
        if (from < 0) continue
        const [issue] = issues.splice(from, 1)
        const anchor = before ?? after
        const anchorIndex = anchor ? issues.findIndex(item => item.key === anchor) : -1
        const destination = anchorIndex < 0 ? issues.length : anchorIndex + (after ? 1 : 0)
        issues.splice(destination, 0, issue)
      }
      return true
    })
    return
  }

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
      projectKey: PRIMARY_PROJECT_KEY,
      projectKeys: PROJECT_KEYS,
      projectName: PROJECT_NAME
    }
  })

  ipcMain.handle('jira:setCredentials', async (_event, email: string, token: string) => {
    const safeEmail = validateEmail(email)
    const safeToken = validateStringLength(token, 10, 512)
    await setJiraCredentials(safeEmail, safeToken)
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
    const safeCustomer = validateStringLength(customer, 1, 160)
    const safeEpicKey = epicKey === null ? null : validateEpicKey(epicKey)
    return setJiraMapping(safeCustomer, safeEpicKey)
  })

  ipcMain.handle('jira:getEpics', async () => {
    const cacheKey = `epics:${PROJECT_KEYS.join(',')}`
    const cached = getCachedValue<JiraEpic[]>(cacheKey)
    if (cached) return cached
    const EPIC_FETCH_LIMIT = 200
    const results = await Promise.allSettled(
      PROJECT_KEYS.map(projectKey =>
        searchIssues(
          `${projectJql(projectKey)} AND issuetype = Epic ORDER BY updated DESC`,
          ['summary'],
          { limit: EPIC_FETCH_LIMIT }
        )
      )
    )
    const successful = results.filter(
      (result): result is PromiseFulfilledResult<JiraSearchIssue[]> => result.status === 'fulfilled'
    )
    if (!successful.length) {
      const firstFailure = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      )
      throw firstFailure?.reason ?? new Error('Jira projects could not be loaded')
    }
    const data = successful.flatMap(result => result.value)
    const epics = Array.from(new Map(data.map(issue => [issue.key, issue])).values()).map(issue => ({
      key: issue.key,
      summary: issue.fields?.summary ?? issue.key
    }))
    setCachedValue(cacheKey, epics, 30 * 60 * 1000)
    return epics
  })

  ipcMain.handle('jira:getBoards', async (_event, projectKey: unknown) => {
    const key = validateStringLength(projectKey, 1, 15).toUpperCase()
    if (!PROJECT_KEYS.includes(key)) throw new Error(`Unsupported Jira project: ${key}`)
    const params = new URLSearchParams({
      projectKeyOrId: key,
      type: 'scrum',
      orderBy: 'name'
    })
    const values = await fetchAgileValues<{
      id?: number
      name?: string
      type?: string
      location?: { projectKey?: string | null } | null
    }>(`/rest/agile/1.0/board?${params.toString()}`, 100)
    return values
      .filter(board => Number.isInteger(board.id) && board.id && board.name)
      .map(board => ({
        id: board.id!,
        name: board.name!,
        type: board.type || 'scrum',
        projectKey: board.location?.projectKey?.trim().toUpperCase() || key
      })) satisfies JiraAgileBoard[]
  })

  ipcMain.handle('jira:getSprints', async (_event, boardId: unknown) => {
    const id = validateAgileId(boardId, 'Jira board ID')
    const values = await fetchAgileValues<{
      id?: number
      name?: string
      state?: string
      goal?: string | null
      startDate?: string | null
      endDate?: string | null
      originBoardId?: number | null
    }>(`/rest/agile/1.0/board/${id}/sprint?state=active,closed`, 300)
    return values
      .filter(
        sprint =>
          Number.isInteger(sprint.id) &&
          sprint.id &&
          sprint.name &&
          ['active', 'future', 'closed'].includes(sprint.state ?? '')
      )
      .map(sprint => ({
        id: sprint.id!,
        name: sprint.name!,
        state: sprint.state as JiraSprint['state'],
        goal: sprint.goal?.trim() || null,
        startDate: sprint.startDate ?? null,
        endDate: sprint.endDate ?? null,
        originBoardId: sprint.originBoardId ?? id
      })) satisfies JiraSprint[]
  })

  ipcMain.handle('jira:getBacklogIssues', async (_event, boardId: unknown) => {
    const id = validateAgileId(boardId, 'Jira board ID')
    return fetchAgileIssues(`/rest/agile/1.0/board/${id}/backlog`)
  })

  ipcMain.handle(
    'jira:getSprintIssues',
    async (_event, boardId: unknown, sprintId: unknown) => {
      const safeBoardId = validateAgileId(boardId, 'Jira board ID')
      const safeSprintId = validateAgileId(sprintId, 'Jira sprint ID')
      return fetchAgileIssues(
        `/rest/agile/1.0/board/${safeBoardId}/sprint/${safeSprintId}/issue`
      )
    }
  )

  ipcMain.handle('jira:getSprintIssueDetails', async (_event, issueKey: unknown) => {
    const key = validateJiraIssueKey(issueKey)
    const [issueData, commentsData] = await Promise.all([
      jiraRequest(
        `/rest/api/3/issue/${encodeURIComponent(key)}?fields=description,attachment`
      ) as Promise<{
        fields?: { description?: unknown; attachment?: JiraIssueAttachment[] }
      }>,
      jiraRequest(
        `/rest/api/3/issue/${encodeURIComponent(key)}/comment?maxResults=20&orderBy=-created`
      ) as Promise<{ comments?: JiraComment[] }>
    ])
    const issueAttachments = issueData.fields?.attachment ?? []
    let previewBudget = 6
    const attachments = await Promise.all(
      issueAttachments
        .filter(attachment => attachment.id !== undefined && attachment.filename?.trim())
        .slice(0, 50)
        .map(async attachment => {
          const id = String(attachment.id)
          const mimeType = attachment.mimeType?.trim() || null
          let previewDataUrl: string | null = null
          if (mimeType?.startsWith('image/') && previewBudget > 0) {
            previewBudget -= 1
            previewDataUrl = await getJiraAttachmentPreviewDataUrl(id)
          }
          return {
            id,
            name: attachment.filename!.trim(),
            mimeType,
            previewDataUrl
          }
        })
    )
    const comments = (commentsData.comments ?? [])
      .map(comment => normalizeJiraComment(comment, issueAttachments))
      .filter(comment => comment.id && (comment.text || comment.attachments.length))
      .slice(0, 20)
    return {
      issueKey: key,
      description: jiraCommentBodyToText(issueData.fields?.description).trim().slice(0, 10_000),
      attachments,
      comments
    } satisfies JiraSprintIssueDetails
  })

  ipcMain.handle('jira:startSprintIssue', async (_event, issueKey: unknown) => {
    await requireSupabaseUser()
    const key = validateJiraIssueKey(issueKey)
    if (!PROJECT_KEYS.includes(key.split('-')[0])) {
      throw new Error('This Jira project is not enabled for HRS sprint management.')
    }
    const data = (await jiraRequest(
      `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`
    )) as { transitions?: JiraTransition[] }
    const transition = (data.transitions ?? []).find(item =>
      normalizeSprintStatusCategory(null, item.to?.name ?? item.name) === 'indeterminate'
    )
    if (!transition) throw new Error('No Jira transition to In Progress is available.')
    await jiraRequest(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
      method: 'POST',
      body: JSON.stringify({ transition: { id: transition.id } })
    })
    clearAllWorkItemCaches()
    return true
  })

  ipcMain.handle('jira:completeSprintIssueByConsensus', async (_event, payload: unknown) => {
    const safe = validateExactObject<{ issueKey?: unknown; taskId?: unknown }>(
      payload ?? {},
      ['issueKey', 'taskId'],
      'Jira sprint completion'
    )
    const key = validateJiraIssueKey(safe.issueKey)
    const taskId = validateStringLength(safe.taskId, 1, 64)
    await requireSprintTaskCompletionConsensus(taskId, key)
    const data = (await jiraRequest(
      `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`
    )) as { transitions?: JiraTransition[] }
    const transition = (data.transitions ?? []).find(item =>
      normalizeSprintStatusCategory(null, item.to?.name ?? item.name) === 'done'
    )
    if (!transition) throw new Error('No Jira transition to Done is available.')
    await jiraRequest(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
      method: 'POST',
      body: JSON.stringify({ transition: { id: transition.id } })
    })
    clearAllWorkItemCaches()
    return true
  })

  ipcMain.handle('jira:moveIssuesToSprint', async (_event, payload: unknown) => {
    await requireSupabaseManager()
    const safe = validateExactObject<{ sprintId?: unknown; issueKeys?: unknown }>(
      payload ?? {},
      ['sprintId', 'issueKeys'],
      'Jira sprint move'
    )
    const sprintId = validateAgileId(safe.sprintId, 'Jira sprint ID')
    const issueKeys = validateIssueKeyList(safe.issueKeys, 'Jira sprint issues')
    await jiraRequest(`/rest/agile/1.0/sprint/${sprintId}/issue`, {
      method: 'POST',
      body: JSON.stringify({ issues: issueKeys })
    })
    clearAllWorkItemCaches()
    return true
  })

  ipcMain.handle('jira:moveIssuesToBacklog', async (_event, issueKeys: unknown) => {
    await requireSupabaseManager()
    const keys = validateIssueKeyList(issueKeys, 'Jira backlog issues')
    await jiraRequest('/rest/agile/1.0/backlog/issue', {
      method: 'POST',
      body: JSON.stringify({ issues: keys })
    })
    clearAllWorkItemCaches()
    return true
  })

  ipcMain.handle('jira:rankIssues', async (_event, payload: unknown) => {
    await requireSupabaseManager()
    const safe = validateExactObject<{
      issueKeys?: unknown
      rankBeforeIssue?: unknown
      rankAfterIssue?: unknown
    }>(
      payload ?? {},
      ['issueKeys', 'rankBeforeIssue', 'rankAfterIssue'],
      'Jira issue ranking'
    )
    const issueKeys = validateIssueKeyList(safe.issueKeys, 'Jira ranking issues')
    const rankBeforeIssue = validateOptionalString(safe.rankBeforeIssue, {
      min: 1,
      max: 64,
      allowNull: true
    })
    const rankAfterIssue = validateOptionalString(safe.rankAfterIssue, {
      min: 1,
      max: 64,
      allowNull: true
    })
    if (!rankBeforeIssue && !rankAfterIssue) {
      throw new Error('Choose an issue before or after which to rank the card.')
    }
    await jiraRequest('/rest/agile/1.0/issue/rank', {
      method: 'PUT',
      body: JSON.stringify({
        issues: issueKeys,
        ...(rankBeforeIssue
          ? { rankBeforeIssue: validateJiraIssueKey(rankBeforeIssue) }
          : {}),
        ...(rankAfterIssue
          ? { rankAfterIssue: validateJiraIssueKey(rankAfterIssue) }
          : {})
      })
    })
    return true
  })

  ipcMain.handle('jira:searchUsers', async (_event, query: unknown) => {
    const safeQuery = validateStringLength(query, 1, 100)
    const params = new URLSearchParams({
      query: safeQuery,
      maxResults: '20'
    })
    const users = (await jiraRequest(
      `/rest/api/3/user/search?${params.toString()}`
    )) as JiraDirectoryUser[]
    return users
      .filter(user => user.active !== false && user.accountId && user.displayName)
      .slice(0, 20)
      .map(user => ({
        accountId: user.accountId,
        displayName: user.displayName,
        emailAddress: user.emailAddress ?? null,
        avatarUrl: user.avatarUrls?.['48x48'] ?? user.avatarUrls?.['32x32'] ?? null
      }))
  })

  ipcMain.handle('jira:getTransitions', async (_event, issueKey: unknown) => {
    const safeIssueKey = validateJiraIssueKey(issueKey)
    const data = (await jiraRequest(
      `/rest/api/3/issue/${encodeURIComponent(safeIssueKey)}/transitions`
    )) as { transitions?: JiraTransition[] }
    return (data.transitions ?? []).map(transition => ({
      id: transition.id,
      name: transition.name,
      toStatusName: transition.to?.name ?? transition.name
    }))
  })

  ipcMain.handle('jira:getRecentComments', async (_event, issueKey: unknown) => {
    const safeIssueKey = validateJiraIssueKey(issueKey)
    const params = new URLSearchParams({
      maxResults: '5',
      orderBy: '-created'
    })
    const [data, issueData] = await Promise.all([
      jiraRequest(
        `/rest/api/3/issue/${encodeURIComponent(safeIssueKey)}/comment?${params.toString()}`
      ) as Promise<{ comments?: JiraComment[] }>,
      jiraRequest(
        `/rest/api/3/issue/${encodeURIComponent(safeIssueKey)}?fields=attachment`
      ).catch(() => ({ fields: { attachment: [] } })) as Promise<{
        fields?: { attachment?: JiraIssueAttachment[] }
      }>
    ])
    const issueAttachments = issueData.fields?.attachment ?? []
    const comments = (data.comments ?? [])
      .map(comment => normalizeJiraComment(comment, issueAttachments))
      .filter(comment => comment.id && (comment.text || comment.attachments.length))
      .slice(0, 5)
    let remainingPreviewBudget = 5
    return Promise.all(
      comments.map(async comment => ({
        ...comment,
        attachments: await Promise.all(
          comment.attachments.map(async attachment => {
            if (!attachment.mimeType?.startsWith('image/') || remainingPreviewBudget <= 0) {
              return attachment
            }
            remainingPreviewBudget -= 1
            const previewDataUrl = await getJiraAttachmentPreviewDataUrl(attachment.id)
            return previewDataUrl ? { ...attachment, previewDataUrl } : attachment
          })
        )
      }))
    )
  })

  ipcMain.handle('jira:openAttachment', async (_event, payload: unknown) => {
    const safe = validateExactObject<{ id?: unknown; filename?: unknown }>(
      payload ?? {},
      ['id', 'filename'],
      'Jira attachment'
    )
    const id = validateStringLength(safe.id, 1, 200)
    if (!/^[A-Za-z0-9-]+$/.test(id)) throw new Error('Invalid Jira attachment ID.')
    const filename = validateStringLength(safe.filename, 1, 500)
      .replace(/[\\/\0]/g, '_')
    const { baseUrl } = await getJiraCredentials()
    await shell.openExternal(
      `${baseUrl.replace(/\/$/, '')}/secure/attachment/${encodeURIComponent(id)}/${encodeURIComponent(filename)}`
    )
    return true
  })

  ipcMain.handle('jira:addComment', async (_event, payload: unknown) => {
    const safe = validateExactObject<{
      issueKey?: unknown
      text?: unknown
      mentions?: unknown
      attachments?: unknown
    }>(
      payload ?? {},
      ['issueKey', 'text', 'mentions', 'attachments'],
      'Jira comment'
    )
    const issueKey = validateJiraIssueKey(safe.issueKey)
    const text = validateJiraCommentText(safe.text)
    const mentions = validateJiraMentions(safe.mentions)
    const attachments = validateJiraCommentAttachments(safe.attachments)
    const { baseUrl } = await getJiraCredentials()
    const linkedAttachments = attachments.map(attachment => ({
      ...attachment,
      downloadUrl: `${baseUrl.replace(/\/$/, '')}/secure/attachment/${encodeURIComponent(
        attachment.id
      )}/${encodeURIComponent(attachment.filename)}`
    }))
    return jiraRequest(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment`, {
      method: 'POST',
      body: JSON.stringify({ body: adfCommentDocument(text, mentions, linkedAttachments) })
    })
  })

  ipcMain.handle('jira:uploadAttachments', async (_event, payload: unknown) => {
    const safe = validateExactObject<{ issueKey?: unknown; attachmentIds?: unknown }>(
      payload ?? {},
      ['issueKey', 'attachmentIds'],
      'Jira attachments'
    )
    const issueKey = validateJiraIssueKey(safe.issueKey)
    const attachments = await resolveIntegrationAttachments(safe.attachmentIds)
    if (!attachments.length) return []
    const form = new FormData()
    for (const attachment of attachments) {
      form.append(
        'file',
        new Blob([attachment.bytes], { type: attachment.mimeType }),
        attachment.name
      )
    }
    return jiraRequest(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/attachments`, {
      method: 'POST',
      headers: { 'X-Atlassian-Token': 'no-check' },
      body: form
    })
  })

  ipcMain.handle('jira:transitionIssue', async (_event, payload: unknown) => {
    const safe = validateExactObject<{ issueKey?: unknown; transitionId?: unknown }>(
      payload ?? {},
      ['issueKey', 'transitionId'],
      'Jira transition'
    )
    const issueKey = validateJiraIssueKey(safe.issueKey)
    const transitionId = validateStringLength(safe.transitionId, 1, 32)
    if (!/^\d+$/.test(transitionId)) throw new Error('Invalid Jira transition ID.')
    await jiraRequest(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
      method: 'POST',
      body: JSON.stringify({ transition: { id: transitionId } })
    })
    clearAllWorkItemCaches()
    return true
  })

  ipcMain.handle('jira:transitionSprintIssue', async (_event, payload: unknown) => {
    await requireSupabaseManager()
    const safe = validateExactObject<{ issueKey?: unknown; transitionId?: unknown }>(
      payload ?? {},
      ['issueKey', 'transitionId'],
      'Jira sprint transition'
    )
    const issueKey = validateJiraIssueKey(safe.issueKey)
    const transitionId = validateStringLength(safe.transitionId, 1, 32)
    if (!/^\d+$/.test(transitionId)) throw new Error('Invalid Jira transition ID.')
    await jiraRequest(`/rest/api/3/issue/${encodeURIComponent(issueKey)}/transitions`, {
      method: 'POST',
      body: JSON.stringify({ transition: { id: transitionId } })
    })
    clearAllWorkItemCaches()
    return true
  })

  ipcMain.handle('jira:getWorkItems', async (_event, epicKey: string) => {
    const safeEpicKey = validateEpicKey(epicKey)
    const WORK_ITEM_LIMIT = 200
    const cacheKey = `workitems:${safeEpicKey}:limit:${WORK_ITEM_LIMIT}`
    // Light fetch - just return cached data, don't validate completeness
    // Full fetch with worklogs happens when user expands a row
    const cached = getCachedValue<JiraWorkItem[]>(cacheKey)
    if (cached) return cached
    const persisted = getPersistedWorkItemsLight(safeEpicKey)
    if (persisted) {
      setCachedValue(cacheKey, persisted.items ?? [], JIRA_PERSIST_TTL_MS)
      const fetchedAt = Date.parse(persisted.fetchedAt)
      const ageMs = Number.isFinite(fetchedAt) ? Date.now() - fetchedAt : Number.POSITIVE_INFINITY
      const shouldRefresh = ageMs > 15 * 60 * 1000
      if (shouldRefresh && !workItemsLightRefreshInFlight.has(safeEpicKey)) {
        const promise = (async () => {
          try {
            const since = Number.isFinite(fetchedAt) ? new Date(fetchedAt) : undefined
            const delta = await fetchWorkItemsLight(safeEpicKey, {
              limit: WORK_ITEM_LIMIT,
              updatedSince: since
            })
            const merged = mergeWorkItemsDeep(persisted.items ?? [], delta)
            setPersistedWorkItemsLight(safeEpicKey, merged)
            setCachedValue(cacheKey, merged, JIRA_PERSIST_TTL_MS)
          } catch {
            // Ignore refresh errors; keep serving the cached payload.
          } finally {
            workItemsLightRefreshInFlight.delete(safeEpicKey)
          }
        })()
        workItemsLightRefreshInFlight.set(safeEpicKey, promise)
      }
      return persisted.items ?? []
    }

    const items = await fetchWorkItemsLight(safeEpicKey, { limit: WORK_ITEM_LIMIT })
    setPersistedWorkItemsLight(safeEpicKey, items)
    setCachedValue(cacheKey, items, JIRA_PERSIST_TTL_MS)
    return items
  })

  ipcMain.handle('jira:getWorkItemsSummary', async (_event, epicKey: string) => {
    const safeEpicKey = validateEpicKey(epicKey)
    const cacheKey = `workitemsummary:${safeEpicKey}`
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
        `/rest/api/3/issue/${encodeURIComponent(safeEpicKey)}?fields=${epicFields.join(',')}`
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
    const primaryJql = `parent = ${safeEpicKey} AND issuetype != Epic ORDER BY updated DESC`
    const fallbackJql = `"Epic Link" = ${safeEpicKey} AND issuetype != Epic ORDER BY updated DESC`
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
    const safeEpicKey = validateEpicKey(epicKey)
    const epicFields = [
      'aggregatetimetracking',
      'aggregatetimeoriginalestimate',
      'aggregatetimespent',
      'timetracking',
      'timeoriginalestimate',
      'timespent'
    ]
    const data = (await jiraRequest(
      `/rest/api/3/issue/${encodeURIComponent(safeEpicKey)}?fields=${epicFields.join(',')}`
    )) as { fields?: Record<string, unknown> }
    return {
      epicKey: safeEpicKey,
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
    const safeEpicKey = validateEpicKey(epicKey)
    if (forceRefresh !== undefined && typeof forceRefresh !== 'boolean') {
      throw new Error('Invalid forceRefresh flag')
    }
    const safeForce = Boolean(forceRefresh)
    const cacheKey = `workitemdetails:${safeEpicKey}`
    const startedAt = Date.now()

    // Helper to check if ALL items and subtasks have complete data
    // (either worklogs loaded OR non-zero timespent)
    const hasCompleteData = (items: JiraWorkItem[]) => {
      if (!items.length) return false
      // Check if all items/subtasks have normalized detail shape cached.
      return items.every(item => {
        if (item.worklogs === undefined) return false
        const subtasks = item.subtasks ?? []
        return subtasks.every(sub => sub.worklogs !== undefined)
      })
    }

    // Force refresh: clear all caches
    if (safeForce) {
      jiraCache.delete(cacheKey)
      const store = jiraStore.get('workItemDetails') ?? {}
      delete store[safeEpicKey]
      jiraStore.set('workItemDetails', store)
    }

    if (!safeForce) {
      const cached = getCachedValue<JiraWorkItemDetailsPayload>(cacheKey)
      const cachedHasCompleteData = cached ? hasCompleteData(cached.items) : false
      
      if (cached && cachedHasCompleteData) {
        return cached
      }

      // Clear in-memory cache if incomplete
      if (cached) {
        jiraCache.delete(cacheKey)
      }

      const persisted = getPersistedWorkItemDetails(safeEpicKey)
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
        delete store[safeEpicKey]
        jiraStore.set('workItemDetails', store)
      }
    }

    // Always do a full fetch if we don't have valid cached data
    try {
      console.log('[jira:getWorkItemDetails] fetch start', safeEpicKey, safeForce ? 'force' : 'normal')
      const payload = await fetchWorkItemDetails(safeEpicKey)
      setPersistedWorkItemDetails(safeEpicKey, payload)
      setCachedValue(cacheKey, payload, JIRA_PERSIST_TTL_MS)
      console.log(
        '[jira:getWorkItemDetails] fetch success',
        safeEpicKey,
        `items=${payload.items.length}`,
        `elapsed=${Date.now() - startedAt}ms`
      )
      return payload
    } catch (error) {
      const message = safeLogLine(error instanceof Error ? error.message : String(error))
      console.error(
        '[jira:getWorkItemDetails] Error fetching for',
        safeEpicKey,
        message,
        `elapsed=${Date.now() - startedAt}ms`
      )
      throw error
    }
  })

  ipcMain.handle('jira:getIssueWorklogs', async (_event, issueKey: string) => {
    const safeIssueKey = validateJiraIssueKey(issueKey)
    const worklogs = await fetchAllWorklogs(safeIssueKey)
    return normalizeWorklogs(worklogs)
  })

  ipcMain.handle('jira:findWorklogsForDate', async (_event, date: unknown) => {
    const safeDate = validateDate(date)
    const currentUser = (await jiraRequest('/rest/api/3/myself')) as {
      accountId?: string
    }
    const results = await Promise.allSettled(
      PROJECT_KEYS.map(projectKey =>
        searchIssuesWithLimit(
          `${projectJql(projectKey)} AND worklogDate = "${safeDate}" AND worklogAuthor = currentUser() ORDER BY updated DESC`,
          ['summary'],
          200
        )
      )
    )
    const successful = results.filter(
      (
        result
      ): result is PromiseFulfilledResult<{ issues: JiraSearchIssue[]; reachedLimit: boolean }> =>
        result.status === 'fulfilled'
    )
    if (!successful.length) {
      const firstFailure = results.find(
        (result): result is PromiseRejectedResult => result.status === 'rejected'
      )
      throw firstFailure?.reason ?? new Error('Jira worklogs could not be searched')
    }
    const issueQueue = Array.from(
      new Set(successful.flatMap(result => result.value.issues.map(issue => issue.key)))
    )
    const worklogs: Array<ReturnType<typeof normalizeWorklogs>[number] & { issueKey: string }> = []
    const concurrency = Math.min(4, issueQueue.length)
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (issueQueue.length) {
          const issueKey = issueQueue.shift()
          if (!issueKey) return
          const issueWorklogs = normalizeWorklogs(await fetchAllWorklogs(issueKey))
          worklogs.push(
            ...issueWorklogs
              .filter(entry => !currentUser.accountId || entry.authorId === currentUser.accountId)
              .map(entry => ({ ...entry, issueKey }))
          )
        }
      })
    )
    return {
      worklogs,
      partial:
        successful.some(result => result.value.reachedLimit) ||
        successful.length !== PROJECT_KEYS.length
    }
  })

  ipcMain.handle('jira:createIssue', async (_event, payload: unknown) => {
    return createJiraIssueUnderParent(validateCreateIssuePayload(payload))
  })

  ipcMain.handle(
    'jira:addWorklog',
    async (_event, payload: { issueKey: string; started: string; seconds: number; comment?: string }) => {
      const safe = validateExactObject<{
        issueKey?: unknown
        started?: unknown
        seconds?: unknown
        comment?: unknown
      }>(payload ?? {}, ['issueKey', 'started', 'seconds', 'comment'], 'jira worklog payload')
      const issueKey = validateJiraIssueKey(safe.issueKey)
      const started = validateStringLength(safe.started, 16, 40)
      const seconds = validateNumberRange(safe.seconds, 1, 60 * 60 * 24 * 5, { integer: true })
      const comment = validateOptionalString(safe.comment, { min: 0, max: 4000 })
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
      clearAllWorkItemCaches()
      const normalized = normalizeWorklogs(created ? [created] : [])
      return normalized[0] ?? null
    }
  )

  ipcMain.handle(
    'jira:deleteWorklog',
    async (_event, payload: { issueKey: string; worklogId: string }) => {
      const safe = validateExactObject<{ issueKey?: unknown; worklogId?: unknown }>(
        payload ?? {},
        ['issueKey', 'worklogId'],
        'jira delete worklog payload'
      )
      const issueKey = validateJiraIssueKey(safe.issueKey)
      const worklogId = validateStringLength(safe.worklogId, 1, 64)
      const permissionParams = new URLSearchParams({
        issueKey,
        permissions: 'DELETE_OWN_WORKLOGS,DELETE_ALL_WORKLOGS'
      })
      const [currentUser, worklog, permissionData] = await Promise.all([
        jiraRequest('/rest/api/3/myself') as Promise<{
          accountId?: string
          displayName?: string
        }>,
        jiraRequest(
          `/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog/${encodeURIComponent(
            worklogId
          )}`
        ) as Promise<JiraWorklogEntry>,
        jiraRequest(`/rest/api/3/mypermissions?${permissionParams.toString()}`) as Promise<{
          permissions?: Record<string, { havePermission?: boolean }>
        }>
      ])
      const ownsWorklog = Boolean(
        currentUser.accountId && worklog.author?.accountId === currentUser.accountId
      )
      const canDeleteOwn = Boolean(
        permissionData.permissions?.DELETE_OWN_WORKLOGS?.havePermission
      )
      const canDeleteAll = Boolean(
        permissionData.permissions?.DELETE_ALL_WORKLOGS?.havePermission
      )
      if (!(canDeleteAll || (ownsWorklog && canDeleteOwn))) {
        const requiredPermission = ownsWorklog ? 'Delete Own Worklogs' : 'Delete All Worklogs'
        const displayName = currentUser.displayName?.trim() || 'The connected Jira user'
        throw new Error(
          `JIRA_WORKLOG_DELETE_PERMISSION_REQUIRED: ${displayName} does not have "${requiredPermission}" permission for ${issueKey}. Ask a Jira administrator to grant it in the ${issueKey.split('-')[0]} project permission scheme. The HRS report and gauge were not changed.`
        )
      }
      await jiraRequest(
        `/rest/api/3/issue/${encodeURIComponent(issueKey)}/worklog/${encodeURIComponent(
          worklogId
        )}`,
        {
          method: 'DELETE'
        }
      )
      clearAllWorkItemCaches()
      return true
    }
  )

  ipcMain.handle('jira:getWorklogHistory', async (_event, issueKey: string) => {
    const safeIssueKey = validateJiraIssueKey(issueKey)
    const data = await jiraRequest(
      `/rest/api/3/issue/${encodeURIComponent(safeIssueKey)}/worklog?maxResults=20`
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
      'subtasks',
      'subtasks.status',
      'subtasks.assignee',
      'subtasks.timespent',
      'subtasks.timeoriginalestimate',
      'subtasks.timetracking'
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
  for (const issue of issues) {
    const refs = (issue.fields?.subtasks ?? []).slice(0, subtaskLimit)
    if ((issue.fields?.subtasks?.length ?? 0) > subtaskLimit) {
      detailsPartial = true
    }
    subtaskRefsByIssue.set(issue.key, refs)
  }
  
  const items = issues.map(issue => {
      const subtasks = (subtaskRefsByIssue.get(issue.key) ?? []).map(subtask => {
        // Fast path: rely on already-returned subtask fields (no extra per-subtask Jira requests).
        const subtaskTimespent =
          subtask.fields?.timespent ||
          subtask.fields?.timetracking?.timeSpentSeconds ||
          0
        
        return {
          key: subtask.key,
          summary: subtask.fields?.summary ?? subtask.key,
          timespent: subtaskTimespent,
          estimateSeconds:
            subtask.fields?.timeoriginalestimate ??
            subtask.fields?.timetracking?.originalEstimateSeconds ??
            0,
        assigneeName:
          subtask.fields?.assignee?.displayName ??
          null,
        statusName: subtask.fields?.status?.name ?? null,
        worklogs: [],
        worklogTotal: 0,
        lastWorklog: null
      }
    })
    // Fast path: use tracked times from issue fields.
    const issueTimespent =
      issue.fields?.timespent ||
      issue.fields?.timetracking?.timeSpentSeconds ||
      0
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
      worklogs: [],
      worklogTotal: 0,
      lastWorklog: null,
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
  let pageCount = 0
  let previousSignature: string | null = null
  const results: JiraSearchIssue[] = []
  while (true) {
    pageCount += 1
    if (pageCount > 50) break
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
    const signature = issues.map(issue => issue.key).join(',')
    if (signature && signature === previousSignature) break
    previousSignature = signature
    const remaining = limit - results.length
    if (remaining <= 0) break
    results.push(...issues.slice(0, remaining))
    startAt += issues.length
    if (data.total !== undefined && results.length >= data.total) break
    if (issues.length < maxResults) break
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
  let pageCount = 0
  let previousSignature: string | null = null
  const results: JiraSearchIssue[] = []
  while (true) {
    pageCount += 1
    if (pageCount > 50) break
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
    const signature = issues.map(issue => issue.key).join(',')
    if (signature && signature === previousSignature) break
    previousSignature = signature
    const remaining = limit - results.length
    if (remaining <= 0) break
    results.push(...issues.slice(0, remaining))
    startAt += issues.length
    if (data.total !== undefined && results.length >= data.total) break
    if (issues.length < maxResults) break
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

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const JIRA_REQUEST_TIMEOUT_MS = 45000

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
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
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
    if (res.status === 401) {
      await res.text().catch(() => {})
      throw new Error('JIRA_AUTH_REQUIRED')
    }
    const text = await res.text()
    throw new Error(`JIRA ${res.status}: ${safeLogLine(text)}`)
  }
  if (res.status === 204) return {}
  return res.json()
}

async function getJiraAttachmentPreviewDataUrl(id: string) {
  if (!/^[A-Za-z0-9-]+$/.test(id)) return null
  const { baseUrl, email, token } = await getJiraCredentials()
  if (!email || !token) return null
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 12000)
  try {
    const response = await fetch(
      `${baseUrl}/rest/api/3/attachment/thumbnail/${encodeURIComponent(id)}?redirect=false&fallbackToDefault=true`,
      {
        headers: {
          Accept: 'image/*',
          Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`
        },
        signal: controller.signal
      }
    )
    if (!response.ok) return null
    const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
    if (!mimeType.startsWith('image/')) return null
    const declaredSize = Number(response.headers.get('content-length'))
    if (Number.isFinite(declaredSize) && declaredSize > 2 * 1024 * 1024) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    if (!bytes.length || bytes.length > 2 * 1024 * 1024) return null
    return `data:${mimeType};base64,${bytes.toString('base64')}`
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}
