/**
 * Validator Subprocess — Phase B, PR B-1
 *
 * Entry point for the forked validator process.  Run via child_process.fork()
 * from ValidatorOrchestrator in the main process.
 *
 * Responsibilities:
 *   1. Receive the seal key once via 'startup' IPC message.
 *   2. Accept ValidateRequest messages: run ingestion-core validators on the
 *      content, produce a cryptographic HMAC seal, return ValidateResponse.
 *   3. Respond to 'ping' with 'pong' (healthcheck).
 *   4. On 'shutdown': ack and exit cleanly; zeroize the seal key.
 *
 * Architectural constraints (Phase B, Section 2.1):
 *   - Does NOT import better-sqlite3, Electron APIs, or any UI code.
 *   - Does NOT write to disk or make network calls.
 *   - HMAC key lives only in this module's memory; never logged; cleared on
 *     shutdown.
 *   - Seal is ONLY produced after real validation — there is no path to
 *     generate a seal without running the validators.
 */

import { createHash, createHmac, randomBytes } from 'node:crypto'

// Use @repo/ingestion-core for all imports. When run as a subprocess via tsx,
// tsx resolves it from the pnpm workspace (node_modules/@repo/ingestion-core
// → packages/ingestion-core/src/index.ts). In tests (Vitest), the alias in
// vitest.config.ts maps it to the same source. electron-vite bundles it at
// build time.
import { validateDecryptedBeapContent, CONTENT_VALIDATOR_VERSION } from '@repo/ingestion-core'
import type { ValidationReasonCode } from '@repo/ingestion-core'
import type {
  ValidateRequest,
  ValidateResponse,
  SealedContent,
  SealedQuarantine,
  SubprocessControlMessage,
  SubprocessAckMessage,
} from '@repo/ingestion-core'

// ─────────────────────────────────────────────────────────────────────────────
// In-memory seal key — set once, never re-set, cleared on shutdown
// ─────────────────────────────────────────────────────────────────────────────

let sealKey: Buffer | null = null
let keyReceived = false
const VALIDATOR_VERSION = CONTENT_VALIDATOR_VERSION

// ─────────────────────────────────────────────────────────────────────────────
// Seal computation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a cryptographic seal over the given content.
 *
 * Seal input (JSON-serialised before HMAC):
 *   { content_sha256, nonce, row_id, outcome_class, validator_version,
 *     validated_at }
 *
 * The nonce is 32 random bytes per invocation (replay-resistance per
 * architecture test L5 — nonces differ across invocations even for identical
 * inputs).
 */
function computeSeal(
  canonicalJson: string,
  targetRowId: string,
  outcomeClass: 'validated' | 'rejected',
  validatorVersion: string,
  timestampUtc: string,
  key: Buffer,
): { seal: string; sealInputJson: string } {
  const contentSha256 = createHash('sha256').update(canonicalJson, 'utf8').digest('hex')
  const nonce = randomBytes(32).toString('base64')

  const sealInput = {
    content_sha256: contentSha256,
    nonce,
    row_id: targetRowId,
    outcome_class: outcomeClass,
    validator_version: validatorVersion,
    validated_at: timestampUtc,
  }

  const sealInputJson = JSON.stringify(sealInput)
  const seal = createHmac('sha256', key).update(sealInputJson, 'utf8').digest('base64')

  return { seal, sealInputJson }
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation dispatch
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run validation on the content from a ValidateRequest and produce either a
 * SealedContent (pass) or SealedQuarantine (fail).
 *
 * Only 'plaintext' kind is fully wired in B-1.  'qbeap_encrypted' and 'pbeap'
 * variants are stubs — they will be wired in PR B-3+ once the decryption path
 * is migrated.  Submitting an encrypted variant in B-1 results in a rejection
 * with ARTEFACT_UNKNOWN_KEY (indicating the validation path is not yet
 * available, not that the content is structurally invalid).
 */
function dispatchValidation(
  req: ValidateRequest,
  key: Buffer,
): ValidateResponse {
  const timestampUtc = new Date().toISOString()

  if (req.plaintext_or_encrypted.kind !== 'plaintext') {
    // Encrypted variants not yet wired — reject with a stub reason.
    // PR B-3+ will implement these paths.
    const rejection_reason: ValidationReasonCode = 'ARTEFACT_UNKNOWN_KEY'
    const canonicalJson = JSON.stringify({
      _stub: true,
      reason: 'encrypted_variant_not_yet_wired',
      kind: req.plaintext_or_encrypted.kind,
    })
    const { seal, sealInputJson } = computeSeal(
      canonicalJson,
      req.target_row_id,
      'rejected',
      VALIDATOR_VERSION,
      timestampUtc,
      key,
    )
    const sealed_quarantine: SealedQuarantine = {
      canonical_json: canonicalJson,
      seal,
      seal_input_json: sealInputJson,
      rejection_reason,
      validator_version: VALIDATOR_VERSION,
      rejected_at: timestampUtc,
    }
    return { request_id: req.request_id, outcome: { ok: false, sealed_quarantine } }
  }

  const content = req.plaintext_or_encrypted.content
  const result = validateDecryptedBeapContent(content)

  const canonicalJson =
    typeof content === 'string' ? content : JSON.stringify(content)

  if (result.validation_reason !== null) {
    const { seal, sealInputJson } = computeSeal(
      canonicalJson,
      req.target_row_id,
      'rejected',
      result.validator_version,
      result.validated_at,
      key,
    )
    const sealed_quarantine: SealedQuarantine = {
      canonical_json: canonicalJson,
      seal,
      seal_input_json: sealInputJson,
      rejection_reason: result.validation_reason,
      validator_version: result.validator_version,
      rejected_at: result.validated_at,
    }
    return { request_id: req.request_id, outcome: { ok: false, sealed_quarantine } }
  }

  const { seal, sealInputJson } = computeSeal(
    canonicalJson,
    req.target_row_id,
    'validated',
    result.validator_version,
    result.validated_at,
    key,
  )
  const sealed: SealedContent = {
    canonical_json: canonicalJson,
    seal,
    seal_input_json: sealInputJson,
    validator_version: result.validator_version,
    validated_at: result.validated_at,
  }
  return { request_id: req.request_id, outcome: { ok: true, sealed } }
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported functions (for in-process test imports — pure logic, no IPC)
// ─────────────────────────────────────────────────────────────────────────────

/** Compute a seal with an externally-supplied key (tests call this directly). */
export function computeSealForTest(
  canonicalJson: string,
  targetRowId: string,
  outcomeClass: 'validated' | 'rejected',
  validatorVersion: string,
  timestampUtc: string,
  key: Buffer,
): { seal: string; sealInputJson: string } {
  return computeSeal(canonicalJson, targetRowId, outcomeClass, validatorVersion, timestampUtc, key)
}

/** Verify a seal against a known key (storage gate + tests use this). */
export function verifySeal(sealInputJson: string, expectedSeal: string, key: Buffer): boolean {
  const recomputed = createHmac('sha256', key).update(sealInputJson, 'utf8').digest('base64')
  // Constant-time comparison to resist timing attacks.
  const a = Buffer.from(recomputed, 'base64')
  const b = Buffer.from(expectedSeal, 'base64')
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/** Extract the content_sha256 from a stored seal_input_json. */
export function extractContentSha256(sealInputJson: string): string | null {
  try {
    const parsed = JSON.parse(sealInputJson) as Record<string, unknown>
    return typeof parsed.content_sha256 === 'string' ? parsed.content_sha256 : null
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC listener — activated only when running as a subprocess
// ─────────────────────────────────────────────────────────────────────────────

function sendAck(msg: SubprocessAckMessage): void {
  process.send!(msg)
}

function handleControlMessage(msg: SubprocessControlMessage): void {
  if (msg.kind === 'startup') {
    if (keyReceived) {
      // Reject duplicate startup — a second startup message is a protocol error.
      console.error('[VALIDATOR_SUBPROCESS] Duplicate startup message rejected.')
      return
    }
    sealKey = Buffer.from(msg.seal_key_b64, 'base64')
    keyReceived = true
    sendAck({ kind: 'startup_ack' })
    return
  }

  if (msg.kind === 'ping') {
    sendAck({ kind: 'pong' })
    return
  }

  if (msg.kind === 'shutdown') {
    sendAck({ kind: 'shutdown_ack' })
    // Zeroize key material before exit.
    if (sealKey) {
      sealKey.fill(0)
      sealKey = null
    }
    keyReceived = false
    process.exit(0)
  }
}

function handleValidateRequest(req: ValidateRequest): void {
  if (!sealKey || !keyReceived) {
    // Subprocess is not ready — this is a protocol error in the caller.
    const errorResponse: ValidateResponse = {
      request_id: req.request_id,
      outcome: {
        ok: false,
        sealed_quarantine: {
          canonical_json: '{}',
          seal: '',
          seal_input_json: '{}',
          rejection_reason: 'ARTEFACT_UNKNOWN_KEY',
          validator_version: VALIDATOR_VERSION,
          rejected_at: new Date().toISOString(),
        },
      },
    }
    process.send!(errorResponse)
    return
  }

  const response = dispatchValidation(req, sealKey)
  process.send!(response)
}

// Activate IPC listener only when running as a forked subprocess.
if (process.send) {
  process.on('message', (raw: unknown) => {
    const msg = raw as Record<string, unknown>
    if (!msg || typeof msg !== 'object') return

    if (msg.kind === 'startup' || msg.kind === 'shutdown' || msg.kind === 'ping') {
      handleControlMessage(msg as SubprocessControlMessage)
      return
    }

    if (typeof msg.request_id === 'string') {
      handleValidateRequest(msg as unknown as ValidateRequest)
      return
    }

    // Vitest worker IPC and other framework messages arrive as Buffer-shaped
    // objects with a 'type: "Buffer"' key.  Ignore them silently to avoid
    // noisy test output; they are not our protocol messages.
    if (typeof (msg as Record<string, unknown>).type === 'string') return
    console.error('[VALIDATOR_SUBPROCESS] Unknown message shape:', JSON.stringify(msg).slice(0, 200))
  })

  process.on('uncaughtException', (err) => {
    console.error('[VALIDATOR_SUBPROCESS] Uncaught exception:', err?.message ?? err)
    // Zeroize key on crash — belt-and-suspenders (OS will reclaim memory anyway).
    if (sealKey) {
      sealKey.fill(0)
      sealKey = null
    }
    process.exit(1)
  })
}
