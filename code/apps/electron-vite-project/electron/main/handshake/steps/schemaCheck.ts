import type { PipelineStep } from '../types'
import { ReasonCode } from '../types'

const SUPPORTED_SCHEMA_VERSIONS = new Set([1, 2])

export const checkSchemaVersion: PipelineStep = {
  name: 'check_schema_version',
  execute(ctx) {
    if (!SUPPORTED_SCHEMA_VERSIONS.has(ctx.input.schema_version)) {
      return { passed: false, reason: ReasonCode.UNSUPPORTED_SCHEMA }
    }
    return { passed: true }
  },
}
