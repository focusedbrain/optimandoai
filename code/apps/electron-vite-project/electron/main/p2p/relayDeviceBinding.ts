/**
 * Single source for relay-facing device id: orchestrator instance id.
 * Must match WS query `device_id`, register-handshake *_device_id, and outbound sender_device_id.
 */

import { getInstanceId } from '../orchestrator/orchestratorModeStore'

export function getCanonicalRelayDeviceId(): string | null {
  try {
    const id = getInstanceId()
    const t = typeof id === 'string' ? id.trim() : ''
    return t.length > 0 ? t : null
  } catch {
    return null
  }
}

export function logDeviceIdBinding(phase: string, fields: Record<string, unknown>): void {
  console.log('[DEVICE_ID_BINDING]', JSON.stringify({ phase, ...fields }))
}
