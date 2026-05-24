/**
 * BEAP edge certificate types — strategy §2.2.
 *
 * The certificate is a gate, not a substitute for validation. Signature verification
 * here covers only Ed25519 math; SSO attestation, hash binding, and expiry are
 * composed separately by the verifier role.
 */

/** Certificate version. Strategy §2.2 uses v: 1. */
export type EdgeCertificateVersion = 1;

/**
 * Fields signed by the edge certifier (REMOTE_EDGE). All fields except
 * `edge_signature` are included in the canonical serialization.
 */
export interface UnsignedCertificate {
  v: EdgeCertificateVersion;
  package_hash: string;
  capsule_canonical_hash: string;
  validation_result_digest: string;
  edge_pod_id: string;
  issued_at: string;
  expires_at: string;
  sso_attestation: string;
}

/** Signed edge certificate returned by the certifier role. */
export interface EdgeCertificate extends UnsignedCertificate {
  /** Ed25519 signature over the canonical unsigned fields: `ed25519:<hex>`. */
  edge_signature: string;
}
