import { describe, it, expect } from 'vitest'
import { HOST_AI_PATH_UNAVAILABLE_TOOLTIP } from '../hostAiSelectorCopy'
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
      p2pUiPhase: 'ready',
      displayTitle: 'Host AI · llama3:8b',
      displaySubtitle: 'Workstation · ID 482-917',
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

  it('P2P unavailable: use main displayTitle + p2pUiPhase; long text in tooltip only', () => {
    const t = {
      available: false,
      p2pUiPhase: 'p2p_unavailable',
      displayTitle: 'Host AI · P2P unavailable',
      displaySubtitle: 'Office-PC · ID 111-222',
      host_computer_name: 'Office-PC',
      internal_identifier_6: '111222',
    } as HostInferenceTargetRow
    const u = hostModelSelectorRowUi(
      { ...baseM(), hostTargetAvailable: false, p2pUiPhase: 'p2p_unavailable', displayTitle: 'Host AI · P2P unavailable' },
      t,
    )
    expect(u.titleLine).toBe('Host AI · P2P unavailable')
    expect(u.subtitleLine).toBe('Office-PC · ID 111-222')
    const tip = buildHostAiSelectorTooltip(t, { hostTargetAvailable: false, hostSelectorState: 'unavailable' })
    expect(tip).toContain(HOST_AI_PATH_UNAVAILABLE_TOOLTIP)
  })

  it('legacy path invalid: primary from main; tooltip without MVP endpoint phrasing', () => {
    const t = {
      available: false,
      p2pUiPhase: 'legacy_http_invalid',
      displayTitle: 'Host AI · legacy endpoint unavailable',
      displaySubtitle: 'H · ID 000-000',
      host_computer_name: 'H',
      internal_identifier_6: '000000',
    } as HostInferenceTargetRow
    const u = hostModelSelectorRowUi(
      {
        ...baseM(),
        hostTargetAvailable: false,
        p2pUiPhase: 'legacy_http_invalid',
        displayTitle: 'Host AI · legacy endpoint unavailable',
      },
      t,
    )
    expect(u.titleLine).toBe('Host AI · legacy endpoint unavailable')
    expect(u.subtitleLine).toBe('H · ID 000-000')
    const tip = buildHostAiSelectorTooltip(t, { hostTargetAvailable: false, hostSelectorState: 'unavailable' })
    expect(tip).toMatch(/WebRTC|legacy|Settings/i)
  })

  it('capability probe: phase p2p_unavailable + displayTitle from main', () => {
    const t = {
      available: false,
      p2pUiPhase: 'p2p_unavailable',
      displayTitle: 'Host AI · P2P unavailable',
      displaySubtitle: 'X · ID 123-456',
      host_computer_name: 'X',
      internal_identifier_6: '123456',
    } as HostInferenceTargetRow
    const u = hostModelSelectorRowUi(
      { ...baseM(), hostTargetAvailable: false, p2pUiPhase: 'p2p_unavailable', displayTitle: 'Host AI · P2P unavailable' },
      t,
    )
    expect(u.titleLine).toBe('Host AI · P2P unavailable')
    const tip = buildHostAiSelectorTooltip(t, { hostTargetAvailable: false, hostSelectorState: 'unavailable' })
    expect(tip).toContain(HOST_AI_PATH_UNAVAILABLE_TOOLTIP)
  })
})
