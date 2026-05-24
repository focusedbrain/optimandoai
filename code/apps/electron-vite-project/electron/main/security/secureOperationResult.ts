/**
 * Shared discriminated unions for sensitive / vault-gated operations.
 * Used to surface deferral, retry, and failure consistently without altering wire formats.
 */

export type SecureOperationReason =
  | 'NEEDS_OUTER_VAULT'
  | 'NEEDS_INNER_VAULT'
  | 'VAULT_LOCKED'
  | 'HANDSHAKE_PENDING'
  | 'KEY_MISSING'
  | 'QUEUE_PROCESSING_FAILED'
  | 'DECRYPT_PENDING'
  | 'NETWORK_RETRY_PENDING'
  | 'PERMANENT_PROTOCOL_ERROR'
  | 'UNKNOWN_ERROR'

export type SecureOperationState =
  | 'ok'
  | 'waiting_for_unlock'
  | 'queued_until_unlock'
  | 'retry_pending'
  | 'failed_retryable'
  | 'failed_permanent'

export interface SecureOperationFailure {
  ok: false
  reason: SecureOperationReason
  state: SecureOperationState
  userVisible: true
  retryable: boolean
  operation: string
  message: string
  safeDetails?: string
}

export interface SecureOperationSuccess {
  ok: true
}

export type SecureOperationResult = SecureOperationSuccess | SecureOperationFailure

export function secureFailure(input: {
  operation: string
  reason: SecureOperationReason
  state: SecureOperationState
  retryable: boolean
  message: string
  safeDetails?: string
}): SecureOperationFailure {
  return {
    ok: false,
    userVisible: true,
    ...input,
  }
}
