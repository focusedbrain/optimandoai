/**
 * The composition root in each build flavor, through the real runtime entry
 * points (`initWrcClient`, `wrc.submitReference`, `wrc.acceptReference`,
 * `wrc.runtimeStatus`) on a real security DB:
 *
 *  - release ignores the WRC environment variables and stays unconfigured;
 *  - only the unbundled dev flavor reads them;
 *  - wrc-test resolves against the built-in registry, keeps its state in
 *    separate files, and spends the one-time offering exactly once;
 *  - declining releases the reservation at once and spends the token.
 */
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { setWrcBuildFlavorForTests } from '../wrcBuildFlavor'
import { createMemoryUseLimitStore } from '../useLimitStore'
import { createWrcTestRegistry } from '../wrcTestRegistry'

const _require = createRequire(import.meta.url)
let Database: any = null
try {
  Database = _require('better-sqlite3')
  new Database(':memory:').close()
} catch {
  Database = null
}

const ENV = {
  WRDESK_WRC_REGISTRY_URL: 'https://rogue.example',
  WRDESK_WRC_INGEST_PUBKEY: 'cm9ndWUtaW5nZXN0LWtleS0zMi1ieXRlcy1wYWQtcGFkLXA',
  WRDESK_WRC_DIRECTORY_OPERATOR_KID: 'rogue-op',
  WRDESK_WRC_DIRECTORY_OPERATOR_PUBKEY: 'cm9ndWUtb3BlcmF0b3Ita2V5LTMyLWJ5dGVzLXBhZC1wYWQ',
}

describe.skipIf(!Database)('WRC composition root per build flavor', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wrc-flavor-'))
  const dbPath = join(dir, 'wrc-security.db')
  const saved: Record<string, string | undefined> = {}

  beforeAll(() => {
    for (const k of [...Object.keys(ENV), 'WRDESK_WRC_SECURITY_DB']) saved[k] = process.env[k]
    Object.assign(process.env, ENV, { WRDESK_WRC_SECURITY_DB: dbPath })
  })

  afterAll(() => {
    setWrcBuildFlavorForTests(null)
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // The runtime keeps its process-lifetime DB handle open; Windows may refuse.
    }
  })

  beforeEach(async () => {
    const rt = await import('../wrcRuntime')
    rt.setWrcSecurityDbForTests(null)
    rt.resetWrcTestRegistryForTests()
  })

  it('release ignores the WRC environment and stays unconfigured', async () => {
    const rt = await import('../wrcRuntime')
    setWrcBuildFlavorForTests('release')
    await rt.initWrcClient()
    expect(await rt.handleWrcRuntimeStatus()).toEqual({
      success: true,
      result: { flavor: 'release', configured: false, testRegistry: false },
    })
  })

  it('only the unbundled dev flavor reads the environment', async () => {
    const rt = await import('../wrcRuntime')
    setWrcBuildFlavorForTests('dev')
    await rt.initWrcClient()
    expect(await rt.isWrcConfigured()).toBe(true)
  })

  it('wrc-test resolves against the built-in registry and keeps its state apart', async () => {
    const rt = await import('../wrcRuntime')
    setWrcBuildFlavorForTests('wrc-test')
    await rt.initWrcClient()
    expect(await rt.handleWrcRuntimeStatus()).toEqual({
      success: true,
      result: { flavor: 'wrc-test', configured: true, testRegistry: true },
    })
    expect(existsSync(join(dir, 'wrc-security.wrc-test.db'))).toBe(true)

    // The resolved-record cache: this submission writes the test file, never the release one.
    const userData = app.getPath('userData')
    const testCache = join(userData, 'wrc-resolved-publishers.wrc-test.json')
    const releaseCache = join(userData, 'wrc-resolved-publishers.json')
    const mtime = (p: string) => (existsSync(p) ? statSync(p).mtimeMs : 0)
    const releaseBefore = mtime(releaseCache)
    const startMs = Date.now() - 1000

    const r = await rt.handleWrcSubmitReference({ raw: 'P-TEST01-10001N', requestInstanceId: 'req-a' })
    expect(r.success && r.result.ok, JSON.stringify(r)).toBe(true)
    expect(mtime(testCache)).toBeGreaterThanOrEqual(startMs)
    expect(mtime(releaseCache)).toBe(releaseBefore)
  })

  it('the composed directory client follows the operator rollover channel (C6)', async () => {
    const rt = await import('../wrcRuntime')
    setWrcBuildFlavorForTests('wrc-test')
    await rt.initWrcClient()
    const rolled = createWrcTestRegistry().codes.find((c) => c.canonical.startsWith('PTEST03'))!
    const r = await rt.handleWrcSubmitReference({ raw: rolled.canonical, requestInstanceId: 'req-rolled' })
    if (!r.success || r.result.ok) throw new Error(`expected a status refusal: ${JSON.stringify(r)}`)
    expect({ gate: r.result.gate, reason: r.result.reason }).toEqual({ gate: 2, reason: 'namespace_inactive' })
  })

  it('wrc-test spends the one-time offering exactly once', async () => {
    const rt = await import('../wrcRuntime')
    setWrcBuildFlavorForTests('wrc-test')
    await rt.initWrcClient()

    const first = await rt.handleWrcSubmitReference({ raw: 'P-TEST01-10005X', requestInstanceId: 'req-1' })
    if (!first.success || !first.result.ok || !first.acceptanceToken) {
      throw new Error(`first submission: ${JSON.stringify(first)}`)
    }
    const accepted = await rt.handleWrcAcceptReference({ acceptanceToken: first.acceptanceToken })
    expect(accepted).toMatchObject({ success: true, result: { accepted: true, consumed: true } })

    const again = await rt.handleWrcSubmitReference({ raw: 'P-TEST01-10005X', requestInstanceId: 'req-2' })
    expect(again.success).toBe(true)
    if (!again.success || again.result.ok) throw new Error('second submission must be refused')
    expect({ gate: again.result.gate, reason: again.result.reason }).toEqual({ gate: 3, reason: 'CONSUMED' })
    expect(again.view).toMatchObject({ kind: 'refusal', headline: 'This one-time offer has already been used.' })
  })

  it('declining releases the reservation at once and spends the token', async () => {
    const rt = await import('../wrcRuntime')
    setWrcBuildFlavorForTests('wrc-test')
    await rt.initWrcClient()
    // A fresh use-limit store with the registry's own declarations, so the
    // reservation state can be read directly.
    const useLimits = createMemoryUseLimitStore()
    createWrcTestRegistry().seedUseLimits(useLimits)
    rt.setWrcUseLimitStoreForTests(useLimits)
    try {
      const first = await rt.handleWrcSubmitReference({ raw: 'P-TEST01-10005X', requestInstanceId: 'req-d1' })
      if (!first.success || !first.result.ok || !first.acceptanceToken) {
        throw new Error(`first submission: ${JSON.stringify(first)}`)
      }
      expect(first.view.kind).toBe('offer')
      expect(useLimits.read('TEST01', '10005')?.state).toBe('claimed')

      expect(await rt.handleWrcDeclineReference({ acceptanceToken: first.acceptanceToken })).toEqual({
        success: true,
        result: { declined: true },
      })
      expect(useLimits.read('TEST01', '10005')).toMatchObject({ state: 'active', uses_taken: 0 })
      expect(await rt.handleWrcDeclineReference({ acceptanceToken: first.acceptanceToken })).toEqual({
        success: false,
        error: 'acceptance_unknown',
      })
    } finally {
      rt.setWrcUseLimitStoreForTests(null)
    }
  })
})
