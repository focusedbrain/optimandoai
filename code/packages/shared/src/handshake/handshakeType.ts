/**
 * Handshake type taxonomy (PR4.5 — edge_ingestor distinct from sandbox internal).
 */

export const HANDSHAKE_TYPES = ['standard', 'internal', 'edge_ingestor'] as const

export type HandshakeType = (typeof HANDSHAKE_TYPES)[number]

export function parseHandshakeType(value: unknown): HandshakeType | null {
  if (value === 'standard' || value === 'internal' || value === 'edge_ingestor') {
    return value
  }
  return null
}

/** Same SSO principal (orchestrator + verification server, or two orchestrator devices). */
export function isSameUserHandshake(type: HandshakeType | null | undefined): boolean {
  return type === 'internal' || type === 'edge_ingestor'
}

/** Sandbox-internal orchestrator ↔ sandbox device (inference relay, AI workflows). */
export function isSandboxInternalHandshake(type: HandshakeType | null | undefined): boolean {
  return type === 'internal'
}

/** Orchestrator ↔ edge Agent verification server (email ingest only). */
export function isEdgeIngestorHandshake(type: HandshakeType | null | undefined): boolean {
  return type === 'edge_ingestor'
}

export function handshakeTypeUserLabel(type: HandshakeType | null | undefined): string {
  switch (type) {
    case 'internal':
      return 'Sandbox device'
    case 'edge_ingestor':
      return 'Verification server'
    case 'standard':
      return 'External contact'
    default:
      return 'Handshake'
  }
}

/** Exhaustiveness helper for compile-time guards in tests and switches. */
export function assertHandshakeTypeExhaustive(type: HandshakeType): void {
  switch (type) {
    case 'standard':
    case 'internal':
    case 'edge_ingestor':
      return
    default: {
      const _exhaustive: never = type
      throw new Error(`Unhandled handshake_type: ${String(_exhaustive)}`)
    }
  }
}
