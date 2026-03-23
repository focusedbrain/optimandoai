/**
 * Canonical Tool Execution Entry Point
 *
 * Every tool invocation MUST pass through executeToolRequest(). There is no
 * alternate runner. Steps (ordered, fail on first error):
 *
 *   1. Validate request shape
 *   2. Resolve governance context (handshake record, active + not revoked)
 *   3. Authorize via authorizeToolInvocation() — deny → fail-closed
 *   4. Execute tool handler with timeout + parameter sanitization
 *   5. Audit (request_id, tool_name, handshake_id, allow/deny, duration)
 *
 * Any exception → caught → { success: false }.
 * No tool code executes if authorization fails.
 */

import type { ToolRequest, ToolExecutionResult } from './types'
import { EXECUTION_CONSTANTS } from './types'
import { getToolHandler } from './toolRegistry'
import { authorizeToolInvocation } from '../enforcement/authorizeToolInvocation'
import { insertAuditLogEntry } from '../handshake/db'

const POISONED_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

// ── Step 1: Request Validation ──

function validateRequestShape(req: unknown): req is ToolRequest {
  if (!req || typeof req !== 'object') return false
  const r = req as Record<string, unknown>
  if (typeof r.request_id !== 'string' || r.request_id.length === 0) return false
  if (typeof r.tool_name !== 'string' || r.tool_name.length === 0) return false
  if (!r.parameters || typeof r.parameters !== 'object' || Array.isArray(r.parameters)) return false
  if (typeof r.requested_at !== 'string') return false
  // ISO 8601 basic check
  if (isNaN(Date.parse(r.requested_at as string))) return false
  const validOrigins = new Set(['local_ui', 'extension', 'sandbox', 'automation'])
  if (!validOrigins.has(r.origin as string)) return false
  return true
}

function checkParameterSize(params: Record<string, unknown>): boolean {
  const serialized = JSON.stringify(params)
  return Buffer.byteLength(serialized) <= EXECUTION_CONSTANTS.MAX_PARAMETER_BYTES
}

// ── Step 4 Helpers: Sanitization + Timeout ──

function sanitizeParameters(params: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = Object.create(null)
  for (const [key, value] of Object.entries(params)) {
    if (POISONED_KEYS.has(key)) continue
    safe[key] = typeof value === 'object' && value !== null && !Array.isArray(value)
      ? sanitizeParameters(value as Record<string, unknown>)
      : value
  }
  return safe
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Tool execution timed out after ${ms}ms`)), ms)
    promise.then(
      (val) => { clearTimeout(timer); resolve(val) },
      (err) => { clearTimeout(timer); reject(err) },
    )
  })
}

// ── Main Entry Point ──

export async function executeToolRequest(
  db: any,
  req: unknown,
): Promise<ToolExecutionResult> {
  const startTime = performance.now()

  try {
    // Step 1: Validate request shape
    if (!validateRequestShape(req)) {
      return fail('INVALID_REQUEST', 'Request does not conform to ToolRequest schema', startTime)
    }

    // Parameter size check
    if (!checkParameterSize(req.parameters)) {
      return fail('PARAMETER_SIZE_EXCEEDED', `Parameters exceed ${EXECUTION_CONSTANTS.MAX_PARAMETER_BYTES} bytes`, startTime)
    }

    // Check for __proto__ in parameters
    if (containsPoisonedKeys(req.parameters)) {
      return fail('POISONED_PARAMETERS', 'Parameters contain forbidden keys (__proto__, constructor, prototype)', startTime)
    }

    // Step 2: Resolve governance context — handshake_id required for authorization
    if (!req.handshake_id) {
      return fail('MISSING_HANDSHAKE', 'handshake_id is required for tool execution', startTime)
    }

    // Step 3: Authorize
    const authResult = authorizeToolInvocation(db, {
      handshake_id: req.handshake_id,
      tool_name: req.tool_name,
      parameters: req.parameters,
      requested_scope: req.scope_id ?? '*',
      requested_purpose: req.purpose_id ?? 'general',
    })

    if (!authResult.authorized) {
      auditExecution(db, req, false, authResult.reason, startTime)
      return fail(authResult.reason, authResult.details ?? 'Authorization denied', startTime)
    }

    // Step 4: Execute tool handler
    const handler = getToolHandler(req.tool_name)
    if (!handler) {
      auditExecution(db, req, false, 'TOOL_NOT_FOUND', startTime)
      return fail('TOOL_NOT_FOUND', `No handler registered for tool "${req.tool_name}"`, startTime)
    }

    const sanitized = sanitizeParameters(req.parameters)
    const result = await withTimeout(
      handler(sanitized),
      EXECUTION_CONSTANTS.TOOL_TIMEOUT_MS,
    )

    // Step 5: Audit success
    auditExecution(db, req, true, 'OK', startTime)

    return {
      success: true,
      result: serializeResult(result),
      duration_ms: elapsed(startTime),
    }
  } catch (err: any) {
    const reason = err?.message?.includes('timed out') ? 'TOOL_TIMEOUT' : 'EXECUTION_ERROR'
    try {
      if (validateRequestShape(req)) {
        auditExecution(db, req as ToolRequest, false, reason, startTime)
      }
    } catch { /* audit failure must not mask error */ }

    return fail(reason, err?.message ?? 'Unhandled execution error', startTime)
  }
}

// ── Helpers ──

function fail(reason: string, details: string, startTime: number): ToolExecutionResult {
  return { success: false, reason, details, duration_ms: elapsed(startTime) }
}

function elapsed(startTime: number): number {
  return Math.round(performance.now() - startTime)
}

function containsPoisonedKeys(obj: Record<string, unknown>): boolean {
  for (const key of Object.keys(obj)) {
    if (POISONED_KEYS.has(key)) return true
    const val = obj[key]
    if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      if (containsPoisonedKeys(val as Record<string, unknown>)) return true
    }
  }
  return false
}

function serializeResult(result: unknown): unknown {
  if (result === undefined) return null
  try {
    JSON.stringify(result)
    return result
  } catch {
    return { _serialization_error: true, type: typeof result }
  }
}

function auditExecution(
  db: any,
  req: ToolRequest,
  success: boolean,
  reasonCode: string,
  startTime: number,
): void {
  try {
    insertAuditLogEntry(db, {
      timestamp: new Date().toISOString(),
      action: success ? 'TOOL_EXECUTION_SUCCESS' : 'TOOL_EXECUTION_DENIED',
      handshake_id: req.handshake_id,
      reason_code: reasonCode,
      metadata: {
        request_id: req.request_id,
        tool_name: req.tool_name,
        origin: req.origin,
        duration_ms: elapsed(startTime),
        parameter_keys: Object.keys(req.parameters),
        parameter_byte_size: Buffer.byteLength(JSON.stringify(req.parameters)),
      },
    })
  } catch { /* audit failure must not mask execution result */ }
}
