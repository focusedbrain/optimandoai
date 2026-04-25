/**
 * STEP 8 — Integration: the same `host_internal` projection (id + p2pUiPhase) flows through
 * `handshake:getAvailableModels` consumers: merged selector models, WR Chat options, and mapHostTargets.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { HostInferenceTargetRow } from '../../hooks/useSandboxHostInference'
import { fetchSelectorModelListFromHostDiscovery, wrChatModelOptionsFromSelectorModels } from '../selectorModelListFromHostDiscovery'
import { mapHostTargetsToGavModelEntries } from '../modelSelectorMerge'

const append = vi.hoisted(() =>
  vi.fn(async <T>(opts: { models: T[] }): Promise<{ models: T[]; gav: HostInferenceTargetRow[] }> => ({
    models: opts.models,
    gav: [],
  })),
)

vi.mock('../appendHostRowsFromListInference', () => ({
  appendHostRowsFromListInference: append,
}))

const hostFromMain: HostInferenceTargetRow = {
  kind: 'host_internal',
  id: 'host-internal:hs1%3Ahs-internal-1:gem',
  label: 'Host AI · gem',
  model: 'gem',
  model_id: 'gem',
  display_label: 'Host AI · gem',
  displayTitle: 'Host AI · gem',
  displaySubtitle: 'Workstation · ID 111-222',
  provider: 'host_internal',
  handshake_id: 'hs-internal-1',
  host_device_id: 'dev-host',
  host_computer_name: 'Workstation',
  host_pairing_code: '111222',
  host_orchestrator_role: 'host',
  host_orchestrator_role_label: 'Host orchestrator',
  internal_identifier_6: '111222',
  secondary_label: 'Workstation · ID 111-222',
  direct_reachable: true,
  policy_enabled: true,
  available: true,
  availability: 'available',
  host_role: 'Host',
  p2pUiPhase: 'ready',
  host_selector_state: 'available',
  hostSelectorState: 'available',
  unavailable_reason: undefined,
}
describe('STEP 8 — production safety (integration: shared host row shape)', () => {
  beforeEach(() => {
    append.mockClear()
  })

  it('getAvailableModels → fetchSelector: gav and merged host_internal share id + p2pUiPhase', async () => {
    vi.stubGlobal('window', {
      handshakeView: {
        getAvailableModels: () =>
          Promise.resolve({
            success: true,
            models: [] as { id: string; name: string; type: 'local' | 'cloud' }[],
            hostInferenceTargets: [hostFromMain],
            ledgerProvesInternalSandboxToHost: true,
          }),
      },
    })
    const r = await fetchSelectorModelListFromHostDiscovery({
      reason: 'selector_open',
      includeHostInternalDiscovery: true,
    })
    expect(r.path).toBe('gav_success')
    expect(r.gavForHook).toHaveLength(1)
    expect(r.gavForHook[0]!.p2pUiPhase).toBe('ready')
    expect(r.gavForHook[0]!.id).toBe(hostFromMain.id)

    const fromMap = mapHostTargetsToGavModelEntries(r.gavForHook)
    expect(fromMap[0]!.p2pUiPhase).toBe('ready')
    expect(fromMap[0]!.id).toBe(hostFromMain.id)

    const hostRows = r.models.filter((m) => m.type === 'host_internal')
    expect(hostRows.length).toBeGreaterThan(0)
    const h = hostRows[hostRows.length - 1]!
    expect(h.type).toBe('host_internal')
    expect(h).toMatchObject({ p2pUiPhase: 'ready', id: hostFromMain.id })
  })

  it('WR Chat model list receives the same p2pUiPhase on the host row as merge output', async () => {
    vi.stubGlobal('window', {
      handshakeView: {
        getAvailableModels: () =>
          Promise.resolve({
            success: true,
            models: [],
            hostInferenceTargets: [hostFromMain],
            ledgerProvesInternalSandboxToHost: true,
          }),
      },
    })
    const r = await fetchSelectorModelListFromHostDiscovery({
      reason: 'selector_open',
      includeHostInternalDiscovery: false,
    })
    const wr = wrChatModelOptionsFromSelectorModels(r.models)
    const hostOpt = wr.find((x) => x.hostAi)
    expect(hostOpt?.p2pUiPhase).toBe('ready')
    expect(hostOpt?.name).toBe(hostFromMain.id)
  })

  it('(9) zero local Ollama models: Host row still present when IPC supplies hostInferenceTargets', async () => {
    vi.stubGlobal('window', {
      handshakeView: {
        getAvailableModels: () =>
          Promise.resolve({
            success: true,
            models: [],
            hostInferenceTargets: [hostFromMain],
            ledgerProvesInternalSandboxToHost: true,
          }),
      },
    })
    const r = await fetchSelectorModelListFromHostDiscovery({
      reason: 'manual_refresh',
      includeHostInternalDiscovery: true,
    })
    expect(r.models.some((m) => m.type === 'host_internal' && m.p2pUiPhase === 'ready')).toBe(true)
  })
})
