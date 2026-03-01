/**
 * Handshake Module
 *
 * BEAP handshake management — backed by the Electron pipeline via RPC.
 */

// New backend-backed types
export * from './rpcTypes'

// New RPC client
export * from './handshakeRpc'

// New hook (reads from backend RPC)
export { useHandshakes } from './useHandshakes'

// Legacy types (kept for non-handshake uses like fingerprint utilities)
export * from './types'

// Utilities
export * from './fingerprint'

// Handshake Service (identity — getOurIdentity for fingerprint display)
export * from './handshakeService'

// Microcopy
export * from './microcopy'

// Components
export * from './components'

// Full-Auto status (uses new RPC-backed system)
export { useFullAutoStatus } from './useFullAutoStatus'
