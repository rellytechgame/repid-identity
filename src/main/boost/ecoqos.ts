import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { encodePowerShell } from '../engine/exec'

/**
 * Windows 11 EcoQoS — the "Efficiency mode" leaf in Task Manager. Node has no
 * binding for SetProcessInformation(ProcessPowerThrottling), so one
 * PowerShell worker per performance session compiles a constant P/Invoke
 * shim once and then receives `[{"p":pid,"on":true}]` lines on stdin.
 * Nothing user-controlled is ever part of the script; pids are re-cast to int.
 */
const WORKER = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RepidEco {
  [StructLayout(LayoutKind.Sequential)]
  public struct Throttle { public uint Version; public uint ControlMask; public uint StateMask; }
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetProcessInformation(IntPtr h, int cls, ref Throttle info, int size);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  // ProcessPowerThrottling = 4, PROCESS_POWER_THROTTLING_EXECUTION_SPEED = 1.
  // on: throttle; off: ControlMask 0 hands the decision back to Windows (the default).
  public static int Set(int pid, bool on) {
    IntPtr h = OpenProcess(0x0200 | 0x1000, false, pid);
    if (h == IntPtr.Zero) return Marshal.GetLastWin32Error();
    try {
      Throttle t = new Throttle();
      t.Version = 1;
      t.ControlMask = on ? 1u : 0u;
      t.StateMask = on ? 1u : 0u;
      return SetProcessInformation(h, 4, ref t, Marshal.SizeOf(typeof(Throttle))) ? 0 : Marshal.GetLastWin32Error();
    } finally { CloseHandle(h); }
  }
}
'@
[Console]::Out.WriteLine('ready')
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    # Assign first: piping ConvertFrom-Json output in PowerShell 5.1 yields the whole array as ONE item.
    $items = ConvertFrom-Json -InputObject $line
    $res = @(foreach ($i in $items) { [pscustomobject]@{ p = [int]$i.p; e = [RepidEco]::Set([int]$i.p, [bool]$i.on) } })
    [Console]::Out.WriteLine((ConvertTo-Json -InputObject $res -Compress))
  } catch { [Console]::Out.WriteLine('[]') }
}
`

export class EcoQos {
  private child: ChildProcessWithoutNullStreams | null = null
  private ready: Promise<boolean> | null = null
  private buffer = ''
  private waiters: Array<(line: string) => void> = []
  private chain: Promise<unknown> = Promise.resolve()

  private start(): Promise<boolean> {
    if (this.ready) return this.ready
    this.ready = new Promise((resolve) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowerShell(WORKER)], { windowsHide: true })
      this.child = child
      const timer = setTimeout(() => resolve(false), 20000)
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        this.buffer += chunk
        let nl: number
        while ((nl = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, nl).trim()
          this.buffer = this.buffer.slice(nl + 1)
          if (line === 'ready') {
            clearTimeout(timer)
            resolve(true)
          } else this.waiters.shift()?.(line)
        }
      })
      child.on('exit', () => {
        clearTimeout(timer)
        resolve(false)
        this.child = null
        this.ready = null
        for (const w of this.waiters.splice(0)) w('[]')
      })
      child.on('error', () => resolve(false))
    })
    return this.ready
  }

  /** Returns pid → Win32 error code (0 = applied). Unreachable worker → empty map. */
  set(items: Array<{ pid: number; on: boolean }>): Promise<Map<number, number>> {
    const job = this.chain.then(async () => {
      const out = new Map<number, number>()
      if (!items.length || !(await this.start()) || !this.child) return out
      const line = await new Promise<string>((resolve) => {
        this.waiters.push(resolve)
        this.child!.stdin.write(JSON.stringify(items.map((i) => ({ p: Math.trunc(i.pid), on: i.on }))) + '\n')
      })
      try {
        const rows = JSON.parse(line || '[]') as Array<{ p: number; e: number }>
        for (const r of Array.isArray(rows) ? rows : [rows]) if (r && Number.isInteger(r.p)) out.set(r.p, r.e)
      } catch {
        // malformed line: treat as not applied
      }
      return out
    })
    this.chain = job.catch(() => undefined)
    return job
  }

  dispose(): void {
    this.child?.stdin.end()
    this.child?.kill()
    this.child = null
    this.ready = null
  }
}
