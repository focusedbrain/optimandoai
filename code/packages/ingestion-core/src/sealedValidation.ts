/**
 * Sealed Validation IPC Protocol — Phase B
 *
 * Typed messages exchanged between the main process and the validator
 * subprocess. All message shapes are pure data (JSON-serialisable).
 *
 * Architecture: Phase B, Section 2.5
 *   Seal algorithm: HMAC-SHA256 over canonical seal_input_json.
 *   Seal input binds: content_sha256, nonce, row_id, outcome_class,
 *   validator_version, validated_at.  See Decision 2 in PR B-1.
 */

import type { ValidationReasonCode, ProvenanceMetadata } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Subprocess control messages (main → subprocess)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Messages from main process that control subprocess lifecycle.
 *
 * - startup: sent once on subprocess start; carries the HMAC seal key.
 *   The subprocess accepts exactly one startup message.  Subsequent
 *   startup messages are rejected.
 * - shutdown: graceful stop; subprocess should ack then exit.
 * - ping: healthcheck; subprocess must respond with a pong ack.
 */
export type SubprocessControlMessage =
  | { kind: 'startup'; seal_key_b64: string; validator_version: string }
  | { kind: 'shutdown' }
  | { kind: 'ping' }

// ─────────────────────────────────────────────────────────────────────────────
// Ack messages (subprocess → main)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Acknowledgement messages sent from the subprocess to the main process.
 *
 * - startup_ack: confirms the subprocess received the seal key and is ready.
 * - shutdown_ack: confirms graceful shutdown is in progress.
 * - pong: healthcheck response to a ping.
 */
export type SubprocessAckMessage =
  | { kind: 'startup_ack' }
  | { kind: 'shutdown_ack' }
  | { kind: 'pong' }

// ─────────────────────────────────────────────────────────────────────────────
// Validation request (main → subprocess)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A validation request from the main process.
 *
 * request_id: opaque string; the matching ValidateResponse will carry the
 *   same ID.  Main process uses a request_id → resolver map for concurrent
 *   in-flight requests.
 * envelope: the outer BEAP capsule envelope (CandidateCapsuleEnvelope shape
 *   or equivalent) — supplied for provenance / audit; the subprocess uses it
 *   to run ingestor-level validation when needed.
 * plaintext_or_encrypted: the inner content to validate.  'plaintext' means
 *   the caller has already decrypted; the other variants signal that
 *   decryption is required (wired in PR B-3+).
 * provenance: metadata from the ingestion pipeline (transport, source type…).
 * target_row_id: the inbox_messages / inbox_attachments row this seal will
 *   be bound to.  Included in the seal input so that the seal cannot be
 *   reused on a different row.
 */
export interface ValidateRequest {
  readonly request_id: string;
  readonly envelope: unknown;
  readonly plaintext_or_encrypted:
    | { readonly kind: 'plaintext'; readonly content: unknown }
    | { readonly kind: 'qbeap_encrypted'; readonly ciphertext: string; readonly handshake_id: string }
    | { readonly kind: 'pbeap'; readonly payload_b64: string };
  readonly provenance: ProvenanceMetadata;
  readonly target_row_id: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation response (subprocess → main)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A successful validation result carrying the cryptographic seal.
 *
 * canonical_json: the exact JSON string the validator approved; this is
 *   the string written to inbox_messages.depackaged_json.  The seal binds
 *   sha256(canonical_json), so any later modification invalidates it.
 * seal: base64(HMAC-SHA256(seal_input_json, key)).
 * seal_input_json: the exact JSON string that was HMAC'd.  Stored alongside
 *   the seal; the read path recomputes the HMAC and compares.
 * validator_version: matches CONTENT_VALIDATOR_VERSION from ingestion-core.
 * validated_at: RFC 3339 UTC timestamp.
 */
export interface SealedContent {
  readonly canonical_json: string;
  readonly seal: string;
  readonly seal_input_json: string;
  readonly validator_version: string;
  readonly validated_at: string;
}

/**
 * A failed validation result, sealed as 'rejected'.
 *
 * Same seal structure as SealedContent; outcome_class in the seal input is
 * 'rejected'.  The rejection_reason is the ValidationReasonCode from the
 * validator.  A 'rejected' seal cannot satisfy the inbox-read gate (PR B-2+).
 */
export interface SealedQuarantine {
  readonly canonical_json: string;
  readonly seal: string;
  readonly seal_input_json: string;
  readonly rejection_reason: ValidationReasonCode;
  readonly validator_version: string;
  readonly rejected_at: string;
}

/**
 * The subprocess response to a ValidateRequest.  The request_id matches the
 * corresponding request.  The outcome discriminates success from failure.
 */
export interface ValidateResponse {
  readonly request_id: string;
  readonly outcome:
    | { readonly ok: true; readonly sealed: SealedContent }
    | { readonly ok: false; readonly sealed_quarantine: SealedQuarantine };
}

// ─────────────────────────────────────────────────────────────────────────────
// Union of all subprocess → main messages (for exhaustive dispatch)
// ─────────────────────────────────────────────────────────────────────────────

export type SubprocessOutboundMessage =
  | SubprocessAckMessage
  | ValidateResponse;

// ─────────────────────────────────────────────────────────────────────────────
// Union of all main → subprocess messages (for exhaustive dispatch)
// ─────────────────────────────────────────────────────────────────────────────

export type SubprocessInboundMessage =
  | SubprocessControlMessage
  | ValidateRequest;
