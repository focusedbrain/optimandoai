/**
 * Handshake Module
 *
 * BEAP handshake management — backed by the Electron pipeline via RPC.
 */

// New backend-backed types
export * from './rpcTypes'

// New RPC client
export * from './handshakeRpc'

// ML-KEM secret storage helpers (get + remove; secrets are written exclusively by Electron DB now)
export * from './mlkemHandshakeStorage'

// New hook (reads from backend RPC)
export { useHandshakes } from './useHandshakes'
export { usePendingP2PBeapIngestion } from './usePendingP2PBeapIngestion'
export { processPendingP2PBeapQueue } from './pendingP2PBeapQueue'
export { usePendingPlainEmailIngestion } from './usePendingPlainEmailIngestion'

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

