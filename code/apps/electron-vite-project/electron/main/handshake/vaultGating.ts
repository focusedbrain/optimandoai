/**
 * WRVault gating for handshake-scoped actions.
 *
 * Gate 1: Handshake must be active
 * Gate 2: Effective tier sufficient (from CURRENT SSO)
 * Gate 3: Receiver policy ceilings
 * Gate 4: Sharing mode enforcement
 * Gate 5: LWM boundary (architectural — no LLM can call this)
 */

import type { ActionType, SSOSession, VaultAccessResult } from './types'
import { ReasonCode, HandshakeState, tierAtLeast } from './types'
import { getHandshakeRecord } from './db'
import { classifyHandshakeTier } from './tierClassification'

export async function gateVaultAccess(
  db: any,
  handshakeId: string,
  requestedAction: ActionType,
  requestedScopes: string[],
  ssoSession: SSOSession,
): Promise<VaultAccessResult> {
  // Gate 1: Handshake must be active
  const record = getHandshakeRecord(db, handshakeId)
  if (!record) {
    return { allowed: false, reason: ReasonCode.HANDSHAKE_NOT_FOUND }
  }
  if (record.state !== HandshakeState.ACTIVE) {
    return { allowed: false, reason: ReasonCode.INVALID_STATE_TRANSITION }
  }

  // Check expiry
  if (record.expires_at) {
    const expiresAt = Date.parse(record.expires_at)
    if (!isNaN(expiresAt) && Date.now() > expiresAt) {
      return { allowed: false, reason: ReasonCode.HANDSHAKE_EXPIRED }
    }
  }

  // Gate 2: Effective tier sufficient
  const currentTier = classifyHandshakeTier({
    plan: ssoSession.plan,
    hardwareAttestation: ssoSession.currentHardwareAttestation,
    dnsVerification: ssoSession.currentDnsVerification,
    wrStampStatus: ssoSession.currentWrStampStatus,
  })

  if (!tierAtLeast(currentTier.effectiveTier, record.effective_policy.effectiveTier)) {
    return {
      allowed: false,
      reason: ReasonCode.SCOPE_ESCALATION,
      effectiveTier: currentTier.effectiveTier,
    }
  }

  // Gate 3: Policy ceilings
  const policy = record.effective_policy

  if (requestedAction === 'cloud-escalation' && !policy.allowsCloudEscalation) {
    return { allowed: false, reason: ReasonCode.CLOUD_PROCESSING_DENIED }
  }
  if (requestedAction === 'export-context' && !policy.allowsExport) {
    return { allowed: false, reason: ReasonCode.POLICY_VIOLATION }
  }

  // Scope check
  if (!policy.allowedScopes.includes('*')) {
    for (const scope of requestedScopes) {
      if (!policy.allowedScopes.includes(scope)) {
        return { allowed: false, reason: ReasonCode.SCOPE_ESCALATION }
      }
    }
  }

  // Gate 4: Sharing mode enforcement
  if (requestedAction === 'write-context') {
    if (record.sharing_mode === 'receive-only' && record.local_role === 'acceptor') {
      return { allowed: false, reason: ReasonCode.SHARING_MODE_VIOLATION }
    }
  }

  return { allowed: true, reason: ReasonCode.OK, effectiveTier: currentTier.effectiveTier }
}
