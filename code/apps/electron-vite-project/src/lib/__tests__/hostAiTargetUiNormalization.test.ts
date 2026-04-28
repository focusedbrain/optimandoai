import { describe, it, expect } from 'vitest'
import type { HostInferenceTargetRow } from '../../hooks/useSandboxHostInference'
import {
  areNormalizedHostAiTargetListsEqual,
  normalizeHostAiTargetForUi,
  serializeMergedSelectorModelsForStableUi,
  serializeNormalizedHostAiTargetListUi,
} from '../hostAiTargetUiNormalization'

function baseHostRow(): HostInferenceTargetRow {
  return {
    kind: 'host_internal',
    id: 'host-internal:h1:mm',
    label: 'Host AI · mm',
    model: 'mm',
    model_id: 'mm',
    handshake_id: 'h1',
    host_device_id: 'dev1',
    host_computer_name: 'Pc',
    direct_reachable: true,
    policy_enabled: true,
    available: true,
    availability: 'available',
    unavailable_reason: undefined,
    host_role: 'Host',
    canChat: true,
    host_ai_target_status: 'beap_ready',
  } as HostInferenceTargetRow
}

describe('normalizeHostAiTargetForUi', () => {
  it('exposes handshake id–aligned fields', () => {
    const n = normalizeHostAiTargetForUi(baseHostRow())
    expect(n.id).toBe('h1')
    expect(n.peerDeviceId).toBe('dev1')
    expect(n.canChat).toBe(true)
    expect(n.status).toBe('beap_ready')
  })
})

describe('areNormalizedHostAiTargetListsEqual', () => {
  it('treats lists as equal when only volatile diagnostics differ', () => {
    const a = baseHostRow()
    const b = {
      ...baseHostRow(),
      host_ai_endpoint_diagnostics: {
        ttl_remaining_ms: 999,
        last_seen_at: Date.now(),
        corr: 'c1',
        chain: ['a', 'b'],
        timestamp_ms: 1,
      } as never,
      failureCode: undefined,
    }

    expect(serializeNormalizedHostAiTargetListUi([a])).toBe(
      serializeNormalizedHostAiTargetListUi([b as HostInferenceTargetRow]),
    )
    expect(areNormalizedHostAiTargetListsEqual([a], [b as HostInferenceTargetRow])).toBe(true)
  })

  it('detects semantic changes (failureCode)', () => {
    const a = baseHostRow()
    const b = { ...baseHostRow(), failureCode: 'X' as never }
    expect(areNormalizedHostAiTargetListsEqual([a], [b])).toBe(false)
  })
})

/**
 * Mirrors HybridSearch setGavHostTargets guard: repeatedly applying the same semantic snapshot
 * should not churn state (conceptual — here we assert reducer would keep prev).
 */
describe('repeated identical GAV merges', () => {
  it('stable snapshot string across fresh array allocations', () => {
    const t1 = [baseHostRow()]
    const t2 = [baseHostRow()]

    const s1 = serializeNormalizedHostAiTargetListUi(t1)
    expect(s1).toBe(serializeNormalizedHostAiTargetListUi(t2))

    let applyCount = 0
    let current: HostInferenceTargetRow[] = []
    const merge = (incoming: HostInferenceTargetRow[]) => {
      if (areNormalizedHostAiTargetListsEqual(current, incoming)) return
      applyCount++
      current = incoming
    }
    merge(t1)
    merge(t2)
    expect(applyCount).toBe(1)
  })

  /**
   * Case 5 (Host AI cross-device): IPC/poll may deliver a new array instance with the same semantic
   * projection — the merge guard must not loop setState (React max update depth).
   */
  it('does not re-apply when many consecutive identical snapshots follow the first update', () => {
    let applyCount = 0
    let current: HostInferenceTargetRow[] = []
    const merge = (incoming: HostInferenceTargetRow[]) => {
      if (areNormalizedHostAiTargetListsEqual(current, incoming)) return
      applyCount++
      current = incoming
    }
    merge([baseHostRow()])
    for (let i = 0; i < 20; i++) {
      merge([baseHostRow()])
    }
    expect(applyCount).toBe(1)
  })
})

describe('serializeMergedSelectorModelsForStableUi', () => {
  it('is stable across object identity churn for locals', () => {
    const prev = [{ id: 'a', type: 'local' as const, name: 'a', provider: 'ollama' }]
    const next = [{ ...prev[0], name: 'a' }]
    expect(serializeMergedSelectorModelsForStableUi(prev)).toBe(
      serializeMergedSelectorModelsForStableUi(next),
    )
  })
})
