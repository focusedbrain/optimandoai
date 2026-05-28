/**
 * User-facing copy when host send is blocked by role policy (Stream B).
 */

export function rolePolicySendBlockedTitle(): string {
  return 'Sending is paused for this account'
}

export function rolePolicySendBlockedMessage(policyReason?: string): string {
  if (policyReason === 'edge_blocked_holding') {
    return (
      'This account uses server-side verification, but the verification server is currently unreachable. ' +
      'Your message has not been sent and remains in the compose area. When the server is reachable again, tap Send again — messages do not send automatically.'
    )
  }
  if (policyReason === 'host_pod_halted') {
    return (
      'Message verification on this device has stopped due to an unexpected issue. ' +
      'Your message has not been sent and remains in the compose area. Use Try to recover in the status panel, then send again when verification is healthy.'
    )
  }
  return (
    'This account is configured for server-side verification on your edge server. ' +
    'Your message has not been sent and remains in the compose area. To send from this device instead, switch verification back to local for this account in Settings.'
  )
}

export function isRolePolicySendBlockedResponse(res: {
  ok?: boolean
  code?: string
  policyBlocked?: boolean
}): boolean {
  return res.code === 'ROLE_SEND_FORBIDDEN' || res.policyBlocked === true
}
