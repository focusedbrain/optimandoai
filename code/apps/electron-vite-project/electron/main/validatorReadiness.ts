/**
 * Shared validator / sealed-storage readiness helper.
 *
 * Wire ONLY at these two security-critical boundaries:
 *   1. processBeapPackageInline  → before validatorOrchestrator.validate()
 *   2. ensureSealedStorageReadyForSandboxClone → before sealedQuery()
 *
 * Do NOT use globally.  The helper is idempotent (safe to call concurrently
 * or repeatedly) and exits immediately when the key provider is already bound
 * AND the outer vault session is still active.
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
 * Outer vault state model
 * ───────────────────────
 * `outerVaultFound`  – a vault exists on disk for the current SSO account.
 *                      Sourced from `getStatus().availableVaults.length > 0`.
 *                      False only when no vault has been created yet for the
 *                      account (or every vault is legacy-unclaimed).
 *
 * `outerVaultReady`  – `isUnlocked === true`: the vault was unlocked with
 *                      the master password AND the session (VMK) is still
 *                      active.  False after auto-lock or explicit lock.
 *
 * Auto-lock edge case
 * ───────────────────
 * `vault.lock()` called from the autolock timer (VaultService.startAutoLockTimer)
 * clears `this.session` but does NOT stop the validator subprocess.  This can
 * leave `isKeyProviderBound()=true` while `isUnlocked=false`.  The key
 * provider closure returns null in that state, causing sealedQuery to throw
 * SealVerificationError.  The fast path therefore verifies BOTH conditions.
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
import { getCachedUserInfo } from '../../src/auth/session'

export type ValidatorReadyCode =
  | 'outer_vault_not_ready'
  | 'outer_vault_unavailable'
  | 'start_failed'
  | 'not_ready_after_start'

export type ValidatorReadyResult =
  | { ok: true }
  | { ok: false; code: ValidatorReadyCode; error: string }

interface OuterVaultProbe {
  outerVaultFound: boolean
  outerVaultReady: boolean
  currentVaultId: string
  accountId: string
  legacyVaultCount: number
  foreignVaultCount: number
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Probe outer vault state and emit [OUTER_VAULT_CHECK] diagnostics.
 *
 * Does NOT check the inner vault (HA mode).  innerVaultRequired is always
 * false for BEAP operations and is logged explicitly as such.
 */
function probeOuterVaultState(reason: string): OuterVaultProbe {
  const status = vaultService.getStatus()
  const userInfo = getCachedUserInfo()

  const accountId = String(userInfo?.wrdesk_user_id || userInfo?.sub || 'unknown').slice(0, 40)
  // outerVaultFound: at least one vault exists for the current SSO account
  const outerVaultFound = (status?.availableVaults?.length ?? 0) > 0
  // outerVaultReady: outer vault session is active (master-password unlocked, VMK in memory)
  // The inner vault (HA mode) is NOT checked — BEAP must never require it.
  const outerVaultReady = status?.isUnlocked === true
  const currentVaultId = status?.currentVaultId ?? 'default'
  const legacyVaultCount = status?.legacyUnclaimedVaults?.length ?? 0
  const foreignVaultCount = status?.hiddenForeignVaultCount ?? 0

  console.log(
    `[OUTER_VAULT_CHECK] reason=${reason} account=${accountId} sessionUnlocked=${outerVaultReady} outerVaultFound=${outerVaultFound} outerVaultReady=${outerVaultReady} innerVaultRequired=false`,
  )

  if (outerVaultFound) {
    const selectedVaultId = status?.availableVaults?.[0]?.id ?? currentVaultId
    console.log(
      `[OUTER_VAULT_CHECK] selected_vault id=${selectedVaultId} account=${accountId} legacy=false legacyVaults=${legacyVaultCount} foreignVaults=${foreignVaultCount}`,
    )
  } else {
    console.log(
      `[OUTER_VAULT_CHECK] no_account_vault reason=${reason} account=${accountId} legacyVaults=${legacyVaultCount} foreignVaults=${foreignVaultCount} — outer vault unavailable`,
    )
  }

  return {
    outerVaultFound,
    outerVaultReady,
    currentVaultId,
    accountId,
    legacyVaultCount,
    foreignVaultCount,
  }
}

/**
 * Ensure the validator subprocess is running and the sealed-storage key
 * provider is bound before a security-critical operation.
 *
 * Requires the OUTER vault only (master-password session, VMK in memory).
 * The inner vault (HA mode) is NOT required and NOT checked.
 *
 * Error codes:
 *   outer_vault_unavailable – no vault found for the current SSO account
 *                             (vault was never created or is legacy-unclaimed).
 *   outer_vault_not_ready   – vault found but session not active; the master
 *                             password vault must be unlocked first.
 *   start_failed            – validator subprocess failed to start.
 *   not_ready_after_start   – subprocess started but key provider not bound
 *                             within the 15 s deadline.
 *
 * - Fast path (key provider already bound AND vault still unlocked): returns immediately.
 * - Stale binding (key provider bound but vault auto-locked): falls through to full check.
 * - Outer vault not found: returns `outer_vault_unavailable` (not the generic "locked" message).
 * - Outer vault locked: returns `outer_vault_not_ready`.
 * - Subprocess in-flight (started by vault.unlock but ack not yet received):
 *   polls up to 15 s for `bindKeyProvider` to be called.
 * - Subprocess not started or dead: awaits `start()` directly.
 *
 * @param reason  Caller context written into logs (e.g. `'beap_receive'`, `'clone_prepare'`).
 */
export async function ensureValidatorAndSealedStorageReady(
  reason: string,
): Promise<ValidatorReadyResult> {
  // ── Fast path ─────────────────────────────────────────────────────────────
  // Verify BOTH: key provider bound AND outer vault still unlocked.
  // The auto-lock timer (VaultService) can clear `session` without stopping
  // the validator, leaving a stale binding whose closure returns null.
  if (isKeyProviderBound() && vaultService.getStatus().isUnlocked) {
    console.log(
      `[VALIDATOR_READY_CHECK] ready reason=${reason} outerVaultReady=true validatorRunning=${validatorOrchestrator.getLiveness() === 'running'} keyProviderBound=true`,
    )
    return { ok: true }
  }

  // ── Probe outer vault state ────────────────────────────────────────────────
  const probe = probeOuterVaultState(reason)
  const validatorRunning = validatorOrchestrator.getLiveness() === 'running'
  const keyProviderBound = isKeyProviderBound()

  console.log(
    `[VALIDATOR_READY_CHECK] reason=${reason} outerVaultReady=${probe.outerVaultReady} validatorRunning=${validatorRunning} keyProviderBound=${keyProviderBound}`,
  )

  if (!probe.outerVaultFound) {
    // No vault exists for this SSO account — cannot derive seal key.
    // This is different from "vault locked": the vault has never been created
    // (or all on-disk vaults are legacy-unclaimed and cannot be auto-bound).
    console.log(
      `[VALIDATOR_READY_CHECK] failed reason=${reason} code=outer_vault_unavailable account=${probe.accountId}`,
    )
    return {
      ok: false,
      code: 'outer_vault_unavailable',
      error:
        'No vault found for the current account — create or claim a vault to enable BEAP operations.',
    }
  }

  if (!probe.outerVaultReady) {
    // Vault exists but session is not active (master password not entered, or auto-locked).
    console.log(
      `[VALIDATOR_READY_CHECK] failed reason=${reason} code=outer_vault_not_ready — vault found but session not active`,
    )
    return {
      ok: false,
      code: 'outer_vault_not_ready',
      error:
        'Outer vault session not active — unlock your vault first to enable BEAP operations.',
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
      console.log(
        `[VALIDATOR_READY_CHECK] failed reason=${reason} code=start_failed error=${msg}`,
      )
      return {
        ok: false,
        code: 'start_failed',
        error: `Validator subprocess start failed: ${msg}`,
      }
    }
  }

  // ── Final readiness check ─────────────────────────────────────────────────
  if (!isKeyProviderBound()) {
    console.log(
      `[VALIDATOR_READY_CHECK] failed reason=${reason} code=not_ready_after_start`,
    )
    return {
      ok: false,
      code: 'not_ready_after_start',
      error: 'Validator subprocess did not bind sealed-storage key provider in time.',
    }
  }

  console.log(`[VALIDATOR_READY_CHECK] ready reason=${reason}`)
  return { ok: true }
}
