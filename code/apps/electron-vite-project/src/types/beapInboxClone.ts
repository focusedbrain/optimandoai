/**
 * Response shape for `inbox:beapInboxCloneToSandboxPrepare` → `prepare` (mirrors main `beapInboxClonePrepare.ts`).
 */
export interface BeapInboxClonePrepareOk {
  /** Present when coming from main `prepareBeapInboxSandboxClone`. */
  ok?: true
  source_message_id: string
  source_type: string
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
  sandbox_target_pairing_code: string | null
  cloned_at: string
  cloned_by_account: string | null
  live_status_optional: 'relay_connected' | 'relay_disconnected' | 'coordination_disabled'
  last_known_delivery_status: string
  p2p_endpoint_set: boolean
  account_tag: string | null
}
