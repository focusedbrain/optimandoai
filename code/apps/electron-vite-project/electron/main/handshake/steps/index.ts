/**
 * Frozen handshake verification pipeline.
 * Steps execute in order. First failure stops the pipeline.
 */

import type { PipelineStep } from '../types'

import { checkSchemaVersion } from './schemaCheck'
import { checkDuplicateCapsule } from './dedup'
import { verifyHandshakeOwnership } from './ownership'
import { verifySenderDomain } from './domain'
import { verifyWrdeskPolicyAnchor } from './policyAnchor'
import { verifyInputLimits } from './inputLimits'
import { checkStateTransition } from './stateTransition'
import { verifyChainIntegrity } from './chainIntegrity'
import { verifySharingMode } from './sharingMode'
import { verifyExternalProcessing } from './externalProcessing'
import { verifyContextBinding } from './contextBinding'
import { verifyContextVersions } from './contextVersions'
import { resolveEffectivePolicy } from './policyResolution'
import { verifyScopePurpose } from './scopePurpose'
import { verifyTimestamp } from './timestamp'
import { checkExpiry } from './expiry'
import { collectTierSignals, classifyTier, runTierSpecificChecks, enforceMinimumTier } from './tierSteps'

export const HANDSHAKE_PIPELINE: readonly PipelineStep[] = Object.freeze([
  checkSchemaVersion,
  checkDuplicateCapsule,
  verifyHandshakeOwnership,
  verifySenderDomain,
  verifyWrdeskPolicyAnchor,
  verifyInputLimits,
  checkStateTransition,
  verifyChainIntegrity,
  verifySharingMode,
  verifyExternalProcessing,
  verifyContextBinding,
  verifyContextVersions,
  resolveEffectivePolicy,
  verifyScopePurpose,
  verifyTimestamp,
  checkExpiry,
  collectTierSignals,
  classifyTier,
  runTierSpecificChecks,
  enforceMinimumTier,
])

export {
  checkSchemaVersion,
  checkDuplicateCapsule,
  verifyHandshakeOwnership,
  verifySenderDomain,
  verifyWrdeskPolicyAnchor,
  verifyInputLimits,
  checkStateTransition,
  verifyChainIntegrity,
  verifySharingMode,
  verifyExternalProcessing,
  verifyContextBinding,
  verifyContextVersions,
  resolveEffectivePolicy,
  verifyScopePurpose,
  verifyTimestamp,
  checkExpiry,
  collectTierSignals,
  classifyTier,
  runTierSpecificChecks,
  enforceMinimumTier,
}
