import type { PipelineStep } from '../types'
import { ReasonCode, INPUT_LIMITS } from '../types'

export const checkSchemaVersion: PipelineStep = {
  name: 'check_schema_version',
  execute(ctx) {
    if (ctx.input.schema_version !== INPUT_LIMITS.SCHEMA_VERSION_CURRENT) {
      return { passed: false, reason: ReasonCode.UNSUPPORTED_SCHEMA }
    }
    return { passed: true }
  },
}
