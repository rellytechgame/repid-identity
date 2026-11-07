import type { AppGroup } from '../types'

export interface IoRate {
  /** Bytes per second read from disk/files by the process. */
  read: number
  /** Bytes per second written to disk/files. */
  write: number
}

/**
 * Parses "pid|readBytesPerSec|writeBytesPerSec" lines (one per process) into a
 * map keyed by pid. Rows with no I/O are skipped by the sampler, but zero and
 * malformed rows are tolerated here.
 */
export function parseProcessIo(stdout: string): Map<number, IoRate> {
  const byPid = new Map<number, IoRate>()
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^(\d+)\|(\d+(?:\.\d+)?)\|(\d+(?:\.\d+)?)/)
    if (!m) continue
    const pid = Number(m[1])
    if (!Number.isSafeInteger(pid) || pid <= 0) continue
    const read = Math.round(Number(m[2]))
    const write = Math.round(Number(m[3]))
    if (read === 0 && write === 0) continue
    byPid.set(pid, { read, write })
  }
  return byPid
}

/** Sums the per-pid I/O rates over each group's pids. Returns groupId → combined rate. */
export function ioByGroup(groups: Pick<AppGroup, 'id' | 'pids'>[], byPid: Map<number, IoRate>): Map<string, IoRate> {
  const out = new Map<string, IoRate>()
  for (const g of groups) {
    let read = 0
    let write = 0
    for (const pid of g.pids) {
      const io = byPid.get(pid)
      if (io) {
        read += io.read
        write += io.write
      }
    }
    if (read > 0 || write > 0) out.set(g.id, { read, write })
  }
  return out
}

/** Total disk activity of a group (read + write), for sorting and the "busiest disk" insight. */
export function ioTotal(group: Pick<AppGroup, 'ioRead' | 'ioWrite'>): number {
  return (group.ioRead ?? 0) + (group.ioWrite ?? 0)
}
