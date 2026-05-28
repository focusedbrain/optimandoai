import {
  ROLE_SEND_FORBIDDEN_CODE,
  isRoleSendForbidden,
  RoleSendForbidden,
} from './rolePolicyErrors.js'

export function formatEmailSendIpcResult(
  result: { success: boolean; error?: string; policyBlocked?: boolean; policyReason?: string },
): { ok: boolean; data?: unknown; error?: string; code?: string; policyReason?: string; policyBlocked?: boolean } {
  if (result.policyBlocked) {
    return {
      ok: false,
      code: ROLE_SEND_FORBIDDEN_CODE,
      policyBlocked: true,
      policyReason: result.policyReason,
      error: result.error,
    }
  }
  if (!result.success) {
    return { ok: false, error: result.error ?? 'Send failed' }
  }
  return { ok: true, data: result }
}

export function emailSendIpcFromError(err: unknown): {
  ok: false
  error: string
  code?: string
  policyReason?: string
  policyBlocked?: boolean
} {
  if (isRoleSendForbidden(err)) {
    return {
      ok: false,
      code: ROLE_SEND_FORBIDDEN_CODE,
      policyBlocked: true,
      policyReason: err.reason,
      error: err.message,
    }
  }
  const msg = err instanceof Error ? err.message : String(err)
  return { ok: false, error: msg }
}

export { RoleSendForbidden, ROLE_SEND_FORBIDDEN_CODE, isRoleSendForbidden }
