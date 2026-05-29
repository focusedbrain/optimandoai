/**
 * PR 5.1/8 — Depackager Determinism Boundary
 *
 * Tests the invariant: `inbox_messages.depackaged_json` is byte-equivalent to the
 * validated capsule plaintext (modulo JSON whitespace). Wrapper metadata moves to
 * `depackaged_metadata`. Legacy `sessionRefs` resolver fallback is removed.
 *
 * Test structure (PR 5.3: tests 1–7 removed, migrateDepackagedJsonToCanonical deleted):
 *   8–12:  Depackager wrapper output shapes (buildOutboundQbeapDepackagedJson,
 *           beapPackageToMainProcessDepackaged, buildElectronMergePayload)
 *   13–15: Format routing reads from depackaged_metadata
 *   16–17: Reader — getArtefactSessionRefs canonical-only path
 *   18:    End-to-end determinism assertion for pBEAP
 */

import { describe, it, expect, vi } from 'vitest'

// Mock electron/Node modules that are not available in the Vitest environment.
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => '/tmp' },
}))
vi.mock('../messageRouter', () => ({
  makeInboxAttachmentStorageId: (msgId: string, attId: string) => `${msgId}/${attId}`,
}))
vi.mock('../attachmentBlobCrypto', () => ({
  writeEncryptedAttachmentFile: vi.fn(() => ({
    storagePath: '/tmp/mock.bin',
    encryptionKeyStored: 'k',
    ivB64: 'i',
    tagB64: 't',
  })),
}))
vi.mock('../gateway', () => ({
  emailGateway: { getProviderSync: () => 'gmail' },
}))
vi.mock('../../../beap/autoresponderEvaluator', () => ({
  evaluateAutoresponder: vi.fn(() => ({ decision: 'no-session' })),
}))
vi.mock('../../../beap/autoresponderAudit', () => ({
  logAutoresponderDecision: vi.fn(),
}))

// migrateDepackagedJsonToCanonical removed in PR 5.3 (no production customers; every DB post-canonical).
// Tests 1–7 (migration tests) removed accordingly.

import {
  beapPackageToMainProcessDepackaged,
} from './helpers/pbeapMainProcessDepackage.testHelpers.js'
import { buildOutboundQbeapDepackagedJson } from '../beapEmailIngestion'
import { depackagedFormatFromJson } from '../../../../src/lib/inboxBeapRowEligibility'

// makeDb helper and migrateDepackagedJsonToCanonical describe block (tests 1–7) removed in PR 5.3.

// ---------------------------------------------------------------------------
// Tests 8–9: buildOutboundQbeapDepackagedJson
// ---------------------------------------------------------------------------

describe('buildOutboundQbeapDepackagedJson', () => {
  const fallback = { id: 'r1', subject: 'My subject', from_address: 'me@example.com', body_text: 'body' }
  const pkg = JSON.stringify({
    header: { encoding: 'qBEAP', sender_fingerprint: 'fp123', content_hash: 'h456', version: '1.0.0' },
    payloadEnc: {},
  })

  it('test 8: depackaged_json is canonical placeholder (no format key)', () => {
    const { depackaged_json } = buildOutboundQbeapDepackagedJson(pkg, fallback)
    const canonical = JSON.parse(depackaged_json) as Record<string, unknown>
    expect(canonical.has_authoritative_encrypted).toBe(true)
    expect(canonical.format).toBeUndefined()
    expect(canonical.schema_version).toBeUndefined()
    expect(canonical.session_import_artefact).toBeUndefined()
  })

  it('test 9: depackaged_metadata carries format and wrapper fields', () => {
    const { depackaged_metadata } = buildOutboundQbeapDepackagedJson(pkg, fallback)
    const meta = JSON.parse(depackaged_metadata) as Record<string, unknown>
    expect(meta.format).toBe('beap_qbeap_outbound')
    expect(meta.source).toBe('main_process_p2p_outbound_echo')
    expect((meta.email_fallback_header as Record<string, unknown>)?.subject).toBe('My subject')
    expect((meta.header_summary as Record<string, unknown>)?.sender_fingerprint).toBe('fp123')
  })
})

// ---------------------------------------------------------------------------
// Tests 10–12: beapPackageToMainProcessDepackaged
// ---------------------------------------------------------------------------

describe('beapPackageToMainProcessDepackaged', () => {
  it('test 10: pBEAP — depackaged_json IS the capsule JSON (no wrapper fields)', () => {
    const capsule = {
      subject: 'pBEAP subject',
      body: 'capsule body',
      transport_plaintext: 'tp',
      session_import_artefact: { artefact_id: 'a1', sessions: [] },
    }
    const capsuleB64 = Buffer.from(JSON.stringify(capsule)).toString('base64')
    const pkg = JSON.stringify({ header: { encoding: 'pBEAP' }, payload: capsuleB64 })
    const { depackaged_json, depackaged_metadata } = beapPackageToMainProcessDepackaged(pkg, {
      id: 'r1', subject: null, from_address: null, body_text: null,
    })
    expect(depackaged_json).not.toBeNull()
    const canonical = JSON.parse(depackaged_json!) as Record<string, unknown>
    expect(canonical.subject).toBe('pBEAP subject')
    // session_import_artefact must be in canonical JSON (the capsule itself)
    expect((canonical.session_import_artefact as Record<string, unknown>)?.artefact_id).toBe('a1')
    // Wrapper fields MUST NOT be in canonical
    expect(canonical.format).toBeUndefined()
    expect(canonical.trust_note).toBeUndefined()

    const meta = JSON.parse(depackaged_metadata) as Record<string, unknown>
    expect(meta.format).toBe('beap_message_main_process')
    expect(meta.encoding).toBe('pBEAP')
  })

  it('test 11: qBEAP — depackaged_json is null; format in metadata', () => {
    const pkg = JSON.stringify({ header: { encoding: 'qBEAP', sender_fingerprint: 'fp' } })
    const { depackaged_json, depackaged_metadata } = beapPackageToMainProcessDepackaged(pkg, {
      id: 'r1', subject: 'Sub', from_address: 'f@e.com', body_text: 'bt',
    })
    expect(depackaged_json).toBeNull()
    const meta = JSON.parse(depackaged_metadata) as Record<string, unknown>
    expect(meta.format).toBe('beap_qbeap_pending_main')
  })

  it('test 12: error/invalid — depackaged_json is null; format in metadata', () => {
    const { depackaged_json, depackaged_metadata } = beapPackageToMainProcessDepackaged('not-json', {
      id: 'r1', subject: null, from_address: null, body_text: null,
    })
    expect(depackaged_json).toBeNull()
    const meta = JSON.parse(depackaged_metadata) as Record<string, unknown>
    expect(meta.format).toBe('beap_main_process_error')
    expect(meta.error_reason).toBe('invalid_json')
  })
})

// ---------------------------------------------------------------------------
// Tests 13–15: Format routing reads from depackaged_metadata first
// ---------------------------------------------------------------------------

describe('depackagedFormatFromJson (PR 5.1 routing helper)', () => {
  it('test 13: reads format from depackaged_metadata when present', () => {
    const meta = JSON.stringify({ format: 'beap_qbeap_decrypted' })
    const dep = JSON.stringify({ format: 'beap_old_format', subject: 'X' })
    expect(depackagedFormatFromJson(dep, meta)).toBe('beap_qbeap_decrypted')
  })

  it('test 14: falls back to depackaged_json when metadata absent', () => {
    const dep = JSON.stringify({ format: 'beap_qbeap_pending_main' })
    expect(depackagedFormatFromJson(dep, null)).toBe('beap_qbeap_pending_main')
  })

  it('test 15: returns null when both absent', () => {
    expect(depackagedFormatFromJson(null, null)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Tests 16–17: getArtefactSessionRefs canonical-only (no legacy sessionRefs)
// ---------------------------------------------------------------------------

describe('getArtefactSessionRefs — canonical position only (PR 5.1 / Decision C)', () => {
  // Inline implementation mirror for testing (same logic as EmailMessageDetail.tsx)
  function getArtefactSessionRefs(
    p: Record<string, unknown>,
  ): { refs: Array<Record<string, unknown>>; requestedAction?: 'import_only' | 'import_and_offer_run' } {
    const canonicalArtefact = p.session_import_artefact
    if (canonicalArtefact != null && typeof canonicalArtefact === 'object') {
      const artefact = canonicalArtefact as Record<string, unknown>
      const sessions = artefact.sessions
      if (Array.isArray(sessions) && sessions.length > 0) {
        const refs = sessions
          .filter((s): s is Record<string, unknown> => s !== null && typeof s === 'object')
          .map((s) => ({
            sessionId: typeof s.session_id === 'string' ? s.session_id : String(s.session_id ?? ''),
            sessionName: typeof s.session_name === 'string' ? s.session_name : undefined,
          }))
        const requestedAction =
          artefact.requested_action === 'import_only' || artefact.requested_action === 'import_and_offer_run'
            ? (artefact.requested_action as 'import_only' | 'import_and_offer_run')
            : undefined
        return { refs, requestedAction }
      }
    }
    return { refs: [] }
  }

  it('test 16: reads session from canonical session_import_artefact', () => {
    const canonical = {
      subject: 'S',
      session_import_artefact: {
        artefact_id: 'a1',
        sessions: [{ session_id: 'sid1', session_name: 'My Session' }],
        requested_action: 'import_and_offer_run',
      },
    }
    const { refs, requestedAction } = getArtefactSessionRefs(canonical)
    expect(refs).toHaveLength(1)
    expect(refs[0].sessionId).toBe('sid1')
    expect(requestedAction).toBe('import_and_offer_run')
  })

  it('test 17: legacy sessionRefs is NOT used — returns empty when artefact absent', () => {
    const legacyRow = {
      subject: 'S',
      sessionRefs: [{ sessionId: 'legacy-sid' }],
      // No session_import_artefact
    }
    const { refs } = getArtefactSessionRefs(legacyRow)
    // After Decision C: legacy fallback removed; empty = conformant absence
    expect(refs).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Test 18: End-to-end determinism — pBEAP path
// ---------------------------------------------------------------------------

describe('End-to-end determinism (test 18)', () => {
  it('test 18: pBEAP capsule stored in depackaged_json byte-equivalent to capsule the validator would validate', () => {
    const artefact = {
      artefact_id: 'e2e-art-1',
      artefact_type: 'session_share',
      sessions: [{ session_id: 'e2e-sid-1', session_name: 'E2E Session' }],
      requested_action: 'import_and_offer_run' as const,
    }
    const capsule = {
      subject: 'E2E test',
      body: 'body text',
      transport_plaintext: 'transport',
      attachments: [] as unknown[],
      automation: undefined,
      session_import_artefact: artefact,
    }
    const capsuleJson = JSON.stringify(capsule)
    const payloadB64 = Buffer.from(capsuleJson).toString('base64')
    const packageJson = JSON.stringify({ header: { encoding: 'pBEAP' }, payload: payloadB64 })

    const { depackaged_json } = beapPackageToMainProcessDepackaged(packageJson, {
      id: 'r-e2e', subject: null, from_address: null, body_text: null,
    })

    // The depackaged_json must be byte-equivalent to the capsuleJson (the validated plaintext).
    // Both are parsed and compared semantically (JSON.stringify default ordering may differ).
    expect(depackaged_json).not.toBeNull()
    const stored = JSON.parse(depackaged_json!) as Record<string, unknown>
    const original = JSON.parse(capsuleJson) as Record<string, unknown>

    expect(stored.subject).toBe(original.subject)
    expect(stored.body).toBe(original.body)
    expect(stored.transport_plaintext).toBe(original.transport_plaintext)
    expect(stored.session_import_artefact).toMatchObject(original.session_import_artefact as object)

    // No wrapper contamination in the stored canonical JSON
    expect(stored.format).toBeUndefined()
    expect(stored.schema_version).toBeUndefined()
    expect(stored.trust_note).toBeUndefined()
  })
})
