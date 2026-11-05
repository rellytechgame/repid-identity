import type { StartupSource } from '../../shared/types'
import { powershell, run } from '../engine/exec'
import type { RawStartup, StartupAdapter, ToggleResult } from './types'

const CV = 'Software\\Microsoft\\Windows\\CurrentVersion'
const APPROVED = `${CV}\\Explorer\\StartupApproved`
const STORE_TASKS = `Software\\Classes\\Local Settings\\${CV}\\AppModel\\SystemAppData`

/**
 * Where Explorer and Task Manager keep the enabled/disabled flag of each Run
 * value and Startup-folder shortcut. Flipping this flag is exactly what Task
 * Manager's "Disable" does: the Run entry itself is never touched.
 */
const APPROVED_KEY: Partial<Record<StartupSource, string>> = {
  'hkcu-run': `HKCU\\${APPROVED}\\Run`,
  'hklm-run': `HKLM\\${APPROVED}\\Run`,
  'hklm-run32': `HKLM\\${APPROVED}\\Run32`,
  'user-folder': `HKCU\\${APPROVED}\\StartupFolder`,
  'common-folder': `HKLM\\${APPROVED}\\StartupFolder`
}

/**
 * Read-only inventory in one PowerShell call. Output is forced to UTF-8 so
 * accented names survive. A StartupApproved value whose first byte is odd
 * (01/03/07) means "disabled"; even (02/04/06) or missing means enabled.
 */
const SCAN = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$out = New-Object System.Collections.ArrayList
$cv = 'Software\Microsoft\Windows\CurrentVersion'
function Approved($key, $name) {
  $v = (Get-Item -LiteralPath $key).GetValue($name)
  if ($v -is [byte[]] -and $v.Length -gt 0) { return (($v[0] -band 1) -eq 0) }
  return $true
}
$runs = @(
  @{ s = 'hkcu-run'; k = "HKCU:\$cv\Run"; a = "HKCU:\$cv\Explorer\StartupApproved\Run" },
  @{ s = 'hklm-run'; k = "HKLM:\$cv\Run"; a = "HKLM:\$cv\Explorer\StartupApproved\Run" },
  @{ s = 'hklm-run32'; k = "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run"; a = "HKLM:\$cv\Explorer\StartupApproved\Run32" }
)
foreach ($r in $runs) {
  $item = Get-Item -LiteralPath $r.k
  if (-not $item) { continue }
  foreach ($n in $item.GetValueNames()) {
    if (-not $n) { continue }
    $cmd = [string]$item.GetValue($n, $null, 'DoNotExpandEnvironmentNames')
    if (-not $cmd) { continue }
    [void]$out.Add([pscustomobject]@{ src = $r.s; label = $n; cmd = [Environment]::ExpandEnvironmentVariables($cmd); on = (Approved $r.a $n) })
  }
}
$sh = New-Object -ComObject WScript.Shell
$folders = @(
  @{ s = 'user-folder'; d = [Environment]::GetFolderPath('Startup'); a = "HKCU:\$cv\Explorer\StartupApproved\StartupFolder" },
  @{ s = 'common-folder'; d = [Environment]::GetFolderPath('CommonStartup'); a = "HKLM:\$cv\Explorer\StartupApproved\StartupFolder" }
)
foreach ($f in $folders) {
  if (-not $f.d) { continue }
  Get-ChildItem -LiteralPath $f.d -File -Force | Where-Object { $_.Name -ne 'desktop.ini' } | ForEach-Object {
    $exe = $_.FullName; $arg = ''
    if ($_.Extension -eq '.lnk') { $l = $sh.CreateShortcut($_.FullName); if ($l.TargetPath) { $exe = $l.TargetPath; $arg = $l.Arguments } }
    [void]$out.Add([pscustomobject]@{ src = $f.s; label = $_.Name; exe = $exe; cmd = ('"' + $exe + '" ' + $arg).Trim(); on = (Approved $f.a $_.Name) })
  }
}
$pk = @{}
Get-AppxPackage -PackageTypeFilter Main | ForEach-Object { $pk[$_.PackageFamilyName] = $_ }
Get-ChildItem -LiteralPath "HKCU:\Software\Classes\Local Settings\$cv\AppModel\SystemAppData" | ForEach-Object {
  $pfn = $_.PSChildName
  Get-ChildItem -LiteralPath $_.PSPath | ForEach-Object {
    $state = (Get-ItemProperty -LiteralPath $_.PSPath).State
    if ($null -eq $state) { return }
    $task = $_.PSChildName; $name = $null; $exe = $null; $p = $pk[$pfn]
    if ($p -and $p.InstallLocation) {
      try {
        [xml]$m = Get-Content -LiteralPath (Join-Path $p.InstallLocation 'AppxManifest.xml') -Raw
        $node = $m.SelectNodes("//*[local-name()='StartupTask']") | Where-Object { $_.TaskId -eq $task } | Select-Object -First 1
        if ($node) {
          $name = $node.DisplayName
          $rel = $node.ParentNode.Executable
          if (-not $rel) { $rel = $node.ParentNode.ParentNode.ParentNode.Executable }
          if ($rel) { $exe = Join-Path $p.InstallLocation $rel }
        }
        if (-not $name -or $name -like 'ms-resource:*') { $name = $m.Package.Properties.DisplayName }
        if ($name -like 'ms-resource:*') { $name = $null }
      } catch {}
    }
    [void]$out.Add([pscustomobject]@{ src = 'store-app'; label = "$pfn\$task"; name = $name; exe = $exe; cmd = $exe; on = ($state -eq 2 -or $state -eq 4); state = [int]$state; pfn = $pfn; task = $task })
  }
}
Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\Microsoft\*' -and ($_.Triggers | Where-Object { $_.CimClass.CimClassName -in 'MSFT_TaskLogonTrigger', 'MSFT_TaskBootTrigger' }) } | ForEach-Object {
  $a = $_.Actions | Where-Object { $_.Execute } | Select-Object -First 1
  if (-not $a) { return }
  $exe = [Environment]::ExpandEnvironmentVariables(([string]$a.Execute).Trim('"'))
  [void]$out.Add([pscustomobject]@{ src = 'task'; label = ($_.TaskPath + $_.TaskName); exe = $exe; cmd = ('"' + $exe + '" ' + $a.Arguments).Trim(); on = ($_.State -ne 'Disabled') })
}
ConvertTo-Json -InputObject @($out) -Compress -Depth 3
`

interface ScanRow {
  src: StartupSource
  label: string
  cmd?: string | null
  exe?: string | null
  name?: string | null
  on: boolean
  state?: number
  pfn?: string
  task?: string
}

const STORE_PART = /^[\w.\-{}]+$/

export const windowsAdapter: StartupAdapter = {
  async list(): Promise<RawStartup[]> {
    const res = await powershell(SCAN, undefined, 30000)
    if (!res.ok || !res.stdout.trim()) throw new Error(res.stderr.trim() || 'startup scan failed')
    const rows = JSON.parse(res.stdout) as ScanRow[]
    return rows
      .filter((r) => r && r.label && (r.cmd || r.exe || r.src === 'store-app'))
      .map((r) => ({
        id: `${r.src}:${r.label}`,
        source: r.src,
        label: r.label,
        command: r.cmd ?? r.exe ?? '',
        exe: r.exe ?? undefined,
        declaredName: r.name ?? (r.src === 'store-app' ? storeName(r.pfn ?? '') : isFolder(r.src) ? r.label.replace(/\.(lnk|url)$/i, '') : undefined),
        enabled: r.on,
        policyLocked: r.src === 'store-app' && (r.state === 3 || r.state === 4),
        data: r.src === 'store-app' ? { pfn: r.pfn ?? '', task: r.task ?? '' } : undefined
      }))
  },

  async setEnabled(entry, enabled): Promise<ToggleResult> {
    const approved = APPROVED_KEY[entry.source]
    if (approved) {
      return regResult(await run('reg.exe', ['add', approved, '/v', entry.label, '/t', 'REG_BINARY', '/d', approvedValue(enabled), '/f', '/reg:64']))
    }
    if (entry.source === 'store-app') {
      const { pfn = '', task = '' } = entry.data ?? {}
      if (!STORE_PART.test(pfn) || !STORE_PART.test(task)) return { ok: false, error: 'failed', message: 'invalid package id' }
      // 1 = disabled by user, 2 = enabled: the same values Settings › Apps › Startup writes.
      return regResult(await run('reg.exe', ['add', `HKCU\\${STORE_TASKS}\\${pfn}\\${task}`, '/v', 'State', '/t', 'REG_DWORD', '/d', enabled ? '2' : '1', '/f']))
    }
    if (entry.source === 'task') {
      if (!/^\\[^"\u0000-\u001f]+$/.test(entry.label)) return { ok: false, error: 'failed', message: 'invalid task path' }
      return regResult(await run('schtasks.exe', ['/Change', '/TN', entry.label, enabled ? '/ENABLE' : '/DISABLE']))
    }
    return { ok: false, error: 'failed', message: 'unsupported source' }
  }
}

function isFolder(src: StartupSource): boolean {
  return src === 'user-folder' || src === 'common-folder'
}

function regResult(res: { ok: boolean; stdout: string; stderr: string }): ToggleResult {
  if (res.ok) return { ok: true }
  const msg = (res.stderr || res.stdout).trim()
  return /denied|denegado|acceso|privilege/i.test(msg) ? { ok: false, error: 'needs-admin', message: msg } : { ok: false, error: 'failed', message: msg }
}

/**
 * 12-byte StartupApproved value: 02 = enabled; 03 + FILETIME = disabled at
 * that moment (Task Manager shows the date from it).
 */
export function approvedValue(enabled: boolean, now = Date.now()): string {
  if (enabled) return '02' + '00'.repeat(11)
  let ft = (BigInt(now) + 11644473600000n) * 10000n
  let hex = ''
  for (let i = 0; i < 8; i++) {
    hex += Number(ft & 0xffn).toString(16).padStart(2, '0')
    ft >>= 8n
  }
  return '03000000' + hex
}

/** "5319275A.WhatsAppDesktop_cv1g1gvanyjgm" → "WhatsAppDesktop". */
export function storeName(pfn: string): string | undefined {
  const name = pfn.split('_')[0]
  const tail = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name
  return tail || undefined
}
