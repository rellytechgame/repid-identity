import { powershell, run } from './exec'

const REFRESH_MS = 4000

interface GpuSample {
  byPid: Map<number, number>
  /** Busiest engine type summed across processes — same figure Task Manager shows. */
  overall?: number
}

let last: GpuSample = { byPid: new Map() }
let lastAt = 0
let inflight = false
let disabled = false

/**
 * Per-process GPU utilization. Sampling takes 0.5–2 s, so it runs in the
 * background and callers always get the latest finished sample immediately.
 *  - Windows: GPU Engine performance counters through WMI (class names are not
 *    localized, unlike Get-Counter paths).
 *  - Linux/macOS: `nvidia-smi pmon` when an NVIDIA driver is present.
 */
export function getGpuSample(): GpuSample {
  if (!disabled && !inflight && Date.now() - lastAt > REFRESH_MS) {
    inflight = true
    sample()
      .then((s) => {
        if (s) last = s
        else disabled = true
      })
      .catch(() => {
        disabled = true
      })
      .finally(() => {
        inflight = false
        lastAt = Date.now()
      })
  }
  return last
}

async function sample(): Promise<GpuSample | null> {
  if (process.platform === 'win32') {
    const res = await powershell(
      'Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine | ' +
        'Where-Object { $_.UtilizationPercentage -gt 0 } | ForEach-Object { $_.Name + "|" + $_.UtilizationPercentage }'
    )
    if (!res.ok) return null
    const byPid = new Map<number, number>()
    const byEngine = new Map<string, number>()
    for (const line of res.stdout.split(/\r?\n/)) {
      const m = line.match(/^pid_(\d+)_.*engtype_([^|]+)\|(\d+(?:\.\d+)?)/)
      if (!m) continue
      const pid = Number(m[1])
      const value = Number(m[3])
      byPid.set(pid, Math.min(100, (byPid.get(pid) ?? 0) + value))
      byEngine.set(m[2], (byEngine.get(m[2]) ?? 0) + value)
    }
    const overall = byEngine.size ? Math.min(100, Math.max(...byEngine.values())) : 0
    return { byPid, overall }
  }

  const res = await run('nvidia-smi', ['pmon', '-c', '1', '-s', 'u'])
  if (!res.ok) return null
  const byPid = new Map<number, number>()
  for (const line of res.stdout.split('\n')) {
    if (line.startsWith('#')) continue
    const cols = line.trim().split(/\s+/)
    const pid = Number(cols[1])
    const sm = Number(cols[3])
    if (Number.isInteger(pid) && Number.isFinite(sm)) byPid.set(pid, Math.min(100, (byPid.get(pid) ?? 0) + sm))
  }
  return { byPid }
}
