import type { ActiveHandshakeHealthIssue } from '@shared/handshake/activeHandshakeHealthIssue'

function formatPairing6(code: string): string {
  return `${code.slice(0, 3)}-${code.slice(3)}`
}

/** User-facing banner line (orchestrator shell). */
export function handshakeHealthBannerMessage(issue: ActiveHandshakeHealthIssue): string {
  const peer = (issue.peer_name ?? '').trim() || 'the other device'
  switch (issue.reason) {
    case 'coordination_incomplete': {
      const code = issue.pairing_code_6
      const codePart = code ? formatPairing6(code) : 'the 6-digit pairing code for this connection'
      return `Pairing not yet confirmed on the other device. Open Settings → Pairing on ${peer} and enter code ${codePart}.`
    }
    case 'missing_self_token':
      return `Your device hasn't been issued a security token by ${peer} yet. Re-run pairing.`
    case 'missing_counterparty_token':
      return `Your device is missing ${peer}'s security token. Re-run pairing.`
    case 'endpoint_invalid':
      return `${peer} has not advertised a reachable address. Check the device is online and on the same network.`
    case 'endpoint_repair_pending':
      return 'Connection is using the relay; a faster direct path will be tried automatically.'
    default:
      return 'This connection needs attention. Open Settings → Orchestrator Mode to review pairing.'
  }
}

export function handshakeHealthDismissKey(issue: ActiveHandshakeHealthIssue): string {
  return `${issue.handshake_id}|${issue.health}|${issue.reason}`
}

/** Lower = more severe (shown first). */
export function handshakeHealthIssueRank(issue: ActiveHandshakeHealthIssue): number {
  const healthT = issue.health === 'BROKEN' ? 0 : issue.health === 'DEGRADED' ? 1 : 2
  const reasonOrder: Record<ActiveHandshakeHealthIssue['reason'], number> = {
    coordination_incomplete: 0,
    endpoint_invalid: 1,
    missing_self_token: 2,
    missing_counterparty_token: 3,
    endpoint_repair_pending: 4,
  }
  return healthT * 10 + reasonOrder[issue.reason]
}
