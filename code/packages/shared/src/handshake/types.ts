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
