/**
 * STEP 9 — Regression: selector merge, submit routing, WR Chat validation, security (no prompt logging in routing helpers).
 */
import { describe, it, expect, vi } from 'vitest'
import {
  getRequestHostCompletion,
  isHostInternalChatModelId,
  resolveChatInferenceKind,
} from '@ext/lib/inferenceSubmitRouting'
import { hostInternalInferenceModelId } from '../hostInferenceModelIds'
import { mapHostTargetsToGavModelEntries, orderModelsLocalHostCloud } from '../modelSelectorMerge'
import type { HostInferenceTargetRow } from '../hooks/useSandboxHostInference'
import { validateStoredSelectionForWrChat } from '../inferenceSelectionPersistence'
import type { StoredInferenceSelectionV1 } from '../inferenceSelectionPersistence'

function hostRow(over: Partial<HostInferenceTargetRow> = {}): HostInferenceTargetRow {
  return {
    kind: 'host_internal',
    id: 'host-internal:x:y',
    label: 'Host',
    model: 'm',
    handshake_id: 'h',
    host_device_id: 'd',
    host_computer_name: 'C',
    host_orchestrator_role: 'host',
    host_orchestrator_role_label: 'Host orchestrator',
    internal_identifier_6: '123456',
    direct_reachable: true,
    policy_enabled: true,
    available: true,
    availability: 'available',
    host_role: 'Host',
    secondary_label: 'sub',
    display_label: 'Host AI · m',
    ...over,
  } as HostInferenceTargetRow
}

describe('STEP 9 — selector', () => {
  it('local empty + Host target available => merged order still includes host (not empty)', () => {
    const models = orderModelsLocalHostCloud([
      { type: 'host_internal' as const, id: 'h1' },
    ])
    expect(models.some((m) => m.type === 'host_internal')).toBe(true)
  })

  it('local empty + Host disabled row => mapHostTargetsToGavModelEntries is not empty (row stays, disabled in UI)', () => {
    const gav = mapHostTargetsToGavModelEntries([
      hostRow({ available: false, availability: 'direct_unreachable', id: 'host-internal:h:unavailable' }),
    ])
    expect(gav).toHaveLength(1)
    expect(gav[0]!.hostTargetAvailable).toBe(false)
    expect(gav[0]!.hostSelectorState).toBe('unavailable')
  })

  it('host_internal is not treated as a local Ollama row for routing kind', () => {
    expect(resolveChatInferenceKind('opaque', [{ id: 'opaque', type: 'host_internal' }])).toBe('host_internal')
    expect(resolveChatInferenceKind('llama3', [{ id: 'llama3', type: 'local' }])).toBe('local_ollama')
  })
})

describe('STEP 9 — WR Chat selection', () => {
  it('disabled Host target cannot be validated as an active selection', () => {
    const stored: StoredInferenceSelectionV1 = {
      v: 1,
      kind: 'host_internal',
      id: 'host-x',
      model: 'm',
    }
    const v = validateStoredSelectionForWrChat(stored, [], [
      { name: 'host-x', hostAi: true, hostAvailable: false },
    ])
    expect(v.error).toBe('host_unavailable')
    expect(v.modelId).toBe('')
  })

  it('Host target still checking keeps persisted WR Chat selection (no false unavailable)', () => {
    const stored: StoredInferenceSelectionV1 = {
      v: 1,
      kind: 'host_internal',
      id: 'host-x',
      model: 'm',
    }
    const v = validateStoredSelectionForWrChat(stored, ['host-x'], [
      { name: 'host-x', hostAi: true, hostAvailable: false, hostTargetChecking: true },
    ])
    expect(v.error).toBeUndefined()
    expect(v.modelId).toBe('host-x')
  })

  it('host_internal id still listed in merged roster validates when host row slice is empty (transitional load)', () => {
    const stored: StoredInferenceSelectionV1 = {
      v: 1,
      kind: 'host_internal',
      id: 'host-internal:a:gemma',
      model: 'gemma',
      handshake_id: 'a',
    }
    const v = validateStoredSelectionForWrChat(stored, ['host-internal:a:gemma'], [])
    expect(v.error).toBeUndefined()
    expect(v.modelId).toBe('host-internal:a:gemma')
  })
})

describe('STEP 9 — submit routing (renderer)', () => {
  it('local model id routes to local_ollama', () => {
    expect(resolveChatInferenceKind('local-m', [{ id: 'local-m', type: 'local' }])).toBe('local_ollama')
  })

  it('host_internal id routes to host_internal for submit layer', () => {
    const id = hostInternalInferenceModelId('hs1', 'gemma')
    expect(resolveChatInferenceKind(id, [])).toBe('host_internal')
  })

  it('getRequestHostCompletion uses requestCompletion with provider host_internal and does not log messages', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const call = vi.fn().mockResolvedValue({ ok: true, output: 'out' })
    const w = { internalInference: { requestCompletion: call } } as unknown as Window
    const fn = getRequestHostCompletion(w)
    await fn?.({
      targetId: 't1',
      handshakeId: 'hs',
      messages: [{ role: 'user', content: 'secret user text' }],
      model: 'm',
    })
    const arg = call.mock.calls[0]?.[0] as Record<string, unknown>
    expect(arg?.provider).toBe('host_internal')
    expect(arg?.stream).toBe(false)
    const logged = log.mock.calls.flat().join(' ')
    expect(logged).not.toMatch(/secret user text/)
    log.mockRestore()
  })
})

describe('STEP 9 — discovery helper', () => {
  it('isHostInternalChatModelId accepts route id or hostAi row (WR Chat when llm.getStatus empty still has host from gav)', () => {
    const hid = hostInternalInferenceModelId('a', 'b')
    expect(isHostInternalChatModelId(hid, [])).toBe(true)
    expect(
      isHostInternalChatModelId('x', [{ name: 'x', hostAi: true, section: 'local' }]),
    ).toBe(true)
  })
})
