/**
 * Handshake Module
 *
 * BEAP handshake management — backed by the Electron pipeline via RPC.
 */

// New backend-backed types
export * from './rpcTypes'

// New RPC client
export * from './handshakeRpc'

// New hook (replaces useHandshakeStore for reads)
export { useHandshakes } from './useHandshakes'

// Legacy types (kept for non-handshake uses like fingerprint utilities)
export * from './types'

// Utilities
export * from './fingerprint'

// Payload Serialization & Parsing (legacy — may be deprecated)
export * from './handshakePayload'

// Handshake Service (legacy identity + payload creation)
export * from './handshakeService'

// Microcopy
export * from './microcopy'

// Components
export * from './components'

// Store hooks (deprecated — use useHandshakes instead for reads)
export { useFullAutoStatus } from './useHandshakeStore'
