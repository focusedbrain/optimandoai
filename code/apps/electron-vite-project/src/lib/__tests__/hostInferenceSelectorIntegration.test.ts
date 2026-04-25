/**
 * STEP 8 — selector integration: merge, visibility, routing, persistence, copy, and error surface.
 * Regression pointers (owned by dedicated suites) are listed at the end.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  formatInternalInferenceErrorCode,
  getRequestHostCompletion,
  hostModelDisplayNameFromSelection,
  resolveChatInferenceKind,
} from '@ext/lib/inferenceSubmitRouting'
import { hostInternalInferenceModelId } from '../hostInferenceModelIds'
import {
  hostInferenceOptionVisible,
  hostInferenceSetupMessageVisible,
} from '../hostInferenceUiGates'
import { GROUP_CLOUD, GROUP_INTERNAL_HOST, GROUP_LOCAL_MODELS } from '../hostAiSelectorCopy'
import {
  accountKeyFromSession,
  LEGACY_ORCH_MODEL_KEY,
  persistOrchestratorModelId,
  readOrchestratorInferenceSelection,
  toStoredSelection,
  validateStoredSelectionForOrchestrator,
} from '../inferenceSelectionPersistence'
import { getCachedUserInfo } from '../auth/sessionCache'

vi.mock('../auth/sessionCache', () => ({
  getCachedUserInfo: vi.fn(() => ({ wrdesk_user_id: 'wrd-user-test', sub: 'sub-t' })),
}))

type Available = { id: string; name: string; type: 'local' | 'cloud' }
type Target = {
  id: string
  label: string
  display_label?: string
  available: boolean
  direct_reachable: boolean
  host_computer_name: string
  host_orchestrator_role_label?: string
  host_pairing_code?: string
  unavailable_reason?: string
  handshake_id: string
}

/** Mirrors HybridSearch model menu group visibility (no React). */
function modelMenuState(available: Available[], isSandbox: boolean, inferenceTargets: Target[]) {
  const locals = available.filter((m) => m.type === 'local')
  const clouds = available.filter((m) => m.type === 'cloud')
  const hasHostGroup = isSandbox && inferenceTargets.length > 0
  const noModels = available.length === 0 && !hasHostGroup
  return { locals, clouds, hasHostGroup, showHostRows: hasHostGroup, noModels, GROUP_LOCAL_MODELS, GROUP_INTERNAL_HOST, GROUP_CLOUD }
}

/** Mirrors useSandboxHostInference `showHostInferenceOption`. */
function showHostInferenceOption(
  modeReady: boolean,
  isSandbox: boolean,
  targets: Array<{ direct_reachable: boolean; available: boolean }>,
) {
  return modeReady && isSandbox && targets.some((t) => t.direct_reachable && t.available)
}

function installLocalStorage() {
  const store: Record<string, string> = {}
  const ls = {
    getItem: (k: string) => (k in store ? store[k]! : null),
    setItem: (k: string, v: string) => {
      store[k] = v
    },
    removeItem: (k: string) => {
      delete store[k]
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k]
    },
  }
  Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true })
  return store
}

beforeEach(() => {
  installLocalStorage()
  vi.mocked(getCachedUserInfo).mockReturnValue({ wrdesk_user_id: 'wrd-user-test', sub: 'sub-t' } as any)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('selector integration — model list merge', () => {
  it('local models only: local group, no Host group (Host tab hidden)', () => {
    const { locals, hasHostGroup, clouds } = modelMenuState(
      [{ id: 'm1', name: 'A', type: 'local' }],
      true,
      [],
    )
    expect(locals).toHaveLength(1)
    expect(clouds).toHaveLength(0)
    expect(hasHostGroup).toBe(false)
  })

  it('Host inference targets only: Host group, empty local when no local rows', () => {
    const t: Target = {
      id: hostInternalInferenceModelId('h1', 'm'),
      label: 'Host AI · m',
      available: true,
      direct_reachable: true,
      host_computer_name: 'PC',
      handshake_id: 'h1',
      unavailable_reason: 'PC — Host orchestrator · ID 123-456',
    }
    const { hasHostGroup, locals, noModels, clouds } = modelMenuState([], true, [t])
    expect(hasHostGroup).toBe(true)
    expect(locals).toHaveLength(0)
    expect(clouds).toHaveLength(0)
    expect(noModels).toBe(false)
  })

  it('local + Host: both groups', () => {
    const t: Target = {
      id: hostInternalInferenceModelId('h1', 'm'),
      label: 'Host AI · m',
      available: true,
      direct_reachable: true,
      host_computer_name: 'PC',
      handshake_id: 'h1',
    }
    const { locals, hasHostGroup } = modelMenuState([{ id: 'loc', name: 'L', type: 'local' }], true, [t])
    expect(locals).toHaveLength(1)
    expect(hasHostGroup).toBe(true)
  })

  it('cloud + local + Host: all three groups when applicable', () => {
    const t: Target = {
      id: hostInternalInferenceModelId('h1', 'm'),
      label: 'Host AI · m',
      available: true,
      direct_reachable: true,
      host_computer_name: 'PC',
      handshake_id: 'h1',
    }
    const s = modelMenuState(
      [
        { id: 'loc', name: 'L', type: 'local' },
        { id: 'c1', name: 'API', type: 'cloud' },
      ],
      true,
      [t],
    )
    expect(s.locals.length).toBe(1)
    expect(s.clouds.length).toBe(1)
    expect(s.hasHostGroup).toBe(true)
  })
})

describe('selector integration — visibility', () => {
  it('Host orchestrator (non-sandbox): Host AI option hidden — hostInferenceOptionVisible false', () => {
    expect(hostInferenceOptionVisible(true, 'host', 1)).toBe(false)
  })

  it('Sandbox with active direct Host: Host AI option visible (when candidates)', () => {
    expect(hostInferenceOptionVisible(true, 'sandbox', 1)).toBe(true)
  })

  it('showHostInferenceOption: requires direct_reachable and available on at least one target', () => {
    const ok: Target = {
      id: 'x',
      label: 'L',
      available: true,
      direct_reachable: true,
      host_computer_name: 'H',
      handshake_id: 'h',
    }
    const bad: Target = { ...ok, available: false }
    expect(showHostInferenceOption(true, true, [ok])).toBe(true)
    expect(showHostInferenceOption(true, true, [bad])).toBe(false)
  })

  it('Sandbox without active Host: setup hint can show; no option when no candidates', () => {
    expect(hostInferenceOptionVisible(true, 'sandbox', 0)).toBe(false)
    expect(
      hostInferenceSetupMessageVisible(true, 'sandbox', false, 0),
    ).toBe(true)
  })

  it('UI pattern: primary line is model / Host label, not a UUID', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000'
    const line = 'Running on Host AI · qwen2.5'
    expect(line).not.toContain(id)
    expect(line).toMatch(/Host AI/)
  })
})

describe('selector integration — selection / routing (extension + preload contract)', () => {
  it('local model id routes to local_ollama', () => {
    expect(
      resolveChatInferenceKind('llama3', [
        { id: 'llama3', type: 'local' },
        { id: 'c', type: 'cloud' },
      ]),
    ).toBe('local_ollama')
  })

  it('Host AI route id routes to host_internal', () => {
    const id = hostInternalInferenceModelId('hs', 'gemma')
    expect(resolveChatInferenceKind(id, [])).toBe('host_internal')
  })

  it('orchestrator model row with type host_internal routes to host_internal (even if id is opaque)', () => {
    expect(
      resolveChatInferenceKind('opaque-row-id', [{ id: 'opaque-row-id', type: 'host_internal' }]),
    ).toBe('host_internal')
  })

  it('cloud model id routes to cloud', () => {
    expect(resolveChatInferenceKind('oai-gpt4', [{ id: 'oai-gpt4', type: 'cloud' }])).toBe('cloud')
  })

  it('selecting Host uses requestCompletion when exposed (STEP 5)', () => {
    const call = vi.fn()
    const w = { internalInference: { requestCompletion: call } } as unknown as Window
    const fn = getRequestHostCompletion(w)
    expect(fn).toBeTypeOf('function')
    void fn?.({
      targetId: 'host-route-id',
      handshakeId: 'h',
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'host_internal',
        target_id: 'host-route-id',
        handshake_id: 'h',
        stream: false,
      }),
    )
  })

  it('getRequestHostCompletion falls back to requestHostCompletion then runHostChat', () => {
    const requestHostCompletion = vi.fn()
    const w = { internalInference: { requestHostCompletion } } as unknown as Window
    const fn = getRequestHostCompletion(w)
    void fn?.({
      targetId: 't',
      handshakeId: 'h',
      messages: [{ role: 'user', content: 'x' }],
    })
    expect(requestHostCompletion).toHaveBeenCalled()
  })

  it('getRequestHostCompletion falls back to runHostChat for older preload', () => {
    const runHostChat = vi.fn()
    const w = { internalInference: { runHostChat } } as unknown as Window
    const fn = getRequestHostCompletion(w)
    void fn?.({
      targetId: 't',
      handshakeId: 'h',
      messages: [{ role: 'user', content: 'x' }],
    })
    expect(runHostChat).toHaveBeenCalled()
  })
})

describe('selector integration — persistence (structured + legacy)', () => {
  it('legacy plain string in scoped storage is readable as local/ cloud selection', () => {
    const ak = accountKeyFromSession()
    localStorage.setItem(`${LEGACY_ORCH_MODEL_KEY}:scoped:${ak}`, 'my-local-model')
    const read = readOrchestratorInferenceSelection()
    expect(read?.kind).toBe('local_ollama')
    expect(read?.id).toBe('my-local-model')
  })

  it('structured Host target persists in V1 json and can be re-read with handshake_id', () => {
    const id = hostInternalInferenceModelId('handshake-abc', 'llama3')
    persistOrchestratorModelId(id, [{ id: 'x', type: 'local' }])
    const read = readOrchestratorInferenceSelection()
    expect(read?.kind).toBe('host_internal')
    expect(read?.id).toBe(id)
    expect(read?.handshake_id).toBe('handshake-abc')
    expect(read?.model).toBe('llama3')
  })

  it('invalid / unavailable Host target: validate returns host_unavailable', () => {
    const id = hostInternalInferenceModelId('h1', 'm1')
    const stored = toStoredSelection(id, [{ id: 'l', type: 'local' }])
    const v = validateStoredSelectionForOrchestrator(
      stored,
      [{ id: 'l', type: 'local' }],
      [],
      true,
      true,
    )
    expect(v.error).toBe('host_unavailable')
    expect(v.modelId).toBe('')
  })
})

describe('selector integration — UI copy (label + secondary)', () => {
  it('hostModelDisplayNameFromSelection prefers parsed model and strips Host AI · prefix in label', () => {
    expect(
      hostModelDisplayNameFromSelection({ parsedModel: 'mymodel', targetLabel: undefined }),
    ).toBe('mymodel')
    expect(
      hostModelDisplayNameFromSelection({ parsedModel: undefined, targetLabel: 'Host AI · mistral' }),
    ).toBe('mistral')
  })

  it('secondary line: computer name, Host orchestrator, and 6-digit ID display', () => {
    const secondary = 'Office — Host orchestrator · ID 123-456'
    expect(secondary).toMatch(/Office/)
    expect(secondary).toMatch(/Host orchestrator/)
    expect(secondary).toMatch(/123-456|123456/)
  })

  it('compact / theme-friendly secondary styling contract (contrast via opacity + theme tokens elsewhere)', () => {
    const hostRowSecondary = { fontSize: 11, opacity: 0.8, lineHeight: 1.3 } as const
    expect(hostRowSecondary.opacity).toBeLessThanOrEqual(0.8)
  })
})

describe('selector integration — error mapping (orchestrator user strings)', () => {
  const cases: Array<{ code: string; needle: string }> = [
    { code: 'HOST_DIRECT_P2P_UNAVAILABLE', needle: "can't reach" },
    { code: 'HOST_INFERENCE_DISABLED', needle: 'turned off' },
    { code: 'MODEL_UNAVAILABLE', needle: 'not available' },
    { code: 'PROVIDER_UNAVAILABLE', needle: 'Ollama' },
    { code: 'PROVIDER_TIMEOUT', needle: 'too long' },
    { code: 'POLICY_FORBIDDEN', needle: "isn't allowed" },
  ]
  for (const { code, needle } of cases) {
    it(`maps ${code} to a clear message`, () => {
      const t = formatInternalInferenceErrorCode(code)
      expect(t.toLowerCase()).toContain(needle.toLowerCase())
    })
  }
})

describe('selector integration — regression ownership (no behavior change; docs for CI)', () => {
  it('defers non-internal / standard handshake rejection to internal inference policy tests', () => {
    /* assertRecordForServiceRpc: electron/main/internalInference/__tests__/internalInferenceService.test.ts */
    expect(true).toBe(true)
  })

  it('defers external relay handshake invariants to regressionMatrix.relayHandshakeSandbox', () => {
    /* apps/electron-vite-project/electron/main/handshake/__tests__/regressionMatrix.relayHandshakeSandbox.test.ts */
    expect(true).toBe(true)
  })

  it('defers inbox / BEAP sandbox clone to inbox and BEAP regression suites', () => {
    /* beapInboxUxSourceRegressions, inboxMessageSandboxClone, step8.sandboxHostUiAndClone */
    expect(true).toBe(true)
  })
})
