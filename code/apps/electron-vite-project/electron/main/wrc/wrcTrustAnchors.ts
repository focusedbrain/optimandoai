/**
 * The WRC trust configuration a RELEASE build ships with.
 *
 * §XVI.6.4: the directory operator's public key "is distributed with the
 * runtime (pinned)". A release build reads its registry endpoint, ingest
 * countersigner and directory-operator anchor from this constant and from
 * nowhere else — no environment variable can replace them, so launching the
 * app with a doctored environment cannot point it at a foreign registry.
 *
 * Null until the production WRC service and its operator key exist: a release
 * build then runs unconfigured and every WR Code resolution fails closed with
 * `not_configured`. Setting it is a reviewed source change, never deployment
 * configuration.
 */

export interface WrcPinnedTrust {
  registryBaseUrl: string
  /** Raw base64url Ed25519 public key of the WRC ingest countersigner. */
  ingestPublicKey: string
  directoryOperatorKid: string
  /** Raw base64url Ed25519 public key of the directory operator. */
  directoryOperatorPub: string
}

export const WRC_RELEASE_TRUST: WrcPinnedTrust | null = null

/**
 * Key-id prefix reserved for the built-in test registry. A release build
 * refuses any pinned anchor carrying it, so test trust can never ship.
 */
export const WRC_TEST_KID_PREFIX = 'test-'
