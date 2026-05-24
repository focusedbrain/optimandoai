/**
 * In-process validator — P1.12 replacement for validator-process/orchestrator.ts
 *
 * Provides the same exported interface as the old ValidatorOrchestrator but
 * runs validation synchronously in the main process instead of forking a
 * child_process.  The subprocess infrastructure (fork, IPC, healthcheck loop)
 * is gone; the key material now lives only in the main-process closure that is
 * passed to sealed-storage's bindKeyProvider.
 *
 * Callers that previously imported from validator-process/orchestrator now
 * import from here.  The method signatures are identical.
 */

import { randomUUID } from 'node:crypto'
import {
  validateDecryptedBeapContent,
  CONTENT_VALIDATOR_VERSION,
} from '@repo/ingestion-core'
import type {
  ValidateRequest,
  ValidateResponse,
} from '@repo/ingestion-core'
import { computeSeal, bindKeyProvider, unbindKeyProvider } from '../sealed-storage/index'
import type { VaultService } from '../vault/service'

// ─────────────────────────────────────────────────────────────────────────────
// Key derivation constant — unchanged from validator-process; existing sealed
// rows in the DB used this derivation path and must continue to verify.
// ─────────────────────────────────────────────────────────────────────────────

const SEAL_KEY_INFO = 'validator-seal-key-v1'

// ─────────────────────────────────────────────────────────────────────────────
// Notification surface — kept for API compatibility with vault/rpc.ts callers
// ─────────────────────────────────────────────────────────────────────────────

export type ValidationServiceUnavailableReason = 'vault_not_unlocked' | 'startup_failed'

let _notifyUnavailable: ((reason: ValidationServiceUnavailableReason) => void) | null = null

export function onValidationServiceUnavailable(
  cb: (reason: ValidationServiceUnavailableReason) => void,
): void {
  _notifyUnavailable = cb
}

// ─────────────────────────────────────────────────────────────────────────────
// Liveness type — kept for API compatibility
// ─────────────────────────────────────────────────────────────────────────────

export type OrchestratorLiveness = 'running' | 'dead' | 'not_started'

// ─────────────────────────────────────────────────────────────────────────────
// InProcessValidator
// ─────────────────────────────────────────────────────────────────────────────

export class ValidatorOrchestrator {
  private liveness: OrchestratorLiveness = 'not_started'
  private vault: VaultService | null = null

  getLiveness(): OrchestratorLiveness {
    return this.liveness
  }

  /**
   * "Start" the validator — binds the sealed-storage inner key provider.
   * No subprocess is forked; the vault is only used to derive the key on demand
   * via the provider closure (same as the old orchestrator did after startup ack).
   */
  async start(vault: VaultService): Promise<void> {
    if (this.liveness === 'running') {
      throw new Error('Validator already running')
    }
    const sealKey = vault.deriveApplicationKey(SEAL_KEY_INFO)
    if (!sealKey) {
      _notifyUnavailable?.('vault_not_unlocked')
      throw new Error('Vault not unlocked — cannot derive seal key')
    }
    sealKey.fill(0) // test derivation only; the provider derives fresh each time

    this.vault = vault
    bindKeyProvider(() => vault.deriveApplicationKey(SEAL_KEY_INFO), 'inner')
    this.liveness = 'running'
    console.log('[IN_PROCESS_VALIDATOR] ready — key provider bound (inner, validator-seal-key-v1)')
  }

  /**
   * "Stop" the validator — unbinds the key provider.
   */
  async stop(): Promise<void> {
    if (this.liveness !== 'running') return
    unbindKeyProvider('inner')
    this.vault = null
    this.liveness = 'dead'
    console.log('[IN_PROCESS_VALIDATOR] stopped — key provider unbound')
  }

  /**
   * Validate content and produce a cryptographic seal.
   *
   * Only `kind: 'plaintext'` is fully implemented.  The `qbeap_encrypted` and
   * `pbeap` variants were stubs in the old subprocess too; they return
   * ARTEFACT_UNKNOWN_KEY here (same behaviour, no regression).
   *
   * Seal format: uses sealed-storage.computeSeal('inner') which produces
   * { seal, seal_input_json } with the inner (validator-seal-key-v1) key.
   * The seal_input_json format is compatible with the sealed-storage read gate.
   */
  async validate(req: Omit<ValidateRequest, 'request_id'>): Promise<ValidateResponse> {
    if (this.liveness !== 'running') {
      throw new Error('Validator unavailable: not running (call start() first)')
    }
    const request_id = randomUUID()
    const now = new Date().toISOString()

    if (req.plaintext_or_encrypted.kind !== 'plaintext') {
      // Encrypted variants still not wired for in-process path — same stub as before.
      const canonical_json = JSON.stringify({ _stub: true, kind: req.plaintext_or_encrypted.kind })
      const { seal, seal_input_json } = computeSeal(canonical_json, req.target_row_id, 'inner')
      return {
        request_id,
        outcome: {
          ok: false,
          sealed_quarantine: {
            canonical_json,
            seal,
            seal_input_json,
            rejection_reason: 'ARTEFACT_UNKNOWN_KEY',
            validator_version: CONTENT_VALIDATOR_VERSION,
            rejected_at: now,
          },
        },
      }
    }

    const content = req.plaintext_or_encrypted.content
    const canonicalJson = typeof content === 'string' ? content : JSON.stringify(content)
    const result = validateDecryptedBeapContent(content)

    if (result.validation_reason !== null) {
      const { seal, seal_input_json } = computeSeal(canonicalJson, req.target_row_id, 'inner')
      return {
        request_id,
        outcome: {
          ok: false,
          sealed_quarantine: {
            canonical_json: canonicalJson,
            seal,
            seal_input_json,
            rejection_reason: result.validation_reason,
            validator_version: result.validator_version,
            rejected_at: result.validated_at,
          },
        },
      }
    }

    const { seal, seal_input_json } = computeSeal(canonicalJson, req.target_row_id, 'inner')
    return {
      request_id,
      outcome: {
        ok: true,
        sealed: {
          canonical_json: canonicalJson,
          seal,
          seal_input_json,
          validator_version: result.validator_version,
          validated_at: result.validated_at,
        },
      },
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton — same singleton pattern as the old orchestrator
// ─────────────────────────────────────────────────────────────────────────────

export const validatorOrchestrator = new ValidatorOrchestrator()
