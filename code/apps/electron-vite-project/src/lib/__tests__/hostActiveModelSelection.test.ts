import { describe, expect, it } from 'vitest'
import { getHostActiveModelIdFromTargets } from '../hostActiveModelSelection'
import { hostInternalInferenceModelId } from '../hostInferenceModelIds'
import type { HostInferenceTargetRow } from '../../hooks/useSandboxHostInference'

function row(model: string, active: string): HostInferenceTargetRow {
  const hid = 'hs-active-model'
  return {
    kind: 'host_internal',
    id: hostInternalInferenceModelId(hid, model),
    label: `Host AI · ${model}`,
    model,
    model_id: model,
    handshake_id: hid,
    host_device_id: 'host-dev',
    host_computer_name: 'Host',
    direct_reachable: true,
    policy_enabled: true,
    available: true,
    availability: 'available',
    host_role: 'Host',
    hostTargetAvailable: true,
    canChat: true,
    beapReady: true,
    visibleInModelSelector: true,
    hostActiveModel: active,
    isHostActiveModel: model === active,
  }
}

describe('host active model selection', () => {
  it('selects Host-active gemma instead of first/stale llama', () => {
    const rows = [row('llama3.1:8b', 'gemma2:12b'), row('gemma2:12b', 'gemma2:12b')]
    expect(getHostActiveModelIdFromTargets(rows)).toBe(hostInternalInferenceModelId('hs-active-model', 'gemma2:12b'))
  })
})
