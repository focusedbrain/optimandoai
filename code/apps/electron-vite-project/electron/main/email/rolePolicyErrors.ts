import type { RolePolicyReason } from '@repo/role-policy'

export const ROLE_SEND_FORBIDDEN_CODE = 'ROLE_SEND_FORBIDDEN' as const

export class RoleSendForbidden extends Error {
  readonly code = ROLE_SEND_FORBIDDEN_CODE
  readonly reason: RolePolicyReason
  readonly accountId: string

  constructor(accountId: string, reason: RolePolicyReason) {
    super(`Send forbidden for account ${accountId}: ${reason}`)
    this.name = 'RoleSendForbidden'
    this.reason = reason
    this.accountId = accountId
  }
}

export function isRoleSendForbidden(err: unknown): err is RoleSendForbidden {
  return err instanceof RoleSendForbidden
}
