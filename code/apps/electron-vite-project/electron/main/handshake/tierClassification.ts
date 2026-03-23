/**
 * Tier classification from verified signals.
 *
 * Pure function: deterministic, no I/O.
 * Tier = highest tier that signals actually support.
 * If sender claimed higher than signals → downgrade.
 * If sender claimed lower than signals → use claimed (min).
 */

import type { TierSignals, TierDecision, HandshakeTier } from './types'
import { tierAtLeast, minTier } from './types'

export function classifyHandshakeTier(
  signals: TierSignals,
  claimedTier?: HandshakeTier | null,
): TierDecision {
  const computedTier = computeTierFromSignals(signals)

  let effectiveTier: HandshakeTier
  let downgraded = false

  if (claimedTier != null) {
    effectiveTier = minTier(claimedTier, computedTier)
    downgraded = effectiveTier !== claimedTier && tierAtLeast(claimedTier, computedTier) === false
    // downgraded is true only when claimed > computed (signals couldn't support claimed)
    downgraded = claimedTier !== computedTier && !tierAtLeast(computedTier, claimedTier)
  } else {
    effectiveTier = computedTier
  }

  return {
    claimedTier: claimedTier ?? null,
    computedTier,
    effectiveTier,
    signals,
    downgraded,
  }
}

function computeTierFromSignals(signals: TierSignals): HandshakeTier {
  const { plan, hardwareAttestation, dnsVerification, wrStampStatus } = signals

  // enterprise: plan >= enterprise + wrStamp + DNS + hardware attestation
  if (
    tierAtLeast(plan, 'enterprise') &&
    wrStampStatus != null &&
    dnsVerification != null &&
    hardwareAttestation != null
  ) {
    return 'enterprise'
  }

  // publisher: plan >= publisher + wrStamp + DNS
  if (
    tierAtLeast(plan, 'publisher') &&
    wrStampStatus != null &&
    dnsVerification != null
  ) {
    return 'publisher'
  }

  // pro: plan >= pro + wrStamp
  if (tierAtLeast(plan, 'pro') && wrStampStatus != null) {
    return 'pro'
  }

  return 'free'
}
