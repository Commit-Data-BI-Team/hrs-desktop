import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

if (process.platform !== 'win32') throw Error('Run the Windows package check on Windows.')
const exe=path.resolve('dist/win-unpacked/resources/app.asar.unpacked/build/python-runtime/hrs-python-runtime/hrs-python-runtime.exe')
assert.ok(fs.statSync(exe).isFile(), 'The Windows app must ship a runnable calendar runtime outside app.asar')
const env={...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}
for(const k of Object.keys(env)) if(/^(MS_|AGENDA_|MEETINGS_|GH_TOKEN$|GITHUB_TOKEN$)/i.test(k)) delete env[k]
const raw=execFileSync(exe,['--calendar-import-check','--windows-browser'],{encoding:'utf8',env,timeout:120000,windowsHide:true})
const data=JSON.parse(raw)
assert.equal(data.month,'2026-11')
assert.equal(data.count,2)
assert.equal(data.meetings.length,2)
assert.deepEqual(data.meetings.map(m=>[m.subject,m.startTime,m.endTime]),[
  ['פגישת בדיקה','2026-11-16 09:00:00','2026-11-16 10:00:00'],
  ['Local review','2026-11-18 09:00:00','2026-11-18 10:00:00']
])
assert.deepEqual(data.meetings[0].attendeeEmails,['fixture@example.invalid'])
assert.equal(data.meetings[0].participants,'בודק')
console.log('PASS: packaged Windows calendar runtime, Selenium Manager, isolated headless Chrome and two-page calendar import (Hebrew/UTC/Israel). No live sign-in.')
