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
 * Vault boundary
 * ──────────────
 * Only the OUTER vault is required here.  The outer vault is defined by
 * `vaultService.getStatus().isUnlocked` being true, which means the vault
 * session exists (KEK + VMK in memory after master-password unlock).
 * `vault.deriveApplicationKey` uses the VMK from that session to derive the
 * HMAC seal key for both the validator subprocess and the sealed-storage
 * key provider.
 *
 * The inner vault (HA mode — `ha.lock` / `ha.unlock`) gates vault CRUD item
 * operations inside handleVaultRPC.  BEAP messaging, BEAP receive validation,
 * sealed inbox writes, and BEAP cloning do NOT route through that HA guard and
 * MUST NOT require HA unlock.  This helper is explicitly inner-vault-free.
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
  | 'outer_vault_not_ready'
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
 * Requires the OUTER vault only (master-password session, VMK in memory).
 * The inner vault (HA mode) is NOT required and NOT checked.
 *
 * - Fast path  (key provider already bound): returns immediately.
 * - Outer vault not ready: returns `{ ok: false, code: 'outer_vault_not_ready' }`.
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
      `[VALIDATOR_READY_CHECK] ready reason=${reason} outerVaultReady=true validatorRunning=${validatorOrchestrator.getLiveness() === 'running'} keyProviderBound=true`,
    )
    return { ok: true }
  }

  const status = vaultService.getStatus()
  // outerVaultReady: outer vault session is active (master-password unlocked, VMK in memory).
  // The inner vault (HA mode) is irrelevant — BEAP ops must not require it.
  const outerVaultReady = status?.isUnlocked === true
  const validatorRunning = validatorOrchestrator.getLiveness() === 'running'
  const keyProviderBound = isKeyProviderBound()

  console.log(
    `[VALIDATOR_READY_CHECK] reason=${reason} outerVaultReady=${outerVaultReady} validatorRunning=${validatorRunning} keyProviderBound=${keyProviderBound}`,
  )

  if (!outerVaultReady) {
    console.log(`[VALIDATOR_READY_CHECK] failed reason=${reason} code=outer_vault_not_ready`)
    return {
      ok: false,
      code: 'outer_vault_not_ready',
      error: 'Outer vault not ready — cannot start validator or perform sealed operations.',
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
