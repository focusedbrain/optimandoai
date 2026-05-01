/**
 * `inbox:cloneBeapToSandbox` / `inbox:beapInboxCloneToSandboxPrepare` — prepare payload and IPC errors.
 * Mirrors `electron/main/email/beapInboxClonePrepare.ts` (kept in sync for renderer + types).
 */

import type { SandboxOrchestratorAvailabilityStatus } from './sandboxOrchestratorAvailability'

export interface BeapInboxClonePrepareOk {
  /** Present when coming from main `prepareBeapInboxSandboxClone`. */
  ok?: true
  source_message_id: string
  source_type: string
  original_response_path: 'email' | 'native_beap'
  reply_transport: 'email' | 'native_beap'
  original_handshake_id: string | null
  original_received_at: string | null
  subject: string
  public_text: string
  encrypted_text: string
  has_attachments: boolean
  content_warning?: string
  from_address: string | null
  target_handshake_id: string
  sandbox_target_device_id: string
  sandbox_target_handshake_id: string
  target_sandbox_device_name: string | null
  sandbox_target_pairing_code: string | null
  clone_reason: 'sandbox_test' | 'external_link_or_artifact_review'
  cloned_at: string
  cloned_by_account: string | null
  live_status_optional: 'relay_connected' | 'relay_disconnected' | 'coordination_disabled'
  last_known_delivery_status: string
  p2p_endpoint_set: boolean
  account_tag: string | null
  /** Present when the clone was triggered from the external-link warning (audit / provenance). */
  triggered_url?: string | null
}

/** Main-process prepare path (not including host envelope errors). */
export type BeapInboxClonePrepareErrorCode =
  | 'MESSAGE_NOT_FOUND'
  | 'MESSAGE_CONTENT_NOT_EXTRACTABLE'
  | 'NO_ACTIVE_SANDBOX_HANDSHAKE'
  | 'INCOMPLETE_SANDBOX_KEYING'
  | 'TARGET_HANDSHAKE_REQUIRED'
  | 'SANDBOX_TARGET_NOT_CONNECTED'
  | 'PREPARE_FAILED'

export type BeapInboxCloneNoSandboxDetails = {
  eligible_count: 0
  internal_sandbox_list_count: number
  relay_connected: boolean
  use_coordination: boolean
  availability_status: SandboxOrchestratorAvailabilityStatus
}

export type CloneBeapToSandboxIpcErrorCode =
  | BeapInboxClonePrepareErrorCode
  | 'NOT_HOST_ORCHESTRATOR'
  | 'UNAUTHENTICATED'
  | 'DB_UNAVAILABLE'
  | 'SANDBOX_SEND_FAILED'

/**
 * `inbox:cloneBeapToSandbox` success: prepare only (renderer builds new qBEAP + send).
 * Failure: `code` is set for NO_ACTIVE_SANDBOX_HANDSHAKE and other structured cases.
 */
export type CloneBeapToSandboxIpcResult =
  | { success: true; prepare: BeapInboxClonePrepareOk }
  | {
      success: false
      error: string
      code?: CloneBeapToSandboxIpcErrorCode
      details?: BeapInboxCloneNoSandboxDetails | Record<string, unknown>
    }
