/**
 * Capability broker — single source of truth for whether a vault-gated
 * operation can proceed.
 *
 * Reads outer/inner vault state via vaultCanon, sealed-storage key provider
 * binding, and validator liveness.  Maps to a structured result with a
 * canonical reasonCode.
 *
 * Routing table (W4-P11):
 *   Non-confidential BEAP (default): outer vault active + outer key bound → ok.
 *     No inner vault or validator subprocess required (SSO-only path).
 *   Confidential BEAP: inner vault unlocked + inner key bound + validator running.
 *   Explicit-confidential ops (beap_receive_confidential, inbox_read_confidential):
 *     always require inner vault regardless of handshake classification.
 *   context_sync: requires inner vault (unchanged).
 */

import { getVaultStatusReport, getHandshakeClassification } from './vaultCanon'
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
 *   2. Classification-dependent checks:
 *      Non-confidential (default): outer key provider bound → ok
 *      Confidential:               inner vault unlocked + inner key bound
 *                                  + validator running → ok
 *   3. All clear → ok
 *
 * ctx.handshakeId, if provided, is used to derive the classification.
 * Callers that don't have a handshake id (e.g. generic send-side checks)
 * default to 'non_confidential', which is the permissive branch.
 *
 * context_sync: unchanged — always requires inner vault, no key/validator check.
 * beap_receive_confidential / inbox_read_confidential: always require inner vault
 * regardless of classification (they are explicitly confidential operations).
 */
export function canPerform(
  op: OperationKind,
  ctx?: { handshakeId?: string },
): CapabilityResult {
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

  switch (op) {
    case 'beap_send':
    case 'beap_receive':
    case 'beap_clone': {
      const classification = ctx?.handshakeId
        ? getHandshakeClassification(ctx.handshakeId)
        : 'non_confidential'

      if (classification === 'confidential') {
        // Confidential path: inner vault + inner key + validator required.
        if (!status.innerUnlocked) {
          return {
            allowed: false,
            reasonCode: 'inner_vault_locked',
            userMessage: 'Please unlock your vault to view this confidential message.',
            retryStrategy: 'auto_on_unlock',
          }
        }
        if (!isKeyProviderBound('inner')) {
          return {
            allowed: false,
            reasonCode: 'key_provider_unbound',
            userMessage: 'Storage is initializing. Please wait.',
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
      } else {
        // Non-confidential path: outer key bound is sufficient.
        // No inner vault or validator required for SSO-only BEAP.
        if (!isKeyProviderBound('outer')) {
          return {
            allowed: false,
            reasonCode: 'key_provider_unbound',
            userMessage: 'Session storage is initializing. Please wait.',
            retryStrategy: 'transient',
          }
        }
      }
      return OK
    }

    case 'beap_receive_confidential':
    case 'inbox_read_confidential': {
      // Always require inner vault regardless of handshake classification —
      // these operation kinds are explicitly confidential.
      if (!status.innerUnlocked) {
        return {
          allowed: false,
          reasonCode: 'inner_vault_locked',
          userMessage: 'Please unlock your vault to view this confidential message.',
          retryStrategy: 'auto_on_unlock',
        }
      }
      if (!isKeyProviderBound('inner')) {
        return {
          allowed: false,
          reasonCode: 'key_provider_unbound',
          userMessage: 'Storage is initializing. Please wait.',
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
      // Unchanged: context_sync defers when inner locked.
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
