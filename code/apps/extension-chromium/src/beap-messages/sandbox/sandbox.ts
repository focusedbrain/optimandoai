/**
 * BEAP Sandbox Sub-Orchestrator — Stage 5 Isolation Boundary
 * Per A.3.055 Stage 5 and Annex I §I.2 (Normative)
 *
 * This module runs EXCLUSIVELY inside the Chrome Extension Sandboxed Page
 * (declared under manifest `sandbox.pages`). It has:
 *
 *   - Its own JS context — no shared memory with the extension renderer
 *   - No access to chrome.* extension APIs
 *   - No access to extension storage, vault, or network
 *   - Communication via window.postMessage only
 *
 * Pipeline executed inside the sandbox (Annex I — Sandbox Sub-Orchestrator):
 *
 *   1. Receive SandboxRequest from host via postMessage
 *   2. Acknowledge receipt (SandboxAck)
 *   3. parseBeapFile  — minimal structural validation, no content access
 *   4. decryptBeapPackage — runs full Stages 0, 2, 4, 6.1–6.3, 7 +
 *                          Gates 1–6 of the depackaging pipeline (Canon §10)
 *   5. Sanitise result — strip all derived key material, raw ciphertext,
 *      internal pipeline details
 *   6. Send SandboxSuccess (or SandboxFailure) back to host
 *
 * Fail-closed invariants (Annex I §I.2):
 *   - Any exception → SandboxFailure with non-disclosing message
 *   - Hard timeout → SandboxFailure with TIMEOUT stage
 *   - Unrecognised request type → SandboxFailure with INTERNAL stage
 *   - No partial results are ever sent; exactly one final response per request
 */

import {
  parseBeapFile,
  decryptBeapPackage,
  type DecryptedPackage,
  type LocalHandshake,
  type SenderIdentity,
  type KnownReceiver,
  type BeapEnvelopeHeader,
} from '../services'
import {
  type SandboxRequest,
  type SandboxResponse,
  type SandboxAck,
  type SandboxSuccess,
  type SandboxFailure,
  type SandboxDecryptOptions,
  type SanitisedDecryptedPackage,
  type DecryptedPackageHeader,
  SANDBOX_DEPACKAGE_TIMEOUT_MS,
  SANDBOX_MEMORY_LIMIT_BYTES,
  isSandboxFailure,
  hexToUint8Array,
} from './sandboxProtocol'

// =============================================================================
// Sandbox Initialisation
// =============================================================================

/**
 * Bootstrap the sandbox message listener.
 * Called once when sandbox.html loads.
 */
function initSandbox(): void {
  window.addEventListener('message', handleMessage)
  // Signal readiness (informational; host does not require this)
  console.debug('[BEAP Sandbox] Sandbox sub-orchestrator initialised (Stage 5).')
}

// =============================================================================
// Message Handler
// =============================================================================

async function handleMessage(event: MessageEvent): Promise<void> {
  // Security: only accept messages from the direct parent frame.
  // In the sandboxed page context, `window.parent` is the extension renderer.
  if (event.source !== window.parent) return

  const data: unknown = event.data
  if (!isValidSandboxRequest(data)) return

  const req = data as SandboxRequest

  // Immediately acknowledge receipt so the host knows the sandbox is alive.
  const ack: SandboxAck = {
    requestId: req.requestId,
    type: 'ACK',
    receivedAt: Date.now(),
  }
  window.parent.postMessage(ack, '*')

  // Dispatch to the correct handler.
  let response: SandboxSuccess | SandboxFailure
  if (req.type === 'DEPACKAGE') {
    response = await handleDepackageWithTimeout(req)
  } else {
    response = buildFailure(req.requestId, 'INTERNAL', 'Package verification failed')
  }

  window.parent.postMessage(response, '*')
}

// =============================================================================
// Request Validation
// =============================================================================

function isValidSandboxRequest(data: unknown): data is SandboxRequest {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  return (
    typeof d['requestId'] === 'string' &&
    d['requestId'].length > 0 &&
    typeof d['type'] === 'string' &&
    typeof d['rawBeapJson'] === 'string' &&
    d['rawBeapJson'].length > 0 &&
    typeof d['options'] === 'object'
  )
}

// =============================================================================
// Depackage with Hard Timeout
// =============================================================================

async function handleDepackageWithTimeout(
  req: SandboxRequest
): Promise<SandboxSuccess | SandboxFailure> {
  const timeoutMs = req.timeoutMs ?? SANDBOX_DEPACKAGE_TIMEOUT_MS

  // Race between the pipeline and a hard timeout.
  return Promise.race([
    handleDepackage(req),
    buildTimeoutPromise(req.requestId, timeoutMs),
  ])
}

function buildTimeoutPromise(
  requestId: string,
  timeoutMs: number
): Promise<SandboxFailure> {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve(buildFailure(requestId, 'TIMEOUT', 'Package verification failed'))
    }, timeoutMs)
  })
}

// =============================================================================
// Core Depackage Handler
// =============================================================================

async function handleDepackage(
  req: SandboxRequest
): Promise<SandboxSuccess | SandboxFailure> {
  try {
    // ------------------------------------------------------------------
    // Step 1: Parse raw .beap bytes (minimal structural validation only)
    // ------------------------------------------------------------------
    const parseResult = parseBeapFile(req.rawBeapJson)
    if (!parseResult.success) {
      return buildFailure(req.requestId, 'PARSE', 'Package verification failed')
    }
    const pkg = parseResult.package

    // ------------------------------------------------------------------
    // Step 2: Reconstruct native types from serialised options
    // ------------------------------------------------------------------
    const nativeOptions = deserialiseOptions(req.options)

    // ------------------------------------------------------------------
    // Step 3: Run the full canonical depackaging pipeline
    //   - Stage 0: Recipient eligibility determination
    //   - Gates 1–6 (Canon §10): Sender ID, Receiver ID, Ciphertext
    //     Integrity, PQ Decryption, Signature, Template Hash
    //   - Stage 2: PoAE anchor verification (optional high-assurance)
    //   - Stage 4: Inner envelope decryption (v2.0 qBEAP)
    //   - Stage 6.1–6.3: Processing event gate + consent + artefacts
    //   - Stage 7: PoAE-R log generation
    // ------------------------------------------------------------------
    const decryptResult = await decryptBeapPackage(pkg, nativeOptions)

    if (!decryptResult.success || !decryptResult.package) {
      // Map to a coarse failure stage based on the non-disclosing error hint.
      const stage = classifyFailureStage(decryptResult.nonDisclosingError)
      return buildFailure(req.requestId, stage, 'Package verification failed')
    }

    // ------------------------------------------------------------------
    // Step 4: Check memory budget (soft — cannot hard-kill in-process)
    // ------------------------------------------------------------------
    checkMemoryBudget()

    // ------------------------------------------------------------------
    // Step 5: Sanitise result — strip all secrets before boundary crossing
    // ------------------------------------------------------------------
    const sanitised = sanitisePackage(decryptResult.package)

    const success: SandboxSuccess = {
      requestId: req.requestId,
      type: 'DEPACKAGE_RESULT',
      result: sanitised,
    }
    return success

  } catch (err) {
    // Unhandled exception — fail-closed, no details disclosed.
    console.error('[BEAP Sandbox] Unhandled exception in depackage handler:', err)
    return buildFailure(req.requestId, 'INTERNAL', 'Package verification failed')
  }
}

// =============================================================================
// Options Deserialisation
// =============================================================================

/**
 * Reconstruct native `decryptBeapPackage` option types from the serialised
 * form received via postMessage. Hex strings → Uint8Array, entry arrays → Map.
 */
function deserialiseOptions(opts: SandboxDecryptOptions): Parameters<typeof decryptBeapPackage>[1] {
  // Reconstruct LocalHandshake records (hybridSharedSecret as Uint8Array)
  let handshakes: LocalHandshake[] | undefined
  if (opts.handshakes && opts.handshakes.length > 0) {
    handshakes = opts.handshakes.map(h => ({
      handshakeId: h.handshakeId,
      senderFingerprint: h.senderFingerprint,
      receiverFingerprint: h.receiverFingerprint,
      hybridSharedSecret: hexToUint8Array(h.hybridSharedSecretHex),
    }))
  }

  // Reconstruct known senders
  let knownSenders: SenderIdentity[] | undefined
  if (opts.knownSenders && opts.knownSenders.length > 0) {
    knownSenders = opts.knownSenders.map(s => ({
      fingerprint: s.fingerprint,
      ed25519PublicKey: s.publicKey,
      keyId: s.keyId,
      trusted: s.trusted,
    }))
  }

  // Reconstruct known receiver
  let knownReceiver: KnownReceiver | undefined
  if (opts.knownReceiver) {
    knownReceiver = {
      fingerprints: [opts.knownReceiver.fingerprint],
      ...(opts.knownReceiver.fingerprintShort ? {} : {}),
    }
  }

  // Reconstruct template hash Map
  let knownTemplateHashes: Map<string, string> | undefined
  if (opts.knownTemplateHashEntries && opts.knownTemplateHashEntries.length > 0) {
    knownTemplateHashes = new Map(opts.knownTemplateHashEntries)
  }

  return {
    handshakeId: opts.handshakeId,
    handshakes,
    senderX25519PublicKey: opts.senderX25519PublicKey,
    mlkemSecretKeyB64: opts.mlkemSecretKeyB64,
    hybridSharedSecretB64: opts.hybridSharedSecretB64,
    skipSignatureVerification: opts.skipSignatureVerification,
    knownSenders,
    knownReceiver,
    knownTemplateHashes,
    expectedContentHash: opts.expectedContentHash,
    permitPoAERLog: opts.permitPoAERLog,
  }
}

// =============================================================================
// Result Sanitisation
// =============================================================================

/**
 * Strip all cryptographic secrets and internal pipeline details from a
 * DecryptedPackage before it crosses the Stage 5 sandbox boundary.
 *
 * Removed:
 *   - `pipelineResult.verifiedContext` (capsuleKey, artefactKey, innerEnvelopeKey)
 *   - Raw encrypted payload / ciphertext references on the header
 *   - Internal error messages (only non-disclosing fields remain)
 */
function sanitisePackage(pkg: DecryptedPackage): SanitisedDecryptedPackage {
  const h = pkg.header as BeapEnvelopeHeader & Record<string, unknown>

  const header: DecryptedPackageHeader = {
    version: String(h['version'] ?? ''),
    encoding: (h['encoding'] === 'pBEAP' ? 'pBEAP' : 'qBEAP'),
    timestamp: typeof h['timestamp'] === 'number' ? h['timestamp'] : 0,
    sender_fingerprint: typeof h['sender_fingerprint'] === 'string' ? h['sender_fingerprint'] : '',
    receiver_fingerprint: typeof h['receiver_fingerprint'] === 'string' ? h['receiver_fingerprint'] : undefined,
    template_hash: typeof h['template_hash'] === 'string' ? h['template_hash'] : '',
    policy_hash: typeof h['policy_hash'] === 'string' ? h['policy_hash'] : '',
    content_hash: typeof h['content_hash'] === 'string' ? h['content_hash'] : '',
    signing: {
      algorithm: typeof pkg.verification.signatureAlgorithm === 'string' ? pkg.verification.signatureAlgorithm : '',
      keyId: typeof pkg.verification.signerKeyId === 'string' ? pkg.verification.signerKeyId : '',
      publicKey: typeof (h['signing'] as Record<string, unknown>)?.['publicKey'] === 'string'
        ? (h['signing'] as Record<string, unknown>)['publicKey'] as string
        : '',
    },
    compliance: typeof h['compliance'] === 'object' && h['compliance'] !== null
      ? h['compliance'] as { canon: string; notes?: string[] }
      : undefined,
  }

  return {
    header,
    capsule: pkg.capsule,
    artefacts: pkg.artefacts,
    metadata: {
      created_at: pkg.metadata.created_at,
      delivery_method: pkg.metadata.delivery_method,
      delivery_hint: pkg.metadata.delivery_hint,
      filename: pkg.metadata.filename,
      inbox_response_path: pkg.metadata.inbox_response_path,
    },
    verification: {
      signatureValid: pkg.verification.signatureValid,
      signatureAlgorithm: pkg.verification.signatureAlgorithm,
      signerKeyId: pkg.verification.signerKeyId,
      verifiedAt: pkg.verification.verifiedAt,
    },
    // Stage 6.1 gate result — consumers MUST check decision === 'AUTHORIZED'
    authorizedProcessing: pkg.authorizedProcessing,
    innerEnvelopeMetadata: pkg.innerEnvelopeMetadata,
    poaeVerification: pkg.poaeVerification,
    poaeRLog: pkg.poaeRLog,
    // High-level summary gate: all pipeline gates + mandatory stages passed
    allGatesPassed: Boolean(
      pkg.verification.signatureValid &&
      pkg.pipelineResult?.success &&
      pkg.authorizedProcessing.decision === 'AUTHORIZED'
    ),
    verifiedAt: Date.now(),
  }
}

// =============================================================================
// Failure Helpers
// =============================================================================

function buildFailure(
  requestId: string,
  stage: SandboxFailure['failureStage'],
  nonDisclosingError: string
): SandboxFailure {
  return {
    requestId,
    type: 'DEPACKAGE_FAILURE',
    nonDisclosingError,
    failureStage: stage,
  }
}

/**
 * Map a non-disclosing error string to a coarse failure stage.
 * Since error messages may not contain stage info, we default to PIPELINE.
 */
function classifyFailureStage(
  nonDisclosingError?: string
): SandboxFailure['failureStage'] {
  if (!nonDisclosingError) return 'PIPELINE'
  const upper = nonDisclosingError.toUpperCase()
  if (upper.includes('PARSE') || upper.includes('MALFORMED')) return 'PARSE'
  if (upper.includes('STAGE2') || upper.includes('POAE')) return 'STAGE2_POAE'
  if (upper.includes('STAGE_4') || upper.includes('INNER ENVELOPE')) return 'STAGE4'
  if (upper.includes('GATE') || upper.includes('BLOCKED')) return 'GATE'
  if (upper.includes('TIMEOUT')) return 'TIMEOUT'
  return 'PIPELINE'
}

// =============================================================================
// Memory Budget Check
// =============================================================================

function checkMemoryBudget(): void {
  // `performance.memory` is a Chrome-only non-standard extension.
  // Cast through unknown to avoid TypeScript errors on non-standard property.
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
  if (mem && mem.usedJSHeapSize > SANDBOX_MEMORY_LIMIT_BYTES) {
    console.warn(
      `[BEAP Sandbox] Memory budget exceeded: ${mem.usedJSHeapSize} bytes ` +
      `(limit: ${SANDBOX_MEMORY_LIMIT_BYTES} bytes). ` +
      'Capsule processed but memory pressure may indicate oversized package.'
    )
  }
}

// Silence unused import warning — isSandboxFailure is exported from protocol
// and used in sandboxClient.ts; the import here documents the dependency.
void (isSandboxFailure as unknown)

// =============================================================================
// Entry Point
// =============================================================================

initSandbox()
