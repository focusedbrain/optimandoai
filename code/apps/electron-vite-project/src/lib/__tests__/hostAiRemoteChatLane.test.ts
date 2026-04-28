import { describe, it, expect } from 'vitest'
import type { HostInferenceTargetRow } from '../../hooks/useSandboxHostInference'
import { hostInternalInferenceModelId } from '../hostInferenceModelIds'
import {
  findHostInferenceTargetRowForChatSelection,
  inferHostModelRemoteLane,
} from '../hostAiRemoteChatLane'

function base(id: string, model: string, over: Partial<HostInferenceTargetRow> = {}): HostInferenceTargetRow {
  return {
    kind: 'host_internal',
    id,
    label: 'x',
    model,
    handshake_id: 'hs-a',
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

describe('inferHostModelRemoteLane', () => {
  it('maps execution_transport ollama_direct', () => {
    expect(
      inferHostModelRemoteLane(
        base('host-internal:hs:m1', 'm1', { execution_transport: 'ollama_direct' }),
      ),
    ).toBe('ollama_direct')
  })

  it('defaults missing transport to BEAP/top-chat semantics', () => {
    expect(inferHostModelRemoteLane(base('host-internal:hs:m2', 'm2', {}))).toBe('beap')
  })
})

describe('findHostInferenceTargetRowForChatSelection', () => {
  const hs = 'hs-handshake-q'

  it('prefers exact id over first handshake row', () => {
    const idGlm = hostInternalInferenceModelId(hs, 'glm')
    const idMistral = hostInternalInferenceModelId(hs, 'mistral:latest')
    const targets: HostInferenceTargetRow[] = [
      base(idGlm, 'glm', {}),
      base(idMistral, 'mistral:latest', { execution_transport: 'ollama_direct' }),
    ]
    const got = findHostInferenceTargetRowForChatSelection(targets, idMistral)
    expect(got?.id).toBe(idMistral)
    expect(got?.execution_transport).toBe('ollama_direct')
  })

  it('matches handshake + model name when ids differ slightly', () => {
    const hsB = 'hs-b-other'
    const idMx = hostInternalInferenceModelId(hsB, 'm-x')
    const idMy = hostInternalInferenceModelId(hsB, 'm-y')
    const targets: HostInferenceTargetRow[] = [
      base(idMx, 'm-x', { handshake_id: hsB }),
      base(idMy, 'm-y', {
        handshake_id: hsB,
        execution_transport: 'ollama_direct',
      }),
    ]
    const got = findHostInferenceTargetRowForChatSelection(targets, idMy)
    expect(got?.execution_transport).toBe('ollama_direct')
  })
})
