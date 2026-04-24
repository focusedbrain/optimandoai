/**
 * Maps renderer `DeliveryResult` to matrix labels (HTTP 200 live vs 202 queued vs failure).
 * Pure — no crypto; used by sandbox clone + regression tests.
 */

export type SandboxCloneMatrixDelivery = 'live' | 'queued' | 'failed' | 'unknown'

export function mapCoordinationDeliveryToMatrixMode(d: {
  success: boolean
  coordinationRelayDelivery?: 'pushed_live' | 'queued_recipient_offline'
  delivered?: boolean
  queued?: boolean
}): SandboxCloneMatrixDelivery {
  if (!d.success) return 'failed'
  if (d.coordinationRelayDelivery === 'pushed_live') return 'live'
  if (d.coordinationRelayDelivery === 'queued_recipient_offline') return 'queued'
  if (d.delivered === false && d.queued) return 'queued'
  if (d.success) return 'live'
  return 'unknown'
}
