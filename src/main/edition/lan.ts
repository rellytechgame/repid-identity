import { createSocket, type Socket } from 'node:dgram'
import os from 'node:os'
import type { Edition } from '../../shared/types'
import { LAN_WINDOW_MS, parseBeacon, type LanPeer } from '../../shared/engine/edition'

export const LAN_PORT = 47913
const ANNOUNCE_MS = 2 * 60_000

/** Broadcast address of every IPv4 interface that is up and not internal (e.g. 192.168.1.255). */
export function broadcastAddresses(): string[] {
  const out = new Set<string>(['255.255.255.255'])
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) {
      if (i.family !== 'IPv4' || i.internal || !i.netmask) continue
      const ip = i.address.split('.').map(Number)
      const mask = i.netmask.split('.').map(Number)
      out.add(ip.map((b, k) => (b & mask[k]) | (~mask[k] & 255)).join('.'))
    }
  }
  return [...out]
}

/**
 * Lets copies of RePID on the same local network notice each other. Each
 * copy broadcasts a small UDP message every two minutes — a random install
 * id, its edition and its license id — and listens for the others. Nothing
 * leaves the local network and nothing about the user or the computer is
 * sent. Broadcasts do not cross routers, so "network" means one LAN/Wi-Fi.
 */
export class LanBeacon {
  private socket: Socket | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly selfId: string,
    private readonly announce: () => { edition: Edition; license: string },
    private readonly onPeer: (id: string, peer: LanPeer) => void,
    /** Overridable for tests so they do not contend with a real copy on the fixed port. */
    private readonly port: number = LAN_PORT
  ) {}

  start(): void {
    const socket = createSocket({ type: 'udp4', reuseAddr: true })
    socket.on('error', () => undefined)
    socket.on('message', (msg) => {
      if (msg.length > 512) return
      const parsed = parseBeacon(msg.toString('utf8'))
      if (parsed && parsed.id !== this.selfId) this.onPeer(parsed.id, { ...parsed.peer, seen: Date.now() })
    })
    socket.bind(this.port, () => {
      try {
        socket.setBroadcast(true)
      } catch {
        // broadcasting unavailable (no network): listening still works
      }
      this.send()
      // A second announcement shortly after start-up catches copies that were still binding.
      setTimeout(() => this.send(), 15_000)
    })
    this.socket = socket
    this.timer = setInterval(() => this.send(), ANNOUNCE_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.socket?.close()
    this.socket = null
  }

  private send(): void {
    if (!this.socket) return
    const { edition, license } = this.announce()
    const msg = Buffer.from(JSON.stringify({ p: 'repid', v: 1, id: this.selfId, e: edition, l: license }))
    for (const addr of broadcastAddresses()) this.socket.send(msg, this.port, addr, () => undefined)
  }
}

/** Drops peers not heard from within the counting window. */
export function prunePeers(peers: Record<string, LanPeer>, now: number): Record<string, LanPeer> {
  return Object.fromEntries(Object.entries(peers).filter(([, p]) => now - p.seen <= LAN_WINDOW_MS))
}
