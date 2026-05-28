import { randomUUID } from 'node:crypto'

import { generatePairingCode, PAIRING_CODE_TTL_MS } from './pairingCode.js'
import type { PairingKeypair } from './pairingKeys.js'
import { generatePairingKeypair } from './pairingKeys.js'
import { computePairingFingerprint } from './fingerprint.js'
import { randomString } from '@repo/sso'

export type SetupUiPhase =
  | 'welcome'
  | 'signing_in'
  | 'code_displayed'
  | 'pairing_in_progress'
  | 'pairing_complete'

export interface PairingCodeState {
  code: string
  expiresAt: number
  consumed: boolean
}

export interface ActivePairingSession {
  sessionId: string
  orchestratorSub: string
  orchestratorPublicKey: string
  orchestratorNonce: string
  agentKeypair: PairingKeypair
  agentNonce: string
  fingerprint: string
  agentRestartEpoch: string
  agentUiConfirmed: boolean
  orchestratorConfirmed: boolean
  rejected: boolean
  createdAt: number
}

export class SetupStateMachine {
  readonly agentRestartEpoch = randomUUID()

  private uiPhase: SetupUiPhase = 'welcome'
  private pairingCode: PairingCodeState | null = null
  private session: ActivePairingSession | null = null
  private ssoError: string | null = null

  getUiPhase(): SetupUiPhase {
    return this.uiPhase
  }

  getSsoError(): string | null {
    return this.ssoError
  }

  clearSsoError(): void {
    this.ssoError = null
  }

  setSsoError(message: string): void {
    this.ssoError = message
    this.uiPhase = 'welcome'
  }

  beginSigningIn(): void {
    this.uiPhase = 'signing_in'
    this.ssoError = null
  }

  onSignedIn(): void {
    this.uiPhase = 'code_displayed'
    this.ensurePairingCode()
  }

  ensurePairingCode(): PairingCodeState {
    const now = Date.now()
    if (
      this.pairingCode &&
      !this.pairingCode.consumed &&
      this.pairingCode.expiresAt > now
    ) {
      return this.pairingCode
    }
    this.pairingCode = {
      code: generatePairingCode(),
      expiresAt: now + PAIRING_CODE_TTL_MS,
      consumed: false,
    }
    if (this.uiPhase !== 'pairing_in_progress') {
      this.uiPhase = 'code_displayed'
    }
    this.session = null
    return this.pairingCode
  }

  regeneratePairingCode(): PairingCodeState {
    this.pairingCode = null
    this.session = null
    return this.ensurePairingCode()
  }

  getPairingCode(): PairingCodeState | null {
    return this.pairingCode
  }

  getSession(): ActivePairingSession | null {
    return this.session
  }

  initiatePairing(input: {
    pairingCode: string
    orchestratorSub: string
    orchestratorPublicKey: string
    orchestratorNonce: string
    agentSignedInSub: string
  }):
    | { ok: true; session: ActivePairingSession }
    | { ok: false; error: string; httpStatus: number } {
    const codeState = this.pairingCode
    if (!codeState) {
      return { ok: false, error: 'code_mismatch', httpStatus: 401 }
    }
    if (codeState.consumed) {
      return { ok: false, error: 'code_consumed', httpStatus: 410 }
    }
    if (codeState.expiresAt < Date.now()) {
      return { ok: false, error: 'code_expired', httpStatus: 410 }
    }
    if (codeState.code !== input.pairingCode) {
      return { ok: false, error: 'code_mismatch', httpStatus: 401 }
    }
    if (input.orchestratorSub !== input.agentSignedInSub) {
      return { ok: false, error: 'sub_mismatch', httpStatus: 403 }
    }

    codeState.consumed = true
    const agentKeypair = generatePairingKeypair()
    const agentNonce = randomString(16)
    const fingerprint = computePairingFingerprint(
      input.orchestratorPublicKey,
      agentKeypair.publicKeyHex,
      input.orchestratorNonce,
      agentNonce,
    )

    const session: ActivePairingSession = {
      sessionId: randomUUID(),
      orchestratorSub: input.orchestratorSub,
      orchestratorPublicKey: input.orchestratorPublicKey.replace(/^ed25519:/i, '').toLowerCase(),
      orchestratorNonce: input.orchestratorNonce,
      agentKeypair,
      agentNonce,
      fingerprint,
      agentRestartEpoch: this.agentRestartEpoch,
      agentUiConfirmed: false,
      orchestratorConfirmed: false,
      rejected: false,
      createdAt: Date.now(),
    }
    this.session = session
    this.uiPhase = 'pairing_in_progress'
    return { ok: true, session }
  }

  confirmAgentUi(sessionId: string): boolean {
    if (!this.session || this.session.sessionId !== sessionId) return false
    this.session.agentUiConfirmed = true
    return true
  }

  confirmOrchestrator(sessionId: string): boolean {
    if (!this.session || this.session.sessionId !== sessionId) return false
    this.session.orchestratorConfirmed = true
    return true
  }

  isSessionReadyToPersist(): boolean {
    return Boolean(
      this.session &&
        !this.session.rejected &&
        this.session.agentUiConfirmed &&
        this.session.orchestratorConfirmed,
    )
  }

  rejectSession(): void {
    if (this.session) {
      this.session.rejected = true
    }
    this.session = null
    this.uiPhase = 'code_displayed'
    this.ensurePairingCode()
  }

  completePairing(): ActivePairingSession | null {
    if (!this.isSessionReadyToPersist() || !this.session) return null
    const done = this.session
    this.session = null
    this.pairingCode = null
    this.uiPhase = 'pairing_complete'
    return done
  }

  markPairedIdle(): void {
    this.uiPhase = 'pairing_complete'
  }
}
