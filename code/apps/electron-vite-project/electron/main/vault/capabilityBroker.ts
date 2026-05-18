/**
 * Capability broker — single source of truth for whether a vault-gated
 * operation can proceed.
 *
 * Reads outer/inner vault state via vaultCanon, sealed-storage key provider
 * binding, and validator liveness.  Maps to a structured result with a
 * canonical reasonCode.
 *
 * This module encodes the current (pre-Wave-4) behavior: every BEAP
 * operation requires the inner vault to be unlocked.  Wave 4 will modify
 * the mapping table so non-confidential BEAP operations require only the
 * outer vault (SSO ledger).
 *
 * No callers are wired up in this prompt.  Future prompts will route gate
 * decisions through canPerform().
 */

import { getVaultStatusReport } from './vaultCanon'
import { isKeyProviderBound } from '../sealed-storage'
import { validatorOrchestrator } from '../validator-process/orchestrator'

export type OperationKind =
  | 'beap_send'
  | 'beap_receive'
  | 'beap_clone'
  | 'beap_receive_confidential'
  | 'context_sync'
  | 'inbox_read_confidential'

export type ReasonCode =
  | 'ok'
  | 'outer_vault_inactive'
  | 'inner_vault_locked'
  | 'key_provider_unbound'
  | 'validator_unhealthy'
  | 'ledger_db_unavailable'

export type RetryStrategy =
  | 'auto_on_unlock'
  | 'user_action'
  | 'transient'

export interface CapabilityResult {
  allowed: boolean
  reasonCode: ReasonCode
  userMessage: string
  retryStrategy: RetryStrategy
}

const OK: CapabilityResult = {
  allowed: true,
  reasonCode: 'ok',
  userMessage: '',
  retryStrategy: 'transient',
}

/**
 * Returns whether an operation can proceed given current vault, key provider,
 * and validator state.  Pure read — no side effects.
 *
 * Priority order (checked top-to-bottom):
 *   1. Outer vault inactive (SSO logged out) → outer_vault_inactive
 *   2. Inner vault locked (master password not entered) → inner_vault_locked
 *   3. Key provider not bound (sealed-storage not ready) → key_provider_unbound
 *   4. Validator subprocess not running → validator_unhealthy
 *   5. All clear → ok
 *
 * context_sync skips checks 3–4: it only needs the inner vault to build and
 * enqueue; it does not directly call sealed-storage or the validator.
 */
export function canPerform(op: OperationKind): CapabilityResult {
  const status = getVaultStatusReport()

  // Always require the outer vault (SSO session / ledger).
  if (!status.outerActive) {
    return {
      allowed: false,
      reasonCode: 'outer_vault_inactive',
      userMessage: 'Please sign in to continue.',
      retryStrategy: 'user_action',
    }
  }

  // Wave 2 mapping table — encodes today's behavior.
  // Every BEAP operation requires inner vault unlocked.
  // Wave 4 will add a branch here for non-confidential ops that need
  // only outerActive + ledger seal key bound + validator running.
  switch (op) {
    case 'beap_send':
    case 'beap_receive':
    case 'beap_clone':
    case 'beap_receive_confidential':
    case 'inbox_read_confidential': {
      if (!status.innerUnlocked) {
        return {
          allowed: false,
          reasonCode: 'inner_vault_locked',
          userMessage: 'Please unlock your vault to continue.',
          retryStrategy: 'auto_on_unlock',
        }
      }
      if (!isKeyProviderBound()) {
        return {
          allowed: false,
          reasonCode: 'key_provider_unbound',
          userMessage: 'Storage is not ready. Please wait or restart the app.',
          retryStrategy: 'transient',
        }
      }
      if (validatorOrchestrator.getLiveness() !== 'running') {
        return {
          allowed: false,
          reasonCode: 'validator_unhealthy',
          userMessage: 'Validation service is unavailable. Please restart the app.',
          retryStrategy: 'transient',
        }
      }
      return OK
    }

    case 'context_sync': {
      if (!status.innerUnlocked) {
        return {
          allowed: false,
          reasonCode: 'inner_vault_locked',
          userMessage: 'Context sync waiting for vault unlock.',
          retryStrategy: 'auto_on_unlock',
        }
      }
      return OK
    }
  }
}
