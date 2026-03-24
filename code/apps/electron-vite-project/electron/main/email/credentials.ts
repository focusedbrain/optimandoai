/**
 * Email OAuth Credential Storage — vault vs plain file
 *
 * Honest source tracking: credentials can be in vault (encrypted) or
 * plain file (temporary). The UI must never claim "from vault" when
 * they are from file.
 */

import { app } from 'electron'
import { appendFileSync } from 'fs'
import * as fs from 'fs'
import * as path from 'path'

// Temporary: log to C drive for easy finding during debug. Change back to userData after debugging.
const LOG_FILE = 'C:\\wrdesk-debug.log'

function debugLog(...args: unknown[]): void {
  const line = `[${new Date().toISOString()}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}\n`
  try {
    appendFileSync(LOG_FILE, line)
  } catch {
    /* ignore */
  }
  console.log('[Email Credentials]', ...args)
}
import { loadOAuthConfig, saveOAuthConfig } from './providers/gmail'
import { getBuiltinGmailOAuthClientId } from './googleOAuthBuiltin'
import { loadOutlookOAuthConfig, saveOutlookOAuthConfig } from './providers/outlook'

export type CredentialSource = 'vault' | 'vault-migrated' | 'temporary' | 'none'

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

function getGmailConfigPath(): string {
  return path.join(app.getPath('userData'), 'email-oauth-config.json')
}

function getOutlookConfigPath(): string {
  return path.join(app.getPath('userData'), 'outlook-oauth-config.json')
}

function getZohoConfigPath(): string {
  return path.join(app.getPath('userData'), 'zoho-oauth-config.json')
}

/** Plain-file Zoho OAuth client (no circular import with `providers/zoho.ts`). */
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
    debugLog('loadZohoOAuthConfig error:', err)
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
    debugLog('saveZohoOAuthConfig error:', err)
  }
}

/** Load credentials from plain file only */
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

/** Load credentials from vault (requires vault unlocked) */
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
    debugLog('loadFromVault error:', err)
    return null
  }
}

/** Save credentials to vault */
export async function saveToVault(
  provider: 'gmail' | 'outlook' | 'zoho',
  creds: GmailCreds | OutlookCreds | ZohoCreds,
): Promise<boolean> {
  debugLog('saveToVault called for:', provider)
  debugLog('userData path:', app.getPath('userData'))
  try {
    const { vaultService } = await import('../vault/rpc')
    const status = vaultService.getStatus()
    debugLog('vault status:', { isUnlocked: status.isUnlocked, currentVaultId: status.currentVaultId })

    if (!status.isUnlocked) {
      debugLog('vault is LOCKED — skipping vault save')
      return false
    }

    const tier = DEFAULT_TIER
    const gmailCreds = creds as GmailCreds
    const outlookCreds = creds as OutlookCreds
    const zohoCreds = creds as ZohoCreds

    // Use vault's expected field names (AUTOMATION_SECRET_STANDARD_FIELDS) for display in Secrets & API Keys,
    // plus internal fields (client_id, client_secret, tenant_id) for loadFromVault.
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
              {
                key: 'endpoint',
                value: `https://accounts.zoho.${zohoDc}`,
                encrypted: false,
                type: 'text' as const,
              },
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
    debugLog('calling vaultService', items.length > 0 ? 'updateItem' : 'createItem', 'with:', { category: 'automation_secret', title, fieldCount: fields.length })

    if (items.length > 0) {
      const result = await vaultService.updateItem(
        items[0].id,
        { title, fields },
        tier
      )
      debugLog('vault updateItem result:', result?.id)
    } else {
      const result = await vaultService.createItem(
        {
          category: 'automation_secret',
          title,
          fields,
          favorite: false,
        },
        tier
      )
      debugLog('vault createItem result:', result?.id)
    }
    return true
  } catch (err) {
    debugLog('saveToVault ERROR:', err)
    return false
  }
}

/** Delete plain file (after migration to vault) */
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
      debugLog('Deleted plain file:', configPath)
    }
  } catch (err) {
    debugLog('deletePlainFile error:', err)
  }
}

/** Check vault status */
export function isVaultUnlocked(): boolean {
  try {
    const { vaultService } = require('../vault/rpc')
    return vaultService.getStatus().isUnlocked === true
  } catch {
    return false
  }
}

/**
 * Check existing credentials with honest source.
 * Used by the wizard for display.
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
      const fileCreds = loadFromFile(provider)
      if (fileCreds) {
        await saveToVault(provider, fileCreds)
        deletePlainFile(provider)
        const clientId = 'clientId' in fileCreds ? fileCreds.clientId : ''
        const hasSecret = !!(fileCreds as any).clientSecret
        result = { source: 'vault-migrated', credentials: fileCreds, clientId, hasSecret }
      } else {
        result = { source: 'none', credentials: null, hasSecret: false }
      }
    }
  } else {
    const fileCreds = loadFromFile(provider)
    if (fileCreds) {
      const clientId = 'clientId' in fileCreds ? fileCreds.clientId : ''
      const hasSecret = !!(fileCreds as any).clientSecret
      result = { source: 'temporary', credentials: fileCreds, clientId, hasSecret }
    } else {
      result = { source: 'none', credentials: null, hasSecret: false }
    }
  }

  if (provider === 'gmail') {
    const builtin = getBuiltinGmailOAuthClientId()
    return { ...result, builtinOAuthAvailable: !!builtin }
  }
  return result
}

/**
 * Get credentials for OAuth flow — vault first (if unlocked), then file.
 * Used by gmail.ts and outlook.ts for the actual connect flow.
 */
export async function getCredentialsForOAuth(
  provider: 'gmail' | 'outlook' | 'zoho',
): Promise<GmailCreds | OutlookCreds | ZohoCreds | null> {
  if (isVaultUnlocked()) {
    const vaultCreds = await loadFromVault(provider)
    if (vaultCreds) return vaultCreds
  }
  return loadFromFile(provider)
}

/**
 * Save credentials — to vault if storeInVault and unlocked, else plain file.
 * @param storeInVault When true (default): try vault first, fall back to file if locked.
 *                     When false: save to plain file only.
 */
export async function saveCredentials(
  provider: 'gmail' | 'outlook' | 'zoho',
  creds: GmailCreds | OutlookCreds | ZohoCreds,
  storeInVault: boolean = true
): Promise<{ ok: boolean; savedToVault: boolean }> {
  const vaultUnlocked = isVaultUnlocked()
  if (storeInVault && vaultUnlocked) {
    const ok = await saveToVault(provider, creds)
    if (ok) {
      deletePlainFile(provider)
      const result = { ok: true, savedToVault: true }
      debugLog('saveCredentials result:', { ...result, storeInVault, vaultUnlocked })
      return result
    }
  }
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
      (creds as OutlookCreds).tenantId
    )
  }
  const result = { ok: true, savedToVault: false }
  debugLog('saveCredentials result:', { ...result, storeInVault, vaultUnlocked })
  return result
}
