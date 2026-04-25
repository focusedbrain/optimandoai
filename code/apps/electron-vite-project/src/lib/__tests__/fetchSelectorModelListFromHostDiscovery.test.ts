/**
 * STEP 10 — merged selector pipeline: Host discovery is independent of local Ollama.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fetchSelectorModelListFromHostDiscovery } from '../selectorModelListFromHostDiscovery'

const append = vi.hoisted(() =>
  vi.fn(
    async <T>(opts: { models: T[] }): Promise<{
      models: T[]
      gav: Array<{
        kind: string
        id: string
        handshake_id: string
        available: boolean
        direct_reachable: boolean
        host_computer_name: string
        label: string
        host_role: string
        availability: string
      }>
    }> => {
      if ((opts.models as { length?: number }).length === 0) {
        return {
          models: [
            {
              id: 'host:hs',
              name: 'Host AI · m',
              provider: 'host_internal',
              type: 'host_internal',
              displayTitle: 'Host',
              displaySubtitle: 's',
              hostTargetAvailable: true,
            },
          ] as T[],
          gav: [
            {
              kind: 'host_internal',
              id: 'id',
              handshake_id: 'hs',
              available: true,
              direct_reachable: true,
              host_computer_name: 'H',
              label: 'L',
              host_role: 'Host',
              availability: 'available',
            },
          ],
        }
      }
      return { models: opts.models, gav: [] }
    },
  ),
)

vi.mock('../appendHostRowsFromListInference', () => ({
  appendHostRowsFromListInference: append,
}))

describe('STEP 10 — fetchSelectorModelListFromHostDiscovery', () => {
  beforeEach(() => {
    append.mockClear()
  })

  it('(9) empty local models: appendHostRows (listTargets merge) can still add Host AI (gav_success + probe)', async () => {
    vi.stubGlobal('window', {
      handshakeView: {
        getAvailableModels: () =>
          Promise.resolve({ success: true, models: [], hostInferenceTargets: [] }),
      },
    })
    const r = await fetchSelectorModelListFromHostDiscovery({
      reason: 'selector_open',
      includeHostInternalDiscovery: true,
    })
    expect(r.path).toBe('gav_success')
    expect(r.models.length).toBe(1)
    expect(r.models[0]).toMatchObject({ type: 'host_internal' })
    expect(r.gavForHook.length).toBe(1)
    expect(append).toHaveBeenCalled()
  })

  it('(10) pipeline does not touch window.llm (Ollama status is a separate step in WRChat)', async () => {
    vi.stubGlobal('window', {
      llm: { getStatus: () => { throw new Error('should not be called') } },
      handshakeView: {
        getAvailableModels: () =>
          Promise.resolve({
            success: true,
            models: [],
            hostInferenceTargets: [],
          }),
      },
    })
    const r = await fetchSelectorModelListFromHostDiscovery({
      reason: 'selector_open',
      includeHostInternalDiscovery: true,
    })
    expect(r.path).toBe('gav_success')
  })
})
