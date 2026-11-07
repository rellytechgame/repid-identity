import { readFile } from 'node:fs/promises'
import { parseProcessIo, type IoRate } from '../../shared/engine/io'
import { powershell } from './exec'

const REFRESH_MS = 2500

let last = new Map<number, IoRate>()
let lastAt = 0
let inflight = false
let disabled = false

/** Linux: cumulative read_bytes/write_bytes from /proc/<pid>/io, kept to turn totals into per-second rates. */
let prevLinux: { at: number; totals: Map<number, { r: number; w: number }> } | null = null

/**
 * Per-process disk/file I/O in bytes per second. Like the GPU sampler, this
 * runs in the background and callers get the most recent finished sample.
 *  - Windows: Win32_PerfFormattedData_PerfProc_Process (property names are not
 *    localized, unlike Get-Counter paths), giving ready per-second rates.
 *  - Linux: /proc/<pid>/io totals, differenced between samples.
 *  - macOS: not exposed without extra entitlements, so no data (same as GPU).
 */
export function getIoSample(): Map<number, IoRate> {
  if (!disabled && !inflight && Date.now() - lastAt > REFRESH_MS) {
    inflight = true
    sample()
      .then((s) => {
        if (s) last = s
        else disabled = true
      })
      .catch(() => undefined)
      .finally(() => {
        inflight = false
        lastAt = Date.now()
      })
  }
  return last
}

const WIN_IO =
  'Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | ' +
  "Where-Object { $_.IDProcess -ne 0 -and ($_.IOReadBytesPersec -gt 0 -or $_.IOWriteBytesPersec -gt 0) } | " +
  'ForEach-Object { "$($_.IDProcess)|$($_.IOReadBytesPersec)|$($_.IOWriteBytesPersec)" }'

async function sample(): Promise<Map<number, IoRate> | null> {
  if (process.platform === 'win32') {
    const res = await powershell(WIN_IO, undefined, 20000)
    if (!res.ok) return null
    return parseProcessIo(res.stdout)
  }
  if (process.platform === 'linux') return sampleLinux()
  return null
}

/** Reads cumulative byte counters and converts the delta since the last sample into a rate. */
async function sampleLinux(): Promise<Map<number, IoRate>> {
  const { readdir } = await import('node:fs/promises')
  const pids = (await readdir('/proc').catch(() => [])).filter((n) => /^\d+$/.test(n)).map(Number)
  const totals = new Map<number, { r: number; w: number }>()
  await Promise.all(
    pids.map(async (pid) => {
      try {
        const text = await readFile(`/proc/${pid}/io`, 'utf8')
        const r = Number(text.match(/^read_bytes:\s*(\d+)/m)?.[1] ?? 0)
        const w = Number(text.match(/^write_bytes:\s*(\d+)/m)?.[1] ?? 0)
        totals.set(pid, { r, w })
      } catch {
        // process gone or not readable (another user's): skip
      }
    })
  )
  const now = Date.now()
  const out = new Map<number, IoRate>()
  if (prevLinux) {
    const dt = (now - prevLinux.at) / 1000
    if (dt > 0) {
      for (const [pid, t] of totals) {
        const prev = prevLinux.totals.get(pid)
        if (!prev) continue
        const read = Math.max(0, Math.round((t.r - prev.r) / dt))
        const write = Math.max(0, Math.round((t.w - prev.w) / dt))
        if (read > 0 || write > 0) out.set(pid, { read, write })
      }
    }
  }
  prevLinux = { at: now, totals }
  return out
}
