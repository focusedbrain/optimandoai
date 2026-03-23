import type { PipelineStep, TierSignals } from '../types'
import { ReasonCode, tierAtLeast } from '../types'
import { classifyHandshakeTier } from '../tierClassification'

export const collectTierSignals: PipelineStep = {
  name: 'collect_tier_signals',
  execute(ctx) {
    const signals: TierSignals = {
      plan: ctx.input.tierSignals.plan,
      hardwareAttestation: ctx.input.tierSignals.hardwareAttestation,
      dnsVerification: ctx.input.tierSignals.dnsVerification,
      wrStampStatus: ctx.input.tierSignals.wrStampStatus,
    }

    return {
      passed: true,
      signals,
    }
  },
}

export const classifyTier: PipelineStep = {
  name: 'classify_tier',
  execute(ctx) {
    const signals: TierSignals = {
      plan: ctx.signals.plan ?? ctx.input.tierSignals.plan,
      hardwareAttestation: ctx.signals.hardwareAttestation ?? ctx.input.tierSignals.hardwareAttestation,
      dnsVerification: ctx.signals.dnsVerification ?? ctx.input.tierSignals.dnsVerification,
      wrStampStatus: ctx.signals.wrStampStatus ?? ctx.input.tierSignals.wrStampStatus,
    }

    const decision = classifyHandshakeTier(signals, ctx.input.claimedTier)
    ctx.tierDecision = decision

    return { passed: true }
  },
}

export const runTierSpecificChecks: PipelineStep = {
  name: 'tier_specific_checks',
  execute(ctx) {
    if (!ctx.tierDecision) {
      return { passed: false, reason: ReasonCode.INTERNAL_ERROR }
    }

    const tier = ctx.tierDecision.effectiveTier
    const signals = ctx.tierDecision.signals

    if (tier === 'free') {
      return { passed: true }
    }

    // pro: requires valid WRStamp
    if (tierAtLeast(tier, 'pro') && !signals.wrStampStatus) {
      return { passed: false, reason: ReasonCode.TIER_WRSTAMP_REQUIRED }
    }

    // publisher: requires DNS verification
    if (tierAtLeast(tier, 'publisher') && !signals.dnsVerification) {
      return { passed: false, reason: ReasonCode.TIER_DNS_REQUIRED }
    }

    // enterprise: requires hardware attestation (fresh)
    if (tierAtLeast(tier, 'enterprise')) {
      if (!signals.hardwareAttestation) {
        return { passed: false, reason: ReasonCode.TIER_ATTESTATION_REQUIRED }
      }
      if (!signals.hardwareAttestation.fresh) {
        return { passed: false, reason: ReasonCode.TIER_ATTESTATION_STALE }
      }
    }

    return { passed: true }
  },
}

export const enforceMinimumTier: PipelineStep = {
  name: 'enforce_minimum_tier',
  execute(ctx) {
    if (!ctx.tierDecision) {
      return { passed: false, reason: ReasonCode.INTERNAL_ERROR }
    }

    const senderTier = ctx.tierDecision.effectiveTier
    const minimumTier = ctx.receiverPolicy.minimumTier

    if (!tierAtLeast(senderTier, minimumTier)) {
      return { passed: false, reason: ReasonCode.TIER_BELOW_RECEIVER_MINIMUM }
    }

    return { passed: true }
  },
}
