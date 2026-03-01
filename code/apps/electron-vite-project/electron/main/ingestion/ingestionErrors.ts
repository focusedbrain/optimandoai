/**
 * Ingestion error types and helpers.
 */

import type { ValidationReasonCode } from './types'

export class IngestionError extends Error {
  constructor(
    message: string,
    public readonly code: ValidationReasonCode,
    public readonly details?: string,
  ) {
    super(message)
    this.name = 'IngestionError'
  }
}

export function formatValidationError(code: ValidationReasonCode, details: string): string {
  return `[${code}] ${details}`
}
