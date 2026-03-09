/**
 * Shared Handshake IPC Types
 *
 * Types shared between Electron main process and Chrome extension
 * for the handshake IPC contract.
 */

export type HandshakeTier = 'free' | 'pro' | 'publisher' | 'enterprise';
export type SharingMode = 'receive-only' | 'reciprocal';
export type ActionType =
  | 'read-context'
  | 'write-context'
  | 'decrypt-payload'
  | 'semantic-search'
  | 'cloud-escalation'
  | 'export-context';

export enum HandshakeState {
  DRAFT = 'DRAFT',
  PENDING_ACCEPT = 'PENDING_ACCEPT',
  ACTIVE = 'ACTIVE',
  EXPIRED = 'EXPIRED',
  REVOKED = 'REVOKED',
}

// ── Per-item policy (Phase 2 fine-grained governance) ──

export type PolicySelection = { cloud_ai?: boolean; internal_ai?: boolean }

export type PolicyMode = 'inherit' | 'override'

/** Per-item policy: inherit global default or override with explicit policy */
export interface ContextItemPolicy {
  policy_mode: PolicyMode
  policy?: PolicySelection
}

/** Vault profile item with per-item policy */
export interface ProfileContextItem {
  profile_id: string
  policy_mode?: PolicyMode
  policy?: PolicySelection
}

/** Context block with optional per-item policy (for ad-hoc blocks) */
export interface ContextBlockWithPolicy {
  block_id: string
  block_hash: string
  type: string
  content: string | Record<string, unknown>
  scope_id?: string
  policy_mode?: PolicyMode
  policy?: PolicySelection
}

// ── Extension → Main ──

export type HandshakeIPCRequest =
  | { type: 'query-handshake-status'; handshakeId: string }
  | { type: 'request-context-blocks'; handshakeId: string; scopes: string[] }
  | { type: 'authorize-action'; handshakeId: string; action: ActionType; scopes: string[] }
  | { type: 'initiate-revocation'; handshakeId: string }
  | { type: 'list-handshakes'; filter?: { state?: HandshakeState; relationship_id?: string } };

// ── Main → Extension (responses) ──

export type HandshakeIPCResponse =
  | { type: 'handshake-status'; record: unknown | null; reason: string }
  | { type: 'context-blocks'; blocks: unknown[]; reason: string }
  | { type: 'authorization-result'; allowed: boolean; reason: string }
  | { type: 'revocation-result'; success: boolean; reason: string }
  | { type: 'handshake-list'; records: unknown[] };

// ── Main → Extension (push events) ──

export type HandshakeIPCEvent =
  | { type: 'handshake-pending'; handshakeId: string; senderEmail: string; tier: HandshakeTier; reciprocalAllowed: boolean }
  | { type: 'handshake-activated'; handshakeId: string; tier: HandshakeTier; sharingMode: SharingMode }
  | { type: 'handshake-revoked'; handshakeId: string }
  | { type: 'handshake-expired'; handshakeId: string }
  | { type: 'context-updated'; handshakeId: string; newBlockIds: string[] }
  | { type: 'tier-changed'; handshakeId: string; oldTier: HandshakeTier; newTier: HandshakeTier };
