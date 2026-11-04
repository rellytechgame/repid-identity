import type { KillOutcome, KillRequest, KillResult, ProcessInfo, Risk } from '../../shared/types'
import { descendantsOf } from '../../shared/engine/grouping'
import { run } from './exec'
import { runElevated } from './privileges'

const GRACE_MS = 2000
const POLL_MS = 150

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM means it exists but belongs to someone else.
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function signal(pid: number, sig: NodeJS.Signals): KillOutcome['status'] | null {
  try {
    process.kill(pid, sig)
    return null
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return 'already-exited'
    if (code === 'EPERM' || code === 'EACCES') return 'denied'
    return 'failed'
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Ends each requested root and everything it spawned.
 *
 * Order is top-down: parents first so supervisors (browsers, launchers,
 * IDEs) cannot respawn the children we are about to end. On POSIX the
 * graceful phase sends SIGTERM so apps can flush state, then SIGKILLs
 * survivors. Windows has no catchable terminate signal for arbitrary
 * processes; Node maps every signal to TerminateProcess there.
 *
 * Protection is re-evaluated here from fresh data — the UI is never trusted.
 */
export async function killTrees(req: KillRequest, procs: ProcessInfo[], riskOf: (p: ProcessInfo) => Risk): Promise<KillResult> {
  const byPid = new Map(procs.map((p) => [p.pid, p]))
  const roots = req.pids.filter((pid) => byPid.has(pid))
  const outcomes: KillOutcome[] = req.pids
    .filter((pid) => !byPid.has(pid))
    .map((pid) => ({ pid, name: '', status: 'already-exited' as const }))

  const ordered = [...roots.map((pid) => byPid.get(pid)!), ...descendantsOf(roots, procs)]
  const targets: ProcessInfo[] = []
  for (const p of ordered) {
    const risk = riskOf(p)
    if (risk === 'critical' || (risk === 'caution' && !req.allowCaution)) {
      outcomes.push({ pid: p.pid, name: p.name, status: 'protected' })
    } else {
      targets.push(p)
    }
  }

  const graceful = !req.force && process.platform !== 'win32'
  const pendingStatus = new Map<number, KillOutcome['status']>()
  for (const p of targets) {
    const failure = signal(p.pid, graceful ? 'SIGTERM' : 'SIGKILL')
    if (failure) pendingStatus.set(p.pid, failure)
  }

  const waitList = () => targets.filter((p) => !pendingStatus.has(p.pid) && isAlive(p.pid))
  const deadline = Date.now() + (graceful ? GRACE_MS : 600)
  while (Date.now() < deadline && waitList().length) await sleep(POLL_MS)

  for (const p of waitList()) {
    const failure = signal(p.pid, 'SIGKILL')
    if (failure) pendingStatus.set(p.pid, failure)
  }
  if (waitList().length) await sleep(400)

  // Escalate for processes the current token may not touch (other users, services).
  const denied = targets.filter((p) => pendingStatus.get(p.pid) === 'denied' && isAlive(p.pid))
  if (denied.length) {
    if (process.platform === 'win32') {
      // taskkill enables SeDebugPrivilege for the admin token, which TerminateProcess from Node does not.
      await Promise.all(denied.map((p) => run('taskkill.exe', ['/F', '/PID', String(p.pid)])))
    } else {
      // Only validated integer pids reach the elevated shell line.
      await runElevated([`kill -9 ${denied.map((p) => Math.trunc(p.pid)).join(' ')}`])
    }
    await sleep(500)
    for (const p of denied) if (!isAlive(p.pid)) pendingStatus.delete(p.pid)
  }

  let freedMemBytes = 0
  let freedCpu = 0
  for (const p of targets) {
    let status = pendingStatus.get(p.pid) ?? (isAlive(p.pid) ? 'failed' : 'killed')
    if (status === 'already-exited' && !isAlive(p.pid)) status = 'killed'
    if (status === 'killed') {
      freedMemBytes += p.memBytes
      freedCpu += p.cpu
    }
    outcomes.push({ pid: p.pid, name: p.name, status })
  }

  return { outcomes, freedMemBytes, freedCpu: Math.min(100, freedCpu) }
}
