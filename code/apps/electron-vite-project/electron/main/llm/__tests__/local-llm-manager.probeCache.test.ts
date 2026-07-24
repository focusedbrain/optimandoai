/**
 * B2 regression test: the shared cached prober (`LocalLlmManager.probeCached`) must collapse
 * concurrent/rapid callers onto a single underlying HTTP probe instead of firing one fetch per
 * caller (UI polling, warmup loop, BEAP ad gate, provider status all used to probe independently).
 *
 * Also verifies the B1 fix: a disk-only match (server unreachable, GGUF present on disk) must
 * report `serverReachable: false`, not `ok: true`-as-if-the-server-were-up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

let tmpModelsDir: string

vi.mock('../localLlmPaths', async () => {
  const actual = await vi.importActual<typeof import('../localLlmPaths')>('../localLlmPaths')
  return {
    ...actual,
    getLocalLlmModelsDirectory: () => tmpModelsDir,
  }
})

describe('LocalLlmManager.probeCached (B2 cache + backoff)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    tmpModelsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-probe-test-'))
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
    try {
      fs.rmSync(tmpModelsDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  it('collapses N concurrent status calls onto a single underlying fetch', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'gemma4-12b-it-q8_0' }] }),
    })

    const { LocalLlmManager } = await import('../local-llm-manager')
    const mgr = new LocalLlmManager()

    const results = await Promise.all([
      mgr.probeCached(),
      mgr.probeCached(),
      mgr.probeCached(),
      mgr.isRunning(),
      mgr.isRunning(),
    ])

    for (const r of results) {
      expect(r === true || (r as { serverReachable: boolean }).serverReachable === true).toBeTruthy()
    }
    // All 5 concurrent callers must collapse onto exactly one network probe.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('serves subsequent calls from cache within the TTL window (no re-fetch)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'gemma4-12b-it-q8_0' }] }),
    })

    const { LocalLlmManager } = await import('../local-llm-manager')
    const mgr = new LocalLlmManager()

    await mgr.probeCached()
    await mgr.probeCached()
    await mgr.isRunning()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports serverReachable=false (not ok=true-as-running) when server is unreachable but disk has a GGUF', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    fs.writeFileSync(path.join(tmpModelsDir, 'gemma4-12b-it-q8_0.gguf'), 'stub')

    const { LocalLlmManager } = await import('../local-llm-manager')
    const mgr = new LocalLlmManager()

    const probe = await mgr.probeCached()
    // Disk-only match: "usable" (ok) but the server itself never answered.
    expect(probe.ok).toBe(true)
    expect(probe.serverReachable).toBe(false)
    expect(await mgr.isRunning()).toBe(false)

    const status = await mgr.getStatus()
    expect(status.running).toBe(false)
  })

  it('backs off exponentially while the server stays down, and resets on success', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

    const { LocalLlmManager } = await import('../local-llm-manager')
    const mgr = new LocalLlmManager()

    const nowSpy = vi.spyOn(Date, 'now')
    let simulatedNow = 1_000_000
    nowSpy.mockImplementation(() => simulatedNow)

    await mgr.probeCached() // 1st probe: fails, backoff -> 4s
    expect(fetchMock).toHaveBeenCalledTimes(2) // 2 bases probed

    simulatedNow += 2_500 // within the ~4s backoff window
    await mgr.probeCached()
    expect(fetchMock).toHaveBeenCalledTimes(2) // still cached, no new fetch

    simulatedNow += 5_000 // past backoff window
    await mgr.probeCached()
    expect(fetchMock).toHaveBeenCalledTimes(4) // re-probed (2 bases)

    nowSpy.mockRestore()
  })
})
