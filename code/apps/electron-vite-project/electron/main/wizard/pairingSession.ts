/**
 * In-memory pairing session (main process only — never sent to renderer).
 */

import type { PairInitiateResult } from '../edge-agent/orchestratorPairing.js'

export interface PendingWizardPairing extends PairInitiateResult {
  readonly pairingAddress: string
  readonly orchestratorSub: string
}

let _pending: PendingWizardPairing | null = null

export function setPendingWizardPairing(session: PendingWizardPairing): void {
  _pending = session
}

export function getPendingWizardPairing(): PendingWizardPairing | null {
  return _pending
}

export function clearPendingWizardPairing(): void {
  _pending = null
}
