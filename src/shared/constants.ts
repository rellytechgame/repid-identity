/** Single place to change the public repository location. */
export const REPO_URL = 'https://github.com/rellytechgame/repid-identity'
/** Fixed download page: its installer is replaced on every release. */
export const RELEASE_URL = `${REPO_URL}/releases/tag/win-release`
export const RELEASE_API_URL = 'https://api.github.com/repos/rellytechgame/repid-identity/releases/tags/win-release'
/** PayPal subscription for RePID Enterprise ($20 per computer per year). */
export const ENTERPRISE_BUY_URL = 'https://www.paypal.com/cgi-bin/webscr?cmd=_s-xclick&hosted_button_id=YGXL925PT8524'
/**
 * Ed25519 public key (SPKI, base64) that verifies Enterprise license keys.
 * The matching private key never enters this repository: it stays with the
 * maintainer, who signs licenses with scripts/license.mjs.
 */
export const LICENSE_PUBLIC_KEY = 'MCowBQYDK2VwAyEAvDoSHrRSXVdWFtonGXnXXmQSd2wKkn9/QSp+ezUwUKc='
/** Voxel Enterprise support mailboxes for licensed RePID Enterprise customers. */
export const SUPPORT_EMAIL = { es: 'soporte@voxel.lat', en: 'support@voxel.lat' } as const
/** Original author and owner. Shown in the UI and preserved per the LICENSE/NOTICE. */
export const AUTHOR = 'RellyDev — Voxel Enterprise'
export const VENDOR_URL = 'https://github.com/rellytechgame'
/** PayPal.me donation link — keep in sync with the landing's src/config.js and .github/FUNDING.yml. */
export const DONATE_URL = 'https://paypal.me/iandasystems'
