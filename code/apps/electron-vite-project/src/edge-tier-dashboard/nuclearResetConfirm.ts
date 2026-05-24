/**
 * Strong confirmation helpers for nuclear reset (P5.10).
 */

export const NUCLEAR_RESET_CONFIRM_TOKEN = 'RESET'

export function canConfirmNuclearReset(input: {
  hostConfirm: string
  expectedHost: string
  resetConfirm: string
  reason: string
}): boolean {
  return (
    input.hostConfirm.trim() === input.expectedHost.trim() &&
    input.resetConfirm.trim() === NUCLEAR_RESET_CONFIRM_TOKEN &&
    input.reason.trim().length >= 3
  )
}
