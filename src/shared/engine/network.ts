import type { AppGroup } from '../types'

export interface RawConnection {
  pid: number
  state: string
  localPort: string
  peerAddress: string
  peerPort: string
  protocol: string
}

export interface ConnectionSummary {
  group: AppGroup
  connections: number
  listening: number[]
  remotes: string[]
}

const LOCAL_PEER = /^(127\.|::1$|0\.0\.0\.0$|::$|\*$|localhost$|\[::1\]$|\[::\]$)/i

/**
 * Groups open sockets by app: established connections to another machine
 * (loopback traffic between local processes is ignored), listening ports, and
 * the busiest remote endpoints. Apps with no outside traffic are omitted.
 */
export function summarizeConnections(conns: RawConnection[], groups: AppGroup[]): ConnectionSummary[] {
  const byPid = new Map<number, AppGroup>()
  for (const g of groups) for (const pid of g.pids) byPid.set(pid, g)
  const acc = new Map<string, { group: AppGroup; connections: number; listening: Set<number>; remotes: Map<string, number> }>()
  for (const c of conns) {
    const g = byPid.get(c.pid)
    if (!g) continue
    const entry = acc.get(g.id) ?? { group: g, connections: 0, listening: new Set<number>(), remotes: new Map<string, number>() }
    const state = c.state.toUpperCase()
    if (state === 'LISTEN' || state === 'LISTENING') {
      const port = Number(c.localPort)
      if (Number.isInteger(port) && port > 0) entry.listening.add(port)
    } else if ((state === 'ESTABLISHED' || (c.protocol.startsWith('udp') && c.peerAddress)) && c.peerAddress && !LOCAL_PEER.test(c.peerAddress)) {
      entry.connections++
      const host = c.peerAddress.includes(':') ? `[${c.peerAddress}]:${c.peerPort}` : `${c.peerAddress}:${c.peerPort}`
      entry.remotes.set(host, (entry.remotes.get(host) ?? 0) + 1)
    } else {
      continue
    }
    acc.set(g.id, entry)
  }
  return [...acc.values()]
    .filter((e) => e.connections > 0 || e.listening.size > 0)
    .map((e) => ({
      group: e.group,
      connections: e.connections,
      listening: [...e.listening].sort((a, b) => a - b).slice(0, 12),
      remotes: [...e.remotes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([h]) => h)
    }))
    .sort((a, b) => b.connections - a.connections || b.listening.length - a.listening.length)
}
