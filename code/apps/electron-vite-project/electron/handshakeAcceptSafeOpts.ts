/**
 * Pure builder for `handshake:accept` IPC options — shared with preload tests.
 * Forwards an explicit allowlist only (no pass-through of arbitrary objects).
 * Internal vs normal and X25519 requirements are decided in main using persisted
 * `record.handshake_type` — this module does not use `device_role` as proof of internal.
 */

const MAX_B64 = 8192
const MAX_NAME = 512
const MAX_PEER_STR = 2048

function trimStr(v: unknown, max: number): string {
  if (typeof v !== 'string') return ''
  const t = v.trim()
  if (!t) return ''
  return t.length > max ? t.slice(0, max) : t
}

function optString(opts: Record<string, unknown>, key: string, max: number): string | undefined {
  const t = trimStr(opts[key], max)
  return t || undefined
}

/**
 * `key_agreement` — only the two public key fields; strips extra nested keys and non-strings.
 */
function safeKeyAgreement(raw: unknown): { x25519_public_key_b64?: string; mlkem768_public_key_b64?: string } | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const ka = raw as Record<string, unknown>
  const out: { x25519_public_key_b64?: string; mlkem768_public_key_b64?: string } = {}
  const x = trimStr(ka.x25519_public_key_b64, MAX_B64)
  const m = trimStr(ka.mlkem768_public_key_b64, MAX_B64)
  if (x) out.x25519_public_key_b64 = x
  if (m) out.mlkem768_public_key_b64 = m
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * Shallow allowlist for policy — not arbitrary server/renderer objects.
 */
function safePolicySelections(raw: unknown): Record<string, unknown> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const out: Record<string, unknown> = {}
  if (typeof o.cloud_ai === 'boolean') out.cloud_ai = o.cloud_ai
  if (typeof o.internal_ai === 'boolean') out.internal_ai = o.internal_ai
  const ap = trimStr(o.ai_processing_mode, 64)
  if (ap) out.ai_processing_mode = ap
  return Object.keys(out).length > 0 ? out : undefined
}

export function buildHandshakeAcceptSafeOpts(contextOpts: unknown): Record<string, unknown> | undefined {
  if (!contextOpts || typeof contextOpts !== 'object' || Array.isArray(contextOpts)) {
    return undefined
  }
  const opts = contextOpts as Record<string, unknown>
  const out: Record<string, unknown> = {}

  if (Array.isArray(opts.context_blocks)) out.context_blocks = opts.context_blocks
  if (Array.isArray(opts.profile_ids)) out.profile_ids = opts.profile_ids
  if (Array.isArray(opts.profile_items)) out.profile_items = opts.profile_items

  const pol = safePolicySelections(opts.policy_selections)
  if (pol) out.policy_selections = pol

  const senderX = optString(opts, 'senderX25519PublicKeyB64', MAX_B64)
  if (senderX) out.senderX25519PublicKeyB64 = senderX
  const senderSnake = optString(opts, 'sender_x25519_public_key_b64', MAX_B64)
  if (senderSnake) out.sender_x25519_public_key_b64 = senderSnake

  const ka = safeKeyAgreement(opts.key_agreement)
  if (ka) out.key_agreement = ka

  const mlkPub = optString(opts, 'senderMlkem768PublicKeyB64', MAX_B64)
  if (mlkPub) out.senderMlkem768PublicKeyB64 = mlkPub
  const mlkSec = optString(opts, 'senderMlkem768SecretKeyB64', MAX_B64)
  if (mlkSec) out.senderMlkem768SecretKeyB64 = mlkSec

  const deviceName = optString(opts, 'device_name', MAX_NAME)
  if (deviceName) out.device_name = deviceName
  if (opts.device_role === 'host' || opts.device_role === 'sandbox') {
    out.device_role = opts.device_role
  }

  const id = optString(opts, 'internal_peer_device_id', MAX_PEER_STR)
  if (id) out.internal_peer_device_id = id
  const irole = optString(opts, 'internal_peer_device_role', 64)
  if (irole) out.internal_peer_device_role = irole
  const icn = optString(opts, 'internal_peer_computer_name', MAX_NAME)
  if (icn) out.internal_peer_computer_name = icn
  const ipc = optString(opts, 'internal_peer_pairing_code', 32)
  if (ipc) out.internal_peer_pairing_code = ipc

  if (typeof opts.local_pairing_code_typed === 'string' && /^\d{6}$/.test(opts.local_pairing_code_typed.trim())) {
    out.local_pairing_code_typed = opts.local_pairing_code_typed.trim()
  }

  return out
}
