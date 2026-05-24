/**
 * Edge message quarantine metadata (Phase 5 — P5.5).
 */

export interface QuarantineMetadata {
  hash: string;
  size: number;
  envelope_from: string;
  envelope_to: string;
  envelope_date: string;
  envelope_subject_filtered: string;
  quarantined_at: string;
  failed_container_role: string;
  failed_stage: string;
  account_id?: string;
  imap_uid?: number;
}

export interface EncryptedQuarantineWire {
  iv: string;
  tag: string;
  ciphertext: string;
}
