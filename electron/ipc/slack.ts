import { ipcMain } from 'electron'
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

type SlackPostMessageResponse = SlackApiResponse<{
  channel?: string
  ts?: string
}>

type SlackUpdateMetrics = {
  capLabel?: string
  usedLabel?: string
  remainingLabel?: string
  usedPercent?: number
}

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
    throw new Error(data.error ? `Slack ${method} failed: ${data.error}` : `Slack ${method} failed`)
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
    throw new Error(data.error ? `Slack ${method} failed: ${data.error}` : `Slack ${method} failed`)
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
  ipcMain.handle('slack:getStatus', async () => getSlackConfigStatus())

  ipcMain.handle('slack:setToken', async (_event, token: unknown) => {
    return setSlackBotToken(validateSlackToken(token))
  })

  ipcMain.handle('slack:clear', async () => clearSlackConfig())

  ipcMain.handle('slack:getChannels', async () => {
    const token = await requireSlackToken()
    return listSlackChannels(token)
  })

  ipcMain.handle('slack:setMapping', async (_event, payload: unknown) => {
    const safe = validateExactObject<{
      customerName?: unknown
      channelId?: unknown
      channelName?: unknown
    }>(payload ?? {}, ['customerName', 'channelId', 'channelName'], 'Slack mapping')
    return setSlackChannelMapping(
      validateStringLength(safe.customerName, 1, 200),
      validateChannelId(safe.channelId),
      validateStringLength(safe.channelName, 1, 200)
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
