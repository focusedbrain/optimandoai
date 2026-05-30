/**
 * Required pod container completeness gate — fail closed when any manifest role is down.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'

vi.mock('../supervisor/podmanLocal.js', () => ({
  inspectContainerState: vi.fn(),
}))

vi.mock('../containerHealth.js', () => ({
  pollContainerHealthOutcome: vi.fn(),
  recordHealthyContainer: vi.fn(),
  recordGenuineHealthFailure: vi.fn(),
  resetContainerHealthStreak: vi.fn(),
}))

import { checkRequiredPodContainersReady } from '../podContainerCompleteness.js'
import { inspectContainerState } from '../supervisor/podmanLocal.js'
import {
  pollContainerHealthOutcome,
  recordGenuineHealthFailure,
} from '../containerHealth.js'
import { DEFAULT_POD_NAME } from '../podConstants.js'

const inspectMock = vi.mocked(inspectContainerState)
const pollMock = vi.mocked(pollContainerHealthOutcome)
const streakMock = vi.mocked(recordGenuineHealthFailure)

describe('checkRequiredPodContainersReady', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    inspectMock.mockResolvedValue('running')
    pollMock.mockResolvedValue('ok')
    streakMock.mockReturnValue(3)
  })

  test('LOCAL_HOST — passes when all five manifest containers are running and healthy', async () => {
    const result = await checkRequiredPodContainersReady(DEFAULT_POD_NAME)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.checked.map((c) => c.role)).toEqual([
        'ingestor',
        'validator',
        'depackager',
        'pdf-parser',
        'sealer',
      ])
    }
    expect(inspectMock).toHaveBeenCalledTimes(5)
    expect(pollMock).toHaveBeenCalledTimes(5)
  })

  test('fail closed when any required container is missing', async () => {
    inspectMock.mockImplementation(async (name) =>
      name.includes('validator') ? 'missing' : 'running',
    )

    const result = await checkRequiredPodContainersReady(DEFAULT_POD_NAME)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues).toEqual([
        expect.objectContaining({ role: 'validator', detail: 'missing' }),
      ])
      expect(result.reason).toContain('required_pod_containers_incomplete')
    }
  })

  test('steady — exec-layer inconclusive does not mark unhealthy', async () => {
    pollMock.mockImplementation(async (name) =>
      String(name).includes('sealer') ? 'inconclusive' : 'ok',
    )

    const result = await checkRequiredPodContainersReady(DEFAULT_POD_NAME)
    expect(result.ok).toBe(true)
  })

  test('steady — sustained genuine failures mark unhealthy', async () => {
    pollMock.mockImplementation(async (name) =>
      String(name).includes('depackager') ? 'genuine_fail' : 'ok',
    )
    streakMock.mockReturnValue(3)

    const result = await checkRequiredPodContainersReady(DEFAULT_POD_NAME)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues).toEqual([
        expect.objectContaining({ role: 'depackager', detail: 'unhealthy' }),
      ])
    }
  })

  test('steady — single genuine failure does not mark unhealthy', async () => {
    pollMock.mockImplementation(async (name) =>
      String(name).includes('sealer') ? 'genuine_fail' : 'ok',
    )
    streakMock.mockReturnValue(1)

    const result = await checkRequiredPodContainersReady(DEFAULT_POD_NAME)
    expect(result.ok).toBe(true)
  })

  test('startup — inconclusive blocks without unhealthy issue', async () => {
    pollMock.mockImplementation(async (name) =>
      String(name).includes('sealer') ? 'inconclusive' : 'ok',
    )

    const result = await checkRequiredPodContainersReady(DEFAULT_POD_NAME, {
      healthGateMode: 'startup',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues).toHaveLength(0)
      expect(result.reason).toContain('health_pending')
    }
  })

  test('while-ready re-check can skip health probes', async () => {
    pollMock.mockClear()
    const result = await checkRequiredPodContainersReady(DEFAULT_POD_NAME, {
      probeHealth: false,
    })
    expect(result.ok).toBe(true)
    expect(pollMock).not.toHaveBeenCalled()
  })
})
