import { createHash } from 'node:crypto'
import si from 'systeminformation'
import type { NetworkApp, NetworkBlockResult, NetworkReport } from '../../shared/types'
import { summarizeConnections } from '../../shared/engine/network'
import type { Engine } from '../engine'
import { powershell } from '../engine/exec'
import { isElevated } from '../engine/privileges'

const IS_WIN = process.platform === 'win32'
const GROUP = 'RePID Identity'
const RULE_ID = /^RePID-Block-[0-9a-f]{16}$/

const LIST_RULES = `
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$r = foreach ($rule in Get-NetFirewallRule -Group '${GROUP}' -ErrorAction SilentlyContinue) {
  [pscustomobject]@{ id = $rule.Name; path = ($rule | Get-NetFirewallApplicationFilter).Program }
}
ConvertTo-Json -InputObject @($r) -Compress
`

/** Outbound block for one program. Values travel in environment variables, never in the script text. */
const ADD_RULE = `
$ErrorActionPreference = 'Stop'
if (-not (Get-NetFirewallRule -Name $env:REPID_RULE -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -Name $env:REPID_RULE -DisplayName $env:REPID_LABEL -Group '${GROUP}' -Direction Outbound -Program $env:REPID_PATH -Action Block -Profile Any | Out-Null
}
'ok'
`

const REMOVE_RULE = `
$ErrorActionPreference = 'Stop'
Remove-NetFirewallRule -Name $env:REPID_RULE
'ok'
`

export function ruleIdFor(path: string): string {
  return `RePID-Block-${createHash('sha256').update(path.toLowerCase()).digest('hex').slice(0, 16)}`
}

/**
 * Which apps are talking to the network right now, and (Windows) an outbound
 * firewall block per program. The UI sends a group id or one of RePID's own
 * rule ids; the program path always comes from the engine's process list.
 */
export class Network {
  /** Byte counters of the previous scan: speeds are measured between two scans, not taken from a single sample. */
  private prev: { at: number; rx: number; tx: number } | null = null

  constructor(private readonly engine: Engine) {}

  private async rules(): Promise<Array<{ id: string; path: string }>> {
    if (!IS_WIN) return []
    const res = await powershell(LIST_RULES, undefined, 30000)
    try {
      return (JSON.parse(res.stdout || '[]') as Array<{ id: string; path: string }>).filter((r) => RULE_ID.test(r.id) && typeof r.path === 'string')
    } catch {
      return []
    }
  }

  async scan(): Promise<NetworkReport> {
    const [{ groups }, conns, stats, rules, elevated] = await Promise.all([
      this.engine.current(3000),
      si.networkConnections().catch(() => []),
      si.networkStats('*').catch(() => []),
      this.rules(),
      isElevated()
    ])
    const blockedPaths = new Set(rules.map((r) => r.path.toLowerCase()))
    const summary = summarizeConnections(
      conns.map((c) => ({ pid: c.pid, state: c.state, localPort: c.localPort, peerAddress: c.peerAddress, peerPort: c.peerPort, protocol: c.protocol })),
      groups
    )
    const apps: NetworkApp[] = summary.map((s) => ({
      groupId: s.group.id,
      name: s.group.name,
      product: s.group.identity.product,
      connections: s.connections,
      listening: s.listening,
      remotes: s.remotes,
      risk: s.group.risk,
      blocked: !!s.group.path && blockedPaths.has(s.group.path.toLowerCase()),
      blockable: IS_WIN && !!s.group.path && s.group.risk !== 'critical'
    }))
    const now = Date.now()
    const rx = stats.reduce((s, i) => s + (i.rx_bytes ?? 0), 0)
    const tx = stats.reduce((s, i) => s + (i.tx_bytes ?? 0), 0)
    const dt = this.prev ? (now - this.prev.at) / 1000 : 0
    const rate = (cur: number, before: number | undefined) => (dt > 0 && before !== undefined && cur >= before ? (cur - before) / dt : 0)
    const rxBytesPerSec = rate(rx, this.prev?.rx)
    const txBytesPerSec = rate(tx, this.prev?.tx)
    this.prev = { at: now, rx, tx }
    const runningPaths = new Set(groups.map((g) => g.path.toLowerCase()).filter(Boolean))
    return {
      apps,
      blockedIdle: rules.filter((r) => !runningPaths.has(r.path.toLowerCase())),
      rxBytesPerSec,
      txBytesPerSec,
      blockSupported: IS_WIN,
      elevated,
      scannedAt: Date.now()
    }
  }

  async block(raw: unknown): Promise<NetworkBlockResult> {
    const req = raw as { groupId?: unknown; ruleId?: unknown; block?: unknown } | null
    if (!req || typeof req.block !== 'boolean') throw new Error('Invalid request')
    if (!IS_WIN) return { status: 'unsupported' }
    if (!(await isElevated())) return { status: 'needs-admin' }

    let rule: string
    let path = ''
    let label = ''
    if (typeof req.ruleId === 'string') {
      if (req.block || !RULE_ID.test(req.ruleId)) throw new Error('Invalid request')
      rule = req.ruleId
    } else if (typeof req.groupId === 'string' && req.groupId.length <= 200) {
      const { groups } = await this.engine.current(0)
      const g = groups.find((x) => x.id === req.groupId)
      if (!g || !g.path) return { status: 'not-found' }
      if (g.risk === 'critical') return { status: 'protected' }
      path = g.path
      label = `RePID Identity: ${g.identity.product ?? g.name}`
      rule = ruleIdFor(path)
    } else {
      throw new Error('Invalid request')
    }

    const res = req.block
      ? await powershell(ADD_RULE, { REPID_RULE: rule, REPID_LABEL: label.slice(0, 200), REPID_PATH: path }, 30000)
      : await powershell(REMOVE_RULE, { REPID_RULE: rule }, 30000)
    if (res.stdout.trim().endsWith('ok')) return { status: req.block ? 'blocked' : 'unblocked' }
    if (/denied|denegado|0x80070005/i.test(res.stderr)) return { status: 'needs-admin' }
    if (/No MSFT_NetFirewallRule|no se encontr/i.test(res.stderr)) return { status: 'unblocked' }
    return { status: 'failed', error: res.stderr.trim().slice(0, 300) }
  }
}
