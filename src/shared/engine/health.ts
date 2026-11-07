import type { BatteryHealth, DriveHealth, HealthFinding, VolumeUsage } from '../types'

const DAY = 86400

export interface HealthInput {
  drives: DriveHealth[]
  volumes: VolumeUsage[]
  battery?: BatteryHealth
  cpuTempC?: number
  gpuTempC?: number
  uptimeSec: number
}

/**
 * Turns raw readings into plain-language findings, worst first. Thresholds
 * follow vendor guidance: SSD wear ≥ 90 % (spare blocks nearly used up),
 * uncorrected read errors on any drive, NVMe ≥ 70 °C sustained, battery below
 * 80 % / 60 % of its design capacity, CPU ≥ 90 °C and GPU ≥ 85 °C at rest.
 */
export function healthFindings(input: HealthInput): HealthFinding[] {
  const out: HealthFinding[] = []
  for (const d of input.drives) {
    if (d.status === 'unhealthy') out.push({ severity: 'critical', key: 'driveFailing', params: { name: d.name } })
    else if (d.status === 'warning') out.push({ severity: 'warning', key: 'driveWarning', params: { name: d.name } })
    if ((d.readErrors ?? 0) > 0) out.push({ severity: 'critical', key: 'driveErrors', params: { name: d.name, count: String(d.readErrors) } })
    if (d.wearPct !== undefined && d.wearPct >= 90) out.push({ severity: 'critical', key: 'driveWorn', params: { name: d.name, pct: String(d.wearPct) } })
    else if (d.wearPct !== undefined && d.wearPct >= 70) out.push({ severity: 'warning', key: 'driveWear', params: { name: d.name, pct: String(d.wearPct) } })
    if (d.temperatureC !== undefined && d.temperatureC >= 70) out.push({ severity: 'warning', key: 'driveHot', params: { name: d.name, temp: String(d.temperatureC) } })
  }
  for (const v of input.volumes) {
    const pct = v.sizeBytes > 0 ? (v.usedBytes / v.sizeBytes) * 100 : 0
    if (pct >= 95) out.push({ severity: 'critical', key: 'volumeFull', params: { mount: v.mount, pct: String(Math.round(pct)) } })
    else if (pct >= 85) out.push({ severity: 'warning', key: 'volumeLow', params: { mount: v.mount, pct: String(Math.round(pct)) } })
  }
  const b = input.battery
  if (b?.capacityPct !== undefined) {
    if (b.capacityPct < 60) out.push({ severity: 'critical', key: 'batteryWorn', params: { pct: String(b.capacityPct) } })
    else if (b.capacityPct < 80) out.push({ severity: 'warning', key: 'batteryAged', params: { pct: String(b.capacityPct) } })
  }
  if (input.cpuTempC !== undefined && input.cpuTempC >= 90) out.push({ severity: 'warning', key: 'cpuHot', params: { temp: String(Math.round(input.cpuTempC)) } })
  if (input.gpuTempC !== undefined && input.gpuTempC >= 85) out.push({ severity: 'warning', key: 'gpuHot', params: { temp: String(Math.round(input.gpuTempC)) } })
  if (input.uptimeSec >= 7 * DAY) out.push({ severity: 'info', key: 'restart', params: { days: String(Math.floor(input.uptimeSec / DAY)) } })
  const order = { critical: 0, warning: 1, info: 2, ok: 3 }
  out.sort((a, b) => order[a.severity] - order[b.severity])
  if (!out.some((f) => f.severity === 'critical' || f.severity === 'warning')) out.unshift({ severity: 'ok', key: 'allGood' })
  return out
}

/** Full-charge vs design capacity as a percentage, when both are known and plausible. */
export function batteryCapacityPct(designMWh?: number, fullMWh?: number): number | undefined {
  if (!designMWh || !fullMWh || designMWh <= 0 || fullMWh <= 0) return undefined
  return Math.min(100, Math.round((fullMWh / designMWh) * 100))
}
