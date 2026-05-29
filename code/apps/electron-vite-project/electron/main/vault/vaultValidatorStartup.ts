/**
 * Await validator start after vault unlock/create and confirm inner key provider binding.
 */

import { validatorOrchestrator } from '../validation/inProcessValidator'
import { isKeyProviderBound } from '../sealed-storage/index'
import type { VaultService } from './service'

export const VAULT_VALIDATOR_ERROR = {
  START_FAILED: 'ERR_VALIDATOR_START_FAILED',
  INNER_UNBOUND: 'ERR_VALIDATOR_INNER_PROVIDER_UNBOUND',
} as const

export async function startValidatorAfterVaultSession(vault: VaultService): Promise<void> {
  try {
    await validatorOrchestrator.start(vault)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    const e = new Error(`Validator failed to start after vault unlock: ${msg}`)
    ;(e as { code?: string }).code = VAULT_VALIDATOR_ERROR.START_FAILED
    throw e
  }
  if (!isKeyProviderBound('inner')) {
    try {
      await validatorOrchestrator.stop()
    } catch {
      /* best-effort rollback */
    }
    const e = new Error(
      'Validator did not bind inner sealed-storage key provider after vault unlock (check vault session)',
    )
    ;(e as { code?: string }).code = VAULT_VALIDATOR_ERROR.INNER_UNBOUND
    throw e
  }
}
