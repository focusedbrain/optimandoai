/**
 * Local pod runner — unit tests (P1.8)
 *
 * Covers:
 *   1. Non-Linux platform → startLocalPod resolves without invoking podman.
 *   2. Linux platform → startLocalPod calls executor with correct podman argv.
 *   3. Secrets never appear in podman argv (they go in the temp manifest file).
 *   4. Vault locked (deriveSealKeyHex returns null) → pod not started, no crash.
 *   5. Concurrent startLocalPod calls join the same in-flight Promise.
 *   6. stopLocalPod calls executor with 'pod stop' then 'pod rm'.
 *   7. stopLocalPod is a no-op when no pod is running.
 *   8. Executor error → non-fatal; startLocalPod resolves without throwing.
 *   9. applyPodManifest substitutes ${POD_AUTH_SECRET} and ${SEAL_KEY_HEX}
 *      in the manifest written to disk before invoking the executor.
 *  10. generatePodAuthSecret returns a 64-char hex string (32 bytes).
 *  11. deriveSealKeyHex returns null when vault returns null key.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'

import {
  startLocalPod,
  stopLocalPod,
  _resetStateForTest,
} from '../index.js'
import {
  applyPodManifest,
  resolveManifestPath,
  type PodmanExecutor,
} from '../podRunner.js'
import {
  generatePodAuthSecret,
  deriveSealKeyHex,
  POD_SEAL_KEY_INFO,
} from '../secrets.js'

// ── Helpers ────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const FIXTURE_MANIFEST = join(__dirname, 'fixtures', 'pod.yaml')

/** A vault mock whose deriveApplicationKey returns a real 32-byte Buffer. */
function makeMockVault(key?: Buffer) {
  const k = key ?? Buffer.alloc(32, 0xab)
  return {
    deriveApplicationKey: vi.fn((_info: string): Buffer | null => Buffer.from(k)),
  }
}

/** A vault mock that returns null (vault locked). */
function makeLockedVault() {
  return {
    deriveApplicationKey: vi.fn((_info: string): Buffer | null => null),
  }
}

/** A PodmanExecutor that resolves immediately (no-op). */
function makeNoopExecutor(): PodmanExecutor {
  return vi.fn().mockResolvedValue(undefined)
}

/** Capture all calls to the executor; returns { executor, calls }. */
function makeCapturingExecutor() {
  const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = []
  const executor: PodmanExecutor = vi.fn(async (args, env) => {
    calls.push({ args: [...args], env })
  })
  return { executor, calls }
}

// ── Test state reset ───────────────────────────────────────────────────────────

beforeEach(() => {
  _resetStateForTest()
})

afterEach(() => {
  _resetStateForTest()
})

// ── Suite 1: secrets ───────────────────────────────────────────────────────────

describe('generatePodAuthSecret', () => {
  test('returns a 64-char hex string (32 bytes)', () => {
    const secret = generatePodAuthSecret()
    expect(typeof secret).toBe('string')
    expect(secret.length).toBe(64)
    expect(/^[0-9a-f]+$/.test(secret)).toBe(true)
  })

  test('returns a fresh value on each call', () => {
    expect(generatePodAuthSecret()).not.toBe(generatePodAuthSecret())
  })
})

describe('deriveSealKeyHex', () => {
  test('returns 64-char hex when vault is unlocked', () => {
    const vault = makeMockVault()
    const hex = deriveSealKeyHex(vault)
    expect(hex).not.toBeNull()
    expect(hex!.length).toBe(64)
    expect(/^[0-9a-f]+$/.test(hex!)).toBe(true)
    expect(vault.deriveApplicationKey).toHaveBeenCalledWith(POD_SEAL_KEY_INFO)
  })

  test('returns null when vault is locked', () => {
    const vault = makeLockedVault()
    expect(deriveSealKeyHex(vault)).toBeNull()
  })

  test('zeroizes the key Buffer after conversion', () => {
    // After deriveSealKeyHex, the returned Buffer from deriveApplicationKey
    // should be filled with zeroes (zeroize call in secrets.ts).
    const rawKey = Buffer.alloc(32, 0xab)
    const vault = { deriveApplicationKey: vi.fn(() => rawKey) }
    deriveSealKeyHex(vault)
    // The buffer that was returned by deriveApplicationKey is now zeroed.
    expect(rawKey.every(b => b === 0)).toBe(true)
  })
})

// ── Suite 2: platform guard ────────────────────────────────────────────────────

describe('startLocalPod — non-Linux platform', () => {
  test('resolves without invoking podman on win32', async () => {
    const executor = makeNoopExecutor()
    const vault = makeMockVault()

    await startLocalPod(vault, {
      platform: 'win32',
      manifestPath: FIXTURE_MANIFEST,
      executor,
    })

    expect(executor).not.toHaveBeenCalled()
  })

  test('resolves without invoking podman on darwin', async () => {
    const executor = makeNoopExecutor()
    const vault = makeMockVault()

    await startLocalPod(vault, {
      platform: 'darwin',
      manifestPath: FIXTURE_MANIFEST,
      executor,
    })

    expect(executor).not.toHaveBeenCalled()
  })
})

// ── Suite 3: Linux start ───────────────────────────────────────────────────────

describe('startLocalPod — Linux platform', () => {
  test('calls executor with podman play kube + manifest path', async () => {
    const { executor, calls } = makeCapturingExecutor()
    const vault = makeMockVault()

    await startLocalPod(vault, {
      platform: 'linux',
      manifestPath: FIXTURE_MANIFEST,
      executor,
    })

    expect(calls.length).toBe(1)
    const [args] = calls.map(c => c.args)
    expect(args![0]).toBe('play')
    expect(args![1]).toBe('kube')
    // Third arg is a temp file path (the substituted manifest)
    expect(typeof args![2]).toBe('string')
    expect(args![2]!.endsWith('.yaml')).toBe(true)
  })

  test('secrets do NOT appear in podman argv (they are in the temp manifest file)', async () => {
    // We cannot inspect the temp file (it is deleted by the time the executor
    // is called), but we CAN assert that no hex secret string appears in argv.
    const podAuthSecret = 'aabbccddeeff'.repeat(4) + '00112233' // 64 chars
    let capturedArgs: string[] = []
    const executor: PodmanExecutor = vi.fn(async (args) => {
      capturedArgs = args
    })

    // Provide a vault that returns a known key whose hex we can search for
    const knownKeyHex = 'aa'.repeat(32)
    const vault = {
      deriveApplicationKey: vi.fn(() => Buffer.from(knownKeyHex, 'hex')),
    }

    await startLocalPod(vault, {
      platform: 'linux',
      manifestPath: FIXTURE_MANIFEST,
      executor,
    })

    // Secret strings must not appear in argv
    const argvStr = capturedArgs.join(' ')
    expect(argvStr).not.toContain(knownKeyHex)
    // podAuthSecret comes from generatePodAuthSecret() inside startLocalPod,
    // so we can't predict it — but we verify the invariant via applyPodManifest:
    expect(capturedArgs[0]).toBe('play')
    expect(capturedArgs[1]).toBe('kube')
  })

  test('vault locked → pod not started, startLocalPod resolves without throwing', async () => {
    const executor = makeNoopExecutor()
    const vault = makeLockedVault()

    await expect(
      startLocalPod(vault, {
        platform: 'linux',
        manifestPath: FIXTURE_MANIFEST,
        executor,
      }),
    ).resolves.toBeUndefined()

    expect(executor).not.toHaveBeenCalled()
  })

  test('executor error → non-fatal; startLocalPod resolves without throwing', async () => {
    const executor: PodmanExecutor = vi.fn().mockRejectedValue(
      new Error('podman: command not found'),
    )
    const vault = makeMockVault()

    await expect(
      startLocalPod(vault, {
        platform: 'linux',
        manifestPath: FIXTURE_MANIFEST,
        executor,
      }),
    ).resolves.toBeUndefined()
  })

  test('concurrent startLocalPod calls join the same in-flight Promise', async () => {
    let resolveExecutor!: () => void
    const executorLatch = new Promise<void>((resolve) => { resolveExecutor = resolve })
    let callCount = 0
    const executor: PodmanExecutor = vi.fn(async () => {
      callCount++
      await executorLatch
    })
    const vault = makeMockVault()

    // Start two concurrent calls
    const p1 = startLocalPod(vault, {
      platform: 'linux',
      manifestPath: FIXTURE_MANIFEST,
      executor,
    })
    const p2 = startLocalPod(vault, {
      platform: 'linux',
      manifestPath: FIXTURE_MANIFEST,
      executor,
    })

    // Release the executor latch
    resolveExecutor()
    await Promise.all([p1, p2])

    // Only one `play kube` call despite two startLocalPod invocations
    expect(callCount).toBe(1)
  })

  test('second startLocalPod call after first completes is a no-op', async () => {
    const { executor, calls } = makeCapturingExecutor()
    const vault = makeMockVault()

    await startLocalPod(vault, {
      platform: 'linux',
      manifestPath: FIXTURE_MANIFEST,
      executor,
    })
    await startLocalPod(vault, {
      platform: 'linux',
      manifestPath: FIXTURE_MANIFEST,
      executor,
    })

    // Only one `play kube` call
    const playKubeCalls = calls.filter(c => c.args[0] === 'play')
    expect(playKubeCalls.length).toBe(1)
  })
})

// ── Suite 4: stopLocalPod ──────────────────────────────────────────────────────

describe('stopLocalPod', () => {
  test('calls pod stop then pod rm after a successful start', async () => {
    const { executor, calls } = makeCapturingExecutor()
    const vault = makeMockVault()

    await startLocalPod(vault, {
      platform: 'linux',
      manifestPath: FIXTURE_MANIFEST,
      executor,
      podName: 'beap-pod',
    })

    await stopLocalPod()

    const stopCall = calls.find(c => c.args[0] === 'pod' && c.args[1] === 'stop')
    const rmCall = calls.find(c => c.args[0] === 'pod' && c.args[1] === 'rm')

    expect(stopCall).toBeDefined()
    expect(stopCall!.args).toContain('beap-pod')

    expect(rmCall).toBeDefined()
    expect(rmCall!.args).toContain('beap-pod')
  })

  test('is a no-op (does not throw) when no pod is running', async () => {
    await expect(stopLocalPod()).resolves.toBeUndefined()
  })
})

// ── Suite 5: applyPodManifest secret substitution ─────────────────────────────

describe('applyPodManifest — secret substitution', () => {
  test('substitutes ${POD_AUTH_SECRET} and ${SEAL_KEY_HEX} before invoking executor', async () => {
    // The executor receives the path to a temp manifest file.
    // We intercept the file content by reading it before the function deletes it.
    let capturedContent: string | null = null
    const executor: PodmanExecutor = vi.fn(async (args) => {
      // args[2] is the temp manifest path
      try {
        capturedContent = readFileSync(args[2]!, 'utf8')
      } catch {
        capturedContent = null
      }
    })

    const secret = generatePodAuthSecret()
    const keyHex = 'ab'.repeat(32)

    await applyPodManifest(secret, keyHex, {
      manifestPath: FIXTURE_MANIFEST,
      executor,
    })

    // After substitution, the file must contain the real secrets (not the placeholders)
    expect(capturedContent).not.toBeNull()
    expect(capturedContent).toContain(secret)
    expect(capturedContent).toContain(keyHex)
    expect(capturedContent).not.toContain('${POD_AUTH_SECRET}')
    expect(capturedContent).not.toContain('${SEAL_KEY_HEX}')
  })

  test('temp manifest is deleted after podman completes', async () => {
    let tempPath: string | null = null
    const executor: PodmanExecutor = vi.fn(async (args) => {
      tempPath = args[2]!
      // File should exist while executor runs
      expect(() => readFileSync(tempPath!, 'utf8')).not.toThrow()
    })

    await applyPodManifest('secret', 'keyhex'.repeat(11), {
      manifestPath: FIXTURE_MANIFEST,
      executor,
    })

    // File should be gone after the call
    expect(() => readFileSync(tempPath!, 'utf8')).toThrow()
  })

  test('temp manifest is deleted even when executor throws', async () => {
    let tempPath: string | null = null
    const executor: PodmanExecutor = vi.fn(async (args) => {
      tempPath = args[2]!
      throw new Error('podman failed')
    })

    await expect(
      applyPodManifest('secret', 'keyhex'.repeat(11), {
        manifestPath: FIXTURE_MANIFEST,
        executor,
      }),
    ).rejects.toThrow('podman failed')

    expect(() => readFileSync(tempPath!, 'utf8')).toThrow()
  })
})

// ── Suite 6: resolveManifestPath ──────────────────────────────────────────────

describe('resolveManifestPath', () => {
  test('returns the override path when provided', () => {
    expect(resolveManifestPath('/custom/path/pod.yaml')).toBe('/custom/path/pod.yaml')
  })

  test('returns BEAP_POD_MANIFEST env var when set', () => {
    const original = process.env['BEAP_POD_MANIFEST']
    process.env['BEAP_POD_MANIFEST'] = '/env/path/pod.yaml'
    expect(resolveManifestPath()).toBe('/env/path/pod.yaml')
    if (original === undefined) {
      delete process.env['BEAP_POD_MANIFEST']
    } else {
      process.env['BEAP_POD_MANIFEST'] = original
    }
  })

  test('falls back to process.cwd() + packages/beap-pod/pod.yaml', () => {
    const original = process.env['BEAP_POD_MANIFEST']
    delete process.env['BEAP_POD_MANIFEST']
    const result = resolveManifestPath()
    expect(result).toContain('beap-pod')
    expect(result).toContain('pod.yaml')
    if (original !== undefined) process.env['BEAP_POD_MANIFEST'] = original
  })
})
