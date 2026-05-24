/**
 * GpuStatus — deterministic fetch/exec mocks (Vitest defaults set WRDESK_ALLOW_CPU_INFERENCE=1 in root setup).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/gpu-status-test',
    getAppPath: () => '/tmp/gpu-status-test',
  },
}))

const execMock = vi.fn()
vi.mock('child_process', () => ({
  exec: (...args: unknown[]) => execMock(...args),
}))

import { clearGpuStatusCache, getGpuInferenceStatusRemote, getGpuStatus } from '../gpuStatus'

function mockFetchHandlers(
  byUrlPrefix: Record<string, (url: string) => { ok: boolean; json: unknown } | null>,
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input)
      for (const [prefix, fn] of Object.entries(byUrlPrefix)) {
        if (url.startsWith(prefix)) {
          const r = fn(url)
          if (r == null) continue
          return {
            ok: r.ok,
            status: r.ok ? 200 : 503,
            json: async () => r.json,
          } as Response
        }
      }
      return { ok: false, status: 503, json: async () => ({}) } as Response
    }),
  )
}

describe('gpuStatus', () => {
  const origPlatform = process.platform

  beforeEach(() => {
    vi.unstubAllGlobals()
    execMock.mockReset()
    clearGpuStatusCache()
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
  })

  describe('Darwin (no NVIDIA-SMI prerequisite)', () => {
    beforeEach(() => {
      execMock.mockImplementation(() => {
        throw new Error('exec should not run on mocked darwin NVIDIA path tests')
      })
    })

    it('returns OLLAMA_NOT_RUNNING when /api/version is unreachable everywhere', async () => {
      mockFetchHandlers({
        'http://127.0.0.1:11434/': () => ({ ok: false, json: {} }),
        'http://localhost:11434/': () => ({ ok: false, json: {} }),
      })
      const s = await getGpuStatus()
      expect(s.available).toBe(false)
      expect(s.reason).toBe('OLLAMA_NOT_RUNNING')
    })

    it('returns available:true when ps match shows full VRAM residency', async () => {
      mockFetchHandlers({
        'http://127.0.0.1:11434/api/version': () => ({ ok: true, json: { version: '0.5.0' } }),
        'http://127.0.0.1:11434/api/tags': () => ({
          ok: true,
          json: { models: [{ name: 'mistral:7b' }] },
        }),
        'http://127.0.0.1:11434/api/ps': () => ({
          ok: true,
          json: {
            models: [{ name: 'mistral:7b', size: 1_000_000_000, size_vram: 1_000_000_000 }],
          },
        }),
      })

      const s = await getGpuStatus()
      expect(s.available).toBe(true)
      expect(s.reason).toBe(null)
      expect(s.detail.activeModelOnGpu).toBe(true)
    })

    it('returns MODEL-ish failure when loaded with size_vram===0', async () => {
      mockFetchHandlers({
        'http://127.0.0.1:11434/api/version': () => ({ ok: true, json: { version: '0.5.0' } }),
        'http://127.0.0.1:11434/api/tags': () => ({
          ok: true,
          json: { models: [{ name: 'heavy:latest' }] },
        }),
        'http://127.0.0.1:11434/api/ps': () => ({
          ok: true,
          json: {
            models: [{ name: 'heavy:latest', size: 8_000_000_000, size_vram: 0 }],
          },
        }),
      })

      const s = await getGpuStatus()
      expect(s.available).toBe(false)
      expect(s.reason).toBeDefined()
      expect(['MODEL_TOO_LARGE_FOR_GPU', 'GPU_NOT_DETECTED_BY_OLLAMA']).toContain(s.reason)
    })

    it('memoizes identical getGpuStatus results for TTL window', async () => {
      mockFetchHandlers({
        'http://127.0.0.1:11434/api/version': () => ({ ok: true, json: { version: '0.5.4' } }),
        'http://127.0.0.1:11434/api/tags': () => ({
          ok: true,
          json: { models: [{ name: 'x:1' }] },
        }),
        'http://127.0.0.1:11434/api/ps': () => ({
          ok: true,
          json: { models: [{ name: 'x:1', size: 100, size_vram: 100 }] },
        }),
      })

      const f = fetch as unknown as ReturnType<typeof vi.fn>
      await getGpuStatus()
      const callsAfterFirst = f.mock.calls.length
      await getGpuStatus()
      expect(f.mock.calls.length).toBe(callsAfterFirst)
    })
  })

  describe('Linux + missing nvidia-smi', () => {
    beforeEach(() => {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
      execMock.mockImplementation((_cmd: string, _opts: unknown, cb: (err: Error) => void) => {
        cb(new Error("spawn ENOENT"))
      })
    })

    it('short-circuits with NVIDIA_DRIVER_MISSING', async () => {
      mockFetchHandlers({})
      const s = await getGpuStatus()
      expect(s.reason).toBe('NVIDIA_DRIVER_MISSING')
      expect(s.available).toBe(false)
    })
  })

  describe('remote Ollama probe', () => {
    beforeEach(() => {
      execMock.mockImplementation(() => {
        throw new Error('unexpected exec')
      })
    })

    it('checks LAN origin without invoking NVIDIA-SMI', async () => {
      mockFetchHandlers({
        'http://10.0.0.50:11434/api/version': () => ({ ok: true, json: { version: '0.9.9' } }),
        'http://10.0.0.50:11434/api/tags': () => ({
          ok: true,
          json: { models: [{ name: 'qwen:mini' }] },
        }),
        'http://10.0.0.50:11434/api/ps': () => ({
          ok: true,
          json: {
            models: [{ name: 'qwen:mini', size: 900_000_000, size_vram: 900_000_000 }],
          },
        }),
      })

      const s = await getGpuInferenceStatusRemote('http://10.0.0.50:11434/', 'qwen:mini')
      expect(s.available).toBe(true)
      expect(execMock).not.toHaveBeenCalled()
    })
  })

  afterAll(() => {
    Object.defineProperty(process, 'platform', { value: origPlatform, configurable: true })
  })
})
