import { app, ipcMain } from 'electron'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { validateExactObject, validateOptionalString } from '../utils/validation'

type AgendaOptions = {
  token?: string | null
}

type AgendaItem = {
  Type: string
  Title: string
  Owner: string
  'Owner Email': string
  'Start Date': string
  'End Date'?: string
  Priority: string
  Status: string
  Preview: string
  Link: string
  'Mission Reason': string
}

type AgendaResult = {
  mailWindow: string
  meetingWindow: string
  unansweredEmails: number
  meetingsThisWeek: number
  outputDir: string
  missions: AgendaItem[]
}

function resolveScriptPath() {
  const candidates = [
    path.join(app.getAppPath(), 'scripts', 'agenda_fetch.py'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'scripts', 'agenda_fetch.py'),
    path.join(process.resourcesPath, 'scripts', 'agenda_fetch.py')
  ]
  const existing = candidates.find(candidate => fs.existsSync(candidate))
  if (!existing) throw new Error(`Agenda script not found. Tried: ${candidates.join(', ')}`)
  return existing
}

function resolvePython() {
  return process.env.PYTHON_BIN || 'python3'
}

export function registerAgendaIpc() {
  ipcMain.handle('agenda:run', async (event, options: AgendaOptions) => {
    const safe = validateExactObject<{ token?: unknown }>(options ?? {}, ['token'], 'agenda options')
    const token = validateOptionalString(safe.token, { min: 0, max: 4096, allowNull: true })
    const scriptPath = resolveScriptPath()
    const py = resolvePython()
    return new Promise<AgendaResult>((resolve, reject) => {
      const child = spawn(py, [scriptPath], {
        env: {
          ...process.env,
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
