/**
 * Roadmap item 0.15 (D-37): a stored API key is not consent.
 * - A key sync yields a local config; only an explicit `preference: 'cloud'` picks a cloud provider.
 * - Inbox AI sends message content to a remote model only after the content was checked:
 *   BEAP-origin messages follow their handshake's AI policy.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const records: Record<string, { policy_selections?: unknown; effective_policy?: unknown }> = {}
vi.mock('../../handshake/db', () => ({
  getHandshakeRecord: (_db: unknown, id: string) => records[id] ?? null,
}))

import { inboxCloudPolicyForMessages } from '../inboxCloudPolicy'
import { cloudConfigFromKeySync, cloudConfigFromOptimandoApiKeysRecord } from '../../ocr/cloudConfigFromOptimandoKeys'
import { ocrRouter } from '../../ocr/router'
import { resolveInboxLlmSettings } from '../inboxLlmChat'

function fakeDb(rows: Record<string, { source_type: string; handshake_id: string | null }>) {
  return {
    prepare: () => ({ get: (id: string) => rows[id] }),
  }
}

describe('key sync is not consent', () => {
  it('a key bag yields a local config without cloud images', () => {
    const cfg = cloudConfigFromOptimandoApiKeysRecord({ OpenAI: 'sk-test', Claude: 'ck-test' })
    expect(cfg).toEqual({
      apiKeys: { OpenAI: 'sk-test', Claude: 'ck-test' },
      preference: 'local',
      useCloudForImages: false,
    })
  })

  it('the extension sync body cannot switch to cloud', () => {
    const cfg = cloudConfigFromKeySync({ apiKeys: { Gemini: 'g-test' }, preference: 'auto', useCloudForImages: true } as any)
    expect(cfg.preference).toBe('local')
    expect(cfg.useCloudForImages).toBe(false)
    expect(cfg.apiKeys).toEqual({ Gemini: 'g-test' })
  })

  it('a synced key leaves OCR on local tesseract', () => {
    ocrRouter.setCloudConfig(cloudConfigFromKeySync({ apiKeys: { OpenAI: 'sk-test' } }))
    expect(ocrRouter.shouldUseCloud().useCloud).toBe(false)
  })
})

describe('resolveInboxLlmSettings', () => {
  afterEach(() => ocrRouter.setCloudConfig({ apiKeys: {}, preference: 'local', useCloudForImages: false }))

  it('auto with a key stays local', () => {
    ocrRouter.setCloudConfig({ apiKeys: { OpenAI: 'sk-test' }, preference: 'auto', useCloudForImages: true })
    expect(resolveInboxLlmSettings().provider).toBe('ollama')
  })

  it('an explicit cloud preference selects the cloud provider', () => {
    ocrRouter.setCloudConfig({ apiKeys: { OpenAI: 'sk-test' }, preference: 'cloud', useCloudForImages: false })
    expect(resolveInboxLlmSettings().provider).toBe('openai')
  })
})

describe('inboxCloudPolicyForMessages', () => {
  afterEach(() => {
    for (const k of Object.keys(records)) delete records[k]
  })

  it('plain e-mail is allowed', () => {
    const db = fakeDb({ m1: { source_type: 'email_plain', handshake_id: null } })
    expect(inboxCloudPolicyForMessages(db, ['m1']).cloudAllowed).toBe(true)
  })

  it('BEAP under a local_only handshake is denied', () => {
    records['hs-1'] = { policy_selections: { ai_processing_mode: 'local_only' }, effective_policy: {} }
    const db = fakeDb({ m1: { source_type: 'direct_beap', handshake_id: 'hs-1' } })
    expect(inboxCloudPolicyForMessages(db, ['m1'])).toEqual({ cloudAllowed: false, reason: 'handshake_ai_policy_local_only' })
  })

  it('BEAP under an internal_and_cloud handshake is allowed', () => {
    records['hs-1'] = { policy_selections: { ai_processing_mode: 'internal_and_cloud' }, effective_policy: {} }
    const db = fakeDb({ m1: { source_type: 'email_beap', handshake_id: 'hs-1' } })
    expect(inboxCloudPolicyForMessages(db, ['m1']).cloudAllowed).toBe(true)
  })

  it('one denying message denies a batch', () => {
    records['hs-1'] = { policy_selections: { ai_processing_mode: 'local_only' }, effective_policy: {} }
    const db = fakeDb({
      m1: { source_type: 'email_plain', handshake_id: null },
      m2: { source_type: 'direct_beap', handshake_id: 'hs-1' },
    })
    expect(inboxCloudPolicyForMessages(db, ['m1', 'm2']).cloudAllowed).toBe(false)
  })

  it('unknown handshake, BEAP without handshake, unknown message and empty list deny', () => {
    const db = fakeDb({
      m1: { source_type: 'direct_beap', handshake_id: 'hs-missing' },
      m2: { source_type: 'direct_beap', handshake_id: null },
    })
    expect(inboxCloudPolicyForMessages(db, ['m1']).reason).toBe('handshake_not_found')
    expect(inboxCloudPolicyForMessages(db, ['m2']).reason).toBe('beap_without_handshake')
    expect(inboxCloudPolicyForMessages(db, ['nope']).reason).toBe('message_not_found')
    expect(inboxCloudPolicyForMessages(db, []).cloudAllowed).toBe(false)
  })
})

describe('source guard: every inbox LLM call carries a checked cloud policy', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const ipcSource = readFileSync(join(here, '..', 'ipc.ts'), 'utf8')
  const llmSource = readFileSync(join(here, '..', 'inboxLlmChat.ts'), 'utf8')

  it('each inboxLlmChat({ … }) call in ipc.ts passes cloudPolicy', () => {
    const calls = [...ipcSource.matchAll(/inboxLlmChat\(\{/g)].map((m) => m.index ?? 0)
    expect(calls.length).toBeGreaterThanOrEqual(8)
    for (const idx of calls) {
      let depth = 0
      let end = idx + 'inboxLlmChat('.length
      for (; end < ipcSource.length; end++) {
        if (ipcSource[end] === '{') depth++
        else if (ipcSource[end] === '}' && --depth === 0) break
      }
      expect(ipcSource.slice(idx, end), `call at offset ${idx}`).toMatch(/cloudPolicy: inboxCloudPolicyForMessages\(/)
    }
  })

  it('inboxLlmChat refuses a remote provider without a checked policy', () => {
    expect(llmSource).toMatch(/params\.cloudPolicy \?\? INBOX_CLOUD_POLICY_UNCHECKED/)
    expect(llmSource).toMatch(/providerLocality\(provider\) === 'remote' && !cloudPolicy\.cloudAllowed/)
  })
})
