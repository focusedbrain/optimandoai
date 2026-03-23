import type { PipelineStep } from '../types'
import { ReasonCode, INPUT_LIMITS } from '../types'

// Initiate capsules may be transferred between machines (email, USB, etc.) — use 24h tolerance.
const INITIATE_TIMESTAMP_TOLERANCE_MS = 24 * 60 * 60 * 1000

export const verifyTimestamp: PipelineStep = {
  name: 'verify_timestamp',
  execute(ctx) {
    const { input } = ctx
    const ts = input.timestamp

    if (!ts) {
      return { passed: false, reason: ReasonCode.CLOCK_SKEW }
    }

    const parsed = Date.parse(ts)
    if (isNaN(parsed)) {
      return { passed: false, reason: ReasonCode.CLOCK_SKEW }
    }

    const now = Date.now()
    const isInitiate = input.capsuleType === 'handshake-initiate'
    const tolerance = isInitiate ? INITIATE_TIMESTAMP_TOLERANCE_MS : INPUT_LIMITS.CLOCK_SKEW_TOLERANCE_MS

    // Deny only FUTURE timestamps beyond tolerance
    // Past timestamps of any age are allowed (email delay safe)
    if (parsed > now + tolerance) {
      return { passed: false, reason: ReasonCode.CLOCK_SKEW }
    }

    return { passed: true }
  },
}
