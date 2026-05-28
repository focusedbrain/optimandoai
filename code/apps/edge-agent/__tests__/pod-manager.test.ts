import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { PodManager, setPodmanRunnerForTests } from '../src/pod-manager.js'
import { AgentStorage } from '../src/storage.js'
import { loadConfig } from '../src/config.js'
import type { PodmanRunner } from '../src/podman.js'

describe('PodManager', () => {
  let dir: string
  const commands: string[][] = []

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'edge-pod-mgr-'))
    commands.length = 0
    const runner: PodmanRunner = async (args) => {
      commands.push(args)
      if (args[0] === 'play' && args[1] === 'kube') {
        return { code: 0, stdout: '', stderr: '' }
      }
      if (args[0] === 'image' && args[1] === 'inspect') {
        return { code: 0, stdout: 'sha256:deadbeef\n', stderr: '' }
      }
      if (args[0] === 'exec') {
        return { code: 0, stdout: '', stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    }
    setPodmanRunnerForTests(runner)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true })),
    )
  })

  afterEach(() => {
    setPodmanRunnerForTests(null)
    rmSync(dir, { recursive: true, force: true })
    vi.unstubAllGlobals()
  })

  test('refuses start when digest mismatches expected file', async () => {
    const storage = new AgentStorage(dir)
    await storage.saveState({
      phase: 'paired',
      accessToken: 'token',
      ssoSub: 'user',
    })
    const digestPath = join(dir, 'digest.json')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(
      digestPath,
      JSON.stringify({ 'beap-components': { dev: 'sha256:expected' } }),
    )

    const mgr = new PodManager(
      { ...loadConfig(), stateDir: dir },
      storage,
      {
        verifyDigest: async () => {
          const { verifyAgentImageDigest } = await import('../src/image-digest.js')
          return verifyAgentImageDigest('beap-components:dev', {
            digestPath,
            inspect: async () => 'sha256:other',
          })
        },
        requestAttestation: async () => ({ jwt: 'jwt' }),
        loadManifest: async () => 'apiVersion: v1',
      },
    )

    await mgr.startPod()
    expect(mgr.getState()).toBe('start_failed')
    expect(mgr.getStatus().lastErrorCode).toBe('image_digest_mismatch')
    expect(commands.some((c) => c[0] === 'play')).toBe(false)
  })

  test('successful start invokes play kube and persists pod identity', async () => {
    const storage = new AgentStorage(dir)
    await storage.saveState({
      phase: 'paired',
      accessToken: 'token',
      ssoSub: 'user',
    })
    const digestPath = join(dir, 'digest.json')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(
      digestPath,
      JSON.stringify({ 'beap-components': { dev: 'sha256:good' } }),
    )

    const mgr = new PodManager(
      { ...loadConfig(), stateDir: dir },
      storage,
      {
        verifyDigest: async () => ({ expected: 'sha256:good', actual: 'sha256:good' }),
        requestAttestation: async () => ({ jwt: 'jwt' }),
        loadManifest: async () => 'name: ${EDGE_POD_ID}',
        playKube: async () => {
          commands.push(['play', 'kube', '-'])
          return { ok: true, stderr: '' }
        },
      },
    )

    await mgr.startPod()
    expect(mgr.getState()).toBe('running')
    expect(commands.some((c) => c[0] === 'play' && c[1] === 'kube')).toBe(true)
    const saved = await storage.loadState()
    expect(saved.edgePodId).toBeTruthy()
    expect(saved.podIdentityKeys?.[saved.edgePodId!]?.privateKeyHex).toHaveLength(64)
    await mgr.stopPod()
    expect(mgr.getState()).toBe('stopped')
  })
})
