import { describe, test, expect, vi, beforeEach } from 'vitest'

import * as podReconcile from '../podReconcile.js'
import * as podExec from '../podExec.js'

vi.mock('../podContainerCompleteness.js', () => ({
  checkRequiredPodContainersReady: vi.fn(),
}))

import { checkRequiredPodContainersReady } from '../podContainerCompleteness.js'

describe('reconcilePodBeforeStart', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  test('no-op when pod does not exist', async () => {
    vi.spyOn(podExec, 'runPodmanCli').mockResolvedValue({ code: 1, stdout: '', stderr: '' })
    const executor = vi.fn().mockResolvedValue(undefined)
    await podReconcile.reconcilePodBeforeStart('beap-pod', executor)
    expect(executor).not.toHaveBeenCalled()
  })

  test('force-removes existing incomplete pod before apply', async () => {
    vi.spyOn(podExec, 'runPodmanCli').mockResolvedValue({ code: 0, stdout: '', stderr: '' })
    vi.mocked(checkRequiredPodContainersReady).mockResolvedValue({
      ok: false,
      podName: 'beap-pod',
      checked: [],
      issues: [{ role: 'ingestor', containerName: 'beap-pod-ingestor', detail: 'missing' }],
      reason: 'required_pod_containers_incomplete pod=beap-pod issues=ingestor:missing',
    })
    const executor = vi.fn().mockResolvedValue(undefined)
    await podReconcile.reconcilePodBeforeStart('beap-pod', executor)
    expect(executor).toHaveBeenCalledWith(['pod', 'rm', '-f', 'beap-pod'], expect.any(Object))
  })

  test('force-removes healthy prior pod (new session secrets)', async () => {
    vi.spyOn(podExec, 'runPodmanCli').mockResolvedValue({ code: 0, stdout: '', stderr: '' })
    vi.mocked(checkRequiredPodContainersReady).mockResolvedValue({
      ok: true,
      podName: 'beap-pod',
      checked: [],
    })
    const executor = vi.fn().mockResolvedValue(undefined)
    await podReconcile.reconcilePodBeforeStart('beap-pod', executor)
    expect(executor).toHaveBeenCalledWith(['pod', 'rm', '-f', 'beap-pod'], expect.any(Object))
  })
})

describe('podExistsLocally', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  test('returns true when podman pod exists exits 0', async () => {
    vi.spyOn(podExec, 'runPodmanCli').mockResolvedValue({ code: 0, stdout: '', stderr: '' })
    await expect(podReconcile.podExistsLocally('beap-pod')).resolves.toBe(true)
    expect(podExec.runPodmanCli).toHaveBeenCalledWith(['pod', 'exists', 'beap-pod'], {
      timeoutMs: 15_000,
    })
  })

  test('returns false when podman pod exists exits non-zero', async () => {
    vi.spyOn(podExec, 'runPodmanCli').mockResolvedValue({ code: 1, stdout: '', stderr: '' })
    await expect(podReconcile.podExistsLocally('beap-pod')).resolves.toBe(false)
  })
})
