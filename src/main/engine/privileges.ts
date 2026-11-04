import { powershell, run, type ExecResult } from './exec'

export async function isElevated(): Promise<boolean> {
  if (process.platform === 'win32') {
    // `net session` only succeeds from an elevated token; no extra dependency needed.
    return (await run('net.exe', ['session'], { timeoutMs: 5000 })).ok
  }
  return typeof process.getuid === 'function' && process.getuid() === 0
}

/**
 * Windows only. Packaged builds already request administrator rights in their
 * manifest; this covers development runs. Electron/Chromium refuses to run as
 * root on Linux/macOS without disabling its sandbox, so there privileged work
 * goes through `runElevated` per action instead.
 */
export async function relaunchElevated(execPath: string, args: string[]): Promise<boolean> {
  if (process.platform !== 'win32') return false
  const res = await powershell(
    '$a = $env:REPID_ARGS; if ($a) { Start-Process -FilePath $env:REPID_EXE -ArgumentList $a -Verb RunAs } ' +
      'else { Start-Process -FilePath $env:REPID_EXE -Verb RunAs }',
    { REPID_EXE: execPath, REPID_ARGS: args.map((a) => `"${a.replace(/"/g, '')}"`).join(' ') }
  )
  return res.ok
}

function appleScriptString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Runs shell lines as root behind ONE password prompt: polkit (`pkexec`) on
 * Linux, the standard administrator dialog (`osascript`) on macOS.
 *
 * SECURITY: `lines` must be constants authored in this codebase, or built
 * only from validated integers (pids). Never pass paths, names or any value
 * that came from the process list, the file system or the UI.
 */
export async function runElevated(lines: string[]): Promise<ExecResult> {
  const script = lines.join('\n')
  if (process.platform === 'linux') {
    return run('pkexec', ['/bin/sh', '-c', script], { timeoutMs: 300000 })
  }
  if (process.platform === 'darwin') {
    return run('osascript', ['-e', `do shell script ${appleScriptString(script)} with administrator privileges`], { timeoutMs: 300000 })
  }
  return { ok: false, stdout: '', stderr: 'unsupported', code: null }
}

/** User closed the password dialog (pkexec 126/127, osascript -128). */
export function wasCancelled(res: ExecResult): boolean {
  return res.code === 126 || res.code === 127 || /-128|cancel/i.test(res.stderr)
}
