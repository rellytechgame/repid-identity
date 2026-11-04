import os from 'node:os'
import si from 'systeminformation'
import type {
  EngineSettings,
  GpuController,
  KillRequest,
  KillResult,
  Platform,
  ProcessDetails,
  ProcessInfo,
  ServiceStopResult,
  SystemSnapshot
} from '../../shared/types'
import { buildGroups } from '../../shared/engine/grouping'
import { normalizeName, riskOf, type ProtectionContext } from '../../shared/engine/protection'
import { getDetails } from './details'
import { getGpuSample } from './gpu'
import { killTrees } from './killer'
import { enrichWithMetadata } from './metadata'
import { isElevated } from './privileges'
import { getServiceMap, stopServiceOf } from './services'

const PROCESS_MAX_AGE_MS = 1500
const GRAPHICS_MAX_AGE_MS = 15000

/**
 * Orchestrates sampling and actions. Keeps the last process list so kill and
 * detail requests resolve pids against data the engine collected itself.
 */
export class Engine {
  private procs: ProcessInfo[] = []
  private procsAt = 0
  private scanning: Promise<ProcessInfo[]> | null = null
  private graphics: { at: number; controllers: GpuController[]; utilization?: number } = { at: 0, controllers: [] }
  private userProtected = new Set<string>()
  private staticInfo: Promise<{ brand: string; elevated: boolean }> | null = null

  constructor(private readonly selfPids: () => Set<number>) {}

  setSettings(settings: EngineSettings): void {
    this.userProtected = new Set(settings.protectedNames.map(normalizeName))
  }

  private protection(): ProtectionContext {
    return { platform: process.platform as Platform, selfPids: this.selfPids(), userProtected: this.userProtected }
  }

  private async processes(maxAgeMs = PROCESS_MAX_AGE_MS): Promise<ProcessInfo[]> {
    if (Date.now() - this.procsAt < maxAgeMs) return this.procs
    this.scanning ??= si
      .processes()
      .then((data) => {
        const gpu = getGpuSample().byPid
        // Windows reports idle time as a "System Idle Process" at pid 0; it is not a consumer.
        const list = process.platform === 'win32' ? data.list.filter((p) => p.pid !== 0) : data.list
        this.procs = list.map((p) => ({
          pid: p.pid,
          ppid: p.parentPid,
          name: p.name,
          // systeminformation returns the full executable path on Windows but only its directory elsewhere.
          path: process.platform === 'win32' ? (p.path ?? '') : p.path ? joinPath(p.path, p.command) : '',
          command: [p.command, p.params].filter(Boolean).join(' '),
          user: p.user ?? '',
          cpu: clamp(p.cpu),
          memBytes: (p.memRss ?? 0) * 1024,
          gpu: gpu.get(p.pid),
          started: p.started ?? ''
        }))
        this.procsAt = Date.now()
        return this.procs
      })
      .finally(() => {
        this.scanning = null
      })
    return this.scanning
  }

  private refreshGraphics(): void {
    if (Date.now() - this.graphics.at < GRAPHICS_MAX_AGE_MS) return
    this.graphics.at = Date.now()
    si.graphics()
      .then((g) => {
        this.graphics.controllers = g.controllers.map((c) => ({
          model: c.model,
          vendor: c.vendor,
          utilization: c.utilizationGpu ?? undefined,
          memTotalMb: c.memoryTotal ?? c.vram ?? undefined,
          memUsedMb: c.memoryUsed ?? undefined
        }))
      })
      .catch(() => undefined)
  }

  async snapshot(): Promise<SystemSnapshot> {
    this.staticInfo ??= Promise.all([si.cpu(), isElevated()]).then(([cpu, elevated]) => ({
      brand: `${cpu.manufacturer} ${cpu.brand}`.trim(),
      elevated
    }))
    this.refreshGraphics()
    const [load, mem, procs, info] = await Promise.all([si.currentLoad(), si.mem(), this.processes(), this.staticInfo])
    const services = await getServiceMap(procs.map((p) => p.pid))
    const gpuSample = getGpuSample()
    const controllerUtil = this.graphics.controllers.find((c) => c.utilization !== undefined)?.utilization
    const groups = buildGroups(procs, { ...this.protection(), totalMem: mem.total, services })
    enrichWithMetadata(groups)

    return {
      timestamp: Date.now(),
      platform: process.platform as Platform,
      hostname: os.hostname(),
      elevated: info.elevated,
      cpu: { load: clamp(load.currentLoad), cores: os.cpus().length, brand: info.brand },
      mem: { total: mem.total, used: mem.total - mem.available, available: mem.available },
      gpu: { utilization: gpuSample.overall ?? controllerUtil, controllers: this.graphics.controllers },
      processCount: procs.length,
      groups
    }
  }

  async details(pid: number): Promise<ProcessDetails | null> {
    return getDetails(pid, await this.processes())
  }

  async kill(req: KillRequest): Promise<KillResult> {
    // Fresh list: pids may have been reused since the UI last rendered.
    const procs = await this.processes(0)
    const ctx = this.protection()
    const result = await killTrees(req, procs, (p) => riskOf(p.pid, p.name, ctx))
    this.procsAt = 0
    return result
  }

  async stopService(pid: number): Promise<ServiceStopResult> {
    const procs = await this.processes()
    const target = procs.find((p) => p.pid === pid)
    const ctx = this.protection()
    if (!target || riskOf(pid, target.name, ctx) === 'critical') {
      return { service: '', ok: false, needsElevation: false, error: target ? 'protected' : 'not-found' }
    }
    const result = await stopServiceOf(pid, procs.map((p) => p.pid))
    this.procsAt = 0
    return result
  }
}

function clamp(n: number | undefined): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round((n as number) * 10) / 10))
}

function joinPath(dir: string, file: string): string {
  return `${dir}${dir.includes('\\') ? '\\' : '/'}${file}`
}
