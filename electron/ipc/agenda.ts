import { app, ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { validateArray, validateExactObject, validateOptionalString } from '../utils/validation'
import {
  clearAgendaAiConfig,
  getAgendaAiConfig,
  setAgendaAiConfig
} from '../ai/config'
import { resolvePythonRunner } from './pythonRuntime'

type AgendaOptions = {
  token?: string | null
  username?: string | null
  password?: string | null
  personNames?: string[]
  personTags?: string[]
  tuning?: {
    hiddenThreads?: string[]
    hiddenSenders?: string[]
    importantTerms?: string[]
  }
}

type AgendaItem = {
  id?: string
  kind?: string
  title?: string
  summary?: string
  priority?: string
  reason?: string
  owner?: string
  ownerEmail?: string
  threadKey?: string
  link?: string
  sourceIds?: string[]
  Type?: string
  Title?: string
  Owner?: string
  'Owner Email'?: string
  'Start Date'?: string
  'End Date'?: string
  Priority?: string
  Status?: string
  Preview?: string
  Link?: string
  'Mission Reason'?: string
  category?: string
  categoryLabel?: string
  actionTitle?: string
  brief?: string
  suggestedAction?: string
  whenLabel?: string
  sourceTitle?: string
  project?: string
  customer?: string
  sourceSender?: string
  sourceSenderEmail?: string
  relevanceScore?: number
  sourceRole?: string
  sourceType?: string
  directAskEvidence?: string
  latestMessageFromIdentity?: boolean
  ccOnly?: boolean
  latestAt?: string
  threadTimeline?: Array<{
    time?: string
    from?: string
    direction?: string
    preview?: string
  }>
  aiSource?: string
  titleHe?: string
  summaryHe?: string
  suggestedActionHe?: string
  reasonHe?: string
}

type AgendaResult = {
  mailWindow: string
  meetingWindow: string
  unansweredEmails: number
  meetingsThisWeek: number
  outputDir: string
  brief?: string
  focus?: string[]
  aiProvider?: string
  sections?: {
    tasks: AgendaItem[]
    emailSummaries: AgendaItem[]
    needReply: AgendaItem[]
    followUps: AgendaItem[]
    projectSignals: AgendaItem[]
    meetingPrep: AgendaItem[]
  }
  missions: AgendaItem[]
}

const REQUIRED_PACKAGES = [
  'selenium==4.26.1',
  'requests==2.32.5',
  'pytz==2026.2',
  'urllib3==1.26.20'
]
const FALLBACK_FACTS = [
  'Octopuses have blue blood because they use copper-rich hemocyanin to move oxygen.',
  'The oldest known writing systems appeared in Mesopotamia and Egypt more than 5,000 years ago.',
  'A teaspoon of neutron-star matter would weigh billions of tons on Earth.',
  'The Suez Canal opened in 1869 and shortened sea travel between Europe and Asia dramatically.',
  'Honey rarely spoils because it has low water content, high acidity, and natural antimicrobial compounds.',
  'The word algorithm comes from the name of the Persian mathematician Al-Khwarizmi.'
]

function randomFallbackFact() {
  return FALLBACK_FACTS[Math.floor(Math.random() * FALLBACK_FACTS.length)]
}

export function registerAgendaIpc() {
  ipcMain.handle('agenda:getAiConfig', async () => {
    const config = await getAgendaAiConfig()
    return {
      hasApiKey: Boolean(config.apiKey),
      model: config.model
    }
  })

  ipcMain.handle('agenda:setAiConfig', async (_event, payload: unknown) => {
    const safe = validateExactObject<{
      apiKey?: unknown
      model?: unknown
    }>(payload ?? {}, ['apiKey', 'model'], 'agenda AI config')
    const apiKey = validateOptionalString(safe.apiKey, { min: 0, max: 4096, allowNull: true }) ?? null
    const model = validateOptionalString(safe.model, { min: 0, max: 100, allowNull: true }) ?? null
    const config = await setAgendaAiConfig(apiKey, model)
    return {
      hasApiKey: Boolean(config.apiKey),
      model: config.model
    }
  })

  ipcMain.handle('agenda:clearAiConfig', async () => {
    await clearAgendaAiConfig()
    return { hasApiKey: false, model: 'gpt-4o-mini' }
  })

  ipcMain.handle('agenda:fact', async () => {
    const config = await getAgendaAiConfig()
    const apiKey = config.apiKey || process.env.OPENAI_API_KEY || ''
    if (!apiKey) return randomFallbackFact()
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: config.model || process.env.AGENDA_AI_MODEL || 'gpt-4o-mini',
          temperature: 0.9,
          max_tokens: 80,
          messages: [
            {
              role: 'system',
              content:
                'Return one concise, surprising, accurate general-knowledge fact. Make it useful and pleasant to read. No markdown, no intro, no numbering.'
            },
            {
              role: 'user',
              content: 'Give me one random fact that makes me smarter.'
            }
          ]
        }),
        signal: AbortSignal.timeout(10000)
      })
      if (!response.ok) return randomFallbackFact()
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const fact = payload.choices?.[0]?.message?.content?.replace(/\s+/g, ' ').trim()
      return fact || randomFallbackFact()
    } catch {
      return randomFallbackFact()
    }
  })

  ipcMain.handle('agenda:run', async (event, options: AgendaOptions) => {
    const safe = validateExactObject<{
      token?: unknown
      username?: unknown
      password?: unknown
      personNames?: unknown
      personTags?: unknown
      tuning?: unknown
    }>(
      options ?? {},
      ['token', 'username', 'password', 'personNames', 'personTags', 'tuning'],
      'agenda options'
    )
    const token = validateOptionalString(safe.token, { min: 0, max: 4096, allowNull: true })
    const username = validateOptionalString(safe.username, {
      min: 0,
      max: 200,
      allowNull: true
    })
    const password = validateOptionalString(safe.password, {
      min: 0,
      max: 300,
      allowNull: true
    })
    const personNames = safe.personNames
      ? validateArray(safe.personNames, value => validateOptionalString(value, { min: 0, max: 120 }) || '')
      : []
    const personTags = safe.personTags
      ? validateArray(safe.personTags, value => validateOptionalString(value, { min: 0, max: 120 }) || '')
      : []
    const tuning =
      safe.tuning && typeof safe.tuning === 'object' && !Array.isArray(safe.tuning)
        ? (safe.tuning as {
            hiddenThreads?: unknown
            hiddenSenders?: unknown
            importantTerms?: unknown
          })
        : {}
    const hiddenThreads = tuning.hiddenThreads
      ? validateArray(tuning.hiddenThreads, value => validateOptionalString(value, { min: 0, max: 240 }) || '')
      : []
    const hiddenSenders = tuning.hiddenSenders
      ? validateArray(tuning.hiddenSenders, value => validateOptionalString(value, { min: 0, max: 240 }) || '')
      : []
    const importantTerms = tuning.importantTerms
      ? validateArray(tuning.importantTerms, value => validateOptionalString(value, { min: 0, max: 240 }) || '')
      : []
    const aiConfig = await getAgendaAiConfig()
    const pythonRunner = resolvePythonRunner('agenda_fetch.py', REQUIRED_PACKAGES)
    return new Promise<AgendaResult>((resolve, reject) => {
      const child = spawn(pythonRunner.bin, pythonRunner.args, {
        windowsHide: true,
        env: {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: '1',
          AGENDA_BROWSER: process.env.AGENDA_BROWSER || 'chrome',
          AGENDA_HEADLESS: process.env.AGENDA_HEADLESS || '1',
          AGENDA_CHROME_PROFILE: path.join(app.getPath('userData'), 'agenda-chrome-profile'),
          MS_USERNAME: username || process.env.MS_USERNAME || '',
          MS_PASSWORD: password || process.env.MS_PASSWORD || '',
          AGENDA_PERSON_NAMES: personNames.filter(Boolean).join(','),
          AGENDA_PERSON_TAGS: personTags.filter(Boolean).join(','),
          AGENDA_TUNING_JSON: JSON.stringify({
            hiddenThreads: hiddenThreads.filter(Boolean),
            hiddenSenders: hiddenSenders.filter(Boolean),
            importantTerms: importantTerms.filter(Boolean)
          }),
          OPENAI_API_KEY: aiConfig.apiKey || process.env.OPENAI_API_KEY || '',
          AGENDA_AI_MODEL: aiConfig.model || process.env.AGENDA_AI_MODEL || '',
          GRAPH_ACCESS_TOKEN: token || process.env.GRAPH_ACCESS_TOKEN || ''
        }
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', data => {
        stdout += data.toString()
      })
      child.stderr.on('data', data => {
        const text = data.toString().trim()
        stderr += text
        if (text) event.sender.send('agenda:progress', text)
      })
      child.on('error', err => reject(err))
      child.on('close', code => {
        if (code !== 0) {
          reject(new Error(stderr || `Agenda script failed (${code})`))
          return
        }
        try {
          const lines = stdout.split(/\r?\n/).filter(Boolean)
          const summary = JSON.parse(lines[lines.length - 1]) as AgendaResult
          resolve(summary)
        } catch (err) {
          reject(new Error((err as Error).message))
        }
      })
    })
  })
}
