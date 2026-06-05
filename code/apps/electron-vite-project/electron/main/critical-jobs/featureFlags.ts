/**
 * Critical-job seam feature flags (B.3).
 *
 * `WRDESK_SEAM_VALIDATION_CUTOVER` routes the live validation legs
 * (`validate-decrypted-beap`, `validate-native-beap`) through the
 * `CriticalJobDispatcher` instead of the inline `validatorOrchestrator.validate`
 * / `validateCapsule` calls. Default OFF: when unset the original inline code
 * paths run unchanged (byte-identical behavior).
 *
 * Resolution precedence: a non-empty env var wins (per-machine ops switch);
 * otherwise the persisted config key `seamValidationCutover` in
 * `seam-flags.json` under Electron userData; otherwise OFF.
 *
 * The depackage/MIME cutover is a separate later build (B2) — NOT gated here.
 */

import fs from 'fs'
import path from 'path'
import { app } from 'electron'

const ENV_KEY = 'WRDESK_SEAM_VALIDATION_CUTOVER'
const CONFIG_KEY = 'seamValidationCutover'
const FILE_NAME = 'seam-flags.json'

function truthy(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v !== 'string') return false
  const s = v.trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'on' || s === 'yes'
}

function readPersistedFlag(key: string): boolean {
  try {
    const dir = app?.getPath ? app.getPath('userData') : null
    if (!dir) return false
    const p = path.join(dir, FILE_NAME)
    if (!fs.existsSync(p)) return false
    const raw = JSON.parse(fs.readFileSync(p, 'utf-8')) as Record<string, unknown>
    return truthy(raw[key])
  } catch {
    // Missing/corrupt store, or no Electron app (unit context) → treat as OFF.
    return false
  }
}

/**
 * Is the seam validation cutover enabled? Reads `process.env` fresh on each call
 * (so tests can toggle it) and falls back to the persisted config.
 */
export function isSeamValidationCutoverEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[ENV_KEY]
  if (typeof raw === 'string' && raw.trim() !== '') return truthy(raw)
  return readPersistedFlag(CONFIG_KEY)
}
