/**
 * Shared validator / sealed-storage readiness helper.
 *
 * Wire ONLY at these two security-critical boundaries:
 *   1. processBeapPackageInline  → before validatorOrchestrator.validate()
 *   2. ensureSealedStorageReadyForSandboxClone → before sealedQuery()
 *
 * Do NOT use globally.  The helper is idempotent (safe to call concurrently
 * or repeatedly) and exits immediately when the key provider is already bound.
 *
 * Root cause this fixes
 * ─────────────────────
 * vault.unlock / vault.create fire `validatorOrchestrator.start()` with
 * .catch() — i.e. non-awaited.  The subprocess forks and awaits its startup
 * ack before `bindKeyProvider()` is called.  If a BEAP message arrives or a
 * clone is triggered before the ack is received, `validate()` throws
 * "Validation service unavailable" and `sealedQuery()` throws
 * "key provider not bound", because `liveness !== 'running'` and
 * `isKeyProviderBound() === false`.
 *
 * This helper detects that window and awaits the startup (or re-starts a
 * dead/unstarted subprocess) before returning, so callers see a ready state.
 */

import { isKeyProviderBound } from './sealed-storage'
import { validatorOrchestrator } from './validator-process/orchestrator'
import { vaultService } from './vault/service'

export type ValidatorReadyCode =
  | 'vault_locked'
  | 'start_failed'
  | 'not_ready_after_start'

export type ValidatorReadyResult =
  | { ok: true }
  | { ok: false; code: ValidatorReadyCode; error: string }

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Ensure the validator subprocess is running and the sealed-storage key
 * provider is bound before a security-critical operation.
 *
 * - Fast path  (key provider already bound): returns immediately.
 * - Vault locked: returns `{ ok: false, code: 'vault_locked' }`.
 * - Subprocess in-flight (started by vault.unlock but ack not yet received):
 *   polls up to 15 s for `bindKeyProvider` to be called.
 * - Subprocess not started or dead: awaits `start()` directly.
 * - Any other start error: returns `{ ok: false, code: 'start_failed' }`.
 *
 * @param reason  Caller context written into `[VALIDATOR_READY_CHECK]` logs
 *                (e.g. `'beap_receive'`, `'clone_prepare'`).
 */
export async function ensureValidatorAndSealedStorageReady(
  reason: string,
): Promise<ValidatorReadyResult> {
  // ── Fast path ─────────────────────────────────────────────────────────────
  if (isKeyProviderBound()) {
    console.log(
      `[VALIDATOR_READY_CHECK] ready reason=${reason} vaultUnlocked=true validatorRunning=${validatorOrchestrator.getLiveness() === 'running'} keyProviderBound=true`,
    )
    return { ok: true }
  }

  const status = vaultService.getStatus()
  const vaultUnlocked = status?.isUnlocked === true
  const validatorRunning = validatorOrchestrator.getLiveness() === 'running'
  const keyProviderBound = isKeyProviderBound()

  console.log(
    `[VALIDATOR_READY_CHECK] reason=${reason} vaultUnlocked=${vaultUnlocked} validatorRunning=${validatorRunning} keyProviderBound=${keyProviderBound}`,
  )

  if (!vaultUnlocked) {
    console.log(`[VALIDATOR_READY_CHECK] failed reason=${reason} code=vault_locked`)
    return {
      ok: false,
      code: 'vault_locked',
      error: 'Vault is locked — cannot start validator or perform sealed operations.',
    }
  }

  // ── Attempt to start (or join in-flight start) ────────────────────────────
  console.log(`[VALIDATOR_READY_CHECK] start_attempt reason=${reason}`)
  try {
    // start() awaits the subprocess ack, then calls bindKeyProvider().
    // Throws 'Subprocess already running' when a fork is in-flight (but ack
    // not yet received) — handled in the catch branch below.
    await validatorOrchestrator.start(vaultService)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)

    if (msg.includes('Subprocess already running')) {
      // vault.unlock fired start() non-awaited; subprocess is forking but
      // bindKeyProvider() has not been called yet (waiting for startup ack).
      // Poll until the ack arrives and the key provider is bound.
      const POLL_MS = 50
      const POLL_DEADLINE_MS = 15_000
      const deadline = Date.now() + POLL_DEADLINE_MS
      while (Date.now() < deadline) {
        if (isKeyProviderBound()) break
        await delay(POLL_MS)
      }
    } else {
      console.log(`[VALIDATOR_READY_CHECK] failed reason=${reason} code=start_failed error=${msg}`)
      return {
        ok: false,
        code: 'start_failed',
        error: `Validator subprocess start failed: ${msg}`,
      }
    }
  }

  // ── Final readiness check ─────────────────────────────────────────────────
  if (!isKeyProviderBound()) {
    console.log(`[VALIDATOR_READY_CHECK] failed reason=${reason} code=not_ready_after_start`)
    return {
      ok: false,
      code: 'not_ready_after_start',
      error: 'Validator subprocess did not bind sealed-storage key provider in time.',
    }
  }

  console.log(`[VALIDATOR_READY_CHECK] ready reason=${reason}`)
  return { ok: true }
}
