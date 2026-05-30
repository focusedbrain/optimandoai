/**
 * Container health — Podman Health preference and exec-layer tolerance.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'

vi.mock('../supervisor/podmanLocal.js', () => ({
  inspectPodmanHealthStatus: vi.fn(),
  probeContainerHealthExec: vi.fn(),
}))

import {
  pollContainerHealthOutcome,
  resetContainerHealthStreak,
} from '../containerHealth.js'
import {
  inspectPodmanHealthStatus,
  probeContainerHealthExec,
} from '../supervisor/podmanLocal.js'

const inspectHealthMock = vi.mocked(inspectPodmanHealthStatus)
const execMock = vi.mocked(probeContainerHealthExec)

describe('pollContainerHealthOutcome', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetContainerHealthStreak()
    inspectHealthMock.mockResolvedValue('none')
    execMock.mockResolvedValue({ kind: 'ok' })
  })

  test('returns ok when Podman aggregated health is healthy (no exec)', async () => {
    inspectHealthMock.mockResolvedValue('healthy')
    const outcome = await pollContainerHealthOutcome('beap-pod-sealer', 18103)
    expect(outcome).toBe('ok')
    expect(execMock).not.toHaveBeenCalled()
  })

  test('returns genuine_fail when Podman aggregated health is unhealthy', async () => {
    inspectHealthMock.mockResolvedValue('unhealthy')
    const outcome = await pollContainerHealthOutcome('beap-pod-sealer', 18103)
    expect(outcome).toBe('genuine_fail')
    expect(execMock).not.toHaveBeenCalled()
  })

  test('returns inconclusive on exec-layer exit 125', async () => {
    execMock.mockResolvedValue({ kind: 'exec_layer', exitCode: 125 })
    const outcome = await pollContainerHealthOutcome('beap-pod-sealer', 18103)
    expect(outcome).toBe('inconclusive')
  })

  test('returns genuine_fail on HTTP non-2xx exec exit 2', async () => {
    execMock.mockResolvedValue({ kind: 'http_unhealthy', exitCode: 2 })
    const outcome = await pollContainerHealthOutcome('beap-pod-sealer', 18103)
    expect(outcome).toBe('genuine_fail')
  })
})
