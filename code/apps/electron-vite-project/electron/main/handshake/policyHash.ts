/**
 * Policy Hash Computation
 *
 * Computes a deterministic SHA-256 hex digest over a canonical policy object.
 * The sender includes `wrdesk_policy_hash` in every handshake capsule so the
 * receiver can verify the sender is operating under a known policy version.
 *
 * Algorithm:
 *   1. Construct a canonical object with only the fields that define policy identity.
 *   2. Serialize to JSON with sorted keys (deterministic).
 *   3. Compute SHA-256 over UTF-8 bytes of the JSON string.
 *   4. Return lowercase hex string (64 characters).
 *
 * The receiver adds accepted hashes to `ReceiverPolicy.acceptedWrdeskPolicyHashes`.
 * The wildcard `'*'` in that list accepts any non-empty hash (MVP open-policy mode).
 */

import { createHash } from 'crypto'

export interface PolicyDescriptor {
  /** Human-readable version string, e.g. '1.0' */
  version: string;
  /** External processing mode allowed by this policy */
  external_processing: 'none' | 'local_only' | string;
  /** Whether cloud escalation is permitted */
  allows_cloud_escalation: boolean;
  /** Whether export is permitted */
  allows_export: boolean;
  /** Minimum handshake tier this policy requires of the counterparty */
  minimum_tier: 'free' | 'pro' | 'publisher' | 'enterprise';
  /** Sharing modes this policy allows */
  allowed_sharing_modes: readonly string[];
}

export const DEFAULT_POLICY_DESCRIPTOR: PolicyDescriptor = {
  version: '1.0',
  external_processing: 'none',
  allows_cloud_escalation: false,
  allows_export: false,
  minimum_tier: 'free',
  allowed_sharing_modes: ['receive-only', 'reciprocal'],
}

/**
 * Compute a deterministic SHA-256 hash of a PolicyDescriptor.
 * Returns a 64-character lowercase hex string.
 */
export function computePolicyHash(policy: PolicyDescriptor): string {
  const canonical = {
    allows_cloud_escalation: policy.allows_cloud_escalation,
    allows_export: policy.allows_export,
    allowed_sharing_modes: [...policy.allowed_sharing_modes].sort(),
    external_processing: policy.external_processing,
    minimum_tier: policy.minimum_tier,
    version: policy.version,
  }
  const json = JSON.stringify(canonical)
  return createHash('sha256').update(json, 'utf8').digest('hex')
}

/**
 * The hash of DEFAULT_POLICY_DESCRIPTOR — precomputed for convenience.
 * Receivers can add this to `acceptedWrdeskPolicyHashes` to accept senders
 * using the standard default policy without running the hash at runtime.
 */
export const DEFAULT_POLICY_HASH: string = computePolicyHash(DEFAULT_POLICY_DESCRIPTOR)
