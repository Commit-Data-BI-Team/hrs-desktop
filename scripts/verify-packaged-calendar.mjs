import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import fs from 'node:fs'
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
  // Read the installer registration, not an assumed /D path. Use the
  // same per-user installation mode as the distributed assisted installer.
  const registrations=()=>{
    const script=String.raw`
      $ErrorActionPreference='Stop'
      $paths=@(foreach($v in @('Registry64','Registry32')) {
        $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryView]$v)
        $un=$base.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\Uninstall')
        if ($un) { foreach($name in $un.GetSubKeyNames()) {
          $item=$un.OpenSubKey($name)
          if ($item.GetValue('DisplayName') -like 'HRS Desktop*' -and $item.GetValue('DisplayVersion') -eq $env:HRS_CI_VERSION) {
            $appKey=$base.OpenSubKey(('Software\'+$name))
            $loc=if($appKey){$appKey.GetValue('InstallLocation')}
            if(!$loc -and $item.GetValue('UninstallString') -match '^"([^"]+)"') { $loc=Split-Path -Parent $Matches[1] }
            if(!$loc){throw 'HRS uninstall entry has no installation location'}
            $loc
          }
        }}
      })
      ConvertTo-Json -InputObject @($paths | Select-Object -Unique) -Compress
    `
    return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{
      encoding:'utf8',env:{...process.env,HRS_CI_VERSION:version},windowsHide:true,timeout:30000
    }).trim())
  }
  assert.deepEqual(registrations(),[],'Requires a clean hosted runner')
  execFileSync(setup,['/S','/currentuser'],{stdio:'inherit',windowsHide:true,timeout:180_000})
  const found=registrations()
  assert.equal(found.length,1,'NSIS must register exactly one installation of the expected version')
  const target=found[0]
  exe=path.join(target,relative)
  assert.ok(fs.statSync(path.join(target,'HRS Desktop.exe')).isFile())
  const hash=f=>createHash('sha256').update(fs.readFileSync(f)).digest('hex')
  assert.equal(hash(exe),hash(built),'NSIS must install the same tested calendar executable')
  assert.equal(hash(path.join(target,'resources','app.asar')),hash(path.resolve('dist/win-unpacked/resources/app.asar')))
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
