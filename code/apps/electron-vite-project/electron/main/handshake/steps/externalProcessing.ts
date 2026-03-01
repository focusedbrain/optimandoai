import type { PipelineStep } from '../types'
import { ReasonCode } from '../types'

export const verifyExternalProcessing: PipelineStep = {
  name: 'verify_external_processing',
  execute(ctx) {
    const { input, receiverPolicy } = ctx
    const ext = input.external_processing

    // 'none' or 'local_only' always pass
    if (ext === 'none' || ext === 'local_only') {
      return { passed: true }
    }

    // Named provider requested — check receiver policy
    if (!receiverPolicy.allowsCloudEscalation) {
      return { passed: false, reason: ReasonCode.CLOUD_PROCESSING_DENIED }
    }

    if (!receiverPolicy.allowedCloudProviders.includes(ext)) {
      return { passed: false, reason: ReasonCode.CLOUD_PROVIDER_DENIED }
    }

    // Cloud payload mode enforcement (snippet-only MVP)
    const mode = input.cloud_payload_mode
    if (mode == null || mode === 'none') {
      return { passed: false, reason: ReasonCode.CLOUD_PROCESSING_DENIED }
    }
    if (mode === 'full') {
      return { passed: false, reason: ReasonCode.CLOUD_PROCESSING_DENIED }
    }
    if (!receiverPolicy.cloudPayloadModeAllowed.includes(mode)) {
      return { passed: false, reason: ReasonCode.CLOUD_PROCESSING_DENIED }
    }

    // Byte limit
    const bytes = input.cloud_payload_bytes ?? 0
    if (bytes > receiverPolicy.maxCloudPayloadBytes) {
      return { passed: false, reason: ReasonCode.CLOUD_PROCESSING_DENIED }
    }

    // Check capsule policy restriction
    if (input.capsulePolicy?.maxExternalProcessing != null) {
      const capsMax = input.capsulePolicy.maxExternalProcessing
      if (capsMax === 'none' || capsMax === 'local_only') {
        return { passed: false, reason: ReasonCode.CLOUD_PROCESSING_DENIED }
      }
    }

    return { passed: true }
  },
}
