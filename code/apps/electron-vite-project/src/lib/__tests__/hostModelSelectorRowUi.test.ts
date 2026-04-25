import { describe, it, expect } from 'vitest'
import { HOST_AI_MVP_P2P_ENDPOINT_INVALID_TOOLTIP, HOST_AI_P2P_OFFLINE_DETAIL_TOOLTIP } from '../hostAiSelectorCopy'
import { buildHostAiSelectorTooltip, hostModelSelectorRowUi } from '../hostModelSelectorRowUi'
import type { HostInferenceTargetRow } from '../../hooks/useSandboxHostInference'

function baseM(over: Partial<Parameters<typeof hostModelSelectorRowUi>[0]> = {}) {
  return {
    hostTargetAvailable: true,
    displayTitle: 'Host AI · m',
    displaySubtitle: '',
    ...over,
  }
}

describe('hostModelSelectorRowUi', () => {
  it('available: primary Host AI · model; secondary computer · ID', () => {
    const t = {
      model: 'llama3:8b',
      host_computer_name: 'Workstation',
      internal_identifier_6: '482917',
    } as HostInferenceTargetRow
    const u = hostModelSelectorRowUi(
      { ...baseM(), hostLocalModelName: 'llama3:8b', displayTitle: 'Host AI · llama3:8b' },
      t,
    )
    expect(u.titleLine).toBe('Host AI · llama3:8b')
    expect(u.subtitleLine).toBe('Workstation · ID 482-917')
    const tip = buildHostAiSelectorTooltip(t, { hostTargetAvailable: true, hostSelectorState: 'available' })
    expect(tip).toBeTruthy()
  })

  it('P2P / probe failure: compact P2P offline; secondary · Retry; long text in tooltip only', () => {
    const t = {
      available: false,
      host_computer_name: 'Office-PC',
      availability: 'direct_unreachable',
      internal_identifier_6: '111222',
      secondary_label: 'Host is paired, but direct P2P is not reachable.',
    } as HostInferenceTargetRow
    const u = hostModelSelectorRowUi(
      { ...baseM(), hostTargetAvailable: false, displayTitle: 'x' },
      t,
    )
    expect(u.titleLine).toBe('Host AI · P2P offline')
    expect(u.subtitleLine).toBe('Office-PC · Retry')
    const tip = buildHostAiSelectorTooltip(t, { hostTargetAvailable: false, hostSelectorState: 'unavailable' })
    expect(tip).toBe(HOST_AI_P2P_OFFLINE_DETAIL_TOOLTIP)
  })

  it('MVP invalid stored p2p_endpoint: P2P offline row + dedicated MVP tooltip', () => {
    const t = {
      available: false,
      host_computer_name: 'H',
      availability: 'direct_unreachable',
      unavailable_reason: 'MVP_P2P_ENDPOINT_INVALID',
      inference_error_code: 'MVP_P2P_ENDPOINT_INVALID',
      internal_identifier_6: '000000',
      secondary_label:
        'The Host handshake is active, but the stored direct P2P endpoint is not reachable.',
    } as HostInferenceTargetRow
    const u = hostModelSelectorRowUi({ ...baseM(), hostTargetAvailable: false, displayTitle: 'x' }, t)
    expect(u.titleLine).toBe('Host AI · P2P offline')
    expect(u.subtitleLine).toContain('Retry')
    const tip = buildHostAiSelectorTooltip(t, { hostTargetAvailable: false, hostSelectorState: 'unavailable' })
    expect(tip).toBe(HOST_AI_MVP_P2P_ENDPOINT_INVALID_TOOLTIP)
  })

  it('capability probe failed: P2P offline + long P2P tooltip', () => {
    const t = {
      available: false,
      host_computer_name: 'X',
      unavailable_reason: 'CAPABILITY_PROBE_FAILED',
      internal_identifier_6: '123456',
      secondary_label: 'Host capabilities could not be fetched (request failed or timed out).',
    } as HostInferenceTargetRow
    const u = hostModelSelectorRowUi({ ...baseM(), hostTargetAvailable: false, displayTitle: 'x' }, t)
    expect(u.titleLine).toBe('Host AI · P2P offline')
    expect(buildHostAiSelectorTooltip(t, { hostTargetAvailable: false, hostSelectorState: 'unavailable' })).toBe(
      HOST_AI_P2P_OFFLINE_DETAIL_TOOLTIP,
    )
  })
})
