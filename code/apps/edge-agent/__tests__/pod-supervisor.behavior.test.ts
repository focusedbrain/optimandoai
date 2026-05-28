import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  AGENT_SUPERVISOR_STUCK_THRESHOLD,
  pollAgentPodSupervisorOnceForTest,
  recordProbeOutcomeForTest,
  _resetAgentSupervisorForTest,
} from '../src/pod-supervisor.js'
import type { PodmanRunner } from '../src/podman.js'
import { setPodmanRunnerForTests } from '../src/podman.js'
import { AgentStorage } from '../src/storage.js'

describe('Agent pod supervisor behavior', () => {
  beforeEach(() => {
    _resetAgentSupervisorForTest()
  })

  afterEach(() => {
    _resetAgentSupervisorForTest()
    setPodmanRunnerForTests(null)
    vi.unstubAllGlobals()
  })

  test('stuck-health threshold fires after consecutive probe failures', () => {
    let stuck = false
    for (let i = 0; i < AGENT_SUPERVISOR_STUCK_THRESHOLD; i++) {
      stuck = recordProbeOutcomeForTest('depackager', false)
    }
    expect(stuck).toBe(true)
    expect(recordProbeOutcomeForTest('depackager', true)).toBe(false)
  })

  test('replaces exited container', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edge-sup-'))
    const storage = new AgentStorage(dir)
    let killCount = 0
    const depackager = 'beap-pod-remote-edge-depackager'

    const runner: PodmanRunner = async (args) => {
      if (args[0] === 'inspect' && args[1] === depackager) {
        return { code: 0, stdout: 'exited\n', stderr: '' }
      }
      if (args[0] === 'inspect') {
        return { code: 0, stdout: 'running\n', stderr: '' }
      }
      if (args[0] === 'kill') {
        killCount += 1
        return { code: 0, stdout: '', stderr: '' }
      }
      if (args[0] === 'start') {
        return { code: 0, stdout: '', stderr: '' }
      }
      if (args[0] === 'exec') {
        return { code: 0, stdout: '', stderr: '' }
      }
      return { code: 0, stdout: '', stderr: '' }
    }
    setPodmanRunnerForTests(runner)

    const onTeardown = vi.fn()
    await pollAgentPodSupervisorOnceForTest(storage, onTeardown)

    expect(killCount).toBeGreaterThanOrEqual(1)
    expect(onTeardown).not.toHaveBeenCalled()
    rmSync(dir, { recursive: true, force: true })
  })

  test('teardown on replacement budget exhaustion', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'edge-sup-'))
    const storage = new AgentStorage(dir)
    const ingestor = 'beap-pod-remote-edge-ingestor'
    const { recordReplacement, AGENT_MAX_REPLACEMENTS } = await import(
      '../src/pod-replacement-budget.js'
    )
    const now = Date.now()
    for (let i = 0; i < AGENT_MAX_REPLACEMENTS; i++) {
      recordReplacement('ingestor', now - (AGENT_MAX_REPLACEMENTS - i) * 1000)
    }

    const runner: PodmanRunner = async (args) => {
      if (args[0] === 'inspect' && args[1] === ingestor) {
        return { code: 0, stdout: 'exited\n', stderr: '' }
      }
      if (args[0] === 'inspect') return { code: 0, stdout: 'running\n', stderr: '' }
      if (args[0] === 'kill' || args[0] === 'start') return { code: 0, stdout: '', stderr: '' }
      if (args[0] === 'exec') return { code: 0, stdout: 'ok', stderr: '' }
      return { code: 0, stdout: '', stderr: '' }
    }
    setPodmanRunnerForTests(runner)

    let teardownKind: string | null = null
    await pollAgentPodSupervisorOnceForTest(storage, async (kind) => {
      teardownKind = kind
    })

    expect(teardownKind).toBe('replacement_exhausted')
    rmSync(dir, { recursive: true, force: true })
  })
})
