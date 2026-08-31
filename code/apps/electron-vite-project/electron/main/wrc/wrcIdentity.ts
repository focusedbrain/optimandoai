/**
 * Run 5 — the SANCTIONED runtime identity source for WR Code resolution.
 *
 * Structural rule (§XVI.7.6 trust boundary): production callers provide
 * untrusted input and request context only. Who the receiver IS — party
 * identifier, publisher part, current device, SSO email, the Principal Key
 * that signs release claims, the publisher's X25519 decryption key — is
 * derived HERE, inside the trust boundary, never accepted from the capture
 * caller. A renderer that could declare `device_party_id = trusted-device-X`
 * would hold Gate 4 by the collar; after Run 5 it cannot.
 *
 * Sources, in order of authority:
 *  - SSO email: the cached SSO session (§XVI.6.5 SSO Identity — the same
 *    principal binding Gate 2 checks against the publisher's DNS-verified
 *    domains). Never an env override: an identity the session did not verify
 *    must not enter the pipeline as "SSO-verified".
 *  - Party/publisher/device identifiers and key material: deployment
 *    configuration (env), because the WRC party model has no settings
 *    surface yet (same posture as the registry endpoint in `wrcRuntime.ts`).
 *    Absent pieces stay absent — the gates that need them fail closed.
 *
 * Everything here is read once per runtime init; tests inject a full
 * identity via the seam in `wrcRuntime.ts`, never through the RPC caller.
 */

import { createHash, createPrivateKey, sign as cryptoSign, type KeyObject } from 'node:crypto'
import type { WrCodeReceiverIdentity } from './gatePipeline'
import type { WrcPrincipalDelegation } from './relayRelease'

/** PKCS8 DER prefix for a raw 32-byte Ed25519 private key (RFC 8410). */
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')
/** PKCS8 DER prefix for a raw 32-byte X25519 private key (RFC 8410). */
const PKCS8_X25519_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex')

const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
const b64url = (b: Buffer) =>
  b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function privateKeyFromRaw(rawB64Url: string, prefix: Buffer): KeyObject | null {
  const raw = fromB64url(rawB64Url)
  if (raw.length !== 32) return null
  try {
    return createPrivateKey({ key: Buffer.concat([prefix, raw]), format: 'der', type: 'pkcs8' })
  } catch {
    return null
  }
}

/** The receiver-side claim identity Gate 5 signs with (§XVI.7.5.5). */
export interface WrcClaimIdentity {
  principal_pub: string
  delegation: WrcPrincipalDelegation | null
  sign(bytes: Buffer): string
}

/** Everything the composition root owns about "who this runtime is". */
export interface WrcRuntimeIdentity {
  /** Gate 2/4 receiver identity — derived, never caller-supplied. */
  receiver: WrCodeReceiverIdentity
  /** Gate 5 claim identity; null = recipient-bound release refuses. */
  claimIdentity: WrcClaimIdentity | null
  /** Gate 6 sealed-nonce key; null = relay capsules cannot admit. */
  decryptKey: KeyObject | null
}

function decodeDelegation(json: string | undefined | null): WrcPrincipalDelegation | null {
  if (!json) return null
  try {
    const v = JSON.parse(json) as WrcPrincipalDelegation
    return v && v.type === 'wrc/delegation-cert' ? v : null
  } catch {
    return null
  }
}

/**
 * Read the deployment identity. `ssoEmail` comes from the caller (the
 * composition root reads the cached SSO session) so this module stays free
 * of the session import cycle.
 */
export function readRuntimeIdentityFromEnvironment(ssoEmail: string | null): WrcRuntimeIdentity {
  const env = process.env
  const receiver: WrCodeReceiverIdentity = {}
  if (env.WRDESK_WRC_PUBLISHER_PART) receiver.publisher_part = env.WRDESK_WRC_PUBLISHER_PART
  if (env.WRDESK_WRC_PARTY_ID) receiver.party_id = env.WRDESK_WRC_PARTY_ID
  if (env.WRDESK_WRC_DEVICE_PARTY_ID) receiver.device_party_id = env.WRDESK_WRC_DEVICE_PARTY_ID
  if (ssoEmail) receiver.sso_email = ssoEmail

  let claimIdentity: WrcClaimIdentity | null = null
  const principalPub = env.WRDESK_WRC_PRINCIPAL_PUB ?? null
  const principalPriv = env.WRDESK_WRC_PRINCIPAL_PRIV ?? null
  if (principalPub && principalPriv) {
    const key = privateKeyFromRaw(principalPriv, PKCS8_ED25519_PREFIX)
    if (key) {
      claimIdentity = {
        principal_pub: principalPub,
        delegation: decodeDelegation(env.WRDESK_WRC_DELEGATION_JSON),
        sign: (bytes) => b64url(cryptoSign(null, bytes, key)),
      }
    }
  }

  const decryptPriv = env.WRDESK_WRC_DECRYPT_PRIV ?? null
  const decryptKey = decryptPriv ? privateKeyFromRaw(decryptPriv, PKCS8_X25519_PREFIX) : null

  return { receiver, claimIdentity, decryptKey }
}

/** sha256 hex of a raw base64url public key — device/principal fingerprint form. */
export function wrcPublicKeyFingerprint(pubB64Url: string): string {
  return createHash('sha256').update(fromB64url(pubB64Url)).digest('hex')
}
