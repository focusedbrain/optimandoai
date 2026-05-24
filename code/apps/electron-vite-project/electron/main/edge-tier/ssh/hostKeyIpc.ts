/**
 * IPC helpers for SSH host key mismatch errors — P4.5.13.
 */

import {
  isHostKeyMismatchError,
  toHostKeyMismatchPayload,
  type HostKeyMismatchPayload,
} from './hostKeyPinning.js'

export interface HostKeyAwareActionFailure {
  readonly ok: false
  readonly error: string
  readonly hostKeyMismatch?: HostKeyMismatchPayload
}

export function toHostKeyAwareFailure(err: unknown): HostKeyAwareActionFailure {
  if (isHostKeyMismatchError(err)) {
    return {
      ok: false,
      error: err.message,
      hostKeyMismatch: toHostKeyMismatchPayload(err),
    }
  }
  return {
    ok: false,
    error: err instanceof Error ? err.message : String(err),
  }
}
