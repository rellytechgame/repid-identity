import { powershell, run } from '../engine/exec'

/** Domain/Azure AD join, server edition and MDM enrollment, read locally. Nothing is sent anywhere. */
const WIN_SIGNALS = `
$s = @()
$cs = Get-CimInstance Win32_ComputerSystem
if ($cs.PartOfDomain) { $s += 'domain' }
if ((Get-CimInstance Win32_OperatingSystem).ProductType -ne 1) { $s += 'server' }
$ds = (dsregcmd.exe /status 2>$null) -join "\`n"
if ($ds -match 'AzureAdJoined\\s*:\\s*YES') { $s += 'azure-ad' }
if (Get-ChildItem 'HKLM:\\SOFTWARE\\Microsoft\\Enrollments' -ErrorAction SilentlyContinue | Where-Object { (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).ProviderID -eq 'MS DM Server' }) { $s += 'mdm' }
$s -join ','
`

/**
 * Signs that this is a company-managed computer. Used only to show a notice
 * (personal computers are never domain-joined or MDM-enrolled).
 */
export async function corporateSignals(): Promise<string[]> {
  try {
    if (process.platform === 'win32') {
      const res = await powershell(WIN_SIGNALS, undefined, 30000)
      return res.stdout.trim().split(',').filter((s) => ['domain', 'server', 'azure-ad', 'mdm'].includes(s))
    }
    if (process.platform === 'darwin') {
      const signals: string[] = []
      if ((await run('dsconfigad', ['-show'], { timeoutMs: 10000 })).stdout.trim()) signals.push('domain')
      if (/MDM enrollment: Yes/i.test((await run('profiles', ['status', '-type', 'enrollment'], { timeoutMs: 10000 })).stdout)) signals.push('mdm')
      return signals
    }
    const realm = await run('realm', ['list'], { timeoutMs: 10000 })
    return realm.ok && realm.stdout.trim() ? ['domain'] : []
  } catch {
    return []
  }
}
