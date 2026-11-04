import { stat } from 'node:fs/promises'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { Tally } from './fsops'
import { emptyTally } from './fsops'

/**
 * Firefox stores history and bookmarks in the same database (places.sqlite),
 * so the file cannot simply be deleted. Visits and unbookmarked pages are
 * removed with SQL instead; bookmarked pages stay, with their visit data reset.
 * Firefox must be closed (it holds an exclusive lock otherwise).
 */
export async function clearFirefoxHistory(profileDir: string): Promise<Tally> {
  const t = emptyTally()
  const file = path.join(profileDir, 'places.sqlite')
  let before: number
  try {
    before = (await stat(file)).size
  } catch {
    return t
  }
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(file)
    db.exec('PRAGMA busy_timeout = 3000')
    db.exec('BEGIN IMMEDIATE')
    db.exec('DELETE FROM moz_historyvisits')
    db.exec('DELETE FROM moz_inputhistory')
    // foreign_count > 0 means a bookmark or keyword references the page.
    db.exec('DELETE FROM moz_places WHERE foreign_count = 0')
    db.exec('UPDATE moz_places SET visit_count = 0, last_visit_date = NULL')
    db.exec('DELETE FROM moz_origins WHERE id NOT IN (SELECT DISTINCT origin_id FROM moz_places)')
    db.exec('COMMIT')
    db.exec('VACUUM')
    db.close()
    db = undefined
    const after = (await stat(file)).size
    t.bytes = Math.max(0, before - after)
    t.count = 1
  } catch {
    try {
      db?.exec('ROLLBACK')
    } catch {
      // nothing to roll back
    }
    t.skipped++
  } finally {
    db?.close()
  }
  return t
}
