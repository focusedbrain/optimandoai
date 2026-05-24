/**
 * Validator Orchestrator — Phase B, PR B-2
 *
 * Main-process side of the validator subprocess lifecycle.  Owns:
 *   - Fork / startup of the subprocess on vault unlock.
 *   - Graceful shutdown / forced kill on vault lock or app exit.
 *   - Healthcheck (ping/pong) on a configurable interval.
 *   - In-flight request tracking: ValidateRequest → Promise<ValidateResponse>.
 *   - Crash recovery: sets liveness = dead, surfaces notification; does NOT
 *     auto-restart (user must log out and back in per architecture).
 *   - Key-provider wiring: binds the SealKeyProvider to the storage gate after
 *     subprocess startup; unbinds on stop.  (PR B-2 Amendment, Decision 1.)
 *
 * Key lifecycle invariant:
 *   The HMAC seal key is sent to the subprocess once in the startup message
 *   and then the Buffer is zeroized in main process memory.  The orchestrator
 *   holds NO long-lived copy of the key.
 *
 *   The gate's SealKeyProvider calls vault.deriveApplicationKey on demand;
 *   the derived Buffer lives for microseconds inside verifyHmacWithProvider.
 *
 * Architecture reference: Phase B, Sections 2.1, 2.2, 2.5; Amendment to B-2.
 */

import { fork, type ChildProcess } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'

import type { VaultService } from '../vault/service'
import { CONTENT_VALIDATOR_VERSION } from '@repo/ingestion-core'
import type {
  ValidateRequest,
  ValidateResponse,
  SubprocessAckMessage,
  SubprocessOutboundMessage,
} from '@repo/ingestion-core'
import { bindKeyProvider, unbindKeyProvider } from '../sealed-storage/index'

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const SEAL_KEY_INFO = 'validator-seal-key-v1'
const HEALTHCHECK_INTERVAL_MS = 5_000
const STARTUP_TIMEOUT_MS = 10_000
const SHUTDOWN_TIMEOUT_MS = 5_000
const PING_TIMEOUT_MS = 3_000

/** Bundled main-process ESM — no global `__dirname`; anchor next to the emitted main chunk. */
const moduleDir = dirname(fileURLToPath(import.meta.url))

// The compiled subprocess entry point path.  Tests override this via
// setValidatorWorkerPath() before starting the orchestrator.
// build-validator-subprocess Vite plugin emits this file alongside the main bundle.
let workerPath = join(moduleDir, 'validator-process', 'index.js')

/** Override the subprocess entry path (used by tests with tsx). */
export function setValidatorWorkerPath(path: string): void {
  workerPath = path
}

/** Read the current worker path (for test assertion). */
export function getValidatorWorkerPath(): string {
  return workerPath
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification surface — thin wrapper so tests can mock it
// ─────────────────────────────────────────────────────────────────────────────

export type ValidationServiceUnavailableReason =
  | 'vault_not_unlocked'
  | 'startup_timeout'
  | 'subprocess_crashed'
  | 'healthcheck_failed'

let _notifyUnavailable: ((reason: ValidationServiceUnavailableReason) => void) | null = null

/** Register a callback that is called when the validation service becomes unavailable. */
export function onValidationServiceUnavailable(
  cb: (reason: ValidationServiceUnavailableReason) => void,
): void {
  _notifyUnavailable = cb
}

function surfaceUnavailable(reason: ValidationServiceUnavailableReason): void {
  console.error(`[VALIDATOR_ORCHESTRATOR] Validation service unavailable: ${reason}`)
  _notifyUnavailable?.(reason)
}

// ─────────────────────────────────────────────────────────────────────────────
// ValidatorOrchestrator
// ─────────────────────────────────────────────────────────────────────────────

export type OrchestratorLiveness = 'running' | 'dead' | 'not_started'

export class ValidatorOrchestrator {
  private subprocess: ChildProcess | null = null
  private liveness: OrchestratorLiveness = 'not_started'

  /** request_id → { resolve, reject, timer } */
  private pendingRequests = new Map<
    string,
    { resolve: (r: ValidateResponse) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >()

  /** Pending startup ack resolver */
  private startupAckResolver: { resolve: () => void; reject: (e: Error) => void } | null = null

  /** Healthcheck timer handle */
  private healthcheckTimer: NodeJS.Timeout | null = null

  /** In-flight ping resolver (one at a time) */
  private pingResolver: { resolve: () => void; reject: (e: Error) => void } | null = null

  /** For tests: exposes liveness without coupling to internals. */
  getLiveness(): OrchestratorLiveness {
    return this.liveness
  }

  /**
   * Start the validator subprocess after vault unlock.
   *
   * Derives the seal key from the vault, forks the subprocess, sends the
   * startup message, waits for ack, then zeroizes the key in main process
   * memory.  The main process holds the key only during this window.
   */
  async start(vault: VaultService, execArgv?: string[]): Promise<void> {
    if (this.subprocess && !this.subprocess.killed) {
      throw new Error('[VALIDATOR_ORCHESTRATOR] Subprocess already running')
    }

    // Derive the seal key.  The key lives in a local variable and is zeroized
    // immediately after the IPC send — it is NOT stored in any field.
    const sealKey = vault.deriveApplicationKey(SEAL_KEY_INFO)
    if (!sealKey) {
      surfaceUnavailable('vault_not_unlocked')
      throw new Error('[VALIDATOR_ORCHESTRATOR] Vault not unlocked — cannot derive seal key')
    }

    const validatorVersion = CONTENT_VALIDATOR_VERSION

    this.subprocess = fork(workerPath, [], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      ...(execArgv ? { execArgv } : {}),
    })

    this.subprocess.stdout?.on('data', (d) =>
      console.log(`[VALIDATOR_SUBPROCESS:stdout] ${String(d).trimEnd()}`),
    )
    this.subprocess.stderr?.on('data', (d) =>
      console.error(`[VALIDATOR_SUBPROCESS:stderr] ${String(d).trimEnd()}`),
    )

    this.subprocess.on('exit', (code, signal) => {
      if (this.liveness === 'running') {
        console.error(
          `[VALIDATOR_ORCHESTRATOR] Subprocess exited unexpectedly: code=${code} signal=${signal}`,
        )
        this.liveness = 'dead'
        this._rejectAllPending(new Error('Validator subprocess exited unexpectedly'))
        surfaceUnavailable('subprocess_crashed')
      }
    })

    this.subprocess.on('message', (raw) => this._handleSubprocessMessage(raw))

    // Wait for startup ack with a timeout.
    await new Promise<void>((resolve, reject) => {
      this.startupAckResolver = { resolve, reject }

      const timer = setTimeout(() => {
        this.startupAckResolver = null
        reject(new Error('[VALIDATOR_ORCHESTRATOR] Startup ack timeout'))
        surfaceUnavailable('startup_timeout')
      }, STARTUP_TIMEOUT_MS)

      this.startupAckResolver = {
        resolve: () => {
          clearTimeout(timer)
          resolve()
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      }

      // Send the startup message and zeroize the key immediately after.
      this.subprocess!.send({
        kind: 'startup',
        seal_key_b64: sealKey.toString('base64'),
        validator_version: validatorVersion,
      })
      sealKey.fill(0)
      // sealKey Buffer is now zeroed; GC will reclaim it.  The orchestrator
      // has NO stored copy; the only live copy is inside the subprocess.
    })

    this.liveness = 'running'
    this._startHealthcheck()

    // Bind the inner (VMK-derived) key provider to the storage gate.  Called
    // after the subprocess is confirmed running so the gate is only active
    // when the full validation pipeline is healthy.
    bindKeyProvider(() => vault.deriveApplicationKey(SEAL_KEY_INFO), 'inner')
    console.log('[SEAL] inner seal key bound')
  }

  /**
   * Gracefully stop the subprocess (vault lock or app exit).
   * Sends shutdown message; if no ack within timeout, SIGKILL.
   */
  async stop(): Promise<void> {
    // Unbind the inner key provider immediately so the gate rejects all
    // subsequent sealed operations even before the subprocess finishes
    // shutting down.
    unbindKeyProvider('inner')
    console.log('[SEAL] inner seal key unbound')

    this._stopHealthcheck()

    if (!this.subprocess || this.subprocess.killed) {
      this.liveness = 'not_started'
      return
    }

    this.liveness = 'not_started'
    this._rejectAllPending(new Error('Validator subprocess shutting down'))

    await new Promise<void>((resolve) => {
      if (!this.subprocess || this.subprocess.killed) {
        resolve()
        return
      }

      const timer = setTimeout(() => {
        console.warn('[VALIDATOR_ORCHESTRATOR] Shutdown ack timeout; sending SIGKILL')
        this.subprocess?.kill('SIGKILL')
        resolve()
      }, SHUTDOWN_TIMEOUT_MS)

      const onExit = () => {
        clearTimeout(timer)
        resolve()
      }
      this.subprocess!.once('exit', onExit)

      try {
        this.subprocess!.send({ kind: 'shutdown' })
      } catch {
        clearTimeout(timer)
        this.subprocess?.kill()
        resolve()
      }
    })

    this.subprocess = null
  }

  /**
   * Send a ValidateRequest and wait for the matching ValidateResponse.
   * Rejects if the subprocess is not running.
   */
  async validate(
    req: Omit<ValidateRequest, 'request_id'>,
  ): Promise<ValidateResponse> {
    if (this.liveness !== 'running' || !this.subprocess) {
      throw new Error('Validation service unavailable')
    }

    const request_id = randomUUID()
    const fullReq: ValidateRequest = { ...req, request_id }

    return new Promise<ValidateResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(request_id)
        reject(new Error(`ValidateRequest ${request_id} timed out`))
      }, 30_000)

      this.pendingRequests.set(request_id, { resolve, reject, timer })

      try {
        this.subprocess!.send(fullReq)
      } catch (err) {
        clearTimeout(timer)
        this.pendingRequests.delete(request_id)
        reject(err)
      }
    })
  }

  /**
   * Send a ping and wait for pong.  Used by healthcheck and tests.
   */
  async ping(): Promise<void> {
    if (!this.subprocess || this.subprocess.killed) {
      throw new Error('Subprocess not running')
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pingResolver = null
        reject(new Error('Ping timeout'))
      }, PING_TIMEOUT_MS)

      this.pingResolver = {
        resolve: () => { clearTimeout(timer); resolve() },
        reject: (e) => { clearTimeout(timer); reject(e) },
      }

      try {
        this.subprocess!.send({ kind: 'ping' })
      } catch (err) {
        clearTimeout(timer)
        this.pingResolver = null
        reject(err)
      }
    })
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────

  private _handleSubprocessMessage(raw: unknown): void {
    const msg = raw as SubprocessOutboundMessage

    if (!msg || typeof msg !== 'object') return

    // Ack messages
    if ('kind' in msg) {
      const ack = msg as SubprocessAckMessage
      if (ack.kind === 'startup_ack') {
        this.startupAckResolver?.resolve()
        this.startupAckResolver = null
        return
      }
      if (ack.kind === 'pong') {
        this.pingResolver?.resolve()
        this.pingResolver = null
        return
      }
      if (ack.kind === 'shutdown_ack') {
        // Subprocess confirmed graceful shutdown; exit event will follow.
        return
      }
    }

    // ValidateResponse (has request_id)
    if ('request_id' in msg) {
      const resp = msg as ValidateResponse
      const pending = this.pendingRequests.get(resp.request_id)
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingRequests.delete(resp.request_id)
        pending.resolve(resp)
      }
      return
    }

    console.warn(
      '[VALIDATOR_ORCHESTRATOR] Unknown message from subprocess:',
      JSON.stringify(raw).slice(0, 200),
    )
  }

  private _rejectAllPending(err: Error): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer)
      pending.reject(err)
      this.pendingRequests.delete(id)
    }
    this.pingResolver?.reject(err)
    this.pingResolver = null
    this.startupAckResolver?.reject(err)
    this.startupAckResolver = null
  }

  private _startHealthcheck(): void {
    this._stopHealthcheck()
    this.healthcheckTimer = setInterval(async () => {
      if (this.liveness !== 'running') {
        this._stopHealthcheck()
        return
      }
      try {
        await this.ping()
      } catch {
        if (this.liveness === 'running') {
          console.error('[VALIDATOR_ORCHESTRATOR] Healthcheck failed — subprocess unresponsive')
          this.liveness = 'dead'
          this._rejectAllPending(new Error('Validator subprocess unresponsive'))
          surfaceUnavailable('healthcheck_failed')
          this._stopHealthcheck()
        }
      }
    }, HEALTHCHECK_INTERVAL_MS)
  }

  private _stopHealthcheck(): void {
    if (this.healthcheckTimer) {
      clearInterval(this.healthcheckTimer)
      this.healthcheckTimer = null
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton (production use)
// ─────────────────────────────────────────────────────────────────────────────

export const validatorOrchestrator = new ValidatorOrchestrator()
