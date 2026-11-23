import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'

if (process.platform !== 'win32') throw Error('Run the Windows package check on Windows.')
const relative=path.join('resources','app.asar.unpacked','build','python-runtime','hrs-python-runtime','hrs-python-runtime.exe')
const built=path.resolve('dist','win-unpacked',relative)
let exe=built
if (process.argv.includes('--install')) {
  // Never install over a developer's desktop. Use the disposable Windows CI user.
  assert.equal(process.env.GITHUB_ACTIONS,'true')
  assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted')
  const version=JSON.parse(fs.readFileSync('package.json','utf8')).version
  const setup=path.resolve('dist','HRS Desktop Setup '+version+'.exe')
  const target=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'hrs-calendar-')),'HRS smoke install')
  execFileSync(setup,['/S','/currentuser','/D='+target],{windowsVerbatimArguments:true,windowsHide:true,timeout:180_000})
  exe=path.join(target,relative)
  assert.ok(fs.statSync(path.join(target,'HRS Desktop.exe')).isFile())
  const hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex')
  assert.equal(hash(exe),hash(built),'NSIS must install the same tested calendar executable')
}
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
console.log('PASS: '+(exe===built?'packaged':'NSIS-installed')+' Windows calendar runtime, Selenium Manager, isolated headless Chrome and two-page calendar import (Hebrew/UTC/Israel). No live sign-in.')
