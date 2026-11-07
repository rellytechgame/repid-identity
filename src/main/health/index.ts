import os from 'node:os'
import si from 'systeminformation'
import type { BatteryHealth, DriveHealth, HealthReport, RestorePointResult, RestoreReason, VolumeUsage } from '../../shared/types'
import { batteryCapacityPct, healthFindings } from '../../shared/engine/health'
import { powershell } from '../engine/exec'
import { isElevated } from '../engine/privileges'

const IS_WIN = process.platform === 'win32'

/** Physical disks with health status and, when elevated, reliability counters (wear, temperature, errors, hours). */
const WIN_DRIVES = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$out = foreach ($d in Get-PhysicalDisk) {
  $r = $null
  try { $r = $d | Get-StorageReliabilityCounter -ErrorAction Stop } catch {}
  [pscustomobject]@{
    name = $d.FriendlyName; media = [string]$d.MediaType; bus = [string]$d.BusType; health = [string]$d.HealthStatus; size = [int64]$d.Size
    temp = $r.Temperature; wear = $r.Wear; errors = $r.ReadErrorsUncorrected; hours = $r.PowerOnHours
  }
}
ConvertTo-Json -InputObject @($out) -Compress
`

/** Design vs full-charge capacity from the built-in battery report (no admin needed). */
const WIN_BATTERY = `
$o = Join-Path $env:TEMP ('repid-battery-' + [guid]::NewGuid().ToString('N') + '.xml')
powercfg.exe /batteryreport /xml /output $o | Out-Null
try {
  [xml]$x = Get-Content -LiteralPath $o -Raw
  $b = @($x.BatteryReport.Batteries.Battery)[0]
  if ($b) { ConvertTo-Json -Compress -InputObject @{ design = [int64]$b.DesignCapacity; full = [int64]$b.FullChargeCapacity; cycles = [int64]$b.CycleCount } }
} finally { Remove-Item -LiteralPath $o -ErrorAction SilentlyContinue }
`

const RESTORE_LABEL: Record<RestoreReason, string> = {
  manual: 'RePID Identity: manual restore point',
  services: 'RePID Identity: before changing services',
  uninstall: 'RePID Identity: before uninstalling an app',
  cleanup: 'RePID Identity: before Windows update cleanup'
}

/**
 * Windows skips a new point when another was made in the last 24 hours (it
 * only warns). Comparing the newest sequence number before and after tells
 * "created" apart from "a recent one already covers you".
 */
const RESTORE_POINT = `
$ErrorActionPreference = 'Stop'
$before = (Get-ComputerRestorePoint | Sort-Object SequenceNumber | Select-Object -Last 1).SequenceNumber
try { Checkpoint-Computer -Description $env:REPID_LABEL -RestorePointType MODIFY_SETTINGS -WarningAction SilentlyContinue }
catch { if ($_.Exception.Message -match 'disabled|deshabilitad|desactivad|0x80042306') { 'disabled'; exit } ; throw }
$after = (Get-ComputerRestorePoint | Sort-Object SequenceNumber | Select-Object -Last 1).SequenceNumber
if ($after -and $after -ne $before) { 'created' } elseif ($after) { 'recent-exists' } else { 'disabled' }
`

function mediaOf(media: string, bus: string): DriveHealth['media'] {
  if (/nvme/i.test(bus)) return 'NVMe'
  if (/ssd/i.test(media)) return 'SSD'
  if (/hdd/i.test(media)) return 'HDD'
  return 'Unknown'
}

function statusOf(health: string): DriveHealth['status'] {
  if (/^healthy$|^ok$/i.test(health)) return 'healthy'
  if (/warning|predicted/i.test(health)) return 'warning'
  if (/unhealthy|fail/i.test(health)) return 'unhealthy'
  return 'unknown'
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

export class Health {
  async scan(): Promise<HealthReport> {
    const [drives, volumes, battery, cpuTemp, graphics, elevated] = await Promise.all([
      this.drives(),
      this.volumes(),
      this.battery(),
      si.cpuTemperature().catch(() => null),
      si.graphics().catch(() => null),
      isElevated()
    ])
    const cpuTempC = num(cpuTemp?.main) ?? num(cpuTemp?.max) ?? undefined
    const gpuTempC = graphics?.controllers.map((c) => num(c.temperatureGpu)).find((t) => t !== undefined)
    const uptimeSec = os.uptime()
    const input = { drives, volumes, battery, cpuTempC: cpuTempC || undefined, gpuTempC, uptimeSec }
    return { ...input, elevated, findings: healthFindings(input), scannedAt: Date.now() }
  }

  private async drives(): Promise<DriveHealth[]> {
    if (IS_WIN) {
      const res = await powershell(WIN_DRIVES, undefined, 30000)
      try {
        const list = JSON.parse(res.stdout || '[]') as Array<Record<string, unknown>>
        return list.map((d) => ({
          name: String(d.name ?? '').trim(),
          media: mediaOf(String(d.media ?? ''), String(d.bus ?? '')),
          sizeBytes: Number(d.size) || 0,
          status: statusOf(String(d.health ?? '')),
          temperatureC: num(d.temp) || undefined,
          wearPct: num(d.wear),
          powerOnHours: num(d.hours),
          readErrors: num(d.errors)
        }))
      } catch {
        // fall back to the cross-platform reading below
      }
    }
    const layout = await si.diskLayout().catch(() => [])
    return layout.map((d) => ({
      name: d.name,
      media: /nvme/i.test(d.interfaceType) ? 'NVMe' : d.type === 'SSD' ? 'SSD' : d.type === 'HD' ? 'HDD' : 'Unknown',
      sizeBytes: d.size,
      status: /^ok$/i.test(d.smartStatus) ? 'healthy' : /predicted|fail/i.test(d.smartStatus) ? 'unhealthy' : 'unknown',
      temperatureC: num(d.temperature) || undefined
    }))
  }

  private async volumes(): Promise<VolumeUsage[]> {
    const list = await si.fsSize().catch(() => [])
    return list
      .filter((f) => f.size >= 1024 ** 3 && !/tmpfs|devtmpfs|overlay|squashfs/i.test(f.type) && !/^\/(boot|snap|run|dev|sys|proc)/.test(f.mount))
      .map((f) => ({ mount: f.mount, sizeBytes: f.size, usedBytes: f.used }))
  }

  private async battery(): Promise<BatteryHealth | undefined> {
    const b = await si.battery().catch(() => null)
    if (!b?.hasBattery) return undefined
    let design = num(b.designedCapacity)
    let full = num(b.maxCapacity)
    let cycles = num(b.cycleCount) || undefined
    if (IS_WIN) {
      const res = await powershell(WIN_BATTERY, undefined, 30000)
      try {
        const r = JSON.parse(res.stdout) as { design?: number; full?: number; cycles?: number }
        design = r.design || design
        full = r.full || full
        cycles = r.cycles || cycles
      } catch {
        // keep systeminformation's reading
      }
    }
    return { capacityPct: batteryCapacityPct(design, full), designMWh: design, fullMWh: full, cycles, percent: num(b.percent), charging: b.isCharging }
  }

  /** Windows System Restore point (administrator only). Other systems: unsupported. */
  async restorePoint(reason: unknown): Promise<RestorePointResult> {
    const key = typeof reason === 'string' && reason in RESTORE_LABEL ? (reason as RestoreReason) : null
    if (!key) throw new Error('Invalid reason')
    if (!IS_WIN) return { status: 'unsupported' }
    if (!(await isElevated())) return { status: 'needs-admin' }
    const res = await powershell(RESTORE_POINT, { REPID_LABEL: RESTORE_LABEL[key] }, 180000)
    const status = res.stdout.trim().split(/\r?\n/).at(-1)
    if (status === 'created' || status === 'recent-exists' || status === 'disabled') return { status }
    return { status: 'failed', error: (res.stderr || res.stdout).trim().slice(0, 300) }
  }
}
