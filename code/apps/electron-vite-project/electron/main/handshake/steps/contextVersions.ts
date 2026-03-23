import type { PipelineStep } from '../types'

/**
 * Context version verification.
 *
 * In the hardened model, handshake capsules carry only proof hashes —
 * they have no version field. Version monotonicity checks are enforced
 * when full content blocks arrive via the BEAP-Capsule pipeline.
 *
 * This step is a no-op for handshake capsules but remains in the
 * pipeline as a structural placeholder for future BEAP-Capsule support.
 */
export const verifyContextVersions: PipelineStep = {
  name: 'verify_context_versions',
  execute(_ctx) {
    return { passed: true }
  },
}
