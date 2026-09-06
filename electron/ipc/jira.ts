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

const PROJECT_KEY = 'VDA'
const PROJECT_NAME = 'Data Analytics Tasks'
const JIRA_CACHE_TTL_MS = 5 * 60 * 1000
const JIRA_PERSIST_TTL_MS = 6 * 60 * 60 * 1000
const JIRA_KEY_REGEX = /^[A-Z][A-Z0-9_]{0,14}-[0-9]+$/
const JIRA_E2E = !app.isPackaged && (process.env.HRS_E2E === '1' || process.env.JIRA_E2E === '1')

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
  { key: 'VDA-147', summary: 'Microsoft' }
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
  ]
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
      Microsoft: 'VDA-147'
    }
    ipcMain.handle('jira:getStatus', async () => ({
      baseUrl: 'https://jira.local',
      email: 'e2e@jira.local',
      configured: true,
      hasCredentials: true,
      projectKey: PROJECT_KEY,
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
      validateJiraIssueKey(safe.issueKey)
      const transitionId = validateStringLength(safe.transitionId, 1, 32)
      if (!/^\d+$/.test(transitionId)) throw new Error('Invalid Jira transition ID.')
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
      projectKey: PROJECT_KEY,
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
    const result = await searchIssuesWithLimit(
      `project = ${PROJECT_KEY} AND worklogDate = "${safeDate}" AND worklogAuthor = currentUser() ORDER BY updated DESC`,
      ['summary'],
      200
    )
    const issueQueue = result.issues.map(issue => issue.key)
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
    return { worklogs, partial: result.reachedLimit }
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
          `JIRA_WORKLOG_DELETE_PERMISSION_REQUIRED: ${displayName} does not have "${requiredPermission}" permission for ${issueKey}. Ask a Jira administrator to grant it in the VDA project permission scheme. The HRS report and gauge were not changed.`
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
