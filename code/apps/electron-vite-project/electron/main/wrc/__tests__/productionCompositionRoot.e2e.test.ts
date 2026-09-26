/**
 * The production composition root itself — `initWrcClient` with no test seam
 * injected. Other suites prove each store through `setWrc*ForTests`; this one
 * proves the wiring those seams replace: every store lands on the durable
 * security DB, and an unconfigured deployment fails closed instead of
 * resolving from empty state.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const _require = createRequire(import.meta.url)
let Database: any = null
try {
  Database = _require('better-sqlite3')
  new Database(':memory:').close()
} catch {
  Database = null
}

describe.skipIf(!Database)('initWrcClient — production composition root', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wrc-root-'))
  const dbPath = join(dir, 'wrc-security.db')
  let previous: string | undefined

  beforeAll(() => {
    previous = process.env.WRDESK_WRC_SECURITY_DB
    process.env.WRDESK_WRC_SECURITY_DB = dbPath
  })

  afterAll(() => {
    if (previous === undefined) delete process.env.WRDESK_WRC_SECURITY_DB
    else process.env.WRDESK_WRC_SECURITY_DB = previous
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // The runtime keeps its process-lifetime handle open; Windows may refuse.
    }
  })

  it('opens the durable security DB and builds every store on it', async () => {
    const rt = await import('../wrcRuntime')
    await rt.initWrcClient({
      registryBaseUrl: null,
      ingestPublicKey: null,
      directoryOperatorKid: null,
      directoryOperatorPub: null,
    })
    expect(existsSync(dbPath)).toBe(true)

    const db = new Database(dbPath, { readonly: true })
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(
      (r) => r.name,
    )
    db.close()
    expect(tables).toEqual(
      expect.arrayContaining([
        'wrc_directory_generation_floor',
        'wrc_publisher_epoch_floor',
        'wrc_entry_use_state',
        'wrc_device_record',
        'wrc_counterpart_pass',
        'wrc_relay_envelope',
        'wrc_relay_request_ledger',
        'wrc_admission_request_ledger',
      ]),
    )
    expect(await rt.isWrcConfigured()).toBe(false)
  })

  it('without a pinned directory operator, a valid reference is refused at Gate 2', async () => {
    const rt = await import('../wrcRuntime')
    const r = await rt.handleWrcSubmitReference({ raw: 'P-WR7X4K-9B2M3C', requestInstanceId: 'req-root' })
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.result.ok).toBe(false)
    if (r.result.ok) return
    expect(r.result.gate).toBe(2)
    expect(r.acceptanceToken).toBeUndefined()
  })
})
