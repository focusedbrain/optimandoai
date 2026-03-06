/**
 * Distribution Gate
 *
 * Routes validated capsules to trust domains.
 * Pure function — no DB, no session, no app state.
 */

import type { ValidatedCapsule, DistributionDecision } from './types.js';

export function routeValidatedCapsule(capsule: ValidatedCapsule): DistributionDecision {
  const { capsule_type } = capsule.capsule;
  const { origin_classification } = capsule.provenance;

  if (
    capsule_type === 'initiate' ||
    capsule_type === 'accept' ||
    capsule_type === 'refresh' ||
    capsule_type === 'revoke' ||
    capsule_type === 'context_sync'
  ) {
    return {
      target: 'handshake_pipeline',
      validated_capsule: capsule,
      reason: `BEAP capsule_type=${capsule_type} routes to handshake pipeline`,
    };
  }

  if (capsule_type === 'internal_draft') {
    if (origin_classification === 'internal') {
      return {
        target: 'handshake_pipeline',
        validated_capsule: capsule,
        reason: 'Internal draft from internal origin routes to handshake pipeline',
      };
    }
    return {
      target: 'sandbox_sub_orchestrator',
      validated_capsule: capsule,
      reason: 'External internal_draft routes to sandbox sub-orchestrator',
    };
  }

  return {
    target: 'quarantine',
    validated_capsule: capsule,
    reason: `Unresolvable capsule_type=${capsule_type} quarantined`,
  };
}
