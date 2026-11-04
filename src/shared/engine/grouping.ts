import type { AppGroup, ProcessInfo, Risk, ServiceRef } from '../types'
import { classify, clusterKey } from './classifier'
import { maxRisk, normalizeName, riskOf, type ProtectionContext } from './protection'

export function childrenIndex(procs: ProcessInfo[]): Map<number, ProcessInfo[]> {
  const index = new Map<number, ProcessInfo[]>()
  for (const p of procs) {
    if (p.ppid === p.pid) continue
    const list = index.get(p.ppid)
    if (list) list.push(p)
    else index.set(p.ppid, [p])
  }
  return index
}

/**
 * Every process below the given roots (roots excluded), ordered top-down.
 * The visited set guards against pid reuse creating cycles in stale data.
 */
export function descendantsOf(roots: number[], procs: ProcessInfo[], index = childrenIndex(procs)): ProcessInfo[] {
  const rootSet = new Set(roots)
  const visited = new Set<number>(roots)
  const out: ProcessInfo[] = []
  const queue = [...roots]
  while (queue.length) {
    const pid = queue.shift()!
    for (const child of index.get(pid) ?? []) {
      if (visited.has(child.pid)) continue
      visited.add(child.pid)
      if (!rootSet.has(child.pid)) out.push(child)
      queue.push(child.pid)
    }
  }
  return out
}

/**
 * Composite 0–100 impact. Each resource saturates at a level that is already
 * "heavy" on a typical machine (25% CPU, 15% RAM, 30% GPU) so one hog does not
 * flatten everyone else's score.
 */
export function impactScore(cpu: number, memBytes: number, totalMem: number, gpu: number): number {
  const memPct = totalMem > 0 ? (memBytes / totalMem) * 100 : 0
  const score = 0.45 * Math.min(1, cpu / 25) + 0.4 * Math.min(1, memPct / 15) + 0.15 * Math.min(1, gpu / 30)
  return Math.round(score * 100)
}

export interface GroupingContext extends ProtectionContext {
  totalMem: number
  services: ReadonlyMap<number, ServiceRef[]>
}

/**
 * Clusters processes into applications: a process belongs to the topmost
 * ancestor chain sharing its executable name (Chrome's 30 children → one
 * "Chrome" group). Stats cover the cluster only; descendants with other names
 * (crash handlers, terminals spawned by an IDE…) are listed separately because
 * a root kill ends them too.
 */
export function buildGroups(procs: ProcessInfo[], ctx: GroupingContext): AppGroup[] {
  const byPid = new Map(procs.map((p) => [p.pid, p]))
  const index = childrenIndex(procs)
  const clusters = new Map<number, ProcessInfo[]>()
  const keys = new Map(procs.map((p) => [p.pid, clusterKey(p.name, p.command)]))

  for (const p of procs) {
    const key = keys.get(p.pid)
    let root = p
    const seen = new Set<number>([p.pid])
    for (;;) {
      const parent = byPid.get(root.ppid)
      if (!parent || seen.has(parent.pid) || keys.get(parent.pid) !== key) break
      seen.add(parent.pid)
      root = parent
    }
    const list = clusters.get(root.pid)
    if (list) list.push(p)
    else clusters.set(root.pid, [p])
  }

  const groups: AppGroup[] = []
  for (const [rootPid, members] of clusters) {
    const root = byPid.get(rootPid)!
    const pids = members.map((m) => m.pid)
    const services = pids.flatMap((pid) => ctx.services.get(pid) ?? [])
    let risk: Risk = 'safe'
    let cpu = 0
    let memBytes = 0
    let gpu = 0
    for (const m of members) {
      risk = maxRisk(risk, riskOf(m.pid, m.name, ctx))
      cpu += m.cpu
      memBytes += m.memBytes
      gpu += m.gpu ?? 0
    }
    cpu = Math.min(100, cpu)
    gpu = Math.min(100, gpu)
    const descendantPids = descendantsOf(pids, procs, index).map((d) => d.pid)
    groups.push({
      id: `${normalizeName(root.name)}:${rootPid}`,
      name: root.name.replace(/\.exe$/i, ''),
      rootPid,
      pids,
      descendantPids,
      cpu,
      memBytes,
      gpu,
      identity: classify({ name: root.name, path: root.path, command: root.command, services }),
      risk,
      services,
      path: root.path,
      command: root.command,
      user: root.user,
      impact: impactScore(cpu, memBytes, ctx.totalMem, gpu)
    })
  }
  return groups.sort((a, b) => b.impact - a.impact || b.memBytes - a.memBytes)
}
