import type { PipelineStep } from '../types'
import { ReasonCode } from '../types'
import { resolveEffectivePolicyFn } from './policyResolution'

export const verifyScopePurpose: PipelineStep = {
  name: 'verify_scope_purpose',
  execute(ctx) {
    const { input, receiverPolicy } = ctx
    const requestedScopes = input.scopes ?? []

    if (requestedScopes.length === 0) {
      return { passed: true }
    }

    const effective = resolveEffectivePolicyFn(input.capsulePolicy, receiverPolicy)
    if ('unsatisfiable' in effective) {
      return { passed: false, reason: effective.reason }
    }

    // Wildcard allows everything
    if (effective.allowedScopes.includes('*')) {
      return { passed: true }
    }

    for (const scope of requestedScopes) {
      if (!effective.allowedScopes.includes(scope)) {
        return { passed: false, reason: ReasonCode.SCOPE_ESCALATION }
      }
    }

    return { passed: true }
  },
}
