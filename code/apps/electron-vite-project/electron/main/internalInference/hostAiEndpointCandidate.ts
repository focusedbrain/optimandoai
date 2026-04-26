/**
 * Host AI direct-BEAP endpoint selection: explicit URL provenance, owner binding, and trust levels.
 * Used by `resolveSandboxToHostHttpDirectIngest` (sandbox → counterparty host for HTTP cap/inference).
 */

export type HostAiEndpointSource =
  | 'peer_advertised_header'
  | 'signed_peer_advertisement'
  | 'internal_handshake_ledger'
  | 'relay_control_plane'
  | 'local_beap'
  | 'unknown'

export type HostAiEndpointTrustLevel =
  | 'peer_signed'
  | 'relay_authenticated'
  | 'ledger_trusted'
  | 'local_only'
  | 'unknown'

/**
 * A single candidate URL with ownership and trust metadata (rejected or accepted).
 */
export type HostAiEndpointCandidate = {
  url: string
  source: HostAiEndpointSource
  owner_device_id: string
  /** When ledger coordination is incomplete, owner role may be unknown. */
  owner_role: 'host' | 'sandbox' | 'unknown'
  handshake_id: string
  observed_by_device_id: string
  created_at: string
  /** Optional absolute expiry; header/ledger paths may not set this yet. */
  expires_at: string | null
  /** Policy timeout hint (e.g. host inference policy) — informational. */
  ttl_ms: number | null
  trust_level: HostAiEndpointTrustLevel
  rejection_reason: string | null
}

export type HostAiEndpointResolutionCategory =
  | 'accepted_peer_header'
  | 'accepted_relay_ad'
  | 'accepted_ledger'
  | 'rejected_no_endpoint'
  | 'rejected_self_local_beap'
  | 'rejected_owner_mismatch'
  | 'rejected_peer_ad_owner_sandbox'
  | 'rejected_provenance_incomplete'
  | 'rejected_stale'
  | 'rejected_inconsistent_owner'

/**
 * Provenance for what was selected or attempted; never "none" when a concrete URL is in play
 * (use `not_applicable` only when no URL is selected).
 */
export type HostAiSelectedEndpointProvenance =
  | HostAiEndpointSource
  | 'not_applicable'
  | 'rejected'
