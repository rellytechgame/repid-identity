import { execFile } from 'node:child_process'

export interface ExecResult {
  ok: boolean
  stdout: string
  stderr: string
  code: number | string | null
}

/**
 * Runs a binary without a shell. Arguments are passed as an array, so values
 * coming from process listings can never be interpreted as shell syntax.
 */
export function run(file: string, args: string[], opts: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: opts.timeoutMs ?? 15000, windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: opts.env ?? process.env },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          code: error ? ((error as NodeJS.ErrnoException).code ?? null) : 0
        })
      }
    )
  })
}

export function powershell(script: string, env?: Record<string, string>): Promise<ExecResult> {
  return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    env: env ? { ...process.env, ...env } : undefined
  })
}
