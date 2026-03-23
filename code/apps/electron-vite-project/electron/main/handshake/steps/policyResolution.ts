import type { PipelineStep, EffectivePolicy, CapsulePolicy, ReceiverPolicy, SharingMode } from '../types'
import { ReasonCode, maxTier } from '../types'

export function resolveEffectivePolicyFn(
  capsulePolicy: CapsulePolicy | null | undefined,
  receiverPolicy: ReceiverPolicy,
): EffectivePolicy | { unsatisfiable: true; reason: ReasonCode } {
  const cp = capsulePolicy ?? {}

  // Scope intersection
  let allowedScopes: string[]
  if (cp.requestedScopes && cp.requestedScopes.length > 0) {
    if (receiverPolicy.allowedScopes.includes('*')) {
      allowedScopes = cp.requestedScopes
    } else {
      allowedScopes = cp.requestedScopes.filter(s => receiverPolicy.allowedScopes.includes(s))
      if (allowedScopes.length === 0) {
        return { unsatisfiable: true, reason: ReasonCode.RECEIVER_POLICY_UNSATISFIABLE }
      }
    }
  } else {
    allowedScopes = receiverPolicy.allowedScopes
  }

  // Tier: max of both (most restrictive)
  const effectiveTier = cp.minimumReceiverTier
    ? maxTier(receiverPolicy.minimumTier, cp.minimumReceiverTier)
    : receiverPolicy.minimumTier

  // Cloud escalation: receiver allows AND capsule doesn't restrict
  let allowsCloudEscalation = receiverPolicy.allowsCloudEscalation
  if (cp.maxExternalProcessing === 'none' || cp.maxExternalProcessing === 'local_only') {
    allowsCloudEscalation = false
  }

  // External processing: most restrictive
  let effectiveExternalProcessing = receiverPolicy.cloudAiDefault
  if (cp.maxExternalProcessing != null) {
    if (cp.maxExternalProcessing === 'none') {
      effectiveExternalProcessing = 'none'
    } else if (cp.maxExternalProcessing === 'local_only') {
      if (effectiveExternalProcessing !== 'none') {
        effectiveExternalProcessing = 'local_only'
      }
    }
  }

  // Reciprocal: both must allow
  const reciprocalAllowed = (cp.reciprocalAllowed !== false) &&
    receiverPolicy.allowedSharingModes.includes('reciprocal')

  // Sharing modes: intersection
  const capsuleModes: SharingMode[] = cp.reciprocalAllowed === false
    ? ['receive-only']
    : ['receive-only', 'reciprocal']
  const effectiveSharingModes = receiverPolicy.allowedSharingModes
    .filter(m => capsuleModes.includes(m))
  if (effectiveSharingModes.length === 0) {
    return { unsatisfiable: true, reason: ReasonCode.RECEIVER_POLICY_UNSATISFIABLE }
  }

  // Attestation/DNS requirements from capsule
  if (cp.requireHardwareAttestation || cp.requireDnsVerification) {
    // These are "minimum requirements" from the sender.
    // If the receiver can't provide them (checked elsewhere in tier), that's unsatisfiable.
    // For policy resolution, we just note them — tier checks handle enforcement.
  }

  return {
    allowedScopes,
    effectiveTier,
    allowsCloudEscalation,
    allowsExport: receiverPolicy.allowsExport,
    onRevocationDeleteBlocks: receiverPolicy.onRevocationDeleteBlocks,
    effectiveExternalProcessing,
    reciprocalAllowed,
    effectiveSharingModes,
  }
}

export const resolveEffectivePolicy: PipelineStep = {
  name: 'resolve_effective_policy',
  execute(ctx) {
    const result = resolveEffectivePolicyFn(ctx.input.capsulePolicy, ctx.receiverPolicy)

    if ('unsatisfiable' in result) {
      return { passed: false, reason: result.reason }
    }

    return { passed: true }
  },
}
