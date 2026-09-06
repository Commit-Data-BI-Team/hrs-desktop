import { app, ipcMain } from 'electron'
import {
  clearSlackConfig,
  getSlackBotToken,
  getSlackConfigStatus,
  removeSlackChannelMapping,
  setSlackBotToken,
  setSlackChannelMapping
} from '../slack/config'
import {
  validateExactObject,
  validateOptionalString,
  validateStringLength
} from '../utils/validation'
import { resolveIntegrationAttachments } from '../integration/attachments'

type SlackApiResponse<T> = T & {
  ok: boolean
  error?: string
  response_metadata?: {
    next_cursor?: string
  }
}

type SlackChannel = {
  id: string
  name: string
  is_channel?: boolean
  is_group?: boolean
  is_archived?: boolean
}

type SlackConversationsListResponse = SlackApiResponse<{
  channels?: SlackChannel[]
}>

type SlackConversationsInfoResponse = SlackApiResponse<{
  channel?: SlackChannel
}>

type SlackPostMessageResponse = SlackApiResponse<{
  channel?: string
  ts?: string
}>

type SlackMessage = {
  ts?: string
  thread_ts?: string
  text?: string
  user?: string
  username?: string
  subtype?: string
  reply_count?: number
  bot_profile?: {
    name?: string
    icons?: { image_48?: string; image_36?: string }
  }
}

type SlackConversationsHistoryResponse = SlackApiResponse<{
  messages?: SlackMessage[]
}>

type SlackUser = {
  id: string
  deleted?: boolean
  is_bot?: boolean
  is_app_user?: boolean
  real_name?: string
  profile?: {
    display_name?: string
    real_name?: string
    email?: string
    image_48?: string
    image_32?: string
  }
}

type SlackUsersListResponse = SlackApiResponse<{
  members?: SlackUser[]
}>

type SlackUploadUrlResponse = SlackApiResponse<{
  upload_url?: string
  file_id?: string
}>

type SlackCompleteUploadResponse = SlackApiResponse<{
  files?: Array<{ id?: string; title?: string }>
}>

type SlackMentionInput = {
  slackUserId: string
  label: string
}

let slackUsersCache: { expiresAt: number; users: SlackUser[] } | null = null

type SlackUpdateMetrics = {
  capLabel?: string
  usedLabel?: string
  remainingLabel?: string
  usedPercent?: number
}

const SLACK_E2E = !app.isPackaged && process.env.HRS_E2E === '1'

function requireSlackToken() {
  return getSlackBotToken().then(token => {
    if (!token) throw new Error('Connect Slack first.')
    return token
  })
}

function validateSlackToken(value: unknown) {
  const token = validateStringLength(value, 10, 4000)
  if (!/^xoxb-[A-Za-z0-9-]+$/.test(token)) {
    throw new Error('Invalid Slack bot token. Expected xoxb- token.')
  }
  return token
}

function validateChannelId(value: unknown) {
  const channelId = validateStringLength(value, 1, 80)
  if (!/^[A-Z0-9]+$/.test(channelId)) {
    throw new Error('Invalid Slack channel ID.')
  }
  return channelId
}

function validateSlackThreadTs(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  const threadTs = validateStringLength(value, 3, 80)
  if (!/^\d{1,20}\.\d{1,20}$/.test(threadTs) && !/^e2e-[A-Za-z0-9-]+$/.test(threadTs)) {
    throw new Error('Invalid Slack thread timestamp.')
  }
  return threadTs
}

function formatSlackApiFailure(method: string, error?: string) {
  const failure = error ? `Slack ${method} failed: ${error}` : `Slack ${method} failed`
  if (error === 'missing_scope' && method === 'users.list') {
    return `${failure}. Add the users:read and users:read.email bot scopes in Slack, reinstall the app to the workspace, then reconnect the bot token.`
  }
  if (error === 'missing_scope' && method === 'chat.postMessage') {
    return `${failure}. Add the chat:write bot scope in Slack, reinstall the app to the workspace, then reconnect the bot token.`
  }
  if (error === 'missing_scope' && method === 'conversations.history') {
    return `${failure}. Add channels:history for public channels and groups:history for private channels, reinstall the Slack app to the workspace, then reconnect the bot token.`
  }
  if (
    error === 'missing_scope' &&
    (method === 'files.getUploadURLExternal' || method === 'files.completeUploadExternal')
  ) {
    return `${failure}. Add the files:write bot scope in Slack, reinstall the app to the workspace, then reconnect the bot token.`
  }
  if (error === 'channel_not_found' || error === 'not_in_channel') {
    return `${failure}. The connected Slack bot cannot access the mapped channel. Verify that the channel belongs to the connected workspace and invite the HRS Desktop bot to it, then save the mapping again.`
  }
  return failure
}

async function listSlackUsers(token: string) {
  if (slackUsersCache && slackUsersCache.expiresAt > Date.now()) {
    return slackUsersCache.users
  }
  const users: SlackUser[] = []
  let cursor = ''
  do {
    const result = await callSlackGetApi<SlackUsersListResponse>('users.list', token, {
      limit: 200,
      cursor
    })
    users.push(...(result.members ?? []))
    cursor = result.response_metadata?.next_cursor ?? ''
  } while (cursor && users.length < 2000)
  const activeUsers = users.filter(
    user => user.id && !user.deleted && !user.is_bot && !user.is_app_user && user.id !== 'USLACKBOT'
  )
  slackUsersCache = { expiresAt: Date.now() + 5 * 60 * 1000, users: activeUsers }
  return activeUsers
}

function validateSlackMentions(value: unknown): SlackMentionInput[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.length > 50) throw new Error('Invalid Slack mentions.')
  return value.map(entry => {
    const safe = validateExactObject<{ slackUserId?: unknown; label?: unknown }>(
      entry,
      ['slackUserId', 'label'],
      'Slack mention'
    )
    const slackUserId = validateStringLength(safe.slackUserId, 1, 80)
    if (!/^[A-Z0-9]+$/.test(slackUserId)) throw new Error('Invalid Slack user ID.')
    return {
      slackUserId,
      label: validateStringLength(safe.label, 1, 200)
    }
  })
}

function validateSlackMessageText(value: unknown) {
  if (typeof value !== 'string') throw new Error('Invalid Slack message text.')
  const text = value
    .replace(/\0/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
  if (!text) throw new Error('Slack message cannot be empty.')
  if (text.length > 10000) throw new Error('Slack message is too long.')
  return text
}

function buildSlackMentionText(text: string, mentions: SlackMentionInput[]) {
  const mentionsByLabel = new Map(
    mentions.map(mention => [mention.label.trim().toLocaleLowerCase(), mention])
  )
  const tokenPattern = /@\[([^\]\n]{1,200})\]/g
  let result = ''
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = tokenPattern.exec(text)) !== null) {
    result += escapeSlackText(text.slice(cursor, match.index))
    const mention = mentionsByLabel.get(match[1].trim().toLocaleLowerCase())
    result += mention ? `<@${mention.slackUserId}>` : escapeSlackText(match[0])
    cursor = match.index + match[0].length
  }
  result += escapeSlackText(text.slice(cursor))
  return result
}

async function postSlackMessageWithAttachments(payload: {
  token: string
  channelId: string
  text: string
  attachmentIds: unknown
  threadTs?: string | null
}) {
  const attachments = await resolveIntegrationAttachments(payload.attachmentIds)
  if (!attachments.length) return null
  const files: Array<{ id: string; title: string }> = []
  for (const attachment of attachments) {
    const reservation = await callSlackApi<SlackUploadUrlResponse>(
      'files.getUploadURLExternal',
      payload.token,
      {
        filename: attachment.name,
        length: attachment.size
      }
    )
    if (!reservation.upload_url || !reservation.file_id) {
      throw new Error(`Slack did not provide an upload URL for ${attachment.name}.`)
    }
    const uploadResponse = await fetch(reservation.upload_url, {
      method: 'POST',
      headers: { 'Content-Type': attachment.mimeType },
      body: new Blob([attachment.bytes], { type: attachment.mimeType })
    })
    if (!uploadResponse.ok) {
      const detail = (await uploadResponse.text().catch(() => '')).trim().slice(0, 240)
      throw new Error(
        `Slack file upload failed for ${attachment.name} (${uploadResponse.status})${
          detail ? `: ${detail}` : ''
        }`
      )
    }
    files.push({ id: reservation.file_id, title: attachment.name })
  }
  const result = await callSlackApi<SlackCompleteUploadResponse>(
    'files.completeUploadExternal',
    payload.token,
    {
      files,
      channel_id: payload.channelId,
      initial_comment: payload.text,
      ...(payload.threadTs ? { thread_ts: payload.threadTs } : {})
    }
  )
  return {
    posted: true,
    channelId: payload.channelId,
    ts: null,
    files: result.files ?? files
  }
}

function decodeSlackText(value: string, usersById: Map<string, SlackUser>) {
  return value
    .replace(/<@([A-Z0-9]+)>/g, (_match, userId: string) => {
      const user = usersById.get(userId)
      const name =
        user?.profile?.display_name?.trim() ||
        user?.profile?.real_name?.trim() ||
        user?.real_name?.trim() ||
        userId
      return `@${name}`
    })
    .replace(/<([^>|]+)\|([^>]+)>/g, '$2')
    .replace(/<([^>]+)>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
}

function slackTimestampToIso(timestamp: string) {
  const seconds = Number(timestamp.split('.')[0])
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : new Date(0).toISOString()
}

async function callSlackApi<T>(
  method: string,
  token: string,
  body?: Record<string, unknown>
): Promise<T> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: body ? JSON.stringify(body) : undefined
  })
  const data = (await response.json()) as SlackApiResponse<T>
  if (!response.ok || !data.ok) {
    throw new Error(formatSlackApiFailure(method, data.error))
  }
  return data as T
}

async function callSlackGetApi<T>(
  method: string,
  token: string,
  query: Record<string, string | number | boolean | undefined>
): Promise<T> {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value))
  }
  const response = await fetch(`https://slack.com/api/${method}?${params.toString()}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`
    }
  })
  const data = (await response.json()) as SlackApiResponse<T>
  if (!response.ok || !data.ok) {
    throw new Error(formatSlackApiFailure(method, data.error))
  }
  return data as T
}

async function listSlackChannels(token: string) {
  const channels: SlackChannel[] = []
  let cursor = ''
  do {
    const result = await callSlackGetApi<SlackConversationsListResponse>(
      'conversations.list',
      token,
      {
        exclude_archived: true,
        limit: 200,
        types: 'public_channel,private_channel',
        cursor
      }
    )
    channels.push(...(result.channels ?? []))
    cursor = result.response_metadata?.next_cursor ?? ''
  } while (cursor)
  return channels
    .filter(channel => channel.id && channel.name && !channel.is_archived)
    .map(channel => ({
      id: channel.id,
      name: channel.name,
      label: `#${channel.name}`
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function buildSlackMessage(payload: {
  customer: string
  title: string
  lines: string[]
  metrics?: SlackUpdateMetrics | null
}) {
  const rows = buildSlackRows(payload.lines, payload.metrics)
  return [`*${formatSlackUpdateTitle(payload.title)}*`, ...rows.map(row => `${row.label}: ${row.value}`)].join(
    '\n'
  )
}

function escapeSlackText(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function truncateSlackText(value: string, max: number) {
  if (value.length <= max) return value
  return `${value.slice(0, Math.max(0, max - 1)).trim()}...`
}

function formatSlackUpdateTitle(title: string) {
  const normalized = title.trim().toLowerCase()
  if (normalized === 'hours logged') return 'LOGGED HOURS'
  return title.trim().toUpperCase()
}

function parseSlackLine(line: string) {
  const delimiter = line.indexOf(':')
  if (delimiter <= 0) {
    return { label: 'Note', value: line.trim() }
  }
  return {
    label: line.slice(0, delimiter).trim(),
    value: line.slice(delimiter + 1).trim()
  }
}

function buildSlackRows(lines: string[], metrics?: SlackUpdateMetrics | null) {
  const metricLabels = new Set(['cap', 'used', 'remaining', 'blocked', '% used', '% blocked'])
  const rows = lines
    .map(line => line.trim())
    .filter(Boolean)
    .map(parseSlackLine)
    .filter(row => !metricLabels.has(row.label.toLowerCase()))
    .map(row => ({
      label: row.label,
      value: row.value || 'NA'
    }))

  rows.push(
    {
      label: 'Cap',
      value: metrics?.capLabel || 'NA'
    },
    {
      label: 'Used',
      value: metrics?.usedLabel || 'NA'
    },
    {
      label: '% Used',
      value: typeof metrics?.usedPercent === 'number' ? `${metrics.usedPercent}%` : 'NA'
    },
    {
      label: 'Remaining',
      value: metrics?.remainingLabel || 'NA'
    }
  )

  return rows.slice(0, 16)
}

const SLACK_TABLE_COLUMNS: Array<{
  label: string
  align?: 'left' | 'center' | 'right'
  isWrapped?: boolean
}> = [
  { label: 'Date', align: 'center' },
  { label: 'Employee', isWrapped: true },
  { label: 'Customer', isWrapped: true },
  { label: 'Task', isWrapped: true },
  { label: 'Comment', isWrapped: true },
  { label: 'Hours', align: 'right' },
  { label: 'Cap', align: 'right' },
  { label: 'Used', align: 'right' },
  { label: '% Used', align: 'right' },
  { label: 'Remaining', align: 'right' }
]

function cleanSlackCellValue(value: string, max = 160) {
  const normalized = value.replace(/\s+/g, ' ').trim() || 'NA'
  return truncateSlackText(normalized, max)
}

function buildRawTableCell(text: string) {
  return {
    type: 'raw_text',
    text: cleanSlackCellValue(text)
  }
}

function buildHeaderTableCell(text: string) {
  return {
    type: 'rich_text',
    elements: [
      {
        type: 'rich_text_section',
        elements: [
          {
            type: 'text',
            text: cleanSlackCellValue(text, 80),
            style: {
              bold: true
            }
          }
        ]
      }
    ]
  }
}

function buildSlackTableBlock(customer: string, rows: Array<{ label: string; value: string }>) {
  const rowValues = new Map(rows.map(row => [row.label.toLowerCase(), row.value]))
  rowValues.set('customer', customer)
  return {
    type: 'table',
    column_settings: SLACK_TABLE_COLUMNS.map(column => ({
      align: column.align ?? 'left',
      is_wrapped: column.isWrapped ?? false
    })),
    rows: [
      SLACK_TABLE_COLUMNS.map(column => buildHeaderTableCell(column.label)),
      SLACK_TABLE_COLUMNS.map(column => buildRawTableCell(rowValues.get(column.label.toLowerCase()) ?? 'NA'))
    ]
  }
}

function buildSlackBlocks(payload: {
  customer: string
  title: string
  lines: string[]
  metrics?: SlackUpdateMetrics | null
}) {
  const rows = buildSlackRows(payload.lines, payload.metrics)
  const blocks: Record<string, unknown>[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${escapeSlackText(formatSlackUpdateTitle(payload.title))}*`
      }
    }
  ]

  blocks.push(buildSlackTableBlock(payload.customer, rows))

  blocks.push({ type: 'divider' })
  return blocks
}

function validateOptionalPercent(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('Invalid Slack metric percent.')
  }
  return Math.max(0, Math.min(100, Math.round(value)))
}

function validateSlackMetrics(value: unknown): SlackUpdateMetrics | null {
  if (value === undefined || value === null) return null
  const safe = validateExactObject<{
    capLabel?: unknown
    usedLabel?: unknown
    remainingLabel?: unknown
    usedPercent?: unknown
    blockedPercent?: unknown
  }>(
    value,
    ['capLabel', 'usedLabel', 'remainingLabel', 'usedPercent', 'blockedPercent'],
    'Slack metrics'
  )
  const metrics: SlackUpdateMetrics = {
    capLabel: validateOptionalString(safe.capLabel, { min: 0, max: 80 }) ?? undefined,
    usedLabel: validateOptionalString(safe.usedLabel, { min: 0, max: 80 }) ?? undefined,
    remainingLabel: validateOptionalString(safe.remainingLabel, { min: 0, max: 80 }) ?? undefined,
    usedPercent: validateOptionalPercent(safe.usedPercent)
  }
  return Object.values(metrics).some(value => value !== undefined) ? metrics : null
}

export function registerSlackIpc() {
  if (SLACK_E2E) {
    let mappings: Record<string, { customerName: string; channelId: string; channelName: string; updatedAt: string }> = {
      Microsoft: {
        customerName: 'Microsoft',
        channelId: 'C0123456789',
        channelName: 'microsoft-project',
        updatedAt: new Date().toISOString()
      }
    }
    const getStatus = () => ({ configured: true, hasToken: true, mappings })
    ipcMain.handle('slack:getStatus', async () => getStatus())
    ipcMain.handle('slack:setToken', async () => getStatus())
    ipcMain.handle('slack:clear', async () => ({ configured: false, hasToken: false, mappings: {} }))
    ipcMain.handle('slack:getChannels', async () => [
      { id: 'C0123456789', name: 'microsoft-project', label: '#microsoft-project' },
      { id: 'C9876543210', name: 'general', label: '#general' }
    ])
    ipcMain.handle('slack:setMapping', async (_event, payload: unknown) => {
      const safe = validateExactObject<{ customerName?: unknown; channelId?: unknown; channelName?: unknown }>(
        payload ?? {},
        ['customerName', 'channelId', 'channelName'],
        'Slack mapping'
      )
      const customerName = validateStringLength(safe.customerName, 1, 200)
      mappings = {
        ...mappings,
        [customerName]: {
          customerName,
          channelId: validateChannelId(safe.channelId),
          channelName: validateStringLength(safe.channelName, 1, 200),
          updatedAt: new Date().toISOString()
        }
      }
      return mappings[customerName]
    })
    ipcMain.handle('slack:removeMapping', async (_event, customerName: unknown) => {
      const next = { ...mappings }
      delete next[validateStringLength(customerName, 1, 200)]
      mappings = next
      return mappings
    })
    ipcMain.handle('slack:searchUsers', async (_event, query: unknown) => {
      const safeQuery = validateStringLength(query, 1, 100).toLocaleLowerCase()
      return [
        {
          id: 'U012DROR',
          displayName: 'Dror Rahamim',
          realName: 'Dror Rahamim',
          email: 'dror@example.com',
          avatarUrl: null
        },
        {
          id: 'U012VITALY',
          displayName: 'Vitaly Shechtman',
          realName: 'Vitaly Shechtman',
          email: 'vitaly@example.com',
          avatarUrl: null
        }
      ].filter(user =>
        `${user.displayName} ${user.email}`.toLocaleLowerCase().includes(safeQuery)
      )
    })
    ipcMain.handle('slack:getRecentMessages', async (_event, channelId: unknown) => {
      const safeChannelId = validateChannelId(channelId)
      return [
        {
          id: '1710000000.000100',
          source: 'slack',
          authorId: 'U012VITALY',
          authorName: 'Vitaly Shechtman',
          avatarUrl: null,
          text: `The latest Slack update in ${safeChannelId} is ready for review.`,
          createdAt: '2026-09-03T14:45:00.000Z',
          replyCount: 2
        }
      ]
    })
    ipcMain.handle('slack:postMessage', async (_event, payload: unknown) => {
      const safe = validateExactObject<{
        channelId?: unknown
        text?: unknown
        mentions?: unknown
        attachmentIds?: unknown
        threadTs?: unknown
      }>(
        payload ?? {},
        ['channelId', 'text', 'mentions', 'attachmentIds', 'threadTs'],
        'Slack message'
      )
      return {
        posted: true,
        channelId: validateChannelId(safe.channelId),
        ts: `e2e-${Date.now()}`,
        text: validateSlackMessageText(safe.text),
        mentions: validateSlackMentions(safe.mentions),
        attachmentIds: Array.isArray(safe.attachmentIds) ? safe.attachmentIds : [],
        threadTs: validateSlackThreadTs(safe.threadTs)
      }
    })
    ipcMain.handle('slack:postCustomerUpdate', async () => ({
      posted: true,
      channelId: 'C0123456789',
      ts: `e2e-${Date.now()}`
    }))
    return
  }

  ipcMain.handle('slack:getStatus', async () => getSlackConfigStatus())

  ipcMain.handle('slack:setToken', async (_event, token: unknown) => {
    slackUsersCache = null
    return setSlackBotToken(validateSlackToken(token))
  })

  ipcMain.handle('slack:clear', async () => {
    slackUsersCache = null
    return clearSlackConfig()
  })

  ipcMain.handle('slack:getChannels', async () => {
    const token = await requireSlackToken()
    return listSlackChannels(token)
  })

  ipcMain.handle('slack:searchUsers', async (_event, query: unknown) => {
    const safeQuery = validateStringLength(query, 1, 100).toLocaleLowerCase()
    const token = await requireSlackToken()
    const users = await listSlackUsers(token)
    return users
      .map(user => {
        const displayName =
          user.profile?.display_name?.trim() ||
          user.profile?.real_name?.trim() ||
          user.real_name?.trim() ||
          user.id
        return {
          id: user.id,
          displayName,
          realName: user.profile?.real_name?.trim() || user.real_name?.trim() || displayName,
          email: user.profile?.email?.trim() || null,
          avatarUrl: user.profile?.image_48 ?? user.profile?.image_32 ?? null
        }
      })
      .filter(user =>
        `${user.displayName} ${user.realName} ${user.email ?? ''}`
          .toLocaleLowerCase()
          .includes(safeQuery)
      )
      .slice(0, 20)
  })

  ipcMain.handle('slack:getRecentMessages', async (_event, channelId: unknown) => {
    const safeChannelId = validateChannelId(channelId)
    const token = await requireSlackToken()
    const [history, users] = await Promise.all([
      callSlackGetApi<SlackConversationsHistoryResponse>('conversations.history', token, {
        channel: safeChannelId,
        limit: 5,
        inclusive: true
      }),
      listSlackUsers(token).catch(() => [] as SlackUser[])
    ])
    const usersById = new Map(users.map(user => [user.id, user]))
    return (history.messages ?? [])
      .filter(message => message.ts && message.text && message.subtype !== 'message_deleted')
      .map(message => {
        const user = message.user ? usersById.get(message.user) : undefined
        const authorName =
          user?.profile?.display_name?.trim() ||
          user?.profile?.real_name?.trim() ||
          user?.real_name?.trim() ||
          message.bot_profile?.name?.trim() ||
          message.username?.trim() ||
          'Slack user'
        return {
          id: message.ts as string,
          source: 'slack' as const,
          authorId: message.user ?? null,
          authorName,
          avatarUrl:
            user?.profile?.image_48 ??
            user?.profile?.image_32 ??
            message.bot_profile?.icons?.image_48 ??
            message.bot_profile?.icons?.image_36 ??
            null,
          text: decodeSlackText(message.text as string, usersById).slice(0, 4000),
          createdAt: slackTimestampToIso(message.ts as string),
          replyCount: message.reply_count ?? 0
        }
      })
      .filter(message => message.text)
      .slice(0, 5)
  })

  ipcMain.handle('slack:postMessage', async (_event, payload: unknown) => {
    const safe = validateExactObject<{
      channelId?: unknown
      text?: unknown
      mentions?: unknown
      attachmentIds?: unknown
      threadTs?: unknown
    }>(payload ?? {}, ['channelId', 'text', 'mentions', 'attachmentIds', 'threadTs'], 'Slack message')
    const channelId = validateChannelId(safe.channelId)
    const text = validateSlackMessageText(safe.text)
    const mentions = validateSlackMentions(safe.mentions)
    const mrkdwnText = buildSlackMentionText(text, mentions)
    const threadTs = validateSlackThreadTs(safe.threadTs)
    const token = await requireSlackToken()
    const attachmentIds = safe.attachmentIds ?? []
    if (Array.isArray(attachmentIds) && attachmentIds.length) {
      return postSlackMessageWithAttachments({
        token,
        channelId,
        text: mrkdwnText,
        attachmentIds,
        threadTs
      })
    }
    const result = await callSlackApi<SlackPostMessageResponse>('chat.postMessage', token, {
      channel: channelId,
      text: mrkdwnText,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: mrkdwnText }
        }
      ],
      mrkdwn: true,
      unfurl_links: false,
      unfurl_media: false,
      ...(threadTs ? { thread_ts: threadTs } : {})
    })
    return {
      posted: true,
      channelId: result.channel ?? channelId,
      ts: result.ts ?? null
    }
  })

  ipcMain.handle('slack:setMapping', async (_event, payload: unknown) => {
    const safe = validateExactObject<{
      customerName?: unknown
      channelId?: unknown
      channelName?: unknown
    }>(payload ?? {}, ['customerName', 'channelId', 'channelName'], 'Slack mapping')
    const customerName = validateStringLength(safe.customerName, 1, 200)
    const channelId = validateChannelId(safe.channelId)
    const requestedChannelName = validateStringLength(safe.channelName, 1, 200)
    const token = await requireSlackToken()
    const result = await callSlackGetApi<SlackConversationsInfoResponse>(
      'conversations.info',
      token,
      { channel: channelId }
    )
    if (!result.channel || result.channel.is_archived) {
      throw new Error('The selected Slack channel is unavailable or archived.')
    }
    return setSlackChannelMapping(
      customerName,
      channelId,
      result.channel.name || requestedChannelName
    )
  })

  ipcMain.handle('slack:removeMapping', async (_event, customerName: unknown) => {
    return removeSlackChannelMapping(validateStringLength(customerName, 1, 200))
  })

  ipcMain.handle('slack:postCustomerUpdate', async (_event, payload: unknown) => {
    const safe = validateExactObject<{
      customer?: unknown
      title?: unknown
      lines?: unknown
      channelId?: unknown
      metrics?: unknown
    }>(
      payload ?? {},
      ['customer', 'title', 'lines', 'channelId', 'metrics'],
      'Slack customer update'
    )
    const customer = validateStringLength(safe.customer, 1, 200)
    const title = validateStringLength(safe.title, 1, 240)
    if (!Array.isArray(safe.lines)) throw new Error('Invalid Slack update lines.')
    const lines = safe.lines
      .slice(0, 12)
      .map(line => validateOptionalString(line, { min: 0, max: 600 }) ?? '')
      .filter(Boolean)
    const channelId =
      safe.channelId === undefined || safe.channelId === null || safe.channelId === ''
        ? null
        : validateChannelId(safe.channelId)
    const metrics = validateSlackMetrics(safe.metrics)
    const status = await getSlackConfigStatus()
    const mapping = status.mappings[customer]
    const targetChannelId = channelId ?? mapping?.channelId
    if (!targetChannelId) {
      return { posted: false, reason: 'No Slack channel mapped for this customer.' }
    }
    const token = await requireSlackToken()
    const text = buildSlackMessage({ customer, title, lines, metrics })
    const result = await callSlackApi<SlackPostMessageResponse>('chat.postMessage', token, {
      channel: targetChannelId,
      text,
      blocks: buildSlackBlocks({ customer, title, lines, metrics }),
      mrkdwn: true,
      unfurl_links: false,
      unfurl_media: false
    })
    return {
      posted: true,
      channelId: result.channel ?? targetChannelId,
      ts: result.ts ?? null
    }
  })
}
