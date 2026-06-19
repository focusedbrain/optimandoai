/**
 * Phase C — parallel Host AI control-plane over sealed relay (/beap/capsule).
 * WRDESK_UNIFIED_SERVICE_RPC_RELAY: runtime/env only, default OFF (INV-HOSTAI-FROZEN).
 * No persisted state — flip off for instant revert to /beap/p2p-signal path.
 */

function envTrue(k: string): boolean {
  const v = (process.env[k] ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

function readUnifiedRelayBool(k: string): { value: boolean; fromEnv: boolean } {
  const raw = process.env[k]
  if (raw === undefined) {
    return { value: false, fromEnv: false }
  }
  const t = String(raw).trim()
  if (t === '') {
    return { value: false, fromEnv: false }
  }
  const l = t.toLowerCase()
  if (l === '0' || l === 'false' || l === 'no') return { value: false, fromEnv: true }
  if (l === '1' || l === 'true' || l === 'yes') return { value: true, fromEnv: true }
  return { value: false, fromEnv: true }
}

let _cached: boolean | null = null
let _fromEnv = false

/** True when WRDESK_UNIFIED_SERVICE_RPC_RELAY=1 — experimental sealed-relay control plane. */
export function isUnifiedServiceRpcRelayEnabled(): boolean {
  if (_cached !== null) return _cached
  const r = readUnifiedRelayBool('WRDESK_UNIFIED_SERVICE_RPC_RELAY')
  _cached = r.value
  _fromEnv = r.fromEnv
  return _cached
}

export function getUnifiedServiceRpcRelayFlagFromEnvForTests(): boolean {
  void isUnifiedServiceRpcRelayEnabled()
  return _fromEnv
}

export function resetUnifiedServiceRpcRelayFlagsForTests(): void {
  _cached = null
  _fromEnv = false
}

/** INV-ENCRYPT: unified relay mode forbids plaintext HTTP inference fallback. */
export function blocksPlaintextHttpInferenceFallback(): boolean {
  return isUnifiedServiceRpcRelayEnabled()
}
