/**
 * Regression: inbox BEAP-content tasks (Summary / etc.) on Sandbox with `ollama_direct` execution,
 * BEAP ingest missing (`beapReady=false`, `ollamaDirectReady=true`), model selection errors,
 * remote Ollama unreachable, and single-flight dedupe.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HandshakeRecord } from '../../handshake/types'
import type { AiExecutionContext } from '../../llm/aiExecutionTypes'
import { NO_AI_MODEL_SELECTED } from '../../llm/resolveAiExecutionContext'
import { InternalInferenceErrorCode } from '../../internalInference/errors'
import * as decideInternalInferenceTransportModule from '../../internalInference/transport/decideInternalInferenceTransport'
import { runInboxAiTaskWithDedup } from '../inboxAiTaskDedup'
import { classifyInboxAiError } from '../inboxAiErrorMapping'

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/wrdesk-beap-odl-inbox-regression',
    getAppPath: () => '/tmp/wrdesk-beap-odl-inbox-regression',
  },
}))

const {
  isSandboxModeMock,
  getInstanceIdMock,
  executeOdChatMock,
} = vi.hoisted(() => ({
  isSandboxModeMock: vi.fn(() => true),
  getInstanceIdMock: vi.fn(() => 'dev-sand-coord-1'),
  executeOdChatMock: vi.fn(async () => ({
    ok: true as const,
    output: 'Concise summary: sender asks for a meeting; action: reply with availability.',
    model: 'llama3:latest',
    duration_ms: 3,
  })),
}))

vi.mock('../../orchestrator/orchestratorModeStore', () => ({
  isHostMode: () => false,
  isSandboxMode: () => isSandboxModeMock(),
  getOrchestratorMode: () => ({
    mode: 'sandbox',
    deviceName: 'S',
    instanceId: 'i',
    pairingCode: '123456',
    connectedPeers: [] as const,
  }),
  getInstanceId: () => getInstanceIdMock(),
}))

vi.mock('../../internalInference/dbAccess', () => ({
  getHandshakeDbForInternalInference: async () => ({}),
}))

vi.mock('../../ocr/router', () => ({
  ocrRouter: {
    getCloudConfig: () => ({ preference: 'local' }),
    getAvailableProviders: () => [],
    getApiKey: () => null,
  },
}))

vi.mock('../../internalInference/sandboxHostAiOllamaDirectChat', () => ({
  executeSandboxHostAiOllamaDirectChat: (...args: unknown[]) => executeOdChatMock(...args),
}))

function party(uid: string) {
  return { email: `${uid}@test.dev`, wrdesk_user_id: uid, iss: 'https://idp', sub: `sub-${uid}` }
}

/** Internal ACTIVE sandbox→host row (same shape as list/probe regression tests). */
function internalHandshakeRow(): HandshakeRecord {
  return {
    handshake_id: 'hs-internal-odl-1',
    relationship_id: 'rel-1',
    state: 'ACTIVE',
    local_role: 'initiator',
    initiator: party('same'),
    acceptor: party('same'),
    initiator_device_role: 'sandbox',
    acceptor_device_role: 'host',
    initiator_coordination_device_id: 'dev-sand-coord-1',
    acceptor_coordination_device_id: 'dev-host-coord-1',
    internal_coordination_identity_complete: true,
    handshake_type: 'internal',
    p2p_endpoint: 'http://192.168.178.99:51249/beap/ingest',
    local_p2p_auth_token: 'tok-local',
    counterparty_p2p_token: 'bearer-g',
    acceptor_device_name: 'Host-PC',
    initiator_device_name: 'Sandbox-PC',
    internal_peer_pairing_code: '123456',
    sharing_mode: null,
    reciprocal_allowed: false,
    tier_snapshot: {} as unknown,
    current_tier_signals: {} as unknown,
    last_seq_sent: 0,
    last_seq_received: 0,
    last_capsule_hash_sent: '',
    last_capsule_hash_received: '',
    effective_policy: {} as unknown,
    external_processing: {} as unknown,
    created_at: '2020-01-01',
    activated_at: '2020-01-01',
    expires_at: null,
    revoked_at: null,
    revocation_source: null,
    initiator_wrdesk_policy_hash: '',
    initiator_wrdesk_policy_version: '',
    acceptor_wrdesk_policy_hash: null,
    acceptor_wrdesk_policy_version: null,
    initiator_context_commitment: null,
    acceptor_context_commitment: null,
  } as HandshakeRecord
}

vi.mock('../../handshake/db', () => ({
  getHandshakeRecord: (_db: unknown, _hid: string) => internalHandshakeRow(),
  listHandshakeRecords: () => [] as HandshakeRecord[],
}))

function ollamaDirectOnlyAiExecution(): AiExecutionContext {
  return {
    lane: 'ollama_direct',
    model: 'llama3:latest',
    handshakeId: 'hs-internal-odl-1',
    peerDeviceId: 'dev-host-coord-1',
    baseUrl: 'http://192.168.178.28:11434',
    beapReady: false,
    ollamaDirectReady: true,
  }
}

describe('beapContent inbox — remote ollama_direct', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    isSandboxModeMock.mockReturnValue(true)
    getInstanceIdMock.mockReturnValue('dev-sand-coord-1')
    executeOdChatMock.mockResolvedValue({
      ok: true,
      output: 'Concise summary: sender asks for a meeting; action: reply with availability.',
      model: 'llama3:latest',
      duration_ms: 3,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('Test 1: Summary uses LAN ollama_direct (executeSandboxHostAiOllamaDirectChat), never decideInternalInferenceTransport', async () => {
    const decideSpy = vi.spyOn(decideInternalInferenceTransportModule, 'decideInternalInferenceTransport')
    const { inboxLlmChat } = await import('../inboxLlmChat')
    const body = 'From: a@b.com\nSubject: Hello\n\nPlease confirm the timeline for next week.'
    const out = await inboxLlmChat({
      system: 'Summarize in two sentences.',
      user: body,
      resolvedContext: {
        model: 'llama3:latest',
        provider: 'ollama',
        aiExecution: ollamaDirectOnlyAiExecution(),
      },
      contentTask: { kind: 'summary' },
    })

    expect(out).toContain('summary')
    expect(out).not.toMatch(/Check that Ollama is running/i)
    expect(decideSpy).not.toHaveBeenCalled()
    expect(executeOdChatMock).toHaveBeenCalledTimes(1)
    const first = executeOdChatMock.mock.calls[0]![0] as { messages?: Array<{ role: string; content: string }> }
    expect(first.messages?.some((m) => m.content.includes('Hello'))).toBe(true)
    decideSpy.mockRestore()
  })

  it('Test 3: empty model fails early with user copy "Select an AI model first" (no ollama direct execution)', async () => {
    const { inboxLlmChat } = await import('../inboxLlmChat')
    await expect(
      inboxLlmChat({
        system: 'S',
        user: 'U',
        resolvedContext: {
          model: '',
          provider: 'ollama',
          aiExecution: { ...ollamaDirectOnlyAiExecution(), model: '' },
        },
        contentTask: { kind: 'summary' },
      }),
    ).rejects.toThrow(NO_AI_MODEL_SELECTED)

    expect(executeOdChatMock).not.toHaveBeenCalled()
    const classified = classifyInboxAiError(new Error(NO_AI_MODEL_SELECTED), { operation: 'summary' })
    expect(classified.code).toBe('no_model_selected')
    // Renderer: `inboxAiUserMessages` maps this to "Select an AI model first."
  })

  it('Test 4: remote Ollama unreachable → remote_ollama_unreachable + BEAP_CONTENT log has lane and baseUrl', async () => {
    executeOdChatMock.mockResolvedValueOnce({
      ok: false,
      code: InternalInferenceErrorCode.OLLAMA_LAN_NOT_REACHABLE,
      message: 'ECONNREFUSED',
    })
    const logs: string[] = []
    const logSpy = vi.spyOn(console, 'log').mockImplementation((msg?: unknown, ...rest: unknown[]) => {
      const line = typeof msg === 'string' ? `${msg}${rest.join(' ')}` : String(msg)
      logs.push(line)
    })

    const { inboxLlmChat } = await import('../inboxLlmChat')
    await expect(
      inboxLlmChat({
        system: 'S',
        user: 'U',
        resolvedContext: {
          model: 'llama3:latest',
          provider: 'ollama',
          aiExecution: ollamaDirectOnlyAiExecution(),
        },
        contentTask: { kind: 'summary' },
      }),
    ).rejects.toThrow(/ECONNREFUSED/)

    logSpy.mockRestore()

    const routeLine = logs.find((l) => l.includes('[BEAP_CONTENT_AI_ROUTE]'))
    expect(routeLine).toBeDefined()
    expect(String(routeLine)).toMatch(/lane=ollama_direct/)
    expect(String(routeLine)).toMatch(/192\.168\.178\.28:11434/)

    const err = Object.assign(new Error('ECONNREFUSED'), {
      inboxFailureCode: InternalInferenceErrorCode.OLLAMA_LAN_NOT_REACHABLE,
    })
    const { code, debug } = classifyInboxAiError(err, {
      operation: 'summary',
      aiExecution: ollamaDirectOnlyAiExecution(),
    })
    expect(code).toBe('remote_ollama_unreachable')
    expect(debug.lane).toBe('ollama_direct')
    expect(debug.baseUrl).toContain('192.168.178.28')
    // Renderer: `inboxAiUserMessages` maps this to "Remote Ollama is not reachable on the host device."
  })

  it('Test 5: duplicate analysis taskKey — only one inner run (dedupe)', async () => {
    let innerRuns = 0
    const taskKey = `analysis-stream:msg-dedup-1:llama3:latest:ollama_direct`
    const run = () =>
      runInboxAiTaskWithDedup(
        taskKey,
        { supersedeKeyPrefix: 'analysis-stream:msg-dedup-1:', messageId: 'msg-dedup-1' },
        async () => {
          innerRuns += 1
          await new Promise((r) => setTimeout(r, 25))
          return { started: true }
        },
      )

    const results = await Promise.all([run(), run(), run()])
    expect(innerRuns).toBe(1)
    expect(results.every((r) => r.started === true)).toBe(true)
    expect(results.filter((r) => r.deduped === true).length).toBeGreaterThanOrEqual(2)
  })
})
