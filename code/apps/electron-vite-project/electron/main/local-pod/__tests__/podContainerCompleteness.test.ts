/**
 * Required pod container completeness gate — fail closed when any manifest role is down.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'

vi.mock('../supervisor/podmanLocal.js', () => ({
  inspectContainerState: vi.fn(),
  probeContainerHealthLocal: vi.fn(),
}))

import { checkRequiredPodContainersReady } from '../podContainerCompleteness.js'
import {
  inspectContainerState,
  probeContainerHealthLocal,
} from '../supervisor/podmanLocal.js'
import { DEFAULT_POD_NAME } from '../podRunner.js'

const inspectMock = vi.mocked(inspectContainerState)
const probeMock = vi.mocked(probeContainerHealthLocal)

describe('checkRequiredPodContainersReady', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    inspectMock.mockResolvedValue('running')
    probeMock.mockResolvedValue(true)
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
    expect(probeMock).toHaveBeenCalledTimes(5)
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

  test('fail closed when running container fails /health', async () => {
    probeMock.mockImplementation(async (name) => !String(name).includes('depackager'))

    const result = await checkRequiredPodContainersReady(DEFAULT_POD_NAME)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues).toEqual([
        expect.objectContaining({ role: 'depackager', detail: 'unhealthy' }),
      ])
    }
  })
})
