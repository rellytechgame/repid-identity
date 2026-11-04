import type { ProcessDetails, ProcessInfo } from '../../shared/types'
import { childrenIndex } from '../../shared/engine/grouping'
import { powershell, run } from './exec'

const MAX_TREE = 250

/** Executable metadata (publisher, description, version) plus the full process tree. */
export async function getDetails(pid: number, procs: ProcessInfo[]): Promise<ProcessDetails | null> {
  const target = procs.find((p) => p.pid === pid)
  if (!target) return null

  const index = childrenIndex(procs)
  const tree: ProcessDetails['tree'] = []
  const walk = (p: ProcessInfo, depth: number, seen: Set<number>) => {
    if (tree.length >= MAX_TREE || seen.has(p.pid)) return
    seen.add(p.pid)
    tree.push({ pid: p.pid, ppid: p.ppid, name: p.name, depth, cpu: p.cpu, memBytes: p.memBytes })
    for (const c of index.get(p.pid) ?? []) walk(c, depth + 1, seen)
  }
  walk(target, 0, new Set())

  const meta = target.path ? await fileMetadata(target.path).catch(() => ({})) : {}
  return { pid, tree, ...meta }
}

async function fileMetadata(path: string): Promise<Pick<ProcessDetails, 'description' | 'company' | 'version'>> {
  if (process.platform === 'win32') {
    // The path travels through an env var, never through the script text.
    const res = await powershell(
      '$v = (Get-Item -LiteralPath $env:REPID_TARGET -ErrorAction Stop).VersionInfo; ' +
        '[pscustomobject]@{ d = $v.FileDescription; c = $v.CompanyName; v = $v.ProductVersion } | ConvertTo-Json -Compress',
      { REPID_TARGET: path }
    )
    if (!res.ok) return {}
    const json = JSON.parse(res.stdout || '{}') as { d?: string; c?: string; v?: string }
    return { description: json.d || undefined, company: json.c || undefined, version: json.v || undefined }
  }
  if (process.platform === 'darwin') {
    const bundle = path.match(/^(.*?\.app)\//)?.[1]
    if (!bundle) return {}
    const res = await run('plutil', ['-convert', 'json', '-o', '-', `${bundle}/Contents/Info.plist`])
    if (!res.ok) return {}
    const plist = JSON.parse(res.stdout) as Record<string, string>
    return {
      description: plist.CFBundleDisplayName || plist.CFBundleName,
      company: plist.NSHumanReadableCopyright,
      version: plist.CFBundleShortVersionString
    }
  }
  // Linux binaries carry no embedded publisher metadata; identity comes from the classifier.
  return {}
}
