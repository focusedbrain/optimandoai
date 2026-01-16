/**
 * Envelope Evaluation Module
 * 
 * Deterministic, fail-closed evaluation of incoming BEAP messages.
 * 
 * @version 1.0.0
 */

export * from './types'
export { evaluateIncomingMessage, createMockIncomingMessage } from './evaluateEnvelope'
export { useVerifyMessage } from './useVerifyMessage'

