/**
 * Pure builder for `handshake:accept` IPC options — shared with preload tests.
 * Validates normal cross-principal X25519 presence; forwards only allowlisted fields.
 */

export function buildHandshakeAcceptSafeOpts(
  contextOpts: unknown,
  errIfNormalMissingX25519: string,
): Record<string, unknown> | undefined {
  const opts = contextOpts && typeof contextOpts === 'object' ? (contextOpts as Record<string, unknown>) : undefined
  const internalAccept = !!(opts && (opts.device_role === 'host' || opts.device_role === 'sandbox'))

  const trimmedNonEmpty = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

  let keyAgreementX25519 = ''
  let keyAgreementMlkemPub = ''
  if (opts && opts.key_agreement !== null && typeof opts.key_agreement === 'object') {
    const ka = opts.key_agreement as Record<string, unknown>
    keyAgreementX25519 = trimmedNonEmpty(ka.x25519_public_key_b64)
    keyAgreementMlkemPub = trimmedNonEmpty(ka.mlkem768_public_key_b64)
  }

  const senderX25519Camel = opts ? trimmedNonEmpty(opts.senderX25519PublicKeyB64) : ''
  const senderX25519Snake = opts ? trimmedNonEmpty(opts.sender_x25519_public_key_b64) : ''
  const hasAnyX25519 = !!(senderX25519Camel || senderX25519Snake || keyAgreementX25519)

  if (opts && !internalAccept && !hasAnyX25519) {
    throw new Error(errIfNormalMissingX25519)
  }

  const safeKeyAgreement: { x25519_public_key_b64?: string; mlkem768_public_key_b64?: string } = {}
  if (keyAgreementX25519) safeKeyAgreement.x25519_public_key_b64 = keyAgreementX25519
  if (keyAgreementMlkemPub) safeKeyAgreement.mlkem768_public_key_b64 = keyAgreementMlkemPub

  const senderMlkemPub = opts ? trimmedNonEmpty(opts.senderMlkem768PublicKeyB64) : ''
  const senderMlkemSecret = opts ? trimmedNonEmpty(opts.senderMlkem768SecretKeyB64) : ''

  if (!opts) return undefined

  return {
    ...(Array.isArray(opts.context_blocks) ? { context_blocks: opts.context_blocks } : {}),
    ...(Array.isArray(opts.profile_ids) ? { profile_ids: opts.profile_ids } : {}),
    ...(Array.isArray(opts.profile_items) ? { profile_items: opts.profile_items } : {}),
    ...(opts.policy_selections && typeof opts.policy_selections === 'object' ? { policy_selections: opts.policy_selections } : {}),
    ...(senderX25519Camel ? { senderX25519PublicKeyB64: senderX25519Camel } : {}),
    ...(senderX25519Snake ? { sender_x25519_public_key_b64: senderX25519Snake } : {}),
    ...(Object.keys(safeKeyAgreement).length > 0 ? { key_agreement: safeKeyAgreement } : {}),
    ...(senderMlkemPub ? { senderMlkem768PublicKeyB64: senderMlkemPub } : {}),
    ...(senderMlkemSecret ? { senderMlkem768SecretKeyB64: senderMlkemSecret } : {}),
    ...(typeof opts.device_name === 'string' && opts.device_name.trim() ? { device_name: opts.device_name.trim() } : {}),
    ...(opts.device_role === 'host' || opts.device_role === 'sandbox' ? { device_role: opts.device_role } : {}),
    ...(typeof opts.local_pairing_code_typed === 'string' && /^\d{6}$/.test(opts.local_pairing_code_typed.trim())
      ? { local_pairing_code_typed: opts.local_pairing_code_typed.trim() }
      : {}),
  }
}
