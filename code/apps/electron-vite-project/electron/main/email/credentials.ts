/**
 * Email OAuth Credential Storage — vault vs plain file
 *
 * Honest source tracking: credentials can be in vault (encrypted) or
 * plain file (temporary). The UI must never claim "from vault" when
 * they are from file.
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { loadOAuthConfig, saveOAuthConfig } from './providers/gmail'
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

export type EmailCreds = GmailCreds | OutlookCreds

export interface CheckResult {
  source: CredentialSource
  credentials: GmailCreds | OutlookCreds | null
  clientId?: string
  hasSecret: boolean
}

const GMAIL_VAULT_TITLE = 'Gmail OAuth Client Credentials'
const OUTLOOK_VAULT_TITLE = 'Outlook OAuth Client Credentials'

function getGmailConfigPath(): string {
  return path.join(app.getPath('userData'), 'email-oauth-config.json')
}

function getOutlookConfigPath(): string {
  return path.join(app.getPath('userData'), 'outlook-oauth-config.json')
}

/** Load credentials from plain file only */
export function loadFromFile(provider: 'gmail' | 'outlook'): GmailCreds | OutlookCreds | null {
  if (provider === 'gmail') {
    const c = loadOAuthConfig()
    return c ? { clientId: c.clientId, clientSecret: c.clientSecret } : null
  }
  const c = loadOutlookOAuthConfig()
  return c ? { clientId: c.clientId, clientSecret: c.clientSecret, tenantId: c.tenantId } : null
}

const DEFAULT_TIER = 'free' as const // automation_secret is free-tier accessible

/** Load credentials from vault (requires vault unlocked) */
export async function loadFromVault(provider: 'gmail' | 'outlook'): Promise<GmailCreds | OutlookCreds | null> {
  try {
    const { vaultService } = await import('../vault/rpc')
    const status = vaultService.getStatus()
    if (!status.isUnlocked) return null

    const tier = DEFAULT_TIER
    const title = provider === 'gmail' ? GMAIL_VAULT_TITLE : OUTLOOK_VAULT_TITLE
    const items = vaultService.search(title, 'automation_secret', tier)
    if (items.length === 0) return null

    const item = await vaultService.getItem(items[0].id, tier)
    const fields = item.fields || []
    const getField = (key: string) => fields.find((f: any) => f.key === key)?.value ?? ''

    if (provider === 'gmail') {
      const clientId = getField('client_id')
      const clientSecret = getField('client_secret')
      if (!clientId || !clientSecret) return null
      return { clientId, clientSecret }
    }
    const clientId = getField('client_id')
    const clientSecret = getField('client_secret')
    const tenantId = getField('tenant_id') || 'organizations'
    if (!clientId) return null
    return { clientId, clientSecret: clientSecret || undefined, tenantId }
  } catch (err) {
    console.error('[Email Credentials] loadFromVault error:', err)
    return null
  }
}

/** Save credentials to vault */
export async function saveToVault(provider: 'gmail' | 'outlook', creds: GmailCreds | OutlookCreds): Promise<boolean> {
  try {
    const { vaultService } = await import('../vault/rpc')
    const status = vaultService.getStatus()
    if (!status.isUnlocked) return false

    const tier = DEFAULT_TIER
    const title = provider === 'gmail' ? GMAIL_VAULT_TITLE : OUTLOOK_VAULT_TITLE

    const gmailCreds = creds as GmailCreds
    const outlookCreds = creds as OutlookCreds

    const fields =
      provider === 'gmail'
        ? [
            { key: 'client_id', value: gmailCreds.clientId, encrypted: false, type: 'text' as const },
            { key: 'client_secret', value: gmailCreds.clientSecret, encrypted: true, type: 'password' as const },
          ]
        : [
            { key: 'client_id', value: outlookCreds.clientId, encrypted: false, type: 'text' as const },
            { key: 'client_secret', value: outlookCreds.clientSecret || '', encrypted: true, type: 'password' as const },
            { key: 'tenant_id', value: outlookCreds.tenantId || 'organizations', encrypted: false, type: 'text' as const },
          ]

    const items = vaultService.search(title, 'automation_secret', tier)
    if (items.length > 0) {
      await vaultService.updateItem(
        items[0].id,
        { title, fields },
        tier
      )
    } else {
      await vaultService.createItem(
        {
          category: 'automation_secret',
          title,
          fields,
          favorite: false,
        },
        tier
      )
    }
    return true
  } catch (err) {
    console.error('[Email Credentials] saveToVault error:', err)
    return false
  }
}

/** Delete plain file (after migration to vault) */
export function deletePlainFile(provider: 'gmail' | 'outlook'): void {
  try {
    const configPath = provider === 'gmail' ? getGmailConfigPath() : getOutlookConfigPath()
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath)
      console.log('[Email Credentials] Deleted plain file:', configPath)
    }
  } catch (err) {
    console.error('[Email Credentials] deletePlainFile error:', err)
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
export async function checkExistingCredentials(provider: 'gmail' | 'outlook'): Promise<CheckResult> {
  const vaultUnlocked = isVaultUnlocked()

  if (vaultUnlocked) {
    const vaultCreds = await loadFromVault(provider)
    if (vaultCreds) {
      const clientId = 'clientId' in vaultCreds ? vaultCreds.clientId : ''
      const hasSecret = !!(vaultCreds as any).clientSecret
      return { source: 'vault', credentials: vaultCreds, clientId, hasSecret }
    }
    const fileCreds = loadFromFile(provider)
    if (fileCreds) {
      await saveToVault(provider, fileCreds)
      deletePlainFile(provider)
      const clientId = 'clientId' in fileCreds ? fileCreds.clientId : ''
      const hasSecret = !!(fileCreds as any).clientSecret
      return { source: 'vault-migrated', credentials: fileCreds, clientId, hasSecret }
    }
    return { source: 'none', credentials: null, hasSecret: false }
  }

  const fileCreds = loadFromFile(provider)
  if (fileCreds) {
    const clientId = 'clientId' in fileCreds ? fileCreds.clientId : ''
    const hasSecret = !!(fileCreds as any).clientSecret
    return { source: 'temporary', credentials: fileCreds, clientId, hasSecret }
  }
  return { source: 'none', credentials: null, hasSecret: false }
}

/**
 * Get credentials for OAuth flow — vault first (if unlocked), then file.
 * Used by gmail.ts and outlook.ts for the actual connect flow.
 */
export async function getCredentialsForOAuth(
  provider: 'gmail' | 'outlook'
): Promise<GmailCreds | OutlookCreds | null> {
  if (isVaultUnlocked()) {
    const vaultCreds = await loadFromVault(provider)
    if (vaultCreds) return vaultCreds
  }
  return loadFromFile(provider)
}

/**
 * Save credentials — to vault if unlocked, else plain file.
 */
export async function saveCredentials(
  provider: 'gmail' | 'outlook',
  creds: GmailCreds | OutlookCreds
): Promise<{ ok: boolean; savedToVault: boolean }> {
  if (isVaultUnlocked()) {
    const ok = await saveToVault(provider, creds)
    if (ok) {
      deletePlainFile(provider)
      return { ok: true, savedToVault: true }
    }
  }
  if (provider === 'gmail') {
    saveOAuthConfig((creds as GmailCreds).clientId, (creds as GmailCreds).clientSecret)
  } else {
    saveOutlookOAuthConfig(
      (creds as OutlookCreds).clientId,
      (creds as OutlookCreds).clientSecret,
      (creds as OutlookCreds).tenantId
    )
  }
  return { ok: true, savedToVault: false }
}
