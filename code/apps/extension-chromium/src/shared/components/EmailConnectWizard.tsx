/**
 * EmailConnectWizard — shared provider UI (Gmail, Microsoft 365, Custom IMAP+SMTP).
 * Do not mount this directly from product surfaces — use `useConnectEmailFlow` so open/close,
 * `launchSource`, and account refresh stay consistent (Inbox, Bulk Inbox, WR Chat docked/popup, legacy BEAP dashboards).
 *
 * Platform-aware: Electron (`window.emailAccounts`) and extension (`chrome.runtime.sendMessage`).
 */

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ConnectEmailLaunchSource, formatConnectEmailLaunchSource } from '../email/connectEmailTypes'
import { ImapConnectionNotice } from '../email/ImapConnectionNotice'

const OAUTH_CALLBACK_PORT = 51249
const CREDENTIALS_NEEDED_GMAIL = 'credentials not configured'
const CREDENTIALS_NEEDED_OUTLOOK = 'oauth client credentials not configured'
const CREDENTIALS_NEEDED_ZOHO = 'zoho oauth client credentials not configured'

export interface EmailConnectWizardProps {
  isOpen: boolean
  onClose: () => void
  onConnected: (account: { provider: string; email: string }) => void
  theme?: 'professional' | 'default'
  /** Optional UI shell context (which surface opened the wizard). */
  launchSource?: ConnectEmailLaunchSource
  /** When set (Electron), skip provider picker and open Custom IMAP pre-filled for password update. */
  reconnectAccountId?: string | null
}

type Step = 'provider' | 'credentials' | 'connecting' | 'result'
type Provider = 'gmail' | 'outlook' | 'zoho' | 'custom'
type ResultType = 'success' | 'failure'
type SecurityModeUi = 'ssl' | 'starttls' | 'none'

/** Align reconnect hints / legacy values with `<select>` option values (`ssl` | `starttls` | `none`). */
function coerceSecurityModeUi(v: unknown, fallback: SecurityModeUi): SecurityModeUi {
  const k = typeof v === 'string' ? v.toLowerCase().trim().replace(/\s+/g, '') : ''
  if (k === 'ssl' || k === 'tls' || k === 'ssl/tls' || k === 'imaps') return 'ssl'
  if (k === 'starttls') return 'starttls'
  if (k === 'none' || k === 'plain') return 'none'
  return fallback
}

/** Single `Window.emailAccounts` merge — see `electron-vite-project/src/components/handshakeViewTypes.ts`. */
/// <reference path="../../../../electron-vite-project/src/components/handshakeViewTypes.ts" />

const isElectron = (): boolean =>
  typeof window !== 'undefined' && typeof (window as any).emailAccounts?.connectGmail === 'function'

/** True when preload exposes the packaged Gmail OAuth runtime diagnostics IPC (proves this build includes that code path). */
const gmailOAuthDiagnosticsBridgeAvailable = (): boolean =>
  typeof window !== 'undefined' &&
  typeof (window as any).emailAccounts?.getGmailOAuthRuntimeDiagnostics === 'function'

function formatGmailOAuthDiagnosticRows(data: unknown): { key: string; value: string }[] {
  if (!data || typeof data !== 'object') {
    return [{ key: 'error', value: 'No data returned from main process.' }]
  }
  const d = data as Record<string, unknown>
  const flow = d.lastStandardConnectFlow as Record<string, unknown> | null | undefined
  const str = (v: unknown) => (v === null || v === undefined ? '—' : String(v))
  const boolStr = (v: unknown) => (v === true ? 'true' : v === false ? 'false' : '—')
  return [
    {
      key: 'authorizeClientIdFingerprint',
      value: str(d.authorizeClientIdFingerprint ?? flow?.authorizeClientIdFingerprint),
    },
    {
      key: 'tokenExchangeClientIdFingerprint',
      value: str(d.tokenExchangeClientIdFingerprint ?? flow?.tokenExchangeClientIdFingerprint),
    },
    {
      key: 'bundledExpectedFingerprint',
      value: str(d.expectedBundledClientFingerprint ?? flow?.bundledExpectedFingerprint),
    },
    { key: 'builtinSourceKind', value: str(d.builtinSourceKind ?? flow?.builtinSourceKind) },
    { key: 'authMode', value: str(d.authMode ?? flow?.authMode) },
    { key: 'hasClientSecret', value: boolStr(flow?.hasClientSecret) },
    { key: 'tokenExchangeShape', value: str(flow?.tokenExchangeShape) },
    { key: 'googleErrorDescription', value: str(flow?.googleErrorDescription) },
  ]
}

function emptyCustomForm() {
  return {
    email: '',
    displayName: '',
    imapHost: '',
    imapPort: '993',
    imapSecurity: 'ssl' as SecurityModeUi,
    imapUsername: '',
    imapPassword: '',
    smtpHost: '',
    smtpPort: '587',
    smtpSecurity: 'starttls' as SecurityModeUi,
    smtpUseSameCredentials: true,
    smtpUsername: '',
    smtpPassword: '',
  }
}

const isExtension = (): boolean =>
  typeof chrome !== 'undefined' && !!chrome?.runtime?.sendMessage

export function EmailConnectWizard({
  isOpen,
  onClose,
  onConnected,
  theme = 'default',
  launchSource,
  reconnectAccountId = null,
}: EmailConnectWizardProps) {
  const [step, setStep] = useState<Step>('provider')
  const [provider, setProvider] = useState<Provider | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [result, setResult] = useState<ResultType | null>(null)
  const [resultEmail, setResultEmail] = useState<string>('')
  const [resultError, setResultError] = useState<string>('')
  const [connectingElapsed, setConnectingElapsed] = useState(0)
  const [connectingTimedOut, setConnectingTimedOut] = useState(false)

  const [gmailCreds, setGmailCreds] = useState({ clientId: '', clientSecret: '' })
  const [outlookCreds, setOutlookCreds] = useState({ clientId: '', clientSecret: '', tenantId: 'organizations' })
  const [zohoCreds, setZohoCreds] = useState<{ clientId: string; clientSecret: string; datacenter: 'com' | 'eu' }>({
    clientId: '',
    clientSecret: '',
    datacenter: 'com',
  })
  const [existingGmail, setExistingGmail] = useState<{ clientId: string; clientSecret?: string; hasSecret: boolean; source: 'vault' | 'vault-migrated' | 'temporary' } | null>(null)
  const [existingOutlook, setExistingOutlook] = useState<{ clientId: string; clientSecret?: string; tenantId?: string; hasSecret: boolean; source: 'vault' | 'vault-migrated' | 'temporary' } | null>(null)
  const [existingZoho, setExistingZoho] = useState<{ clientId: string; clientSecret?: string; datacenter?: 'com' | 'eu'; hasSecret: boolean; source: 'vault' | 'vault-migrated' | 'temporary' } | null>(null)
  const [credError, setCredError] = useState<string | null>(null)
  const [showSecret, setShowSecret] = useState(false)
  const [vaultUnlocked, setVaultUnlocked] = useState<boolean | undefined>(undefined)
  const [storeInVault, setStoreInVault] = useState(true)
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null)
  /** Gmail: show legacy Google Cloud client id/secret UI (self-hosted / developer). */
  const [showGmailAdvanced, setShowGmailAdvanced] = useState(false)
  /** Gmail OAuth readiness from main process (builtin app id and/or saved developer creds). */
  const [gmailOAuthMeta, setGmailOAuthMeta] = useState<{
    configured: boolean
    builtinOAuthAvailable: boolean
    /** Electron / native: show Advanced OAuth UI (env or unpackaged dev). */
    developerModeEnabled?: boolean
    /** Fingerprint for standard Connect built-in client (from main checkGmailCredentials). */
    standardConnectBundledClientFingerprint?: string | null
  } | null>(null)
  const [customForm, setCustomForm] = useState(emptyCustomForm)
  /** Electron reconnect: main process reports whether a password is already saved (value never sent here). */
  const [reconnectHasStoredImapPassword, setReconnectHasStoredImapPassword] = useState(false)
  /** Initial inbox sync window for the account being connected (7 / 30 / 90 / 0 = all). */
  const [connectSyncWindowDays, setConnectSyncWindowDays] = useState(30)
  /**
   * Standard “Connect Google” must use built-in Desktop OAuth (PKCE). Advanced uses saved developer creds.
   * Set synchronously before `setStep('connecting')` so the connect effect reads the right source.
   */
  const gmailOAuthCredentialSourceRef = useRef<'builtin_public' | 'developer_saved'>('builtin_public')
  /** Electron: structured Gmail OAuth runtime proof rows (from main via IPC). */
  const [gmailOAuthDiagModalOpen, setGmailOAuthDiagModalOpen] = useState(false)
  const [gmailOAuthDiagRows, setGmailOAuthDiagRows] = useState<{ key: string; value: string }[] | null>(null)
  const [gmailOAuthDiagError, setGmailOAuthDiagError] = useState<string | null>(null)
  const [gmailOAuthDiagLoading, setGmailOAuthDiagLoading] = useState(false)

  const isPro = theme === 'professional'
  const textColor = isPro ? '#0f172a' : 'white'
  const mutedColor = isPro ? '#64748b' : 'rgba(255,255,255,0.7)'
  const borderColor = isPro ? '#e2e8f0' : 'rgba(255,255,255,0.15)'
  const inputBg = isPro ? '#fff' : 'rgba(255,255,255,0.08)'

  const reset = useCallback(() => {
    setStep('provider')
    setProvider(null)
    setConnecting(false)
    setResult(null)
    setResultEmail('')
    setResultError('')
    setConnectingElapsed(0)
    setConnectingTimedOut(false)
    setCredError(null)
    setGmailCreds({ clientId: '', clientSecret: '' })
    setOutlookCreds({ clientId: '', clientSecret: '', tenantId: 'organizations' })
    setZohoCreds({ clientId: '', clientSecret: '', datacenter: 'com' })
    setExistingGmail(null)
    setExistingOutlook(null)
    setExistingZoho(null)
    setVaultUnlocked(undefined)
    setStoreInVault(true)
    setSaveFeedback(null)
    setShowGmailAdvanced(false)
    setGmailOAuthMeta(null)
    setCustomForm(emptyCustomForm())
    setReconnectHasStoredImapPassword(false)
    setConnectSyncWindowDays(30)
    setGmailOAuthDiagModalOpen(false)
    setGmailOAuthDiagRows(null)
    setGmailOAuthDiagError(null)
    setGmailOAuthDiagLoading(false)
  }, [])

  useEffect(() => {
    if (!isOpen) reset()
  }, [isOpen, reset])

  const showGmailOAuthRuntimeDiagnostics = useCallback(async () => {
    if (!isElectron() || !gmailOAuthDiagnosticsBridgeAvailable()) return
    setGmailOAuthDiagModalOpen(true)
    setGmailOAuthDiagError(null)
    setGmailOAuthDiagRows(null)
    setGmailOAuthDiagLoading(true)
    try {
      const raw = await window.emailAccounts!.getGmailOAuthRuntimeDiagnostics!()
      if (!raw) {
        setGmailOAuthDiagError('IPC returned no response (getGmailOAuthRuntimeDiagnostics).')
        setGmailOAuthDiagRows(formatGmailOAuthDiagnosticRows(null))
        return
      }
      if (!raw.ok) {
        setGmailOAuthDiagError(raw.error ?? 'Unknown error from main process.')
        setGmailOAuthDiagRows(formatGmailOAuthDiagnosticRows(raw.data ?? null))
        return
      }
      setGmailOAuthDiagError(null)
      setGmailOAuthDiagRows(formatGmailOAuthDiagnosticRows(raw.data ?? null))
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setGmailOAuthDiagError(msg)
      setGmailOAuthDiagRows(formatGmailOAuthDiagnosticRows(null))
    } finally {
      setGmailOAuthDiagLoading(false)
    }
  }, [])

  /** Pre-fill Custom IMAP form when updating credentials for an existing account (Electron). */
  useEffect(() => {
    if (!isOpen || !reconnectAccountId || !isElectron()) return
    let cancelled = false
    const run = async () => {
      try {
        const r = await window.emailAccounts?.getImapReconnectHints?.(reconnectAccountId)
        if (cancelled || !r?.ok || !r.data) return
        const h = r.data as Record<string, unknown>
        setProvider('custom')
        setStep('credentials')
        setCredError(null)
        setReconnectHasStoredImapPassword(h.hasImapPassword === true)
        const sw = h.syncWindowDays
        if (typeof sw === 'number' && Number.isInteger(sw) && sw >= 0) {
          setConnectSyncWindowDays(sw)
        }
        setCustomForm({
          email: String(h.email ?? ''),
          displayName: String(h.displayName ?? h.email ?? ''),
          imapHost: String(h.imapHost ?? ''),
          imapPort: String(h.imapPort ?? '993'),
          imapSecurity: coerceSecurityModeUi(h.imapSecurity, 'ssl'),
          imapUsername: String(h.imapUsername ?? ''),
          imapPassword: '',
          smtpHost: String(h.smtpHost ?? ''),
          smtpPort: String(h.smtpPort ?? '587'),
          smtpSecurity: coerceSecurityModeUi(h.smtpSecurity, 'starttls'),
          smtpUseSameCredentials: h.smtpUseSameCredentials !== false,
          smtpUsername: String(h.smtpUsername ?? ''),
          smtpPassword: '',
        })
      } catch (e) {
        console.warn('[EmailConnectWizard] reconnect hints failed:', e)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [isOpen, reconnectAccountId])

  // Fetch vault status when on credentials step (platform-aware)
  useEffect(() => {
    if (!isOpen || step !== 'credentials') return
    let cancelled = false
    const fetchVaultStatus = async () => {
      try {
        if (isElectron()) {
          const status = (window as any).handshakeView?.getVaultStatus
            ? await (window as any).handshakeView.getVaultStatus()
            : (window as any).emailAccounts?.checkVaultStatus
              ? await (window as any).emailAccounts.checkVaultStatus()
              : undefined
          console.log('[EmailConnectWizard] vault status (Electron):', status)
          if (!cancelled) setVaultUnlocked(status?.isUnlocked ?? false)
        } else if (isExtension()) {
          const { getVaultStatus } = await import('../../vault/api')
          const status = await getVaultStatus()
          console.log('[EmailConnectWizard] vault status (extension):', status)
          if (!cancelled) setVaultUnlocked(status?.isUnlocked === true || (status && status.locked === false))
        } else {
          if (!cancelled) setVaultUnlocked(undefined)
        }
      } catch (err) {
        console.warn('[EmailConnectWizard] vault status fetch failed:', err)
        if (!cancelled) setVaultUnlocked(undefined)
      }
    }
    fetchVaultStatus()
    return () => { cancelled = true }
  }, [isOpen, step])

  // Platform API helpers — returns honest source (vault / vault-migrated / temporary / none)
  const checkGmailCreds = useCallback(async (): Promise<{
    configured: boolean
    developerCredentialsStored?: boolean
    builtinOAuthAvailable?: boolean
    developerModeEnabled?: boolean
    clientId?: string
    clientSecret?: string
    source?: 'vault' | 'vault-migrated' | 'temporary' | 'none'
    hasSecret?: boolean
    standardConnectBundledClientFingerprint?: string | null
  }> => {
    if (isElectron()) {
      const res = await (window as any).emailAccounts?.checkGmailCredentials?.()
      if (!res?.ok) return { configured: false }
      const d = res.data
      return {
        configured: !!d?.configured,
        developerCredentialsStored: !!d?.developerCredentialsStored,
        builtinOAuthAvailable: !!d?.builtinOAuthAvailable,
        developerModeEnabled: d?.developerModeEnabled === true,
        clientId: d?.clientId,
        clientSecret: (d?.credentials as any)?.clientSecret,
        source: d?.source || (d?.configured ? 'temporary' : 'none'),
        hasSecret: d?.hasSecret ?? false,
        standardConnectBundledClientFingerprint: d?.standardConnectBundledClientFingerprint ?? null,
      }
    }
    if (isExtension()) {
      const res = await chrome.runtime.sendMessage({ type: 'EMAIL_CHECK_GMAIL_CREDENTIALS' })
      if (!res?.ok) return { configured: false }
      const d = res.data
      return {
        configured: !!d?.configured,
        developerCredentialsStored: !!d?.developerCredentialsStored,
        builtinOAuthAvailable: !!d?.builtinOAuthAvailable,
        developerModeEnabled: d?.developerModeEnabled === true,
        clientId: d?.clientId,
        clientSecret: (d?.credentials as any)?.clientSecret,
        source: d?.source || (d?.configured ? 'temporary' : 'none'),
        hasSecret: d?.hasSecret ?? false,
        standardConnectBundledClientFingerprint: d?.standardConnectBundledClientFingerprint ?? null,
      }
    }
    return { configured: false }
  }, [])

  const checkOutlookCreds = useCallback(async (): Promise<{
    configured: boolean
    clientId?: string
    clientSecret?: string
    tenantId?: string
    source?: 'vault' | 'vault-migrated' | 'temporary' | 'none'
    hasSecret?: boolean
  }> => {
    if (isElectron()) {
      const res = await (window as any).emailAccounts?.checkOutlookCredentials?.()
      if (!res?.ok) return { configured: false }
      const d = res.data
      return {
        configured: !!d?.configured,
        clientId: d?.clientId,
        clientSecret: (d?.credentials as any)?.clientSecret,
        tenantId: (d?.credentials as any)?.tenantId,
        source: d?.source || (d?.configured ? 'temporary' : 'none'),
        hasSecret: d?.hasSecret ?? false,
      }
    }
    if (isExtension()) {
      const res = await chrome.runtime.sendMessage({ type: 'EMAIL_CHECK_OUTLOOK_CREDENTIALS' })
      if (!res?.ok) return { configured: false }
      const d = res.data
      return {
        configured: !!d?.configured,
        clientId: d?.clientId,
        clientSecret: (d?.credentials as any)?.clientSecret,
        tenantId: (d?.credentials as any)?.tenantId,
        source: d?.source || (d?.configured ? 'temporary' : 'none'),
        hasSecret: d?.hasSecret ?? false,
      }
    }
    return { configured: false }
  }, [])

  const checkZohoCreds = useCallback(async (): Promise<{
    configured: boolean
    clientId?: string
    clientSecret?: string
    datacenter?: 'com' | 'eu'
    source?: 'vault' | 'vault-migrated' | 'temporary' | 'none'
    hasSecret?: boolean
  }> => {
    if (isElectron()) {
      const res = await (window as any).emailAccounts?.checkZohoCredentials?.()
      if (!res?.ok) return { configured: false }
      const d = res.data
      return {
        configured: !!d?.configured,
        clientId: d?.clientId,
        clientSecret: (d?.credentials as any)?.clientSecret,
        datacenter: (d?.credentials as any)?.datacenter === 'eu' ? 'eu' : 'com',
        source: d?.source || (d?.configured ? 'temporary' : 'none'),
        hasSecret: d?.hasSecret ?? false,
      }
    }
    if (isExtension()) {
      const res = await chrome.runtime.sendMessage({ type: 'EMAIL_CHECK_ZOHO_CREDENTIALS' })
      if (!res?.ok) return { configured: false }
      const d = res.data
      return {
        configured: !!d?.configured,
        clientId: d?.clientId,
        clientSecret: (d?.credentials as any)?.clientSecret,
        datacenter: (d?.credentials as any)?.datacenter === 'eu' ? 'eu' : 'com',
        source: d?.source || (d?.configured ? 'temporary' : 'none'),
        hasSecret: d?.hasSecret ?? false,
      }
    }
    return { configured: false }
  }, [])

  const saveGmailCreds = useCallback(async (clientId: string, clientSecret?: string, storeInVaultOpt?: boolean): Promise<{ ok: boolean; savedToVault?: boolean }> => {
    if (isElectron()) {
      const res = await (window as any).emailAccounts?.setGmailCredentials?.(clientId, clientSecret, storeInVaultOpt ?? true)
      return { ok: !!res?.ok, savedToVault: res?.savedToVault }
    }
    if (isExtension()) {
      const res = await chrome.runtime.sendMessage({ type: 'EMAIL_SAVE_GMAIL_CREDENTIALS', clientId, clientSecret, storeInVault: storeInVaultOpt ?? true })
      return { ok: !!res?.ok, savedToVault: res?.savedToVault }
    }
    return { ok: false }
  }, [])

  const saveOutlookCreds = useCallback(
    async (clientId: string, clientSecret?: string, tenantId?: string, storeInVaultOpt?: boolean): Promise<{ ok: boolean; savedToVault?: boolean }> => {
      if (isElectron()) {
        const res = await (window as any).emailAccounts?.setOutlookCredentials?.(clientId, clientSecret, tenantId, storeInVaultOpt ?? true)
        return { ok: !!res?.ok, savedToVault: res?.savedToVault }
      }
      if (isExtension()) {
        const res = await chrome.runtime.sendMessage({
          type: 'EMAIL_SAVE_OUTLOOK_CREDENTIALS',
          clientId,
          clientSecret,
          tenantId,
          storeInVault: storeInVaultOpt ?? true,
        })
        return { ok: !!res?.ok, savedToVault: res?.savedToVault }
      }
      return { ok: false }
    },
    [],
  )

  const saveZohoCreds = useCallback(
    async (
      clientId: string,
      clientSecret: string,
      datacenter: 'com' | 'eu',
      storeInVaultOpt?: boolean,
    ): Promise<{ ok: boolean; savedToVault?: boolean }> => {
      if (isElectron()) {
        const res = await (window as any).emailAccounts?.setZohoCredentials?.(
          clientId,
          clientSecret,
          datacenter,
          storeInVaultOpt ?? true,
        )
        return { ok: !!res?.ok, savedToVault: res?.savedToVault }
      }
      if (isExtension()) {
        const res = await chrome.runtime.sendMessage({
          type: 'EMAIL_SAVE_ZOHO_CREDENTIALS',
          clientId,
          clientSecret,
          datacenter,
          storeInVault: storeInVaultOpt ?? true,
        })
        return { ok: !!res?.ok, savedToVault: res?.savedToVault }
      }
      return { ok: false }
    },
    [],
  )

  const connectGmail = useCallback(
    async (
      syncWindowDays?: number,
      gmailOAuthCredentialSource: 'builtin_public' | 'developer_saved' = 'builtin_public',
    ): Promise<{ ok: boolean; email?: string; error?: string }> => {
      const days = typeof syncWindowDays === 'number' ? syncWindowDays : 30
      if (isElectron()) {
        const res = await (window as any).emailAccounts?.connectGmail?.(
          'Gmail Account',
          days,
          gmailOAuthCredentialSource,
        )
        return { ok: !!res?.ok, email: res?.data?.email, error: res?.error }
      }
      if (isExtension()) {
        const res = await chrome.runtime.sendMessage({
          type: 'EMAIL_CONNECT_GMAIL',
          displayName: 'Gmail Account',
          syncWindowDays: days,
          gmailOAuthCredentialSource,
        })
        return { ok: !!res?.ok, email: res?.data?.email, error: res?.error }
      }
      return { ok: false, error: 'Email connection requires the desktop app or extension.' }
    },
    [],
  )

  const connectOutlook = useCallback(async (syncWindowDays?: number): Promise<{ ok: boolean; email?: string; error?: string }> => {
    const days = typeof syncWindowDays === 'number' ? syncWindowDays : 30
    if (isElectron()) {
      const res = await (window as any).emailAccounts?.connectOutlook?.('Outlook Account', days)
      return { ok: !!res?.ok, email: res?.data?.email, error: res?.error }
    }
    if (isExtension()) {
      const res = await chrome.runtime.sendMessage({
        type: 'EMAIL_CONNECT_OUTLOOK',
        displayName: 'Outlook Account',
        syncWindowDays: days,
      })
      return { ok: !!res?.ok, email: res?.data?.email, error: res?.error }
    }
    return { ok: false, error: 'Email connection requires the desktop app or extension.' }
  }, [])

  const connectZoho = useCallback(async (syncWindowDays?: number): Promise<{ ok: boolean; email?: string; error?: string }> => {
    const days = typeof syncWindowDays === 'number' ? syncWindowDays : 30
    if (isElectron()) {
      const res = await (window as any).emailAccounts?.connectZoho?.('Zoho Mail', days)
      return { ok: !!res?.ok, email: res?.data?.email, error: res?.error }
    }
    if (isExtension()) {
      const res = await chrome.runtime.sendMessage({
        type: 'EMAIL_CONNECT_ZOHO',
        displayName: 'Zoho Mail',
        syncWindowDays: days,
      })
      const inner = res?.data ?? res
      return {
        ok: !!(inner?.ok ?? res?.ok),
        email: inner?.data?.email ?? inner?.email ?? res?.data?.email,
        error: inner?.error ?? res?.error,
      }
    }
    return { ok: false, error: 'Email connection requires the desktop app or extension.' }
  }, [])

  const connectCustomMailbox = useCallback(
    async (payload: Record<string, unknown>): Promise<{ ok: boolean; email?: string; error?: string }> => {
      if (isElectron()) {
        const res = await (window as any).emailAccounts?.connectCustomMailbox?.(payload)
        return { ok: !!res?.ok, email: res?.data?.email, error: res?.error }
      }
      if (isExtension()) {
        const res = await chrome.runtime.sendMessage({ type: 'EMAIL_CONNECT_CUSTOM_MAILBOX', ...payload })
        return { ok: !!res?.ok, email: res?.data?.email, error: res?.error }
      }
      return { ok: false, error: 'Email connection requires the desktop app or extension.' }
    },
    [],
  )

  const handleSelectProvider = useCallback(
    async (p: Provider) => {
      setProvider(p)
      setCredError(null)
      setStep('credentials')
      if (p === 'custom') {
        setCustomForm(emptyCustomForm())
        return
      }
      if (p === 'gmail') {
        try {
          const check = await checkGmailCreds()
          setGmailOAuthMeta({
            configured: !!check.configured,
            builtinOAuthAvailable: !!check.builtinOAuthAvailable,
            developerModeEnabled: check.developerModeEnabled === true,
            standardConnectBundledClientFingerprint: check.standardConnectBundledClientFingerprint ?? null,
          })
          setShowGmailAdvanced(false)
          const src = check.source as 'vault' | 'vault-migrated' | 'temporary' | undefined
          if (check.developerCredentialsStored && check.clientId && src) {
            setExistingGmail({
              clientId: check.clientId || '',
              clientSecret: check.clientSecret,
              hasSecret: check.hasSecret ?? true,
              source: src,
            })
            setGmailCreds({
              clientId: check.clientId || '',
              clientSecret: check.clientSecret || '',
            })
          } else {
            setExistingGmail(null)
            setGmailCreds({ clientId: '', clientSecret: '' })
          }
        } catch {
          setExistingGmail(null)
          setGmailOAuthMeta(null)
        }
      } else if (p === 'zoho') {
        try {
          const check = await checkZohoCreds()
          const src = check.source as 'vault' | 'vault-migrated' | 'temporary' | undefined
          if (check.configured && src) {
            setExistingZoho({
              clientId: check.clientId || '',
              clientSecret: check.clientSecret,
              datacenter: check.datacenter,
              hasSecret: check.hasSecret ?? true,
              source: src,
            })
            setZohoCreds({
              clientId: check.clientId || '',
              clientSecret: check.clientSecret || '',
              datacenter: check.datacenter || 'com',
            })
          } else {
            setExistingZoho(null)
            setZohoCreds({ clientId: '', clientSecret: '', datacenter: 'com' })
          }
        } catch {
          setExistingZoho(null)
        }
      } else {
        try {
          const check = await checkOutlookCreds()
          const src = check.source as 'vault' | 'vault-migrated' | 'temporary' | undefined
          if (check.configured && src) {
            setExistingOutlook({
              clientId: check.clientId || '',
              clientSecret: check.clientSecret,
              tenantId: check.tenantId,
              hasSecret: check.hasSecret ?? true,
              source: src,
            })
            setOutlookCreds({
              clientId: check.clientId || '',
              clientSecret: check.clientSecret || '',
              tenantId: check.tenantId || 'organizations',
            })
          } else {
            setExistingOutlook(null)
            setOutlookCreds({ clientId: '', clientSecret: '', tenantId: 'organizations' })
          }
        } catch {
          setExistingOutlook(null)
        }
      }
    },
    [checkGmailCreds, checkOutlookCreds, checkZohoCreds],
  )

  const handleSaveAndConnect = useCallback(async () => {
    if (!provider) return
    setCredError(null)
    setSaveFeedback(null)
    if (provider === 'custom') {
      const cf = customForm
      const email = cf.email.trim()
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        setCredError('Enter a valid email address.')
        return
      }
      if (!cf.imapHost.trim()) {
        setCredError('IMAP server host is required.')
        return
      }
      const imapPort = parseInt(cf.imapPort, 10)
      if (!Number.isInteger(imapPort) || imapPort < 1 || imapPort > 65535) {
        setCredError('IMAP port must be a number from 1 to 65535 (common: 993 for SSL).')
        return
      }
      if (!cf.smtpHost.trim()) {
        setCredError('SMTP server host is required for sending mail.')
        return
      }
      const smtpPort = parseInt(cf.smtpPort, 10)
      if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) {
        setCredError('SMTP port must be a number from 1 to 65535 (common: 587 STARTTLS or 465 SSL).')
        return
      }
      if (!cf.imapPassword.trim()) {
        setCredError('IMAP password or app password is required.')
        return
      }
      if (!cf.smtpUseSameCredentials) {
        if (!cf.smtpUsername.trim()) {
          setCredError('SMTP username is required when it is not the same as IMAP.')
          return
        }
        if (!cf.smtpPassword.trim()) {
          setCredError('SMTP password is required when it is not the same as IMAP.')
          return
        }
      }
      if (connectSyncWindowDays === 0) {
        const ok = window.confirm('Syncing all messages may take a long time. Continue?')
        if (!ok) return
      }
      setStep('connecting')
      setConnecting(true)
      setConnectingElapsed(0)
      setConnectingTimedOut(false)
      return
    }
    if (provider === 'gmail') {
      if (!showGmailAdvanced) {
        if (!gmailOAuthMeta?.configured) {
          setCredError(
            gmailOAuthMeta?.developerModeEnabled
              ? 'Google sign-in is not configured for this build. Add the app OAuth client id to the build, or use Advanced to supply your own OAuth client.'
              : 'Google sign-in is not available in this version of the app. Please update the app or contact support.',
          )
          return
        }
        if (connectSyncWindowDays === 0) {
          const ok = window.confirm('Syncing all messages may take a long time. Continue?')
          if (!ok) return
        }
        gmailOAuthCredentialSourceRef.current = 'builtin_public'
        setStep('connecting')
        setConnecting(true)
        setConnectingElapsed(0)
        setConnectingTimedOut(false)
        return
      }
      gmailOAuthCredentialSourceRef.current = 'developer_saved'
      const c = gmailCreds
      const gmailClientId = c.clientId?.trim()
      if (!gmailClientId) {
        setCredError('Client ID is required')
        return
      }
      const res = await saveGmailCreds(gmailClientId, c.clientSecret?.trim() || undefined, storeInVault)
      if (!res.ok) {
        setCredError('Failed to save credentials')
        return
      }
      setSaveFeedback(
        res.savedToVault
          ? '🔐 Credentials stored in vault'
          : storeInVault
            ? '⚠️ Vault save failed — credentials stored temporarily in file'
            : '💾 Credentials saved to file',
      )
      setTimeout(() => setSaveFeedback(null), 4000)
    } else if (provider === 'zoho') {
      const c = zohoCreds
      if (!c.clientId?.trim() || !c.clientSecret?.trim()) {
        setCredError('Please enter Zoho Client ID and Client Secret')
        return
      }
      const res = await saveZohoCreds(c.clientId.trim(), c.clientSecret.trim(), c.datacenter, storeInVault)
      if (!res.ok) {
        setCredError('Failed to save credentials')
        return
      }
      setSaveFeedback(
        res.savedToVault
          ? '🔐 Credentials stored in vault'
          : storeInVault
            ? '⚠️ Vault save failed — credentials stored temporarily in file'
            : '💾 Credentials saved to file'
      )
      setTimeout(() => setSaveFeedback(null), 4000)
    } else {
      const c = outlookCreds
      if (!c.clientId?.trim()) {
        setCredError('Please enter the Application (Client) ID')
        return
      }
      const res = await saveOutlookCreds(c.clientId.trim(), c.clientSecret?.trim() || undefined, c.tenantId?.trim() || undefined, storeInVault)
      if (!res.ok) {
        setCredError('Failed to save credentials')
        return
      }
      setSaveFeedback(
        res.savedToVault
          ? '🔐 Credentials stored in vault'
          : storeInVault
            ? '⚠️ Vault save failed — credentials stored temporarily in file'
            : '💾 Credentials saved to file'
      )
      setTimeout(() => setSaveFeedback(null), 4000)
    }
    if (connectSyncWindowDays === 0) {
      const ok = window.confirm('Syncing all messages may take a long time. Continue?')
      if (!ok) return
    }
    setStep('connecting')
    setConnecting(true)
    setConnectingElapsed(0)
    setConnectingTimedOut(false)
  }, [
    provider,
    gmailCreds,
    showGmailAdvanced,
    gmailOAuthMeta,
    outlookCreds,
    zohoCreds,
    storeInVault,
    saveGmailCreds,
    saveOutlookCreds,
    saveZohoCreds,
    customForm,
    connectSyncWindowDays,
  ])

  const handleConnectWithExisting = useCallback(() => {
    gmailOAuthCredentialSourceRef.current = 'developer_saved'
    setCredError(null)
    if (connectSyncWindowDays === 0) {
      const ok = window.confirm('Syncing all messages may take a long time. Continue?')
      if (!ok) return
    }
    setStep('connecting')
    setConnecting(true)
    setConnectingElapsed(0)
    setConnectingTimedOut(false)
  }, [connectSyncWindowDays])

  useEffect(() => {
    if (step !== 'connecting' || !connecting) return
    const connect = async () => {
      try {
        let res: { ok: boolean; email?: string; error?: string }
        if (provider === 'gmail') {
          res = await connectGmail(connectSyncWindowDays, gmailOAuthCredentialSourceRef.current)
        } else if (provider === 'outlook') {
          res = await connectOutlook(connectSyncWindowDays)
        } else if (provider === 'zoho') {
          res = await connectZoho(connectSyncWindowDays)
        } else {
          const cf = customForm
          if (reconnectAccountId && isElectron() && window.emailAccounts?.updateImapCredentials) {
            const raw = await window.emailAccounts.updateImapCredentials(reconnectAccountId, {
              imapPassword: cf.imapPassword,
              smtpPassword: cf.smtpUseSameCredentials ? undefined : cf.smtpPassword,
              smtpUseSameCredentials: cf.smtpUseSameCredentials,
            })
            const inner = raw?.data as { success?: boolean; error?: string } | undefined
            const ok = !!(raw?.ok && inner?.success)
            res = {
              ok,
              email: cf.email.trim(),
              error: ok ? undefined : inner?.error || (raw as { error?: string })?.error || 'Could not update credentials',
            }
          } else {
            const imapPort = parseInt(cf.imapPort, 10)
            const smtpPort = parseInt(cf.smtpPort, 10)
            res = await connectCustomMailbox({
              displayName: cf.displayName.trim() || undefined,
              email: cf.email.trim(),
              imapHost: cf.imapHost.trim(),
              imapPort,
              imapSecurity: cf.imapSecurity,
              imapUsername: cf.imapUsername.trim() || undefined,
              imapPassword: cf.imapPassword,
              smtpHost: cf.smtpHost.trim(),
              smtpPort,
              smtpSecurity: cf.smtpSecurity,
              smtpUseSameCredentials: cf.smtpUseSameCredentials,
              smtpUsername: cf.smtpUseSameCredentials ? undefined : cf.smtpUsername.trim() || undefined,
              smtpPassword: cf.smtpUseSameCredentials ? undefined : cf.smtpPassword,
              syncWindowDays: connectSyncWindowDays,
            })
          }
        }
        setConnecting(false)
        setStep('result')
        if (res.ok) {
          setResult('success')
          const em = res.email || (provider === 'custom' ? customForm.email.trim() : '')
          setResultEmail(em)
          const providerTag = provider === 'custom' ? 'imap' : provider!
          const isImapReconnect =
            Boolean(reconnectAccountId) && isElectron() && provider === 'custom'
          if (isImapReconnect) {
            // Show result screen until the user clicks Done — do not auto-close.
          } else {
            setTimeout(() => {
              onConnected({ provider: providerTag, email: em })
              onClose()
            }, 3000)
          }
        } else {
          setResult('failure')
          setResultError(res.error || 'Connection failed')
        }
      } catch (e: any) {
        setConnecting(false)
        setStep('result')
        setResult('failure')
        setResultError(e?.message || 'Connection failed')
      }
    }
    connect()
  }, [
    step,
    connecting,
    provider,
    connectGmail,
    connectOutlook,
    connectZoho,
    connectCustomMailbox,
    customForm,
    connectSyncWindowDays,
    reconnectAccountId,
    onConnected,
    onClose,
  ])

  useEffect(() => {
    if (step !== 'connecting' || !connecting) return
    const iv = setInterval(() => {
      setConnectingElapsed((s) => {
        const next = s + 1
        if (next >= 90) setConnectingTimedOut(true)
        return next
      })
    }, 1000)
    return () => clearInterval(iv)
  }, [step, connecting])

  const handleBackToProvider = useCallback(() => {
    setStep('provider')
    setProvider(null)
    setCredError(null)
    setExistingGmail(null)
    setExistingOutlook(null)
    setExistingZoho(null)
  }, [])

  const handleBackToCredentials = useCallback(() => {
    setStep('credentials')
    setConnecting(false)
    setConnectingTimedOut(false)
    setConnectingElapsed(0)
  }, [])

  const handleTryAgain = useCallback(() => {
    setResult(null)
    setResultError('')
    setStep('connecting')
    setConnecting(true)
    setConnectingElapsed(0)
    setConnectingTimedOut(false)
  }, [])

  const handleDone = useCallback(() => {
    if (result === 'success' && resultEmail) {
      const providerTag = provider === 'custom' ? 'imap' : provider!
      onConnected({ provider: providerTag, email: resultEmail })
    }
    onClose()
  }, [result, resultEmail, provider, onConnected, onClose])

  if (!isOpen) return null

  const hasElectron = isElectron()
  const hasExtension = isExtension()
  const canConnect = hasElectron || hasExtension
  const modalWidth =
    step === 'provider' ? 'min(520px, 96vw)' : provider === 'custom' ? 'min(500px, 96vw)' : '400px'

  return (
    <>
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        zIndex: 2147483651,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        style={{
          width: modalWidth,
          maxHeight: '90vh',
          background: isPro ? '#ffffff' : 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
          borderRadius: '16px',
          border: `1px solid ${borderColor}`,
          boxShadow: '0 25px 50px rgba(0,0,0,0.4)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px',
            background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
            color: 'white',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '24px' }}>📧</span>
            <div>
              <div style={{ fontSize: '16px', fontWeight: '600' }}>Connect Your Email</div>
              <div style={{ fontSize: '11px', opacity: 0.9 }}>Secure access via OAuth or IMAP/SMTP</div>
              {launchSource != null && (
                <div style={{ fontSize: '10px', opacity: 0.88, marginTop: '3px' }}>
                  {formatConnectEmailLaunchSource(launchSource)}
                </div>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              color: 'white',
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '16px',
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
          {/* Step 1: Provider */}
          {step === 'provider' && (
            <>
              <div style={{ fontSize: '14px', fontWeight: 700, color: textColor, marginBottom: 6 }}>Connect email account</div>
              <div style={{ fontSize: '12px', color: mutedColor, marginBottom: 14, lineHeight: 1.45 }}>
                Recommended providers offer <strong>Smart Sync</strong> — pull, classify, and mirror sorted emails back to your
                mailbox automatically.
              </div>
              {!canConnect && (
                <div
                  style={{
                    padding: '12px',
                    background: isPro ? '#fef3c7' : 'rgba(245,158,11,0.2)',
                    borderRadius: '8px',
                    marginBottom: '16px',
                    fontSize: '12px',
                    color: isPro ? '#92400e' : 'rgba(255,255,255,0.9)',
                  }}
                >
                  Email connection requires the desktop app. Ensure WR Desk™ is running.
                </div>
              )}
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  color: mutedColor,
                  textTransform: 'uppercase',
                  letterSpacing: 0.6,
                  marginBottom: 8,
                }}
              >
                Recommended — Smart Sync
              </div>
              <div
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  background: inputBg,
                  border: `1px solid ${borderColor}`,
                  borderRadius: '10px',
                  marginBottom: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <span style={{ fontSize: '22px', lineHeight: 1.2 }}>🟢</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: textColor }}>Microsoft 365 / Outlook</div>
                    <div style={{ fontSize: '11px', color: mutedColor, lineHeight: 1.45, marginTop: 4 }}>
                      Smart Sync via Microsoft Graph
                    </div>
                    <button
                      type="button"
                      disabled={!canConnect}
                      onClick={() => canConnect && handleSelectProvider('outlook')}
                      style={{
                        marginTop: 10,
                        padding: '8px 14px',
                        fontSize: 12,
                        fontWeight: 600,
                        borderRadius: 8,
                        border: 'none',
                        cursor: canConnect ? 'pointer' : 'not-allowed',
                        opacity: canConnect ? 1 : 0.65,
                        background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                        color: 'white',
                      }}
                    >
                      Connect with Microsoft
                    </button>
                  </div>
                </div>
              </div>
              <div
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  background: inputBg,
                  border: `1px solid ${borderColor}`,
                  borderRadius: '10px',
                  marginBottom: '10px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <span style={{ fontSize: '22px', lineHeight: 1.2 }}>🟢</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: textColor }}>Gmail</div>
                    <div style={{ fontSize: '11px', color: mutedColor, lineHeight: 1.45, marginTop: 4 }}>
                      Smart Sync via Gmail API
                    </div>
                    <button
                      type="button"
                      disabled={!canConnect}
                      onClick={() => canConnect && handleSelectProvider('gmail')}
                      style={{
                        marginTop: 10,
                        padding: '8px 14px',
                        fontSize: 12,
                        fontWeight: 600,
                        borderRadius: 8,
                        border: 'none',
                        cursor: canConnect ? 'pointer' : 'not-allowed',
                        opacity: canConnect ? 1 : 0.65,
                        background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                        color: 'white',
                      }}
                    >
                      Connect with Google
                    </button>
                  </div>
                </div>
              </div>
              <div
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  background: inputBg,
                  border: `1px solid ${borderColor}`,
                  borderRadius: '10px',
                  marginBottom: '12px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <span style={{ fontSize: '22px', lineHeight: 1.2 }}>🟢</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: textColor }}>Zoho Mail</div>
                    <div style={{ fontSize: '11px', color: mutedColor, lineHeight: 1.45, marginTop: 4 }}>
                      Smart Sync via Zoho API
                    </div>
                    <button
                      type="button"
                      disabled={!canConnect}
                      onClick={() => canConnect && handleSelectProvider('zoho')}
                      style={{
                        marginTop: 10,
                        padding: '8px 14px',
                        fontSize: 12,
                        fontWeight: 600,
                        borderRadius: 8,
                        border: 'none',
                        cursor: canConnect ? 'pointer' : 'not-allowed',
                        opacity: canConnect ? 1 : 0.65,
                        background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                        color: 'white',
                      }}
                    >
                      Connect with Zoho
                    </button>
                  </div>
                </div>
              </div>
              <div
                style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  color: mutedColor,
                  textTransform: 'uppercase',
                  letterSpacing: 0.6,
                  marginBottom: 8,
                }}
              >
                Other providers
              </div>
              <div
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  background: inputBg,
                  border: `1px solid ${borderColor}`,
                  borderRadius: '10px',
                  marginBottom: '14px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <span style={{ fontSize: '22px', lineHeight: 1.2 }}>📧</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: textColor }}>IMAP / SMTP</div>
                    <div style={{ fontSize: '11px', color: mutedColor, lineHeight: 1.45, marginTop: 4 }}>
                      Pull &amp; classify: full support
                      <br />
                      Remote folder sync: limited
                    </div>
                    <button
                      type="button"
                      disabled={!canConnect}
                      onClick={() => canConnect && handleSelectProvider('custom')}
                      style={{
                        marginTop: 10,
                        padding: '8px 14px',
                        fontSize: 12,
                        fontWeight: 600,
                        borderRadius: 8,
                        border: `1px solid ${borderColor}`,
                        cursor: canConnect ? 'pointer' : 'not-allowed',
                        opacity: canConnect ? 1 : 0.65,
                        background: isPro ? '#f8fafc' : 'rgba(255,255,255,0.12)',
                        color: textColor,
                      }}
                    >
                      Connect with IMAP
                    </button>
                  </div>
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <label
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    color: textColor,
                  }}
                >
                  <span style={{ whiteSpace: 'nowrap' }}>Sync window:</span>
                  <select
                    value={connectSyncWindowDays}
                    onChange={(e) => setConnectSyncWindowDays(parseInt(e.target.value, 10))}
                    style={{
                      fontSize: 12,
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: `1px solid ${borderColor}`,
                      background: inputBg,
                      color: textColor,
                      cursor: 'pointer',
                    }}
                  >
                    <option value={7}>Last 7 days</option>
                    <option value={30}>Last 30 days</option>
                    <option value={90}>Last 90 days</option>
                    <option value={0}>All mail (warning)</option>
                  </select>
                </label>
                <div style={{ fontSize: '11px', color: mutedColor, lineHeight: 1.45, marginTop: 8 }}>
                  Only recent messages are synced initially. Pull older messages anytime with &quot;Pull More&quot;.
                </div>
              </div>
              <div style={{ marginTop: '16px', padding: '12px', background: isPro ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.15)', borderRadius: '8px', border: '1px solid rgba(59,130,246,0.2)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                  <span style={{ fontSize: '14px' }}>🔒</span>
                  <div style={{ fontSize: '11px', color: isPro ? '#1e40af' : 'rgba(255,255,255,0.8)', lineHeight: '1.5' }}>
                    <strong>Security:</strong> Your emails are never rendered with scripts or tracking.
                  </div>
                </div>
                <div style={{ fontSize: '11px', color: isPro ? '#1e40af' : 'rgba(255,255,255,0.8)', lineHeight: '1.5', marginTop: '4px' }}>
                  🔐 Credentials are stored encrypted in your local vault.
                </div>
              </div>
            </>
          )}

          {/* Step 2: Credentials */}
          {step === 'credentials' && provider && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button
                onClick={handleBackToProvider}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'none',
                  border: 'none',
                  color: isPro ? '#3b82f6' : '#60a5fa',
                  fontSize: '13px',
                  cursor: 'pointer',
                  padding: 0,
                  marginBottom: '8px',
                }}
              >
                ← Back to provider selection
              </button>
              <div style={{ fontSize: '14px', fontWeight: '600', color: textColor, marginBottom: '8px' }}>
                {provider === 'custom'
                  ? 'Custom email (IMAP + SMTP)'
                  : `Set up ${
                      provider === 'gmail' ? 'Gmail' : provider === 'zoho' ? 'Zoho Mail' : 'Outlook'
                    } OAuth`}
              </div>
              {provider === 'custom' ? (
                <ImapConnectionNotice accountId="wizard-imap-credentials" variant="wizard-full" theme={isPro ? 'professional' : 'dark'} />
              ) : null}

              {/* Vault status (for new saves) — only when no existing creds or source is none */}
              {provider !== 'custom' &&
                !(provider === 'gmail' && !showGmailAdvanced) &&
                !(provider === 'gmail' && existingGmail) &&
                !(provider === 'outlook' && existingOutlook) &&
                !(provider === 'zoho' && existingZoho) &&
                vaultUnlocked === true && (
                <div style={{ padding: '10px 12px', background: isPro ? '#ecfdf5' : 'rgba(34,197,94,0.15)', borderRadius: '8px', marginBottom: '12px', fontSize: '12px', color: isPro ? '#166534' : 'rgba(34,197,94,0.95)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>🔐</span>
                  <span>Credentials will be stored encrypted in your vault.</span>
                </div>
              )}
              {provider !== 'custom' &&
                !(provider === 'gmail' && !showGmailAdvanced) &&
                !(provider === 'gmail' && existingGmail) &&
                !(provider === 'outlook' && existingOutlook) &&
                !(provider === 'zoho' && existingZoho) &&
                vaultUnlocked === false && (
                <div style={{ padding: '10px 12px', background: isPro ? '#fef3c7' : 'rgba(245,158,11,0.2)', borderRadius: '8px', marginBottom: '12px', fontSize: '12px', color: isPro ? '#92400e' : 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>⚠️</span>
                  <span>Vault is locked. Your credentials will be stored temporarily. Unlock your vault for permanent encrypted storage.</span>
                </div>
              )}

              {provider === 'gmail' && (
                <>
                  {!showGmailAdvanced ? (
                    <>
                      <div style={{ fontSize: '12px', lineHeight: 1.55, color: mutedColor, marginBottom: 10 }}>
                        Sign in with Google in your browser. Your password is not stored — only OAuth tokens (and refresh
                        tokens are encrypted when the vault is unlocked).
                      </div>
                      {isElectron() && gmailOAuthDiagnosticsBridgeAvailable() && (
                        <div
                          style={{
                            marginBottom: 10,
                            padding: '6px 10px',
                            fontSize: '10px',
                            fontWeight: 600,
                            letterSpacing: '0.02em',
                            textTransform: 'uppercase',
                            borderRadius: 6,
                            display: 'inline-block',
                            background: isPro ? '#ede9fe' : 'rgba(139,92,246,0.25)',
                            color: isPro ? '#5b21b6' : 'rgba(196,181,253,0.95)',
                            border: `1px solid ${isPro ? '#c4b5fd' : 'rgba(167,139,250,0.35)'}`,
                          }}
                        >
                          OAuth diagnostics build active
                        </div>
                      )}
                      {(isElectron() || isExtension()) && gmailOAuthMeta && (
                        <div style={{ fontSize: '11px', color: mutedColor, marginBottom: 10, lineHeight: 1.45 }}>
                          Bundled OAuth client (fingerprint):{' '}
                          <span
                            style={{
                              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                              color: textColor,
                              fontWeight: 600,
                            }}
                          >
                            {gmailOAuthMeta.standardConnectBundledClientFingerprint ?? '—'}
                          </span>
                        </div>
                      )}
                      {gmailOAuthMeta && !gmailOAuthMeta.configured && (
                        <div
                          style={{
                            padding: '10px 12px',
                            background: isPro ? '#fef3c7' : 'rgba(245,158,11,0.2)',
                            borderRadius: '8px',
                            marginBottom: 10,
                            fontSize: '11px',
                            color: isPro ? '#92400e' : 'rgba(255,255,255,0.9)',
                            lineHeight: 1.5,
                          }}
                        >
                          {gmailOAuthMeta.developerModeEnabled ? (
                            <>
                              Google sign-in is not configured for this build. Set the app Google OAuth client id at build
                              time (environment or bundled resources file), or open Advanced to use your own OAuth client.
                            </>
                          ) : (
                            <>
                              Google sign-in is not available in this version of the app. Please check for an update or
                              contact support.
                            </>
                          )}
                        </div>
                      )}
                      {existingGmail && (
                        <div style={{ fontSize: '11px', color: mutedColor, marginBottom: 8 }}>
                          Custom OAuth credentials may be saved for Advanced. The standard Connect Google button always uses
                          the app&apos;s built-in Google client (PKCE) so sign-in is not tied to a developer web client id
                          on disk.
                        </div>
                      )}
                      {credError && (
                        <div style={{ fontSize: '12px', color: '#dc2626', marginBottom: 8 }}>{credError}</div>
                      )}
                      <button
                        type="button"
                        onClick={handleSaveAndConnect}
                        style={{
                          width: '100%',
                          padding: '12px',
                          background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                          border: 'none',
                          borderRadius: '8px',
                          color: 'white',
                          fontSize: '14px',
                          fontWeight: '600',
                          cursor: 'pointer',
                        }}
                      >
                        Connect Google
                      </button>
                      {(gmailOAuthMeta?.developerModeEnabled === true || !!existingGmail) && (
                        <button
                          type="button"
                          onClick={() => {
                            setCredError(null)
                            setShowGmailAdvanced(true)
                          }}
                          style={{
                            width: '100%',
                            marginTop: 8,
                            padding: '8px',
                            fontSize: '12px',
                            background: 'transparent',
                            border: 'none',
                            color: isPro ? '#64748b' : 'rgba(255,255,255,0.65)',
                            cursor: 'pointer',
                            textDecoration: 'underline',
                          }}
                        >
                          Advanced (developer OAuth client)
                        </button>
                      )}
                      {isElectron() && gmailOAuthDiagnosticsBridgeAvailable() && (
                        <button
                          type="button"
                          onClick={() => void showGmailOAuthRuntimeDiagnostics()}
                          style={{
                            width: '100%',
                            marginTop: 10,
                            padding: '8px',
                            fontSize: '11px',
                            background: isPro ? '#f1f5f9' : 'rgba(255,255,255,0.06)',
                            border: `1px solid ${borderColor}`,
                            borderRadius: '8px',
                            color: mutedColor,
                            cursor: 'pointer',
                          }}
                        >
                          Show Gmail OAuth runtime diagnostics
                        </button>
                      )}
                    </>
                  ) : existingGmail ? (
                    <>
                      {existingGmail.source === 'vault' && (
                        <div style={{ fontSize: '12px', color: '#22c55e', marginBottom: '8px' }}>🔐 Credentials stored securely in your vault</div>
                      )}
                      {existingGmail.source === 'vault-migrated' && (
                        <div style={{ fontSize: '12px', color: '#22c55e', marginBottom: '8px' }}>🔐 Credentials migrated to vault from temporary storage</div>
                      )}
                      {existingGmail.source === 'temporary' && (
                        <div style={{ fontSize: '12px', color: isPro ? '#92400e' : 'rgba(245,158,11,0.95)', marginBottom: '8px' }}>
                          ⚠️ Credentials loaded from temporary storage. Check &quot;Store in Vault&quot; and reconnect to secure them.
                        </div>
                      )}
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Client ID</label>
                        <input
                          type="text"
                          value={gmailCreds.clientId}
                          onChange={(e) => setGmailCreds((p) => ({ ...p, clientId: e.target.value }))}
                          placeholder="xxxxxxxxx.apps.googleusercontent.com"
                          style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Client Secret (legacy)</label>
                        <input
                          type={showSecret ? 'text' : 'password'}
                          value={gmailCreds.clientSecret}
                          onChange={(e) => setGmailCreds((p) => ({ ...p, clientSecret: e.target.value }))}
                          placeholder="••••••••"
                          style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                        />
                        <button
                          type="button"
                          onClick={() => setShowSecret((s) => !s)}
                          style={{ marginTop: '4px', fontSize: '11px', background: 'none', border: 'none', color: isPro ? '#3b82f6' : '#60a5fa', cursor: 'pointer' }}
                        >
                          {showSecret ? 'Hide' : 'Reveal'} and edit
                        </button>
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', fontSize: '13px', color: textColor, cursor: 'pointer' }}>
                        <input type="checkbox" checked={storeInVault} onChange={(e) => setStoreInVault(e.target.checked)} />
                        🔐 Store securely in Vault
                        {storeInVault && vaultUnlocked === false && (
                          <span style={{ fontSize: '11px', color: isPro ? '#92400e' : 'rgba(245,158,11,0.95)' }}>
                            (vault locked — will store temporarily, migrate when unlocked)
                          </span>
                        )}
                      </label>
                      {saveFeedback && <div style={{ fontSize: '12px', marginTop: '8px', color: saveFeedback.startsWith('🔐') ? '#22c55e' : (isPro ? '#92400e' : 'rgba(245,158,11,0.95)') }}>{saveFeedback}</div>}
                      <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                        <button
                          onClick={handleConnectWithExisting}
                          style={{
                            flex: 1,
                            padding: '12px',
                            background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                            border: 'none',
                            borderRadius: '8px',
                            color: 'white',
                            fontSize: '14px',
                            fontWeight: '600',
                            cursor: 'pointer',
                          }}
                        >
                          Connect with saved client
                        </button>
                        <button
                          onClick={handleSaveAndConnect}
                          style={{
                            flex: 1,
                            padding: '12px',
                            background: isPro ? '#e2e8f0' : 'rgba(255,255,255,0.15)',
                            border: `1px solid ${borderColor}`,
                            borderRadius: '8px',
                            color: textColor,
                            fontSize: '14px',
                            fontWeight: '600',
                            cursor: 'pointer',
                          }}
                        >
                          Update credentials
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowGmailAdvanced(false)}
                        style={{ marginTop: 10, fontSize: '12px', background: 'none', border: 'none', color: isPro ? '#3b82f6' : '#60a5fa', cursor: 'pointer' }}
                      >
                        ← Back to simple sign-in
                      </button>
                    </>
                  ) : (
                    <>
                      <div style={{ padding: '12px', background: isPro ? 'rgba(234,179,8,0.1)' : 'rgba(234,179,8,0.15)', borderRadius: '8px', border: '1px solid rgba(234,179,8,0.3)', marginBottom: '8px', fontSize: '11px', color: isPro ? '#854d0e' : 'rgba(255,255,255,0.9)', lineHeight: '1.6' }}>
                        <strong>Developer OAuth (optional):</strong> create a Google Cloud OAuth client (Desktop or Web with
                        loopback). Enable Gmail API. Add authorized redirect URIs:{' '}
                        <code style={{ fontSize: 10 }}>http://127.0.0.1:51249/callback</code> through{' '}
                        <code style={{ fontSize: 10 }}>http://127.0.0.1:51258/callback</code> (the app may pick any port in
                        that range). Client secret is only required for legacy confidential clients; PKCE works with client
                        id alone.
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Client ID *</label>
                        <input
                          type="text"
                          value={gmailCreds.clientId}
                          onChange={(e) => setGmailCreds((p) => ({ ...p, clientId: e.target.value }))}
                          placeholder="xxxxxxxxx.apps.googleusercontent.com"
                          style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Client Secret (optional for PKCE)</label>
                        <input
                          type="password"
                          value={gmailCreds.clientSecret}
                          onChange={(e) => setGmailCreds((p) => ({ ...p, clientSecret: e.target.value }))}
                          placeholder="Leave empty if using PKCE-only client"
                          style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                        />
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', fontSize: '13px', color: textColor, cursor: 'pointer' }}>
                        <input type="checkbox" checked={storeInVault} onChange={(e) => setStoreInVault(e.target.checked)} />
                        🔐 Store securely in Vault
                        {storeInVault && vaultUnlocked === false && (
                          <span style={{ fontSize: '11px', color: isPro ? '#92400e' : 'rgba(245,158,11,0.95)' }}>
                            (vault locked — will store temporarily, migrate when unlocked)
                          </span>
                        )}
                      </label>
                      {saveFeedback && <div style={{ fontSize: '12px', marginTop: '8px', color: saveFeedback.startsWith('🔐') ? '#22c55e' : (isPro ? '#92400e' : 'rgba(245,158,11,0.95)') }}>{saveFeedback}</div>}
                      {credError && <div style={{ fontSize: '12px', color: '#dc2626' }}>{credError}</div>}
                      <button
                        onClick={handleSaveAndConnect}
                        style={{
                          width: '100%',
                          padding: '12px',
                          background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                          border: 'none',
                          borderRadius: '8px',
                          color: 'white',
                          fontSize: '14px',
                          fontWeight: '600',
                          cursor: 'pointer',
                          marginTop: '8px',
                        }}
                      >
                        Save & Connect
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowGmailAdvanced(false)}
                        style={{ marginTop: 10, fontSize: '12px', background: 'none', border: 'none', color: isPro ? '#3b82f6' : '#60a5fa', cursor: 'pointer' }}
                      >
                        ← Back to simple sign-in
                      </button>
                    </>
                  )}
                </>
              )}

              {provider === 'outlook' && (
                <>
                  {existingOutlook ? (
                    <>
                      {existingOutlook.source === 'vault' && (
                        <div style={{ fontSize: '12px', color: '#22c55e', marginBottom: '8px' }}>🔐 Credentials stored securely in your vault</div>
                      )}
                      {existingOutlook.source === 'vault-migrated' && (
                        <div style={{ fontSize: '12px', color: '#22c55e', marginBottom: '8px' }}>🔐 Credentials migrated to vault from temporary storage</div>
                      )}
                      {existingOutlook.source === 'temporary' && (
                        <div style={{ fontSize: '12px', color: isPro ? '#92400e' : 'rgba(245,158,11,0.95)', marginBottom: '8px' }}>
                          ⚠️ Credentials loaded from temporary storage. Check &quot;Store in Vault&quot; and reconnect to secure them.
                        </div>
                      )}
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Application (Client) ID</label>
                        <input
                          type="text"
                          value={outlookCreds.clientId}
                          onChange={(e) => setOutlookCreds((p) => ({ ...p, clientId: e.target.value }))}
                          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                          style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Client Secret</label>
                        <input
                          type={showSecret ? 'text' : 'password'}
                          value={outlookCreds.clientSecret}
                          onChange={(e) => setOutlookCreds((p) => ({ ...p, clientSecret: e.target.value }))}
                          placeholder="••••••••"
                          style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                        />
                        <button
                          type="button"
                          onClick={() => setShowSecret((s) => !s)}
                          style={{ marginTop: '4px', fontSize: '11px', background: 'none', border: 'none', color: isPro ? '#3b82f6' : '#60a5fa', cursor: 'pointer' }}
                        >
                          {showSecret ? 'Hide' : 'Reveal'} and edit
                        </button>
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Tenant ID (Directory ID) *</label>
                        <input
                          type="text"
                          value={outlookCreds.tenantId}
                          onChange={(e) => setOutlookCreds((p) => ({ ...p, tenantId: e.target.value }))}
                          placeholder="e.g., 12345678-abcd-... or organizations"
                          style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                        />
                        <div style={{ fontSize: '11px', color: mutedColor, marginTop: '4px' }}>Azure Portal → App Registration → Overview → Verzeichnis-ID (Mandanten-ID)</div>
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', fontSize: '13px', color: textColor, cursor: 'pointer' }}>
                        <input type="checkbox" checked={storeInVault} onChange={(e) => setStoreInVault(e.target.checked)} />
                        🔐 Store securely in Vault
                        {storeInVault && vaultUnlocked === false && (
                          <span style={{ fontSize: '11px', color: isPro ? '#92400e' : 'rgba(245,158,11,0.95)' }}>
                            (vault locked — will store temporarily, migrate when unlocked)
                          </span>
                        )}
                      </label>
                      {saveFeedback && <div style={{ fontSize: '12px', marginTop: '8px', color: saveFeedback.startsWith('🔐') ? '#22c55e' : (isPro ? '#92400e' : 'rgba(245,158,11,0.95)') }}>{saveFeedback}</div>}
                      <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                        <button
                          onClick={handleConnectWithExisting}
                          style={{
                            flex: 1,
                            padding: '12px',
                            background: 'linear-gradient(135deg, #0078d4 0%, #004578 100%)',
                            border: 'none',
                            borderRadius: '8px',
                            color: 'white',
                            fontSize: '14px',
                            fontWeight: '600',
                            cursor: 'pointer',
                          }}
                        >
                          Connect with existing credentials
                        </button>
                        <button
                          onClick={handleSaveAndConnect}
                          style={{
                            flex: 1,
                            padding: '12px',
                            background: isPro ? '#e2e8f0' : 'rgba(255,255,255,0.15)',
                            border: `1px solid ${borderColor}`,
                            borderRadius: '8px',
                            color: textColor,
                            fontSize: '14px',
                            fontWeight: '600',
                            cursor: 'pointer',
                          }}
                        >
                          Update credentials
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ padding: '12px', background: isPro ? 'rgba(234,179,8,0.1)' : 'rgba(234,179,8,0.15)', borderRadius: '8px', border: '1px solid rgba(234,179,8,0.3)', marginBottom: '8px', fontSize: '11px', color: isPro ? '#854d0e' : 'rgba(255,255,255,0.9)', lineHeight: '1.6' }}>
                        <strong>For Outlook:</strong>
                        <ol style={{ margin: '8px 0 0 16px', padding: 0 }}>
                          <li>Go to <a href="https://portal.azure.com" target="_blank" rel="noopener noreferrer" style={{ color: isPro ? '#3b82f6' : '#60a5fa' }}>Azure Portal</a></li>
                          <li>Register an application in Azure Active Directory</li>
                          <li>Add redirect URI: http://localhost:{OAUTH_CALLBACK_PORT}/callback</li>
                          <li>Create a client secret</li>
                          <li>Copy Application (client) ID, Client Secret, and Tenant ID below</li>
                        </ol>
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Application (Client) ID *</label>
                        <input
                          type="text"
                          value={outlookCreds.clientId}
                          onChange={(e) => setOutlookCreds((p) => ({ ...p, clientId: e.target.value }))}
                          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                          style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Client Secret *</label>
                        <input
                          type="password"
                          value={outlookCreds.clientSecret}
                          onChange={(e) => setOutlookCreds((p) => ({ ...p, clientSecret: e.target.value }))}
                          placeholder="Optional for public clients"
                          style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Tenant ID (Directory ID) *</label>
                        <input
                          type="text"
                          value={outlookCreds.tenantId}
                          onChange={(e) => setOutlookCreds((p) => ({ ...p, tenantId: e.target.value }))}
                          placeholder="e.g., 12345678-abcd-... or organizations"
                          style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                        />
                        <div style={{ fontSize: '11px', color: mutedColor, marginTop: '4px' }}>Azure Portal → App Registration → Overview → Verzeichnis-ID (Mandanten-ID)</div>
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', fontSize: '13px', color: textColor, cursor: 'pointer' }}>
                        <input type="checkbox" checked={storeInVault} onChange={(e) => setStoreInVault(e.target.checked)} />
                        🔐 Store securely in Vault
                        {storeInVault && vaultUnlocked === false && (
                          <span style={{ fontSize: '11px', color: isPro ? '#92400e' : 'rgba(245,158,11,0.95)' }}>
                            (vault locked — will store temporarily, migrate when unlocked)
                          </span>
                        )}
                      </label>
                      {saveFeedback && <div style={{ fontSize: '12px', marginTop: '8px', color: saveFeedback.startsWith('🔐') ? '#22c55e' : (isPro ? '#92400e' : 'rgba(245,158,11,0.95)') }}>{saveFeedback}</div>}
                      {credError && <div style={{ fontSize: '12px', color: '#dc2626' }}>{credError}</div>}
                      <button
                        onClick={handleSaveAndConnect}
                        style={{
                          width: '100%',
                          padding: '12px',
                          background: 'linear-gradient(135deg, #0078d4 0%, #004578 100%)',
                          border: 'none',
                          borderRadius: '8px',
                          color: 'white',
                          fontSize: '14px',
                          fontWeight: '600',
                          cursor: 'pointer',
                          marginTop: '8px',
                        }}
                      >
                        Save & Connect
                      </button>
                    </>
                  )}
                </>
              )}

              {provider === 'zoho' && (
                <>
                  {existingZoho ? (
                    <>
                      {existingZoho.source === 'vault' && (
                        <div style={{ fontSize: '12px', color: '#22c55e', marginBottom: '8px' }}>
                          🔐 Credentials stored securely in your vault
                        </div>
                      )}
                      {existingZoho.source === 'vault-migrated' && (
                        <div style={{ fontSize: '12px', color: '#22c55e', marginBottom: '8px' }}>
                          🔐 Credentials migrated to vault from temporary storage
                        </div>
                      )}
                      {existingZoho.source === 'temporary' && (
                        <div
                          style={{
                            fontSize: '12px',
                            color: isPro ? '#92400e' : 'rgba(245,158,11,0.95)',
                            marginBottom: '8px',
                          }}
                        >
                          ⚠️ Credentials loaded from temporary storage. Check &quot;Store in Vault&quot; and reconnect to
                          secure them.
                        </div>
                      )}
                      <div>
                        <label
                          style={{
                            fontSize: '12px',
                            fontWeight: '600',
                            color: mutedColor,
                            marginBottom: '4px',
                            display: 'block',
                          }}
                        >
                          Client ID
                        </label>
                        <input
                          type="text"
                          value={zohoCreds.clientId}
                          onChange={(e) => setZohoCreds((p) => ({ ...p, clientId: e.target.value }))}
                          style={{
                            width: '100%',
                            padding: '10px 12px',
                            background: inputBg,
                            border: `1px solid ${borderColor}`,
                            borderRadius: '8px',
                            fontSize: '13px',
                            color: textColor,
                          }}
                        />
                      </div>
                      <div>
                        <label
                          style={{
                            fontSize: '12px',
                            fontWeight: '600',
                            color: mutedColor,
                            marginBottom: '4px',
                            display: 'block',
                          }}
                        >
                          Client Secret
                        </label>
                        <input
                          type={showSecret ? 'text' : 'password'}
                          value={zohoCreds.clientSecret}
                          onChange={(e) => setZohoCreds((p) => ({ ...p, clientSecret: e.target.value }))}
                          style={{
                            width: '100%',
                            padding: '10px 12px',
                            background: inputBg,
                            border: `1px solid ${borderColor}`,
                            borderRadius: '8px',
                            fontSize: '13px',
                            color: textColor,
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => setShowSecret((s) => !s)}
                          style={{
                            marginTop: '4px',
                            fontSize: '11px',
                            background: 'none',
                            border: 'none',
                            color: isPro ? '#3b82f6' : '#60a5fa',
                            cursor: 'pointer',
                          }}
                        >
                          {showSecret ? 'Hide' : 'Reveal'} and edit
                        </button>
                      </div>
                      <div style={{ marginTop: '10px' }}>
                        <label
                          style={{
                            fontSize: '12px',
                            fontWeight: '600',
                            color: mutedColor,
                            marginBottom: '4px',
                            display: 'block',
                          }}
                        >
                          Data center
                        </label>
                        <select
                          value={zohoCreds.datacenter}
                          onChange={(e) =>
                            setZohoCreds((p) => ({
                              ...p,
                              datacenter: e.target.value === 'eu' ? 'eu' : 'com',
                            }))
                          }
                          style={{
                            width: '100%',
                            padding: '10px 12px',
                            background: inputBg,
                            border: `1px solid ${borderColor}`,
                            borderRadius: '8px',
                            fontSize: '13px',
                            color: textColor,
                          }}
                        >
                          <option value="com">US — accounts.zoho.com / mail.zoho.com</option>
                          <option value="eu">EU — accounts.zoho.eu / mail.zoho.eu</option>
                        </select>
                      </div>
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          marginTop: '12px',
                          fontSize: '13px',
                          color: textColor,
                          cursor: 'pointer',
                        }}
                      >
                        <input type="checkbox" checked={storeInVault} onChange={(e) => setStoreInVault(e.target.checked)} />
                        🔐 Store securely in Vault
                        {storeInVault && vaultUnlocked === false && (
                          <span
                            style={{
                              fontSize: '11px',
                              color: isPro ? '#92400e' : 'rgba(245,158,11,0.95)',
                            }}
                          >
                            (vault locked — will store temporarily, migrate when unlocked)
                          </span>
                        )}
                      </label>
                      {saveFeedback && (
                        <div
                          style={{
                            fontSize: '12px',
                            marginTop: '8px',
                            color: saveFeedback.startsWith('🔐')
                              ? '#22c55e'
                              : isPro
                                ? '#92400e'
                                : 'rgba(245,158,11,0.95)',
                          }}
                        >
                          {saveFeedback}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                        <button
                          onClick={handleConnectWithExisting}
                          style={{
                            flex: 1,
                            padding: '12px',
                            background: 'linear-gradient(135deg, #0d9488 0%, #0f766e 100%)',
                            border: 'none',
                            borderRadius: '8px',
                            color: 'white',
                            fontSize: '14px',
                            fontWeight: '600',
                            cursor: 'pointer',
                          }}
                        >
                          Connect with existing credentials
                        </button>
                        <button
                          onClick={handleSaveAndConnect}
                          style={{
                            flex: 1,
                            padding: '12px',
                            background: isPro ? '#e2e8f0' : 'rgba(255,255,255,0.15)',
                            border: `1px solid ${borderColor}`,
                            borderRadius: '8px',
                            color: textColor,
                            fontSize: '14px',
                            fontWeight: '600',
                            cursor: 'pointer',
                          }}
                        >
                          Update credentials
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div
                        style={{
                          padding: '12px',
                          background: isPro ? 'rgba(234,179,8,0.1)' : 'rgba(234,179,8,0.15)',
                          borderRadius: '8px',
                          border: '1px solid rgba(234,179,8,0.3)',
                          marginBottom: '8px',
                          fontSize: '11px',
                          color: isPro ? '#854d0e' : 'rgba(255,255,255,0.9)',
                          lineHeight: '1.6',
                        }}
                      >
                        <strong>For Zoho Mail:</strong>
                        <ol style={{ margin: '8px 0 0 16px', padding: 0 }}>
                          <li>
                            Go to{' '}
                            <a
                              href="https://api-console.zoho.com/"
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: isPro ? '#3b82f6' : '#60a5fa' }}
                            >
                              Zoho API Console
                            </a>
                          </li>
                          <li>Add a Server-based client</li>
                          <li>
                            Authorized redirect URI: http://localhost:{OAUTH_CALLBACK_PORT}/callback
                          </li>
                          <li>Enable Zoho Mail scopes (messages, folders, accounts)</li>
                          <li>Copy Client ID and Client Secret below; pick EU if your mail is on zoho.eu</li>
                        </ol>
                      </div>
                      <div>
                        <label
                          style={{
                            fontSize: '12px',
                            fontWeight: '600',
                            color: mutedColor,
                            marginBottom: '4px',
                            display: 'block',
                          }}
                        >
                          Client ID *
                        </label>
                        <input
                          type="text"
                          value={zohoCreds.clientId}
                          onChange={(e) => setZohoCreds((p) => ({ ...p, clientId: e.target.value }))}
                          style={{
                            width: '100%',
                            padding: '10px 12px',
                            background: inputBg,
                            border: `1px solid ${borderColor}`,
                            borderRadius: '8px',
                            fontSize: '13px',
                            color: textColor,
                          }}
                        />
                      </div>
                      <div>
                        <label
                          style={{
                            fontSize: '12px',
                            fontWeight: '600',
                            color: mutedColor,
                            marginBottom: '4px',
                            display: 'block',
                          }}
                        >
                          Client Secret *
                        </label>
                        <input
                          type="password"
                          value={zohoCreds.clientSecret}
                          onChange={(e) => setZohoCreds((p) => ({ ...p, clientSecret: e.target.value }))}
                          style={{
                            width: '100%',
                            padding: '10px 12px',
                            background: inputBg,
                            border: `1px solid ${borderColor}`,
                            borderRadius: '8px',
                            fontSize: '13px',
                            color: textColor,
                          }}
                        />
                      </div>
                      <div style={{ marginTop: '10px' }}>
                        <label
                          style={{
                            fontSize: '12px',
                            fontWeight: '600',
                            color: mutedColor,
                            marginBottom: '4px',
                            display: 'block',
                          }}
                        >
                          Data center *
                        </label>
                        <select
                          value={zohoCreds.datacenter}
                          onChange={(e) =>
                            setZohoCreds((p) => ({
                              ...p,
                              datacenter: e.target.value === 'eu' ? 'eu' : 'com',
                            }))
                          }
                          style={{
                            width: '100%',
                            padding: '10px 12px',
                            background: inputBg,
                            border: `1px solid ${borderColor}`,
                            borderRadius: '8px',
                            fontSize: '13px',
                            color: textColor,
                          }}
                        >
                          <option value="com">US — accounts.zoho.com / mail.zoho.com</option>
                          <option value="eu">EU — accounts.zoho.eu / mail.zoho.eu</option>
                        </select>
                      </div>
                      <label
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          marginTop: '12px',
                          fontSize: '13px',
                          color: textColor,
                          cursor: 'pointer',
                        }}
                      >
                        <input type="checkbox" checked={storeInVault} onChange={(e) => setStoreInVault(e.target.checked)} />
                        🔐 Store securely in Vault
                        {storeInVault && vaultUnlocked === false && (
                          <span
                            style={{
                              fontSize: '11px',
                              color: isPro ? '#92400e' : 'rgba(245,158,11,0.95)',
                            }}
                          >
                            (vault locked — will store temporarily, migrate when unlocked)
                          </span>
                        )}
                      </label>
                      {saveFeedback && (
                        <div
                          style={{
                            fontSize: '12px',
                            marginTop: '8px',
                            color: saveFeedback.startsWith('🔐')
                              ? '#22c55e'
                              : isPro
                                ? '#92400e'
                                : 'rgba(245,158,11,0.95)',
                          }}
                        >
                          {saveFeedback}
                        </div>
                      )}
                      {credError && <div style={{ fontSize: '12px', color: '#dc2626' }}>{credError}</div>}
                      <button
                        onClick={handleSaveAndConnect}
                        style={{
                          width: '100%',
                          padding: '12px',
                          background: 'linear-gradient(135deg, #0d9488 0%, #0f766e 100%)',
                          border: 'none',
                          borderRadius: '8px',
                          color: 'white',
                          fontSize: '14px',
                          fontWeight: '600',
                          cursor: 'pointer',
                          marginTop: '8px',
                        }}
                      >
                        Save & Connect
                      </button>
                    </>
                  )}
                </>
              )}

              {provider === 'custom' && (
                <>
                  <div
                    style={{
                      padding: '12px',
                      background: isPro ? 'rgba(59,130,246,0.08)' : 'rgba(59,130,246,0.12)',
                      borderRadius: '8px',
                      border: '1px solid rgba(59,130,246,0.25)',
                      marginBottom: '12px',
                      fontSize: '11px',
                      color: isPro ? '#1e40af' : 'rgba(255,255,255,0.88)',
                      lineHeight: 1.55,
                    }}
                  >
                    <strong>Inbox</strong> uses IMAP. <strong>Sending</strong> uses SMTP — both are tested before the account is saved. Passwords are stored encrypted on disk when your OS secure storage is available (same as OAuth tokens).
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Email address *</label>
                    <input
                      type="email"
                      value={customForm.email}
                      onChange={(e) => setCustomForm((p) => ({ ...p, email: e.target.value }))}
                      placeholder="you@company.com"
                      autoComplete="email"
                      style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Display name (optional)</label>
                    <input
                      type="text"
                      value={customForm.displayName}
                      onChange={(e) => setCustomForm((p) => ({ ...p, displayName: e.target.value }))}
                      placeholder="Work mailbox"
                      style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                    />
                  </div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: textColor, marginTop: '8px' }}>IMAP (inbox)</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 88px', gap: '8px' }}>
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Host *</label>
                      <input
                        type="text"
                        value={customForm.imapHost}
                        onChange={(e) => setCustomForm((p) => ({ ...p, imapHost: e.target.value }))}
                        placeholder="imap.example.com"
                        autoComplete="off"
                        style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Port *</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={customForm.imapPort}
                        onChange={(e) => setCustomForm((p) => ({ ...p, imapPort: e.target.value }))}
                        placeholder="993"
                        style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                      />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Security *</label>
                    {/* option `value` is canonical SecurityMode — not the label text (see types.SecurityMode / IMAP_PRESETS). */}
                    <select
                      value={customForm.imapSecurity}
                      onChange={(e) =>
                        setCustomForm((p) => ({ ...p, imapSecurity: coerceSecurityModeUi(e.target.value, p.imapSecurity) }))
                      }
                      style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                    >
                      <option value="ssl">SSL/TLS (typical port 993)</option>
                      <option value="starttls">STARTTLS (often port 143)</option>
                      <option value="none">None (not recommended)</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Username (optional)</label>
                    <input
                      type="text"
                      value={customForm.imapUsername}
                      onChange={(e) => setCustomForm((p) => ({ ...p, imapUsername: e.target.value }))}
                      placeholder="Defaults to your email address"
                      autoComplete="username"
                      style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Password or app password *</label>
                    <input
                      type="password"
                      value={customForm.imapPassword}
                      onChange={(e) => setCustomForm((p) => ({ ...p, imapPassword: e.target.value }))}
                      placeholder={reconnectAccountId && reconnectHasStoredImapPassword ? 'Enter new password' : '••••••••'}
                      autoComplete="new-password"
                      style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                    />
                    {reconnectAccountId && (
                      <div style={{ fontSize: '11px', color: mutedColor, marginTop: '8px', lineHeight: 1.5 }}>
                        <span style={{ fontWeight: 700, color: reconnectHasStoredImapPassword ? '#22c55e' : '#f59e0b' }}>
                          {reconnectHasStoredImapPassword ? 'Password saved ✓' : 'No password stored'}
                        </span>
                        {' — '}
                        The field stays empty for security until you type. Enter your password to verify or update; the connection test result is shown on the next step.
                      </div>
                    )}
                  </div>

                  <div style={{ fontSize: '13px', fontWeight: 600, color: textColor, marginTop: '12px' }}>SMTP (sending)</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 88px', gap: '8px' }}>
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Host *</label>
                      <input
                        type="text"
                        value={customForm.smtpHost}
                        onChange={(e) => setCustomForm((p) => ({ ...p, smtpHost: e.target.value }))}
                        placeholder="smtp.example.com"
                        autoComplete="off"
                        style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Port *</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={customForm.smtpPort}
                        onChange={(e) => setCustomForm((p) => ({ ...p, smtpPort: e.target.value }))}
                        placeholder="587"
                        style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                      />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Security *</label>
                    <select
                      value={customForm.smtpSecurity}
                      onChange={(e) =>
                        setCustomForm((p) => ({ ...p, smtpSecurity: coerceSecurityModeUi(e.target.value, p.smtpSecurity) }))
                      }
                      style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                    >
                      <option value="starttls">STARTTLS (typical port 587)</option>
                      <option value="ssl">SSL/TLS (typical port 465)</option>
                      <option value="none">None (not recommended)</option>
                    </select>
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', fontSize: '13px', color: textColor, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={customForm.smtpUseSameCredentials}
                      onChange={(e) => setCustomForm((p) => ({ ...p, smtpUseSameCredentials: e.target.checked }))}
                    />
                    Use same username and password for SMTP as for IMAP
                  </label>
                  {!customForm.smtpUseSameCredentials && (
                    <>
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>SMTP username *</label>
                        <input
                          type="text"
                          value={customForm.smtpUsername}
                          onChange={(e) => setCustomForm((p) => ({ ...p, smtpUsername: e.target.value }))}
                          style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>SMTP password *</label>
                        <input
                          type="password"
                          value={customForm.smtpPassword}
                          onChange={(e) => setCustomForm((p) => ({ ...p, smtpPassword: e.target.value }))}
                          style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                        />
                      </div>
                    </>
                  )}
                  <div style={{ marginTop: 14, marginBottom: 4 }}>
                    <label
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 12,
                        fontWeight: 600,
                        color: textColor,
                      }}
                    >
                      <span style={{ whiteSpace: 'nowrap' }}>Initial sync window:</span>
                      <select
                        value={connectSyncWindowDays}
                        onChange={(e) => setConnectSyncWindowDays(parseInt(e.target.value, 10))}
                        style={{
                          fontSize: 12,
                          padding: '6px 10px',
                          borderRadius: 8,
                          border: `1px solid ${borderColor}`,
                          background: inputBg,
                          color: textColor,
                          cursor: 'pointer',
                        }}
                      >
                        <option value={7}>Last 7 days</option>
                        <option value={30}>Last 30 days</option>
                        <option value={90}>Last 90 days</option>
                        <option value={0}>All mail (warning)</option>
                      </select>
                    </label>
                    <div style={{ fontSize: '11px', color: mutedColor, lineHeight: 1.45, marginTop: 6 }}>
                      Saved on the account as <code style={{ fontSize: 10 }}>sync.syncWindowDays</code> — must match what you expect for the first Pull.
                    </div>
                  </div>
                  {credError && <div style={{ fontSize: '12px', color: '#dc2626', marginTop: '8px' }}>{credError}</div>}
                  <button
                    type="button"
                    onClick={handleSaveAndConnect}
                    style={{
                      width: '100%',
                      padding: '12px',
                      marginTop: '12px',
                      background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                      border: 'none',
                      borderRadius: '8px',
                      color: 'white',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: 'pointer',
                    }}
                  >
                    Test IMAP &amp; SMTP and connect
                  </button>
                </>
              )}
            </div>
          )}

          {/* Step 3: Connecting */}
          {step === 'connecting' && (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ fontSize: '36px', marginBottom: '16px', animation: 'spin 1s linear infinite' }}>⏳</div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: textColor, marginBottom: '8px' }}>
                {provider === 'custom'
                  ? 'Testing IMAP and SMTP...'
                  : `Connecting to ${
                      provider === 'gmail' ? 'Gmail' : provider === 'zoho' ? 'Zoho Mail' : 'Outlook'
                    }...`}
              </div>
              <div style={{ fontSize: '12px', color: mutedColor, marginBottom: '16px' }}>
                {provider === 'custom'
                  ? 'Checking inbox login and send authentication. This usually takes a few seconds.'
                  : 'Please complete the authorization in your browser window.'}
              </div>
              {provider !== 'custom' && connectingElapsed >= 30 && connectingElapsed < 90 && (
                <div style={{ fontSize: '12px', color: '#f59e0b', marginBottom: '12px' }}>
                  Still waiting... Make sure you completed the sign-in in your browser.
                </div>
              )}
              {provider === 'custom' && connectingElapsed >= 25 && connectingElapsed < 90 && (
                <div style={{ fontSize: '12px', color: '#f59e0b', marginBottom: '12px' }}>
                  Still working… If this hangs, confirm firewall/VPN allows IMAP/SMTP to your server.
                </div>
              )}
              {connectingTimedOut && (
                <div style={{ marginTop: '16px', display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: '12px', color: '#dc2626', width: '100%', marginBottom: '8px' }}>Connection timed out.</div>
                  <button
                    onClick={handleTryAgain}
                    style={{ padding: '8px 16px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}
                  >
                    Try Again
                  </button>
                  <button
                    onClick={handleBackToCredentials}
                    style={{ padding: '8px 16px', background: 'transparent', color: textColor, border: `1px solid ${borderColor}`, borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}
                  >
                    Back to Credentials
                  </button>
                </div>
              )}
              <button
                onClick={onClose}
                style={{ marginTop: '20px', padding: '8px 16px', background: 'transparent', color: mutedColor, border: `1px solid ${borderColor}`, borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}
              >
                Cancel
              </button>
            </div>
          )}

          {/* Step 4: Result */}
          {step === 'result' && result && (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              {result === 'success' ? (
                reconnectAccountId && isElectron() ? (
                  <>
                    <div style={{ fontSize: '48px', marginBottom: '12px', color: '#22c55e' }}>✓</div>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: '#22c55e', marginBottom: '10px' }}>Connected ✓</div>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: textColor, marginBottom: '8px' }}>
                      IMAP and SMTP tests passed — credentials saved.
                    </div>
                    <div style={{ fontSize: '13px', color: textColor, marginBottom: '6px' }}>{resultEmail || 'Your account'}</div>
                    <div style={{ fontSize: '12px', color: mutedColor, marginBottom: '20px' }}>
                      Click Done to refresh the inbox and clear sign-in warnings.
                    </div>
                    <button
                      type="button"
                      onClick={handleDone}
                      style={{
                        padding: '12px 24px',
                        background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                        border: 'none',
                        borderRadius: '8px',
                        color: 'white',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}
                    >
                      Done
                    </button>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: '48px', marginBottom: '16px', color: '#22c55e' }}>✓</div>
                    <div style={{ fontSize: '16px', fontWeight: 600, color: textColor, marginBottom: '8px' }}>
                      Connected as {resultEmail || 'your account'}
                    </div>
                    <div style={{ fontSize: '12px', color: mutedColor, marginBottom: '20px' }}>Closing in 3 seconds...</div>
                    <button
                      type="button"
                      onClick={handleDone}
                      style={{
                        padding: '12px 24px',
                        background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                        border: 'none',
                        borderRadius: '8px',
                        color: 'white',
                        fontSize: '14px',
                        fontWeight: '600',
                        cursor: 'pointer',
                      }}
                    >
                      Done
                    </button>
                  </>
                )
              ) : (
                <>
                  <div style={{ fontSize: '48px', marginBottom: '16px', color: '#dc2626' }}>✗</div>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: textColor, marginBottom: '8px' }}>Connection failed</div>
                  <div style={{ fontSize: '12px', color: mutedColor, marginBottom: '20px', maxHeight: '100px', overflowY: 'auto', lineHeight: 1.45 }}>
                    {resultError ? `Connection failed: ${resultError}` : 'Connection failed: Unknown error'}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button
                      onClick={handleTryAgain}
                      style={{ padding: '10px 20px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}
                    >
                      Try Again
                    </button>
                    <button
                      onClick={handleBackToCredentials}
                      style={{ padding: '10px 20px', background: 'transparent', color: textColor, border: `1px solid ${borderColor}`, borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}
                    >
                      Back to Credentials
                    </button>
                    <button
                      onClick={onClose}
                      style={{ padding: '10px 20px', background: 'transparent', color: mutedColor, border: `1px solid ${borderColor}`, borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}
                    >
                      Close
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>

    {gmailOAuthDiagModalOpen && (
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gmail-oauth-diag-title"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 2147483652,
          background: 'rgba(0,0,0,0.55)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) setGmailOAuthDiagModalOpen(false)
        }}
      >
        <div
          style={{
            width: 'min(440px, 96vw)',
            maxHeight: '85vh',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            background: isPro ? '#ffffff' : '#1e293b',
            borderRadius: 12,
            border: `1px solid ${borderColor}`,
            boxShadow: '0 25px 50px rgba(0,0,0,0.45)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            id="gmail-oauth-diag-title"
            style={{
              padding: '14px 16px',
              fontSize: 15,
              fontWeight: 700,
              color: textColor,
              borderBottom: `1px solid ${borderColor}`,
            }}
          >
            Gmail OAuth runtime diagnostics
          </div>
          <div style={{ padding: 12, overflowY: 'auto', flex: 1 }}>
            {gmailOAuthDiagLoading && (
              <div style={{ fontSize: 12, color: mutedColor, marginBottom: 10 }}>Loading from main process…</div>
            )}
            {gmailOAuthDiagError && (
              <div
                style={{
                  fontSize: 12,
                  color: '#b91c1c',
                  background: isPro ? '#fee2e2' : 'rgba(248,113,113,0.15)',
                  padding: '8px 10px',
                  borderRadius: 8,
                  marginBottom: 10,
                  lineHeight: 1.4,
                }}
              >
                {gmailOAuthDiagError}
              </div>
            )}
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <tbody>
                {(gmailOAuthDiagRows ?? formatGmailOAuthDiagnosticRows(null)).map((row) => (
                  <tr key={row.key}>
                    <td
                      style={{
                        verticalAlign: 'top',
                        padding: '6px 8px 6px 0',
                        color: mutedColor,
                        fontWeight: 600,
                        width: '42%',
                        wordBreak: 'break-word',
                      }}
                    >
                      {row.key}
                    </td>
                    <td
                      style={{
                        verticalAlign: 'top',
                        padding: '6px 0',
                        color: textColor,
                        wordBreak: 'break-word',
                        lineHeight: 1.35,
                      }}
                    >
                      {row.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 10, color: mutedColor, marginTop: 10, lineHeight: 1.4 }}>
              Values update after a standard Connect Google attempt. Fingerprints only — no secrets or tokens.
            </div>
          </div>
          <div style={{ padding: 12, borderTop: `1px solid ${borderColor}` }}>
            <button
              type="button"
              onClick={() => setGmailOAuthDiagModalOpen(false)}
              style={{
                width: '100%',
                padding: '10px',
                fontSize: 13,
                fontWeight: 600,
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                color: 'white',
              }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

export default EmailConnectWizard
