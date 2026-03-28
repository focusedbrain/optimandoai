/**
 * Shared types for BEAP UI components.
 * These are presentation types — no crypto, no IPC, no store imports.
 */

/** Draft state for capsule composition (public + encrypted fields) */
export interface CapsuleDraftState {
  publicText: string
  encryptedText: string
  selectedSessionId: string | null
}

/** Session option for the session selector dropdown */
export interface SessionOption {
  id: string
  name: string
  description?: string
}

/** Attachment item displayed in the attachment picker */
export interface AttachmentItem {
  name: string
  id?: string
  size?: number
}

/** Session reference attached to a BEAP message (receiver view) */
export interface BeapMessageBodySessionRef {
  sessionId: string
  sessionName?: string
  requiredCapability?: string
}
