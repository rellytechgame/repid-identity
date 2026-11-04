import { powershell, run } from './exec'

export async function isElevated(): Promise<boolean> {
  if (process.platform === 'win32') {
    // `net session` only succeeds from an elevated token; no extra dependency needed.
    return (await run('net.exe', ['session'], { timeoutMs: 5000 })).ok
  }
  return typeof process.getuid === 'function' && process.getuid() === 0
}

/**
 * Windows only. Electron/Chromium refuses to run as root on Linux/macOS without
 * disabling its sandbox, so there privileged actions go through pkexec per action.
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
