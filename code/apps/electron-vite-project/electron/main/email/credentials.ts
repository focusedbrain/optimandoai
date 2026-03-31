/**
 * Email OAuth Credential Storage — vault + safeStorage-encrypted file backup
 *
 * Storage hierarchy (most secure → fallback):
 *   1. WR Vault (AES-GCM, unlocked by user PIN/password)
 *   2. safeStorage-encrypted backup file (DPAPI / Keychain / libsecret)
 *   3. Plain JSON file (last resort when OS encryption is unavailable)
 *
 * Honest source tracking: the UI must never claim "from vault" when
 * credentials came from file.
 *
 * Connection-drop fix: backup files are NEVER deleted after vault migration.
 * If the vault locks (session expiry, user logout), getCredentialsForOAuth()
 * can always fall back to the encrypted backup and token-refresh will succeed.
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { encryptValue, decryptValue, isSecureStorageAvailable } from './secure-storage'
import { loadOAuthConfig, saveOAuthConfig } from './providers/gmail'
import { isBuiltinGmailOAuthConfigured } from './googleOAuthBuiltin'
import { loadOutlookOAuthConfig, saveOutlookOAuthConfig } from './providers/outlook'

function credLog(...args: unknown[]): void {
  console.log('[Credentials]', ...args)
}

export type CredentialSource = 'vault' | 'vault-migrated' | 'backup-file' | 'temporary' | 'none'

export interface GmailCreds {
  clientId: string
  clientSecret: string
}

export interface OutlookCreds {
  clientId: string
  clientSecret?: string
  tenantId?: string
}

/** Zoho Mail OAuth client (Developer Console). */
export interface ZohoCreds {
  clientId: string
  clientSecret: string
  /** `com` (default) or `eu` for accounts.zoho.eu / mail.zoho.eu */
  datacenter?: 'com' | 'eu'
}

export type EmailCreds = GmailCreds | OutlookCreds | ZohoCreds

export interface CheckResult {
  source: CredentialSource
  credentials: GmailCreds | OutlookCreds | ZohoCreds | null
  clientId?: string
  hasSecret: boolean
  /** Gmail: app-owned client id is configured (env / resources); end users can connect without pasting OAuth credentials. */
  builtinOAuthAvailable?: boolean
}

const GMAIL_VAULT_TITLE = 'Gmail OAuth Client Credentials'
const OUTLOOK_VAULT_TITLE = 'Outlook OAuth Client Credentials'
const ZOHO_VAULT_TITLE = 'Zoho Mail OAuth Client Credentials'

// ── Path helpers ─────────────────────────────────────────────────────────────

function getGmailConfigPath(): string {
  return path.join(app.getPath('userData'), 'email-oauth-config.json')
}

function getOutlookConfigPath(): string {
  return path.join(app.getPath('userData'), 'outlook-oauth-config.json')
}

function getZohoConfigPath(): string {
  return path.join(app.getPath('userData'), 'zoho-oauth-config.json')
}

/**
 * Encrypted backup files — written alongside every vault save so credentials
 * survive vault lock/logout without falling back to unencrypted plain JSON.
 */
function getBackupPath(provider: 'gmail' | 'outlook' | 'zoho'): string {
  return path.join(
    app.getPath('userData'),
    `${provider}-credentials.enc`,
  )
}

// ── safeStorage-encrypted backup helpers ─────────────────────────────────────

/**
 * Write credentials to an OS-encrypted backup file.
 * Falls back to plain JSON only when safeStorage is unavailable (rare, user-warned
 * by secure-storage.ts).  The `_e` wrapper distinguishes encrypted from plain.
 */
function writeBackupFile(provider: 'gmail' | 'outlook' | 'zoho', creds: EmailCreds): void {
  try {
    const json = JSON.stringify(creds)
    const payload = isSecureStorageAvailable()
      ? JSON.stringify({ _e: encryptValue(json) })
      : json
    fs.writeFileSync(getBackupPath(provider), payload, 'utf-8')
  } catch (err) {
    credLog(`writeBackupFile(${provider}) error:`, err)
  }
}

/**
 * Read and decrypt the OS-encrypted backup file.
 * Handles both encrypted (`{ _e: "..." }`) and legacy plain JSON.
 */
function readBackupFile(
  provider: 'gmail' | 'outlook' | 'zoho',
): GmailCreds | OutlookCreds | ZohoCreds | null {
  try {
    const p = getBackupPath(provider)
    if (!fs.existsSync(p)) return null
    const raw = fs.readFileSync(p, 'utf-8')
    const outer = JSON.parse(raw) as Record<string, unknown>
    let inner: Record<string, unknown>
    if (typeof outer._e === 'string') {
      inner = JSON.parse(decryptValue(outer._e)) as Record<string, unknown>
    } else {
      inner = outer
    }
    if (!inner?.clientId) return null
    return inner as unknown as GmailCreds | OutlookCreds | ZohoCreds
  } catch (err) {
    credLog(`readBackupFile(${provider}) error:`, err)
    return null
  }
}

// ── Zoho plain-file helpers (no circular import with providers/zoho.ts) ──────

export function loadZohoOAuthConfig(): ZohoCreds | null {
  try {
    const p = getZohoConfigPath()
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, 'utf-8'))
      if (j?.clientId && j?.clientSecret) {
        return {
          clientId: String(j.clientId),
          clientSecret: String(j.clientSecret),
          datacenter: j.datacenter === 'eu' ? 'eu' : 'com',
        }
      }
    }
  } catch (err) {
    credLog('loadZohoOAuthConfig error:', err)
  }
  return null
}

export function saveZohoOAuthConfig(
  clientId: string,
  clientSecret: string,
  datacenter: 'com' | 'eu' = 'com',
): void {
  try {
    fs.writeFileSync(
      getZohoConfigPath(),
      JSON.stringify({ clientId, clientSecret, datacenter }, null, 2),
      'utf-8',
    )
  } catch (err) {
    credLog('saveZohoOAuthConfig error:', err)
  }
}

/** Load credentials from plain file only (legacy path; backup file preferred). */
export function loadFromFile(
  provider: 'gmail' | 'outlook' | 'zoho',
): GmailCreds | OutlookCreds | ZohoCreds | null {
  if (provider === 'gmail') {
    const c = loadOAuthConfig()
    return c ? { clientId: c.clientId, clientSecret: c.clientSecret || undefined } : null
  }
  if (provider === 'zoho') {
    return loadZohoOAuthConfig()
  }
  const c = loadOutlookOAuthConfig()
  return c ? { clientId: c.clientId, clientSecret: c.clientSecret, tenantId: c.tenantId } : null
}

const DEFAULT_TIER = 'free' as const // automation_secret is free-tier accessible

// ── Vault helpers ─────────────────────────────────────────────────────────────

/** Load credentials from vault (requires vault unlocked). */
export async function loadFromVault(
  provider: 'gmail' | 'outlook' | 'zoho',
): Promise<GmailCreds | OutlookCreds | ZohoCreds | null> {
  try {
    const { vaultService } = await import('../vault/rpc')
    const status = vaultService.getStatus()
    if (!status.isUnlocked) return null

    const tier = DEFAULT_TIER
    const title =
      provider === 'gmail'
        ? GMAIL_VAULT_TITLE
        : provider === 'zoho'
          ? ZOHO_VAULT_TITLE
          : OUTLOOK_VAULT_TITLE
    const items = vaultService.search(title, 'automation_secret', tier)
    if (items.length === 0) return null

    const item = await vaultService.getItem(items[0].id, tier)
    const fields = item.fields || []
    const getField = (key: string) => fields.find((f: any) => f.key === key)?.value ?? ''

    if (provider === 'gmail') {
      const clientId = getField('client_id')
      const clientSecret = getField('client_secret')
      if (!clientId) return null
      return { clientId, clientSecret: clientSecret || undefined }
    }
    if (provider === 'zoho') {
      const clientId = getField('client_id')
      const clientSecret = getField('client_secret')
      const dcRaw = getField('zoho_datacenter')
      if (!clientId || !clientSecret) return null
      return {
        clientId,
        clientSecret,
        datacenter: dcRaw === 'eu' ? 'eu' : 'com',
      }
    }
    const clientId = getField('client_id')
    const clientSecret = getField('client_secret')
    const tenantId = getField('tenant_id') || 'organizations'
    if (!clientId) return null
    return { clientId, clientSecret: clientSecret || undefined, tenantId }
  } catch (err) {
    credLog('loadFromVault error:', err)
    return null
  }
}

/** Save credentials to vault. Returns true on success. */
export async function saveToVault(
  provider: 'gmail' | 'outlook' | 'zoho',
  creds: GmailCreds | OutlookCreds | ZohoCreds,
): Promise<boolean> {
  try {
    const { vaultService } = await import('../vault/rpc')
    const status = vaultService.getStatus()

    if (!status.isUnlocked) {
      credLog(`saveToVault(${provider}): vault is locked — skipping vault save`)
      return false
    }

    const tier = DEFAULT_TIER
    const gmailCreds = creds as GmailCreds
    const outlookCreds = creds as OutlookCreds
    const zohoCreds = creds as ZohoCreds

    const title =
      provider === 'gmail'
        ? GMAIL_VAULT_TITLE
        : provider === 'zoho'
          ? ZOHO_VAULT_TITLE
          : OUTLOOK_VAULT_TITLE
    const tenantId = outlookCreds.tenantId || 'organizations'
    const zohoDc = zohoCreds.datacenter === 'eu' ? 'eu' : 'com'

    const fields =
      provider === 'gmail'
        ? [
            { key: 'service_name', value: 'Google Gmail', encrypted: false, type: 'text' as const },
            { key: 'key_name', value: gmailCreds.clientId, encrypted: false, type: 'text' as const },
            { key: 'secret', value: gmailCreds.clientSecret ?? '', encrypted: true, type: 'password' as const },
            { key: 'endpoint', value: 'https://accounts.google.com', encrypted: false, type: 'text' as const },
            { key: 'notes', value: 'Auto-saved by WR Desk Email Connect Wizard', encrypted: false, type: 'text' as const },
            { key: 'client_id', value: gmailCreds.clientId, encrypted: false, type: 'text' as const },
            { key: 'client_secret', value: gmailCreds.clientSecret ?? '', encrypted: true, type: 'password' as const },
          ]
        : provider === 'zoho'
          ? [
              { key: 'service_name', value: 'Zoho Mail', encrypted: false, type: 'text' as const },
              { key: 'key_name', value: zohoCreds.clientId, encrypted: false, type: 'text' as const },
              { key: 'secret', value: zohoCreds.clientSecret, encrypted: true, type: 'password' as const },
              { key: 'endpoint', value: `https://accounts.zoho.${zohoDc}`, encrypted: false, type: 'text' as const },
              { key: 'notes', value: 'Auto-saved by WR Desk Email Connect Wizard', encrypted: false, type: 'text' as const },
              { key: 'client_id', value: zohoCreds.clientId, encrypted: false, type: 'text' as const },
              { key: 'client_secret', value: zohoCreds.clientSecret, encrypted: true, type: 'password' as const },
              { key: 'zoho_datacenter', value: zohoDc, encrypted: false, type: 'text' as const },
            ]
          : [
              { key: 'service_name', value: 'Microsoft 365 / Outlook', encrypted: false, type: 'text' as const },
              { key: 'key_name', value: outlookCreds.clientId, encrypted: false, type: 'text' as const },
              { key: 'secret', value: outlookCreds.clientSecret || '', encrypted: true, type: 'password' as const },
              { key: 'endpoint', value: `https://login.microsoftonline.com/${tenantId}`, encrypted: false, type: 'text' as const },
              { key: 'notes', value: `Tenant ID: ${tenantId}\nAuto-saved by WR Desk Email Connect Wizard`, encrypted: false, type: 'text' as const },
              { key: 'client_id', value: outlookCreds.clientId, encrypted: false, type: 'text' as const },
              { key: 'client_secret', value: outlookCreds.clientSecret || '', encrypted: true, type: 'password' as const },
              { key: 'tenant_id', value: tenantId, encrypted: false, type: 'text' as const },
            ]

    const items = vaultService.search(title, 'automation_secret', tier)

    if (items.length > 0) {
      await vaultService.updateItem(items[0].id, { title, fields }, tier)
      credLog(`saveToVault(${provider}): updated existing vault item`)
    } else {
      await vaultService.createItem({ category: 'automation_secret', title, fields, favorite: false }, tier)
      credLog(`saveToVault(${provider}): created new vault item`)
    }
    return true
  } catch (err) {
    credLog(`saveToVault(${provider}) error:`, err)
    return false
  }
}

// ── Vault status ──────────────────────────────────────────────────────────────

/** Check vault status synchronously (uses cached module ref after first import). */
export function isVaultUnlocked(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { vaultService } = require('../vault/rpc') as { vaultService: { getStatus: () => { isUnlocked: boolean } } }
    return vaultService.getStatus().isUnlocked === true
  } catch {
    return false
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Check existing credentials with honest source.
 * Used by the wizard for display.
 *
 * NOTE: credentials are never deleted here. The backup file persists
 * independently of vault state so token-refresh works when vault is locked.
 */
export async function checkExistingCredentials(
  provider: 'gmail' | 'outlook' | 'zoho',
): Promise<CheckResult> {
  const vaultUnlocked = isVaultUnlocked()
  let result: CheckResult

  if (vaultUnlocked) {
    const vaultCreds = await loadFromVault(provider)
    if (vaultCreds) {
      const clientId = 'clientId' in vaultCreds ? vaultCreds.clientId : ''
      const hasSecret = !!(vaultCreds as any).clientSecret
      result = { source: 'vault', credentials: vaultCreds, clientId, hasSecret }
    } else {
      // Vault is unlocked but no vault entry — check backup file then legacy file.
      // Migrate to vault if found, but KEEP the backup file as fallback.
      const backupCreds = readBackupFile(provider)
      const fileCreds = backupCreds ?? loadFromFile(provider)
      if (fileCreds) {
        const vaultSaveOk = await saveToVault(provider, fileCreds)
        // Always (re)write the encrypted backup regardless of vault save result
        writeBackupFile(provider, fileCreds)
        const clientId = 'clientId' in fileCreds ? fileCreds.clientId : ''
        const hasSecret = !!(fileCreds as any).clientSecret
        credLog(`checkExistingCredentials(${provider}): migrated from file to vault (vault=${vaultSaveOk})`)
        result = { source: 'vault-migrated', credentials: fileCreds, clientId, hasSecret }
      } else {
        result = { source: 'none', credentials: null, hasSecret: false }
      }
    }
  } else {
    // Vault locked — check encrypted backup first, then legacy plain file
    const backupCreds = readBackupFile(provider)
    if (backupCreds) {
      const clientId = 'clientId' in backupCreds ? backupCreds.clientId : ''
      const hasSecret = !!(backupCreds as any).clientSecret
      result = { source: 'backup-file', credentials: backupCreds, clientId, hasSecret }
      credLog(`checkExistingCredentials(${provider}): vault locked, using encrypted backup file`)
    } else {
      const fileCreds = loadFromFile(provider)
      if (fileCreds) {
        const clientId = 'clientId' in fileCreds ? fileCreds.clientId : ''
        const hasSecret = !!(fileCreds as any).clientSecret
        result = { source: 'temporary', credentials: fileCreds, clientId, hasSecret }
        credLog(`checkExistingCredentials(${provider}): vault locked, using plain file (unlock vault to secure)`)
      } else {
        result = { source: 'none', credentials: null, hasSecret: false }
      }
    }
  }

  if (provider === 'gmail') {
    return { ...result, builtinOAuthAvailable: isBuiltinGmailOAuthConfigured() }
  }
  return result
}

/**
 * Get credentials for OAuth flow — vault first (if unlocked), then encrypted
 * backup file, then legacy plain file.
 *
 * This three-tier lookup ensures token-refresh always succeeds even when the
 * vault is locked (session expiry, user logout, etc.) — preventing connection drops.
 */
export async function getCredentialsForOAuth(
  provider: 'gmail' | 'outlook' | 'zoho',
): Promise<GmailCreds | OutlookCreds | ZohoCreds | null> {
  // Tier 1: vault (encrypted, unlocked)
  if (isVaultUnlocked()) {
    const vaultCreds = await loadFromVault(provider)
    if (vaultCreds) return vaultCreds
  }
  // Tier 2: safeStorage-encrypted backup file (always available, OS-protected)
  const backupCreds = readBackupFile(provider)
  if (backupCreds) {
    credLog(`getCredentialsForOAuth(${provider}): vault unavailable, using encrypted backup`)
    return backupCreds
  }
  // Tier 3: legacy plain JSON file (fallback for accounts set up before this fix)
  const fileCreds = loadFromFile(provider)
  if (fileCreds) {
    credLog(`getCredentialsForOAuth(${provider}): using plain file (upgrade: re-save credentials to secure storage)`)
  }
  return fileCreds
}

/**
 * Save credentials.
 *
 * Always writes:
 *   • vault item (if vault unlocked and storeInVault=true)
 *   • safeStorage-encrypted backup file (always — ensures fallback is never missing)
 *   • legacy plain file (only when storeInVault=false OR vault is locked, as last resort)
 *
 * The backup file is NEVER deleted by this function. Credentials will be
 * available via getCredentialsForOAuth() even after vault is locked.
 */
export async function saveCredentials(
  provider: 'gmail' | 'outlook' | 'zoho',
  creds: GmailCreds | OutlookCreds | ZohoCreds,
  storeInVault: boolean = true,
): Promise<{ ok: boolean; savedToVault: boolean }> {
  const vaultUnlocked = isVaultUnlocked()
  let savedToVault = false

  // Always write the encrypted backup file first so it's never missing
  writeBackupFile(provider, creds)

  if (storeInVault && vaultUnlocked) {
    savedToVault = await saveToVault(provider, creds)
    if (!savedToVault) {
      credLog(`saveCredentials(${provider}): vault save failed, backup file is the secure copy`)
    }
  }

  if (!savedToVault) {
    // Also write legacy plain file as last-resort fallback
    if (provider === 'gmail') {
      const g = creds as GmailCreds
      saveOAuthConfig(g.clientId, g.clientSecret)
    } else if (provider === 'zoho') {
      const z = creds as ZohoCreds
      saveZohoOAuthConfig(z.clientId, z.clientSecret, z.datacenter === 'eu' ? 'eu' : 'com')
    } else {
      saveOutlookOAuthConfig(
        (creds as OutlookCreds).clientId,
        (creds as OutlookCreds).clientSecret,
        (creds as OutlookCreds).tenantId,
      )
    }
    if (storeInVault && !vaultUnlocked) {
      credLog(
        `saveCredentials(${provider}): vault is locked — credentials saved to encrypted backup ` +
          `file and plain file. Unlock the vault to move them to encrypted vault storage.`,
      )
    }
  }

  credLog(`saveCredentials(${provider}): ok=true, savedToVault=${savedToVault}`)
  return { ok: true, savedToVault }
}

/**
 * Delete the legacy plain-file credential (used only when explicitly clearing an account).
 * Does NOT touch the encrypted backup file or vault entry.
 */
export function deletePlainFile(provider: 'gmail' | 'outlook' | 'zoho'): void {
  try {
    const configPath =
      provider === 'gmail'
        ? getGmailConfigPath()
        : provider === 'zoho'
          ? getZohoConfigPath()
          : getOutlookConfigPath()
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath)
      credLog(`deletePlainFile(${provider}): removed legacy plain file`)
    }
  } catch (err) {
    credLog(`deletePlainFile(${provider}) error:`, err)
  }
}

/**
 * Delete ALL stored credentials for a provider (vault + backup file + plain file).
 * Use this only when an account is being removed / disconnected.
 */
export async function deleteAllCredentials(provider: 'gmail' | 'outlook' | 'zoho'): Promise<void> {
  // Remove backup file
  try {
    const bp = getBackupPath(provider)
    if (fs.existsSync(bp)) {
      fs.unlinkSync(bp)
      credLog(`deleteAllCredentials(${provider}): removed backup file`)
    }
  } catch (err) {
    credLog(`deleteAllCredentials(${provider}) backup error:`, err)
  }

  // Remove legacy plain file
  deletePlainFile(provider)

  // Remove vault entry
  try {
    const { vaultService } = await import('../vault/rpc')
    if (!vaultService.getStatus().isUnlocked) return
    const title =
      provider === 'gmail'
        ? GMAIL_VAULT_TITLE
        : provider === 'zoho'
          ? ZOHO_VAULT_TITLE
          : OUTLOOK_VAULT_TITLE
    const items = vaultService.search(title, 'automation_secret', DEFAULT_TIER)
    for (const item of items) {
      await vaultService.deleteItem(item.id, DEFAULT_TIER).catch(() => {})
    }
    credLog(`deleteAllCredentials(${provider}): removed vault entry`)
  } catch (err) {
    credLog(`deleteAllCredentials(${provider}) vault error:`, err)
  }
}
