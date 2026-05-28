import { app, ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { validateArray, validateExactObject, validateOptionalString } from '../utils/validation'
import {
  clearAgendaAiConfig,
  getAgendaAiConfig,
  setAgendaAiConfig
} from '../ai/config'
import { ensurePythonEnv, resolvePackagedScriptPath, resolvePythonBin } from './pythonRuntime'

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
  aiSource?: string
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

const REQUIRED_PACKAGES = ['selenium', 'requests', 'pytz']

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
    const scriptPath = resolvePackagedScriptPath('agenda_fetch.py')
    const py = ensurePythonEnv(resolvePythonBin(), REQUIRED_PACKAGES)
    return new Promise<AgendaResult>((resolve, reject) => {
      const child = spawn(py, [scriptPath], {
        env: {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: '1',
          AGENDA_BROWSER: process.env.AGENDA_BROWSER || 'chrome',
          AGENDA_HEADLESS: process.env.AGENDA_HEADLESS || '1',
          AGENDA_CHROME_PROFILE: path.join(app.getPath('userData'), 'agenda-chrome-profile'),
          MEETINGS_CHROME_PROFILE: path.join(app.getPath('userData'), 'agenda-chrome-profile'),
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
