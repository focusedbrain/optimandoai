/**
 * SSOSession Factory
 *
 * Constructs a validated SSOSession from JWT claims and live attestation state.
 * Callers (IPC handlers, app bootstrap) use this to build the session object
 * required by the handshake pipeline entry point.
 *
 * The session is intentionally simple: it reflects the currently authenticated
 * user's identity and attestation evidence at the time of the call.
 */

import type { SSOSession } from './types'

export interface JwtClaims {
  /** Canonical wrdesk user ID */
  wrdesk_user_id: string;
  /** Email address */
  email: string;
  /** Issuer (iss) */
  iss: string;
  /** Subject (sub) */
  sub: string;
  /** Subscription plan */
  plan: 'free' | 'pro' | 'publisher' | 'enterprise';
  /** Session expiry (ISO 8601) */
  session_expires_at: string;
}

export interface AttestationState {
  hardwareAttestation: { verified: true; fresh: boolean; attestedAt: string } | null;
  dnsVerification: { verified: true; domain: string } | null;
  wrStampStatus: { verified: true; stampId: string } | null;
}

/**
 * Build a SSOSession from JWT claims and current attestation evidence.
 *
 * @throws {Error} if required fields are missing or invalid
 */
export function sessionFromClaims(
  claims: JwtClaims,
  attestation: AttestationState = {
    hardwareAttestation: null,
    dnsVerification: null,
    wrStampStatus: null,
  },
): SSOSession {
  if (!claims.wrdesk_user_id) throw new Error('SSOSession: wrdesk_user_id is required')
  if (!claims.email) throw new Error('SSOSession: email is required')
  if (!claims.iss) throw new Error('SSOSession: iss is required')
  if (!claims.sub) throw new Error('SSOSession: sub is required')
  if (!claims.plan) throw new Error('SSOSession: plan is required')
  if (!claims.session_expires_at) throw new Error('SSOSession: session_expires_at is required')

  return {
    wrdesk_user_id: claims.wrdesk_user_id,
    email: claims.email,
    iss: claims.iss,
    sub: claims.sub,
    email_verified: true,
    plan: claims.plan,
    currentHardwareAttestation: attestation.hardwareAttestation,
    currentDnsVerification: attestation.dnsVerification,
    currentWrStampStatus: attestation.wrStampStatus,
    session_expires_at: claims.session_expires_at,
  }
}

/**
 * Build a minimal free-tier SSOSession for testing and MVP use.
 * All attestation evidence is null (free tier requires none).
 */
export function buildTestSession(overrides?: Partial<JwtClaims>): SSOSession {
  const claims: JwtClaims = {
    wrdesk_user_id: overrides?.wrdesk_user_id ?? 'local-user-001',
    email: overrides?.email ?? 'user@example.com',
    iss: overrides?.iss ?? 'https://auth.optimando.ai',
    sub: overrides?.sub ?? 'local-user-001',
    plan: overrides?.plan ?? 'free',
    session_expires_at: overrides?.session_expires_at ?? new Date(Date.now() + 86_400_000).toISOString(),
  }
  return sessionFromClaims(claims)
}
