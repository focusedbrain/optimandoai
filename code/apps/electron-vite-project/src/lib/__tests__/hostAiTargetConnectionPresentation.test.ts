import { describe, it, expect } from 'vitest'
import type { HostInferenceTargetRow } from '../../hooks/useSandboxHostInference'
import {
  composeHostAiConnectionSubtitle,
  computeHostInferenceGavRowPresentation,
  hostInferenceTargetMenuSelectable,
} from '../hostAiTargetConnectionPresentation'

function fakeBase(over: Partial<HostInferenceTargetRow>): HostInferenceTargetRow {
  return {
    kind: 'host_internal',
    id: 'x',
    label: 'x',
    handshake_id: 'h',
    host_device_id: 'd',
    host_computer_name: 'Pc',
    direct_reachable: true,
    policy_enabled: true,
    available: true,
    availability: 'available',
    host_role: 'Host',
    ...over,
  } as HostInferenceTargetRow
}

describe('hostInferenceTargetMenuSelectable', () => {
  it('uses canChat=true (not IPC available) when status is omitted', () => {
    expect(
      hostInferenceTargetMenuSelectable(
        fakeBase({ canChat: true, host_selector_state: 'available', hostSelectorState: 'available', available: true }),
      ),
    ).toBe(true)

    expect(
      hostInferenceTargetMenuSelectable(
        fakeBase({
          canChat: false,
          host_selector_state: 'unavailable',
          hostSelectorState: 'unavailable',
          available: true,
        }),
      ),
    ).toBe(false)
  })

  it('allows ollama_direct_only + ollama_direct when backend says canUseOllamaDirect', () => {
    expect(
      hostInferenceTargetMenuSelectable(
        fakeBase({
          host_ai_target_status: 'ollama_direct_only',
          execution_transport: 'ollama_direct',
          canUseOllamaDirect: true,
          canChat: false,
          available: false,
          host_selector_state: 'unavailable',
          hostSelectorState: 'unavailable',
        }),
      ),
    ).toBe(true)
  })

  it('blocks endpoint-missing handshake state', () => {
    expect(
      hostInferenceTargetMenuSelectable(
        fakeBase({
          host_ai_target_status: 'handshake_active_but_endpoint_missing',
          execution_transport: 'ollama_direct',
          canUseOllamaDirect: true,
          canChat: false,
        }),
      ),
    ).toBe(false)
  })

  it('blocks untrusted and offline', () => {
    expect(
      hostInferenceTargetMenuSelectable(
        fakeBase({ host_ai_target_status: 'untrusted', canChat: false, available: false }),
      ),
    ).toBe(false)

    expect(
      hostInferenceTargetMenuSelectable(fakeBase({ host_ai_target_status: 'offline', canChat: false })),
    ).toBe(false)
  })
})

describe('composeHostAiConnectionSubtitle', () => {
  it('prepends handshake_active_but_endpoint_missing copy', () => {
    const s = composeHostAiConnectionSubtitle('handshake_active_but_endpoint_missing', 'Pc · ID 123-456')
    expect(s).toContain('Host paired, BEAP endpoint missing')
    expect(s).toContain(
      'The host is paired and Ollama is reachable, but the host BEAP endpoint is not advertised.',
    )
    expect(s.split('\n').length).toBeGreaterThanOrEqual(2)
  })

  it('is identity when status is omitted', () => {
    expect(composeHostAiConnectionSubtitle(undefined, 'line')).toBe('line')
  })
})

describe('computeHostInferenceGavRowPresentation', () => {
  it('forces menu state from trust flags when IPC still reports unavailable', () => {
    const o = fakeBase({
      host_ai_target_status: 'ollama_direct_only',
      execution_transport: 'ollama_direct',
      canUseOllamaDirect: true,
      canChat: false,
      available: false,
      host_selector_state: 'unavailable',
      hostSelectorState: 'unavailable',
    })
    expect(computeHostInferenceGavRowPresentation(o)).toEqual({
      hostTargetAvailable: true,
      hostSelectorState: 'available',
    })
  })

  it('keeps checking without advertising ready', () => {
    const o = fakeBase({
      host_selector_state: 'checking',
      hostSelectorState: 'checking',
      unavailable_reason: null,
      canChat: false,
    })
    expect(computeHostInferenceGavRowPresentation(o)).toEqual({
      hostTargetAvailable: false,
      hostSelectorState: 'checking',
    })
  })
})
