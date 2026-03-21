/**
 * Email Gateway IPC Handlers
 *
 * Electron IPC interface for the email gateway.
 * These handlers expose email operations to the renderer process.
 */

import { ipcMain, BrowserWindow, shell, dialog, app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

// ── WRExpert.md: user-editable AI behaviour (userData, survives app updates) ──
const RULES_PATH = path.join(app.getPath('userData'), 'WRExpert.md')
const DEFAULT_RULES_PATH = path.join(__dirname, '../../WRExpert.default.md')

const DEFAULT_WREXPERT_CONTENT = `# WRExpert.md — WR Desk Inbox AI Behaviour
# This is your personal AI expert. Edit this file to teach the AI how to
# handle your specific inbox. Changes take effect on the next Auto-Sort run.
# Lines starting with # are comments and are ignored by the AI.

## IDENTITY
You are classifying emails for a business professional.
Adapt tone and priorities to a business context unless specified otherwise.

## CATEGORIES AND THRESHOLDS

### pending_delete (auto-deleted after 7 days)
Move here if ANY of these apply:
- Newsletters and marketing emails with no direct action required
- Automated notifications (order confirmations, shipping updates, receipts)
  EXCEPTION: receipts over €500 → move to pending_review instead
- Social media notifications
- Promotional offers
- Spam or unsolicited commercial email
- System status emails with no incident

### pending_review (human review required, auto-deleted after 14 days)
Move here if ANY of these apply:
- Legal notices or contract-related emails that are NOT time-sensitive
- Supplier or vendor communications that are informational only
- Any email where the intent is unclear and automatic action seems risky
- Receipts or invoices over €500 (even if automated)
- First contact from an unknown sender on a potentially relevant topic

### archive (kept permanently, no action needed)
Move here if:
- Useful reference material (documentation, guides, confirmations you might need later)
- Completed transaction records under €500
- Meeting notes, summaries, reports for future reference
- Any email explicitly marked by the user as "keep"

### urgent (stays in inbox, flagged red, urgency >= 7)
Move here if ANY of these apply:
- Invoice or payment overdue or due within 3 days
- Legal deadline within 7 days
- Contract termination or dispute
- Security alert requiring immediate action
- Direct request from a known important contact requiring same-day response

### action_required (stays in inbox, flagged orange, urgency 4–6)
Move here if:
- Requires a response within the next 7 days
- Requires a decision or manual step (not just reading)
- Contains a question directed at you that is not automated

### normal (stays in inbox, no special flag)
Move here if:
- Requires attention but no urgency
- Does not fit the above categories
- Personal or low-stakes business communication

## URGENCY SCORING (1–10)
1–3: No action required, informational only
4–6: Action required within the week
7–8: Action required within 48 hours
9–10: Immediate action required (legal, financial, security)

## OUTPUT COHERENCE (mandatory)
category, urgency (1–10), needsReply, reason, and summary MUST agree:
- Promotional offers, newsletters, marketing blasts, and unsolicited commercial email with NO billing/legal/security angle MUST use category pending_delete (or archive if it is reference material you want to keep), urgency 1–3, and needsReply false. NEVER use urgent or action_required for those.
- Do NOT assign urgency 9–10 unless the reason explicitly cites a legal deadline, financial consequence, security incident, account lockout, or same-day human deadline from a real counterparty.
- If the reason describes "no action required" or "informational/promotional only", urgency MUST be 1–3 and needsReply MUST be false.

## DRAFT REPLY RULES
Generate a draft reply (draftReply field) when:
- needsReply is true
- The email is action_required or urgent
- The sender is a real person (not an automated system)
Do NOT generate a draft reply for:
- Automated notifications
- Newsletters
- Spam

Draft tone: professional, concise, direct. 
Default language: match the language of the incoming email.
Signature: do not add a signature — the user will add their own.

## CUSTOM RULES (add your own below)
# Example: treat all emails from my-important-client.com as urgent
# RULE: sender domain "my-important-client.com" → urgent, urgency 8
#
# Example: never auto-delete emails with subject containing "invoice"
# RULE: subject contains "invoice" → pending_review minimum
`

let rulesCache = { content: '', mtime: 0 }

function getInboxAiRules(): string {
  if (!fs.existsSync(RULES_PATH)) {
    let defaults: string
    try {
      defaults = fs.readFileSync(DEFAULT_RULES_PATH, 'utf-8')
    } catch {
      defaults = DEFAULT_WREXPERT_CONTENT
    }
    fs.writeFileSync(RULES_PATH, defaults, 'utf-8')
    rulesCache = { content: defaults, mtime: Date.now() }
    return defaults
  }
  try {
    const stats = fs.statSync(RULES_PATH)
    if (stats.mtimeMs !== rulesCache.mtime) {
      rulesCache = { content: fs.readFileSync(RULES_PATH, 'utf-8'), mtime: stats.mtimeMs }
    }
    return rulesCache.content
  } catch {
    return DEFAULT_WREXPERT_CONTENT
  }
}

function getInboxAiRulesForPrompt(): string {
  const raw = getInboxAiRules()
  return raw
    .split('\n')
    .filter((line) => !line.trim().startsWith('#') && line.trim() !== '')
    .join('\n')
}
import { emailGateway } from './gateway'
import { pickDefaultEmailAccountRowId } from './domain/accountRowPicker'
import { checkExistingCredentials, saveCredentials, isVaultUnlocked } from './credentials'
import {
  MessageSearchOptions,
  SendEmailPayload,
  IMAP_PRESETS,
  type CustomImapSmtpConnectPayload
} from './types'
import { syncAccountEmails, startAutoSync, updateSyncState } from './syncOrchestrator'
import { bulkQueueDeletion, cancelRemoteDeletion } from './remoteDeletion'
import {
  enqueueOrchestratorRemoteMutations,
  scheduleOrchestratorRemoteDrain,
  listRemoteOrchestratorQueueRows,
  enqueueRemoteOpsForLocalLifecycleState,
} from './inboxOrchestratorRemoteQueue'
import { runInboxLifecycleTick } from './inboxLifecycleEngine'
import { reconcileImapLifecycleFromLocalState } from './imapLifecycleReconcile'
import type { OrchestratorRemoteOperation } from './domain/orchestratorRemoteTypes'
import { processPendingP2PBeapEmails } from './beapEmailIngestion'
import { processPendingPlainEmails } from './plainEmailIngestion'
import { reconcileAnalyzeTriage, reconcileInboxClassification } from '../../../src/lib/inboxClassificationReconcile'
import { extractPdfText, isPdfFile } from './pdf-extractor'
import { extractPdfTextWithVisionApi } from '../vault/hsContextOcrJob'

// ── Inbox: active auto-sync loops ──

const INBOX_LLM_TIMEOUT_MS = 45_000

/** Use ollamaManager.chat (same path as main app HTTP chat) — avoids aiProviders fetch path that can return 404. */
async function callInboxOllamaChat(systemPrompt: string, userPrompt: string): Promise<string> {
  const { ollamaManager } = await import('../llm/ollama-manager')
  const models = await ollamaManager.listModels()
  if (models.length === 0) {
    throw new Error('No LLM model installed. Install a model in LLM Settings first.')
  }
  const modelId = models[0].name
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userPrompt },
  ]
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('LLM_TIMEOUT: response exceeded 45s')), INBOX_LLM_TIMEOUT_MS)
  )
  const response = await Promise.race([
    ollamaManager.chat(modelId, messages),
    timeoutPromise,
  ])
  return response?.content?.trim() ?? 'No response from model.'
}

/** Check if Ollama has at least one model (same resolution as chat). */
async function isOllamaAvailable(): Promise<boolean> {
  try {
    const { ollamaManager } = await import('../llm/ollama-manager')
    const models = await ollamaManager.listModels()
    return models.length > 0
  } catch {
    return false
  }
}

const OLLAMA_BASE_URL = 'http://127.0.0.1:11434'

/** Stream LLM response token-by-token. Yields content chunks. 45s timeout via AbortController. */
async function* callInboxOllamaChatStream(
  systemPrompt: string,
  userPrompt: string
): AsyncGenerator<string> {
  const { ollamaManager } = await import('../llm/ollama-manager')
  const models = await ollamaManager.listModels()
  if (models.length === 0) {
    throw new Error('No LLM model installed. Install a model in LLM Settings first.')
  }
  const modelId = models[0].name
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), INBOX_LLM_TIMEOUT_MS)
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!response.ok || !response.body) throw new Error('Stream failed')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const parsed = JSON.parse(line) as { message?: { content?: string } }
          if (parsed.message?.content) {
            yield parsed.message.content
          }
        } catch {
          /* partial line, skip */
        }
      }
    }
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer) as { message?: { content?: string } }
        if (parsed.message?.content) {
          yield parsed.message.content
        }
      } catch {
        /* partial line, skip */
      }
    }
  } catch (err: unknown) {
    clearTimeout(timeoutId)
    const isAbort = err instanceof Error && err.name === 'AbortError'
    if (isAbort) {
      throw new Error('LLM_TIMEOUT: response exceeded 45s')
    }
    throw err
  }
}

/** Robust JSON parsing for LLM responses — strips markdown fences and preamble. */
function parseAiJson(raw: string): Record<string, unknown> {
  let cleaned = raw.trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) {
    cleaned = cleaned.substring(start, end + 1)
  }
  try {
    return JSON.parse(cleaned) as Record<string, unknown>
  } catch {
    return {}
  }
}
const activeAutoSyncLoops = new Map<string, { stop: () => void }>()

/**
 * Register all email-related IPC handlers.
 * Uses removeHandler before each handle to allow re-registration (idempotent).
 */
export function registerEmailHandlers(): void {
  console.log('[Email IPC] Registering handlers...')
  
  const channels = [
    'email:listAccounts', 'email:getAccount', 'email:deleteAccount', 'email:testConnection',
    'email:getImapPresets', 'email:setGmailCredentials', 'email:connectGmail', 'email:showGmailSetup',
    'email:checkGmailCredentials', 'email:checkOutlookCredentials',
    'email:setOutlookCredentials', 'email:connectOutlook', 'email:showOutlookSetup', 'email:connectImap', 'email:connectCustomMailbox',
    'email:validateImapLifecycleRemote',
    'email:listMessages', 'email:getMessage', 'email:markAsRead', 'email:markAsUnread', 'email:flagMessage',
    'email:listAttachments', 'email:extractAttachmentText', 'email:sendReply', 'email:sendEmail', 'email:sendBeapEmail',
    'email:syncAccount', 'email:getSyncStatus',
  ] as const
  channels.forEach(ch => ipcMain.removeHandler(ch))
  
  // =================================================================
  // Account Management
  // =================================================================
  
  /**
   * List all email accounts
   */
  ipcMain.handle('email:listAccounts', async () => {
    try {
      const accounts = await emailGateway.listAccounts()
      return { ok: true, data: accounts }
    } catch (error: any) {
      console.error('[Email IPC] listAccounts error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Get a single account
   */
  ipcMain.handle('email:getAccount', async (_e, accountId: string) => {
    try {
      const account = await emailGateway.getAccount(accountId)
      return { ok: true, data: account }
    } catch (error: any) {
      console.error('[Email IPC] getAccount error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Delete an account
   */
  ipcMain.handle('email:deleteAccount', async (_e, accountId: string) => {
    try {
      await emailGateway.deleteAccount(accountId)
      return { ok: true }
    } catch (error: any) {
      console.error('[Email IPC] deleteAccount error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Test account connection
   */
  ipcMain.handle('email:testConnection', async (_e, accountId: string) => {
    try {
      const result = await emailGateway.testConnection(accountId)
      return { ok: true, data: result }
    } catch (error: any) {
      console.error('[Email IPC] testConnection error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  // =================================================================
  // OAuth/Setup Flows
  // =================================================================
  
  /**
   * Get available IMAP presets
   */
  ipcMain.handle('email:getImapPresets', async () => {
    return { ok: true, data: IMAP_PRESETS }
  })
  
  /**
   * Set Gmail OAuth credentials (vault if unlocked, else plain file)
   */
  ipcMain.handle('email:setGmailCredentials', async (_e, clientId: string, clientSecret: string, storeInVault: boolean = true) => {
    try {
      const result = await saveCredentials('gmail', { clientId, clientSecret }, storeInVault)
      return { ok: result.ok, savedToVault: result.savedToVault }
    } catch (error: any) {
      console.error('[Email IPC] setGmailCredentials error:', error)
      return { ok: false, error: error.message }
    }
  })

  /**
   * Check Gmail credentials with honest source (vault / vault-migrated / temporary / none)
   */
  ipcMain.handle('email:checkGmailCredentials', async () => {
    try {
      const result = await checkExistingCredentials('gmail')
      return {
        ok: true,
        data: {
          configured: !!result.credentials,
          clientId: result.clientId,
          source: result.source,
          credentials: result.credentials,
          hasSecret: result.hasSecret,
          vaultUnlocked: isVaultUnlocked(),
        },
      }
    } catch (error: any) {
      return { ok: false, error: error.message }
    }
  })

  /**
   * Check Outlook credentials with honest source (vault / vault-migrated / temporary / none)
   */
  ipcMain.handle('email:checkOutlookCredentials', async () => {
    try {
      const result = await checkExistingCredentials('outlook')
      return {
        ok: true,
        data: {
          configured: !!result.credentials,
          clientId: result.clientId,
          source: result.source,
          credentials: result.credentials,
          hasSecret: result.hasSecret,
          vaultUnlocked: isVaultUnlocked(),
        },
      }
    } catch (error: any) {
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Start Gmail OAuth flow
   */
  ipcMain.handle('email:connectGmail', async (_e, displayName?: string) => {
    try {
      const account = await emailGateway.connectGmailAccount(displayName)
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('email:accountConnected', { provider: 'gmail', email: account.email })
      })
      return { ok: true, data: account }
    } catch (error: any) {
      console.error('[Email IPC] connectGmail error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Show Gmail credentials setup dialog
   */
  ipcMain.handle('email:showGmailSetup', async () => {
    try {
      const result = await showGmailSetupDialog()
      return { ok: true, data: result }
    } catch (error: any) {
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Set Outlook OAuth credentials (vault if unlocked, else plain file)
   */
  ipcMain.handle('email:setOutlookCredentials', async (_e, clientId: string, clientSecret?: string, tenantId?: string, storeInVault: boolean = true) => {
    try {
      const result = await saveCredentials('outlook', { clientId, clientSecret, tenantId }, storeInVault)
      return { ok: result.ok, savedToVault: result.savedToVault }
    } catch (error: any) {
      console.error('[Email IPC] setOutlookCredentials error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Start Outlook OAuth flow
   */
  ipcMain.handle('email:connectOutlook', async (_e, displayName?: string) => {
    try {
      const account = await emailGateway.connectOutlookAccount(displayName)
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('email:accountConnected', { provider: 'microsoft365', email: account.email })
      })
      return { ok: true, data: account }
    } catch (error: any) {
      console.error('[Email IPC] connectOutlook error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Show Outlook credentials setup dialog
   */
  ipcMain.handle('email:showOutlookSetup', async () => {
    try {
      const result = await showOutlookSetupDialog()
      return { ok: true, data: result }
    } catch (error: any) {
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Connect IMAP account (legacy; optional SMTP)
   */
  ipcMain.handle('email:connectImap', async (_e, config: {
    displayName: string
    email: string
    host: string
    port: number
    username: string
    password: string
    security: 'ssl' | 'starttls' | 'none'
    smtpHost?: string
    smtpPort?: number
    smtpSecurity?: 'ssl' | 'starttls' | 'none'
    smtpUsername?: string
    smtpPassword?: string
  }) => {
    try {
      const account = await emailGateway.connectImapAccount(config)
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('email:accountConnected', { provider: 'imap', email: account.email })
      })
      return { ok: true, data: account }
    } catch (error: any) {
      console.error('[Email IPC] connectImap error:', error)
      return { ok: false, error: error.message }
    }
  })

  /**
   * Custom mailbox: IMAP + SMTP (both required), separate connection tests in main.
   */
  ipcMain.handle('email:connectCustomMailbox', async (_e, payload: CustomImapSmtpConnectPayload) => {
    try {
      const account = await emailGateway.connectCustomImapSmtpAccount(payload)
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('email:accountConnected', { provider: 'imap', email: account.email })
      })
      return { ok: true, data: account }
    } catch (error: any) {
      console.error('[Email IPC] connectCustomMailbox error:', error)
      return { ok: false, error: error.message }
    }
  })

  ipcMain.handle('email:validateImapLifecycleRemote', async (_e, accountId: string) => {
    try {
      if (typeof accountId !== 'string' || !accountId.trim()) {
        return { ok: false, error: 'Account id is required.' }
      }
      return await emailGateway.validateImapLifecycleRemote(accountId.trim())
    } catch (error: any) {
      console.error('[Email IPC] validateImapLifecycleRemote error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  // =================================================================
  // Message Operations
  // =================================================================
  
  /**
   * List messages from an account
   */
  ipcMain.handle('email:listMessages', async (
    _e, 
    accountId: string, 
    options?: MessageSearchOptions
  ) => {
    try {
      const messages = await emailGateway.listMessages(accountId, options)
      return { ok: true, data: messages }
    } catch (error: any) {
      console.error('[Email IPC] listMessages error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Get a single message with full body
   */
  ipcMain.handle('email:getMessage', async (_e, accountId: string, messageId: string) => {
    try {
      const message = await emailGateway.getMessage(accountId, messageId)
      return { ok: true, data: message }
    } catch (error: any) {
      console.error('[Email IPC] getMessage error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Mark message as read
   */
  ipcMain.handle('email:markAsRead', async (_e, accountId: string, messageId: string) => {
    try {
      await emailGateway.markAsRead(accountId, messageId)
      return { ok: true }
    } catch (error: any) {
      console.error('[Email IPC] markAsRead error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Mark message as unread
   */
  ipcMain.handle('email:markAsUnread', async (_e, accountId: string, messageId: string) => {
    try {
      await emailGateway.markAsUnread(accountId, messageId)
      return { ok: true }
    } catch (error: any) {
      console.error('[Email IPC] markAsUnread error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Flag/unflag message
   */
  ipcMain.handle('email:flagMessage', async (
    _e, 
    accountId: string, 
    messageId: string, 
    flagged: boolean
  ) => {
    try {
      await emailGateway.flagMessage(accountId, messageId, flagged)
      return { ok: true }
    } catch (error: any) {
      console.error('[Email IPC] flagMessage error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  // =================================================================
  // Attachment Operations
  // =================================================================
  
  /**
   * List attachments for a message
   */
  ipcMain.handle('email:listAttachments', async (
    _e, 
    accountId: string, 
    messageId: string
  ) => {
    try {
      const attachments = await emailGateway.listAttachments(accountId, messageId)
      return { ok: true, data: attachments }
    } catch (error: any) {
      console.error('[Email IPC] listAttachments error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Extract text from PDF attachment
   */
  ipcMain.handle('email:extractAttachmentText', async (
    _e,
    accountId: string,
    messageId: string,
    attachmentId: string
  ) => {
    try {
      const result = await emailGateway.extractAttachmentText(accountId, messageId, attachmentId)
      return { ok: true, data: result }
    } catch (error: any) {
      console.error('[Email IPC] extractAttachmentText error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  // =================================================================
  // Send Operations
  // =================================================================
  
  /**
   * Send a reply
   */
  ipcMain.handle('email:sendReply', async (
    _e,
    accountId: string,
    messageId: string,
    payload: Omit<SendEmailPayload, 'inReplyTo' | 'references'>
  ) => {
    try {
      const result = await emailGateway.sendReply(accountId, messageId, payload)
      return { ok: true, data: result }
    } catch (error: any) {
      console.error('[Email IPC] sendReply error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Send a new email
   */
  ipcMain.handle('email:sendEmail', async (
    _e,
    accountId: string,
    payload: SendEmailPayload
  ) => {
    try {
      const result = await emailGateway.sendEmail(accountId, payload)
      return { ok: true, data: result }
    } catch (error: any) {
      console.error('[Email IPC] sendEmail error:', error)
      return { ok: false, error: error.message }
    }
  })

  /**
   * Send BEAP package via email (uses default connected account row — see `pickDefaultEmailAccountRowId`).
   * Contract: { to: string; subject: string; body: string; attachments: { name: string; data: string; mime: string }[] }
   */
  ipcMain.handle('email:sendBeapEmail', async (
    _e,
    contract: { to: string; subject: string; body: string; attachments: { name: string; data: string; mime: string }[] }
  ) => {
    try {
      const accounts = await emailGateway.listAccounts()
      const accountId = pickDefaultEmailAccountRowId(accounts)
      if (!accountId) {
        return { ok: false, error: 'No email account connected. Connect in Settings or use Download.' }
      }
      const payload: SendEmailPayload = {
        to: [contract.to],
        subject: contract.subject || 'BEAP™ Secure Message',
        bodyText: contract.body || '',
        attachments: (contract.attachments || []).map((a) => ({
          filename: a.name,
          mimeType: a.mime || 'application/json',
          contentBase64: Buffer.from(a.data, 'utf-8').toString('base64')
        }))
      }
      const result = await emailGateway.sendEmail(accountId, payload)
      return { ok: true, data: result }
    } catch (error: any) {
      console.error('[Email IPC] sendBeapEmail error:', error)
      return { ok: false, error: error.message }
    }
  })

  // =================================================================
  // Sync Operations
  // =================================================================
  
  /**
   * Sync an account
   */
  ipcMain.handle('email:syncAccount', async (_e, accountId: string) => {
    try {
      const status = await emailGateway.syncAccount(accountId)
      return { ok: true, data: status }
    } catch (error: any) {
      console.error('[Email IPC] syncAccount error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Get sync status
   */
  ipcMain.handle('email:getSyncStatus', async (_e, accountId: string) => {
    try {
      const status = await emailGateway.getSyncStatus(accountId)
      return { ok: true, data: status }
    } catch (error: any) {
      console.error('[Email IPC] getSyncStatus error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  console.log('[Email IPC] Handlers registered')
}

/** Optional: retrieve Anthropic API key for Vision fallback when extraction fails. */
export type GetAnthropicApiKey = () => Promise<string | null>

/** Options shared by inbox:listMessages and inbox:listMessageIds (WHERE clause only). */
type InboxListFilterOptions = {
  filter?: string
  sourceType?: string
  handshakeId?: string
  category?: string
  search?: string
}

/**
 * Build WHERE + bind params for inbox message lists. Must stay aligned across list handlers.
 */
function buildInboxMessagesWhereClause(options: InboxListFilterOptions = {}): { where: string; params: unknown[] } {
  const { filter, sourceType, handshakeId, category, search } = options
  const conditions: string[] = []
  const params: unknown[] = []

  if (filter === 'deleted') conditions.push('deleted = 1')
  else if (filter === 'pending_delete') {
    conditions.push('deleted = 0', 'pending_delete = 1')
  } else if (filter === 'pending_review') {
    conditions.push(
      'deleted = 0',
      'archived = 0',
      '(pending_delete = 0 OR pending_delete IS NULL)',
      'sort_category = ?',
    )
    params.push('pending_review')
  } else if (filter === 'unread') {
    conditions.push('deleted = 0', 'archived = 0', 'read_status = 0', '(pending_delete = 0 OR pending_delete IS NULL)', '(sort_category IS NULL OR sort_category != ?)')
    params.push('pending_review')
  } else if (filter === 'starred') {
    conditions.push('deleted = 0', 'archived = 0', 'starred = 1', '(pending_delete = 0 OR pending_delete IS NULL)', '(sort_category IS NULL OR sort_category != ?)')
    params.push('pending_review')
  } else if (filter === 'archived') {
    conditions.push('archived = 1', 'deleted = 0')
  } else {
    /* all: main inbox — exclude archived, deleted, pending_delete, pending_review */
    conditions.push('deleted = 0', 'archived = 0', '(pending_delete = 0 OR pending_delete IS NULL)', '(sort_category IS NULL OR sort_category != ?)')
    params.push('pending_review')
  }
  if (sourceType) {
    conditions.push('source_type = ?')
    params.push(sourceType)
  }
  if (handshakeId) {
    conditions.push('handshake_id = ?')
    params.push(handshakeId)
  }
  if (category) {
    conditions.push('sort_category = ?')
    params.push(category)
  }
  if (search && search.trim()) {
    const q = `%${search.trim()}%`
    conditions.push('(subject LIKE ? OR body_text LIKE ? OR from_address LIKE ? OR from_name LIKE ?)')
    params.push(q, q, q, q)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  return { where, params }
}

/**
 * Register inbox IPC handlers.
 * Requires db (or getter) and optional mainWindow for sending events.
 * Call from main.ts alongside registerEmailHandlers.
 * When getAnthropicApiKey is provided, PDF extraction will try Vision API fallback when basic extraction fails.
 */
export function registerInboxHandlers(
  getDb: () => Promise<any> | any,
  mainWindow?: BrowserWindow | null,
  getAnthropicApiKey?: GetAnthropicApiKey,
): void {
  const channels = [
    'inbox:syncAccount', 'inbox:toggleAutoSync', 'inbox:getSyncState',
    'inbox:listMessages', 'inbox:listMessageIds', 'inbox:getMessage',
    'inbox:markRead', 'inbox:toggleStar', 'inbox:archiveMessages', 'inbox:setCategory',
    'inbox:deleteMessages', 'inbox:cancelDeletion', 'inbox:getDeletedMessages',
    'inbox:getAttachment', 'inbox:getAttachmentText', 'inbox:openAttachmentOriginal', 'inbox:rasterAttachment',
    'inbox:aiSummarize', 'inbox:aiDraftReply', 'inbox:aiAnalyzeMessage', 'inbox:aiAnalyzeMessageStream', 'inbox:aiClassifySingle', 'inbox:persistManualBulkAnalysis', 'inbox:aiCategorize', 'inbox:enqueueRemoteLifecycleMirror', 'inbox:enqueueRemoteSync', 'inbox:markPendingDelete', 'inbox:moveToPendingReview', 'inbox:cancelPendingDelete', 'inbox:cancelPendingReview', 'inbox:unarchive',
    'inbox:getInboxSettings', 'inbox:setInboxSettings', 'inbox:selectAndUploadContextDoc', 'inbox:deleteContextDoc', 'inbox:listContextDocs',
    'inbox:getAiRules', 'inbox:saveAiRules', 'inbox:getAiRulesDefault',
    'inbox:listRemoteOrchestratorQueue',
    'inbox:reconcileImapRemoteLifecycle',
  ] as const
  channels.forEach((ch) => ipcMain.removeHandler(ch))

  /** ~2000 tokens ≈ 8000 chars */
  const CONTEXT_TOKEN_LIMIT_CHARS = 8000
  const CONTEXT_MAX_TOTAL_BYTES = 10 * 1024 * 1024

  function getInboxSetting(db: any, key: string): any {
    try {
      const row = db.prepare('SELECT value_json FROM inbox_settings WHERE key = ?').get(key) as { value_json?: string } | undefined
      if (!row?.value_json) return undefined
      return JSON.parse(row.value_json)
    } catch {
      return undefined
    }
  }

  function setInboxSetting(db: any, key: string, value: any): void {
    const now = Date.now()
    db.prepare('INSERT OR REPLACE INTO inbox_settings (key, value_json, updated_at) VALUES (?, ?, ?)').run(key, JSON.stringify(value), now)
  }

  function getContextBlockForPrompts(db: any): string {
    const docs = getInboxSetting(db, 'inbox_ai_context_docs') as Array<{ extractedText?: string }> | undefined
    if (!Array.isArray(docs) || docs.length === 0) return ''
    const combined = docs.map((d) => (d.extractedText || '').trim()).filter(Boolean).join('\n\n')
    if (!combined) return ''
    const truncated = combined.length > CONTEXT_TOKEN_LIMIT_CHARS ? combined.slice(0, CONTEXT_TOKEN_LIMIT_CHARS) + '…' : combined
    return `\n## Business Context\n${truncated}\n`
  }

  function getToneAndSortForPrompts(db: any): { tone: string; sortRules: string } {
    const tone = (getInboxSetting(db, 'inbox_ai_tone') as string) || ''
    const sortRules = (getInboxSetting(db, 'inbox_ai_sort_rules') as string) || ''
    return { tone: tone.trim(), sortRules: sortRules.trim() }
  }

  const sendToRenderer = (channel: string, data: any) => {
    const wins = mainWindow ? [mainWindow] : BrowserWindow.getAllWindows()
    wins.forEach((w) => {
      if (!w.isDestroyed() && w.webContents) w.webContents.send(channel, data)
    })
  }

  const resolveDb = async () => (typeof getDb === 'function' ? await getDb() : getDb)

  /**
   * After a successful **local** orchestrator write, enqueue best-effort remote mailbox mutations.
   * Never throws — failures stay in the queue / `remote_orchestrator_last_error` on the message row.
   */
  function fireRemoteOrchestratorSync(db: any, ids: string[], operation: OrchestratorRemoteOperation) {
    if (!db || !ids?.length) return
    try {
      const r = enqueueOrchestratorRemoteMutations(db, ids, operation)
      if (r.enqueued === 0 && r.skipped > 0) {
        console.warn(
          `[Inbox] Remote orchestrator: 0 enqueued, ${r.skipped} skipped (op=${operation}, batch=${ids.length}) — rows may lack account_id/email_message_id, wrong source_type, or missing account`,
        )
      }
      scheduleOrchestratorRemoteDrain(getDb)
    } catch (e) {
      console.warn('[Inbox] Remote orchestrator enqueue failed:', e)
    }
  }

  /**
   * Re-read local lifecycle columns for these inbox row IDs and upsert `remote_orchestrator_mutation_queue`,
   * then schedule chained background drain until the queue is empty (see `scheduleOrchestratorRemoteDrain`).
   */
  async function runEnqueueRemoteLifecycleMirrorFromIds(messageIds: unknown): Promise<
    { ok: true; enqueued: number; skipped: number } | { ok: false; error: string }
  > {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const ids = Array.isArray(messageIds)
        ? messageIds.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
        : []
      const r = ids.length ? enqueueRemoteOpsForLocalLifecycleState(db, ids) : { enqueued: 0, skipped: 0 }
      scheduleOrchestratorRemoteDrain(getDb)
      return { ok: true, enqueued: r.enqueued, skipped: r.skipped }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'enqueue failed' }
    }
  }

  // ── Sync ──
  ipcMain.handle('inbox:syncAccount', async (_e, accountId: string) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }

      let result: Awaited<ReturnType<typeof syncAccountEmails>>
      try {
        result = await syncAccountEmails(db, { accountId, fullSync: true })
      } catch (syncErr: any) {
        console.error('[Inbox] syncAccountEmails threw:', syncErr)
        const msg = syncErr?.message ?? 'Sync failed'
        return {
          ok: false,
          error: msg,
          data: undefined,
          warningCount: 1,
          syncWarnings: [msg],
        }
      }

      try {
        processPendingPlainEmails(db)
      } catch (e: any) {
        console.warn('[Inbox] Plain email post-sync processing:', e?.message)
      }
      try {
        processPendingP2PBeapEmails(db)
      } catch (e: any) {
        console.warn('[Inbox] BEAP post-sync processing:', e?.message)
      }

      try {
        if (result.newInboxMessageIds?.length) {
          enqueueRemoteOpsForLocalLifecycleState(db, result.newInboxMessageIds)
        }
        scheduleOrchestratorRemoteDrain(resolveDb)
      } catch (e: any) {
        console.warn('[Inbox] Post-pull remote mailbox mirror:', e?.message)
        try {
          scheduleOrchestratorRemoteDrain(resolveDb)
        } catch {
          /* ignore */
        }
      }

      const errors = result.errors ?? []
      const warnCount = errors.length

      if (!result.ok) {
        return {
          ok: false,
          error: errors[0] ?? 'Sync failed',
          data: result,
          warningCount: warnCount,
          syncWarnings: errors,
        }
      }

      if (result.newMessages === 0 && warnCount > 0) {
        return {
          ok: false,
          error: 'All messages failed to sync',
          data: result,
          warningCount: warnCount,
          syncWarnings: errors,
        }
      }

      if (result.newMessages > 0) {
        try {
          sendToRenderer('inbox:newMessages', result)
        } catch (e: any) {
          console.warn('[Inbox] sendToRenderer inbox:newMessages:', e?.message)
        }
      }

      if (warnCount > 0) {
        return {
          ok: true,
          data: result,
          warningCount: warnCount,
          syncWarnings: errors,
        }
      }

      return { ok: true, data: result }
    } catch (err: any) {
      console.error('[Inbox] inbox:syncAccount unhandled error:', err)
      return { ok: false, error: err?.message ?? 'Sync failed (unhandled)' }
    }
  })

  ipcMain.handle('inbox:toggleAutoSync', async (_e, accountId: string, enabled: boolean) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      updateSyncState(db, accountId, { auto_sync_enabled: enabled ? 1 : 0 })
      const existing = activeAutoSyncLoops.get(accountId)
      if (existing) {
        existing.stop()
        activeAutoSyncLoops.delete(accountId)
      }
      if (enabled) {
        const row = db.prepare('SELECT sync_interval_ms FROM email_sync_state WHERE account_id = ?').get(accountId) as { sync_interval_ms?: number } | undefined
        const intervalMs = row?.sync_interval_ms ?? 30_000
        const loop = startAutoSync(db, accountId, intervalMs, (result) => {
          if (result.newMessages > 0) sendToRenderer('inbox:newMessages', result)
        }, resolveDb)
        activeAutoSyncLoops.set(accountId, loop)
      }
      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Toggle failed' }
    }
  })

  ipcMain.handle('inbox:getSyncState', async (_e, accountId: string) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const row = db.prepare('SELECT * FROM email_sync_state WHERE account_id = ?').get(accountId)
      return { ok: true, data: row ?? null }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Failed' }
    }
  })

  /** Resume auto-sync loops after app restart (rows with auto_sync_enabled = 1). */
  void (async () => {
    try {
      const db = await resolveDb()
      if (!db) return
      const rows = db
        .prepare('SELECT account_id, sync_interval_ms FROM email_sync_state WHERE auto_sync_enabled = 1')
        .all() as Array<{ account_id: string; sync_interval_ms?: number }>
      for (const r of rows) {
        if (activeAutoSyncLoops.has(r.account_id)) continue
        const intervalMs = r.sync_interval_ms ?? 30_000
        const loop = startAutoSync(db, r.account_id, intervalMs, (syncRes) => {
          if (syncRes.newMessages > 0) sendToRenderer('inbox:newMessages', syncRes)
        }, resolveDb)
        activeAutoSyncLoops.set(r.account_id, loop)
        console.log('[Inbox] Resumed auto-sync loop for account', r.account_id, 'interval', intervalMs)
      }
    } catch (e) {
      console.warn('[Inbox] Failed to resume auto-sync loops:', (e as Error)?.message)
    }
  })()

  // ── Messages ──
  ipcMain.handle('inbox:listMessages', async (_e, options: InboxListFilterOptions & {
    limit?: number
    offset?: number
  } = {}) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const { limit = 50, offset = 0, ...filterOpts } = options ?? {}
      const { where, params } = buildInboxMessagesWhereClause(filterOpts)
      const countRow = db.prepare(`SELECT COUNT(*) as total FROM inbox_messages ${where}`).get(...params) as { total: number }
      const total = countRow?.total ?? 0

      const qParams = [...params, limit, offset]
      const rows = db.prepare(
        `SELECT * FROM inbox_messages ${where} ORDER BY received_at DESC LIMIT ? OFFSET ?`
      ).all(...qParams) as any[]

      for (const m of rows) {
        if (m.has_attachments === 1) {
          const atts = db.prepare('SELECT * FROM inbox_attachments WHERE message_id = ?').all(m.id) as any[]
          m.attachments = atts
        } else {
          m.attachments = []
        }
      }

      return { ok: true, data: { messages: rows, total } }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'List failed' }
    }
  })

  /** IDs only — same filters as listMessages; for bulk selection / verification without full row payload. */
  ipcMain.handle('inbox:listMessageIds', async (_e, options: InboxListFilterOptions & {
    limit?: number
    offset?: number
  } = {}) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const { limit = 500, offset = 0, ...filterOpts } = options ?? {}
      const { where, params } = buildInboxMessagesWhereClause(filterOpts)
      const countRow = db.prepare(`SELECT COUNT(*) as total FROM inbox_messages ${where}`).get(...params) as { total: number }
      const total = countRow?.total ?? 0
      const qParams = [...params, limit, offset]
      const idRows = db.prepare(
        `SELECT id FROM inbox_messages ${where} ORDER BY received_at DESC LIMIT ? OFFSET ?`
      ).all(...qParams) as { id: string }[]
      return { ok: true, data: { ids: idRows.map((r) => r.id), total } }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'List ids failed' }
    }
  })

  ipcMain.handle('inbox:getMessage', async (_e, messageId: string) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const row = db.prepare('SELECT * FROM inbox_messages WHERE id = ?').get(messageId) as any
      if (!row) return { ok: false, error: 'Message not found' }
      const atts = db.prepare('SELECT * FROM inbox_attachments WHERE message_id = ?').all(messageId) as any[]
      row.attachments = atts
      db.prepare('UPDATE inbox_messages SET read_status = 1 WHERE id = ?').run(messageId)
      return { ok: true, data: row }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Get failed' }
    }
  })

  // ── Actions ──
  ipcMain.handle('inbox:markRead', async (_e, messageIds: string[], read: boolean) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const stmt = db.prepare('UPDATE inbox_messages SET read_status = ? WHERE id = ?')
      for (const id of messageIds ?? []) stmt.run(read ? 1 : 0, id)
      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Mark failed' }
    }
  })

  ipcMain.handle('inbox:toggleStar', async (_e, messageId: string) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const row = db.prepare('SELECT starred FROM inbox_messages WHERE id = ?').get(messageId) as { starred?: number } | undefined
      const next = row?.starred === 1 ? 0 : 1
      db.prepare('UPDATE inbox_messages SET starred = ? WHERE id = ?').run(next, messageId)
      return { ok: true, data: { starred: next === 1 } }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Toggle failed' }
    }
  })

  ipcMain.handle('inbox:archiveMessages', async (_e, messageIds: string[]) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const ids = messageIds ?? []
      const stmt = db.prepare('UPDATE inbox_messages SET archived = 1 WHERE id = ?')
      for (const id of ids) stmt.run(id)
      fireRemoteOrchestratorSync(db, ids, 'archive')
      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Archive failed' }
    }
  })

  ipcMain.handle('inbox:setCategory', async (_e, messageIds: string[], category: string) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const ids = messageIds ?? []
      const stmt = db.prepare('UPDATE inbox_messages SET sort_category = ? WHERE id = ?')
      for (const id of ids) stmt.run(category ?? null, id)
      const cat = (category ?? '').trim()
      if (cat === 'pending_review') {
        fireRemoteOrchestratorSync(db, ids, 'pending_review')
      }
      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Set category failed' }
    }
  })

  // ── Deletion ──
  ipcMain.handle('inbox:deleteMessages', async (_e, messageIds: string[], gracePeriodHours?: number) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const result = bulkQueueDeletion(db, messageIds ?? [], gracePeriodHours ?? 72)
      return { ok: true, data: result }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Delete failed' }
    }
  })

  ipcMain.handle('inbox:cancelDeletion', async (_e, messageId: string) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const cancelled = cancelRemoteDeletion(db, messageId)
      return { ok: true, data: { cancelled } }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Cancel failed' }
    }
  })

  ipcMain.handle('inbox:getDeletedMessages', async () => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const rows = db.prepare(
        `SELECT m.*, dq.grace_period_ends, dq.executed, dq.cancelled, dq.execution_error
         FROM inbox_messages m
         LEFT JOIN deletion_queue dq ON dq.message_id = m.id
         WHERE m.deleted = 1
         ORDER BY m.deleted_at DESC`
      ).all() as any[]
      return { ok: true, data: rows }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Get failed' }
    }
  })

  // ── Attachments ──
  ipcMain.handle('inbox:getAttachment', async (_e, attachmentId: string) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const row = db.prepare('SELECT * FROM inbox_attachments WHERE id = ?').get(attachmentId) as any
      if (!row) return { ok: false, error: 'Attachment not found' }
      return { ok: true, data: row }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Get failed' }
    }
  })

  ipcMain.handle('inbox:getAttachmentText', async (_e, attachmentId: string) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const row = db.prepare('SELECT * FROM inbox_attachments WHERE id = ?').get(attachmentId) as any
      if (!row) return { ok: false, error: 'Attachment not found' }
      if (row.text_extraction_status === 'done' && row.extracted_text) {
        return { ok: true, data: { text: row.extracted_text, status: 'done' } }
      }
      if (row.text_extraction_status === 'done' && !row.extracted_text) {
        return { ok: true, data: { text: '', status: 'done' } }
      }
      if (row.text_extraction_status === 'skipped' || row.text_extraction_status === 'failed') {
        return { ok: true, data: { text: '', status: row.text_extraction_status } }
      }
      if (row.storage_path && fs.existsSync(row.storage_path) && isPdfFile(row.content_type || '', row.filename)) {
        const buf = fs.readFileSync(row.storage_path)
        let result = await extractPdfText(buf)
        let text = result?.text ?? ''
        let status = result?.success ? 'done' : 'failed'

        // Vision fallback: when basic extraction fails or yields unusable text, try Anthropic Vision if API key available
        const minUsableChars = 30
        const needsFallback = !result?.success || (text.replace(/\s/g, '').length < minUsableChars)
        if (needsFallback && getAnthropicApiKey) {
          const apiKey = await getAnthropicApiKey()
          if (apiKey?.trim()?.startsWith('sk-ant-')) {
            try {
              const visionResult = await extractPdfTextWithVisionApi(buf, apiKey.trim())
              if (visionResult.success && visionResult.text) {
                text = visionResult.text
                status = 'done'
                result = { ...result, success: true, text }
              }
            } catch (visionErr: any) {
              console.warn('[Inbox IPC] Vision fallback failed:', visionErr?.message)
            }
          }
        }

        db.prepare('UPDATE inbox_attachments SET extracted_text = ?, text_extraction_status = ? WHERE id = ?')
          .run(text, status, attachmentId)

        // Merge extracted_text into depackaged_json so BEAP/depackaged attachment structure includes it
        const messageId = row.message_id
        if (messageId && text) {
          try {
            const msgRow = db.prepare('SELECT depackaged_json FROM inbox_messages WHERE id = ?').get(messageId) as { depackaged_json?: string } | undefined
            const depackaged = msgRow?.depackaged_json
            if (depackaged) {
              const parsed = JSON.parse(depackaged) as { attachments?: Array<{ content_id?: string; extracted_text?: string }> }
              if (Array.isArray(parsed.attachments)) {
                let updated = false
                for (const att of parsed.attachments) {
                  if (att.content_id === attachmentId) {
                    att.extracted_text = text
                    updated = true
                    break
                  }
                }
                if (updated) {
                  db.prepare('UPDATE inbox_messages SET depackaged_json = ? WHERE id = ?').run(JSON.stringify(parsed), messageId)
                }
              }
            }
          } catch (mergeErr: any) {
            console.warn('[Inbox IPC] Failed to merge extracted_text into depackaged:', mergeErr?.message)
          }
        }

        return { ok: true, data: { text, status } }
      }
      db.prepare('UPDATE inbox_attachments SET text_extraction_status = ? WHERE id = ?').run('skipped', attachmentId)
      return { ok: true, data: { text: '', status: 'skipped' } }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Extract failed' }
    }
  })

  ipcMain.handle('inbox:openAttachmentOriginal', async (_e, attachmentId: string) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const row = db.prepare('SELECT storage_path FROM inbox_attachments WHERE id = ?').get(attachmentId) as { storage_path?: string } | undefined
      if (!row?.storage_path || !fs.existsSync(row.storage_path)) {
        return { ok: false, error: 'Attachment file not found' }
      }
      const result = await shell.openPath(row.storage_path)
      return { ok: true, data: { opened: result === '' } }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Open failed' }
    }
  })

  ipcMain.handle('inbox:rasterAttachment', async (_e, attachmentId: string) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const row = db.prepare('SELECT * FROM inbox_attachments WHERE id = ?').get(attachmentId) as any
      if (!row) return { ok: false, error: 'Attachment not found' }
      return { ok: true, data: { rasterPageData: [], status: 'placeholder' } }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Raster failed' }
    }
  })

  // ── AI (real LLM calls) ──
  ipcMain.handle('inbox:aiSummarize', async (_e, messageId: string) => {
    console.log('[AI-SUMMARIZE] Starting for message:', messageId)
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const row = db.prepare('SELECT from_address, from_name, subject, body_text, received_at FROM inbox_messages WHERE id = ?').get(messageId) as { from_address?: string; from_name?: string; subject?: string; body_text?: string; received_at?: string } | undefined
      if (!row) return { ok: false, error: 'Message not found' }
      console.log('[AI-SUMMARIZE] Message fetched:', { from: row.from_address, subject: row.subject, bodyLength: (row.body_text ?? '').length })

      const available = await isOllamaAvailable()
      if (!available) {
        return { ok: true, data: { summary: 'Error: LLM not available. Check Ollama status.', error: true } }
      }

      const sender = row.from_name ? `${row.from_name} <${row.from_address || ''}>` : (row.from_address || 'Unknown')
      const body = (row.body_text || '').trim().slice(0, 8000)
      const userPrompt = `From: ${sender}\nSubject: ${row.subject || '(No subject)'}\nDate: ${row.received_at || '—'}\n\n${body}`

      const systemPrompt = 'You are an AI assistant for WR Desk inbox. Summarize the following email concisely in 2-3 sentences. Focus on: who sent it, what they want, and any action required.'
      console.log('[AI-SUMMARIZE] System prompt length:', systemPrompt.length)
      console.log('[AI-SUMMARIZE] Calling LLM...')
      const summary = await callInboxOllamaChat(systemPrompt, userPrompt)
      console.log('[AI-SUMMARIZE] Raw LLM response:', summary.substring(0, 500))

      /** Persist to ai_analysis_json so analysis survives clearBulkAiOutputsForIds. */
      const existingRow = db.prepare('SELECT ai_analysis_json FROM inbox_messages WHERE id = ?').get(messageId) as { ai_analysis_json?: string | null } | undefined
      let merged: Record<string, unknown> = {}
      if (existingRow?.ai_analysis_json) {
        try {
          merged = JSON.parse(existingRow.ai_analysis_json) as Record<string, unknown>
        } catch { /* ignore */ }
      }
      merged.summary = summary.slice(0, 1000)
      merged.status = merged.status ?? 'summarized'
      db.prepare('UPDATE inbox_messages SET ai_analysis_json = ? WHERE id = ?').run(JSON.stringify(merged), messageId)

      return { ok: true, data: { summary } }
    } catch (err: any) {
      const isTimeout = err?.message?.startsWith('LLM_TIMEOUT')
      return {
        ok: false,
        error: isTimeout ? 'timeout' : 'llm_error',
        message: err?.message ?? 'Unknown error',
      }
    }
  })

  ipcMain.handle('inbox:aiDraftReply', async (_e, messageId: string) => {
    console.log('[AI-DRAFT] Starting for message:', messageId)
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const row = db.prepare('SELECT from_address, from_name, subject, body_text FROM inbox_messages WHERE id = ?').get(messageId) as { from_address?: string; from_name?: string; subject?: string; body_text?: string } | undefined
      if (!row) return { ok: false, error: 'Message not found' }
      console.log('[AI-DRAFT] Message fetched:', { from: row.from_address, subject: row.subject, bodyLength: (row.body_text ?? '').length })

      const available = await isOllamaAvailable()
      if (!available) {
        return { ok: true, data: { draft: 'Error: LLM not available. Check Ollama status.', error: true } }
      }

      const sender = row.from_name ? `${row.from_name} <${row.from_address || ''}>` : (row.from_address || 'Unknown')
      const body = (row.body_text || '').trim().slice(0, 8000)
      const userPrompt = `Original email:\nFrom: ${sender}\nSubject: ${row.subject || '(No subject)'}\n\n${body}\n\nDraft a reply:`

      const { tone } = getToneAndSortForPrompts(db)
      const contextBlock = getContextBlockForPrompts(db)
      let systemPrompt = 'You are an AI assistant for WR Desk inbox. Draft a professional reply to the following email. Match the language of the original email (if the email is in German, reply in German). Keep it concise. Output ONLY the reply text, no subject line, no metadata.'
      if (tone) systemPrompt += `\n\nUser instructions for response tone and style: ${tone}`
      if (contextBlock) systemPrompt += contextBlock
      console.log('[AI-DRAFT] System prompt length:', systemPrompt.length)
      console.log('[AI-DRAFT] Calling LLM...')
      const draft = await callInboxOllamaChat(systemPrompt, userPrompt)
      console.log('[AI-DRAFT] Raw LLM response:', draft.substring(0, 500))

      /** Persist to ai_analysis_json so analysis survives clearBulkAiOutputsForIds. */
      const existingRow = db.prepare('SELECT ai_analysis_json FROM inbox_messages WHERE id = ?').get(messageId) as { ai_analysis_json?: string | null } | undefined
      let merged: Record<string, unknown> = {}
      if (existingRow?.ai_analysis_json) {
        try {
          merged = JSON.parse(existingRow.ai_analysis_json) as Record<string, unknown>
        } catch { /* ignore */ }
      }
      merged.draftReply = draft.slice(0, 8000)
      merged.status = merged.status ?? 'draft_reply'
      db.prepare('UPDATE inbox_messages SET ai_analysis_json = ? WHERE id = ?').run(JSON.stringify(merged), messageId)

      return { ok: true, data: { draft } }
    } catch (err: any) {
      const isTimeout = err?.message?.startsWith('LLM_TIMEOUT')
      return {
        ok: false,
        error: isTimeout ? 'timeout' : 'llm_error',
        message: err?.message ?? 'Unknown error',
      }
    }
  })

  ipcMain.handle('inbox:aiAnalyzeMessage', async (_e, messageId: string) => {
    console.log('[AI-ANALYZE] Starting for message:', messageId)
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const row = db.prepare('SELECT from_address, from_name, subject, body_text, received_at FROM inbox_messages WHERE id = ?').get(messageId) as { from_address?: string; from_name?: string; subject?: string; body_text?: string; received_at?: string } | undefined
      if (!row) return { ok: false, error: 'Message not found' }
      console.log('[AI-ANALYZE] Message fetched:', { from: row.from_address, subject: row.subject, bodyLength: (row.body_text ?? '').length })

      const available = await isOllamaAvailable()
      if (!available) {
        return { ok: true, data: { error: 'LLM not available. Check Ollama status.' } }
      }

      const sender = row.from_name ? `${row.from_name} <${row.from_address || ''}>` : (row.from_address || 'Unknown')
      const body = (row.body_text || '').trim().slice(0, 8000)
      const userPrompt = `From: ${sender}\nSubject: ${row.subject || '(No subject)'}\nDate: ${row.received_at || '—'}\n\n${body}`

      const { tone, sortRules } = getToneAndSortForPrompts(db)
      const contextBlock = getContextBlockForPrompts(db)
      let systemPrompt = `You are an email triage AI for WR Desk. Analyze the following email and respond with a JSON object only. Use these exact keys:
- needsReply: boolean — true if the user should respond to this email
- needsReplyReason: string — one sentence explaining why (e.g. "No — this is an automated notification" or "Yes — sender is asking for clarification")
- summary: string — 2-3 sentence summary of the message
- urgencyScore: number — 1-10 (1=low, 10=critical)
- urgencyReason: string — one sentence explaining the urgency
- actionItems: string[] — bullet list of extracted action items (empty array if none)
- archiveRecommendation: "archive" | "keep" — whether to archive or keep in inbox
- archiveReason: string — one sentence explaining the recommendation
- draftReply: string | null — if needsReply is true, write a professional, concise draft reply here. If needsReply is false, set draftReply to null.

Respond ONLY with valid JSON. No markdown, no backticks, no preamble, no explanation.`
      if (tone) systemPrompt += `\n\nUser instructions for response tone and style: ${tone}`
      if (sortRules) systemPrompt += `\n\nUser custom sorting rules: ${sortRules}`
      if (contextBlock) systemPrompt += contextBlock

      console.log('[AI-ANALYZE] System prompt length:', systemPrompt.length)
      console.log('[AI-ANALYZE] Calling LLM...')
      const raw = await callInboxOllamaChat(systemPrompt, userPrompt)
      console.log('[AI-ANALYZE] Raw LLM response:', raw.substring(0, 500))
      const parsed = parseAiJson(raw) as {
        needsReply?: boolean
        needsReplyReason?: string
        summary?: string
        urgencyScore?: number
        urgencyReason?: string
        actionItems?: string[]
        archiveRecommendation?: string
        archiveReason?: string
        draftReply?: string | null
      }

      const parseFailed = !parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0
      let needsReply = parseFailed ? false : !!parsed.needsReply
      const needsReplyReason = (parseFailed ? 'Could not analyze' : (parsed.needsReplyReason ?? '')).slice(0, 300)
      const summary = (parseFailed ? 'Analysis failed — could not parse AI response' : (parsed.summary ?? '')).slice(0, 1000)
      let urgencyScore = parseFailed ? 5 : (typeof parsed.urgencyScore === 'number' ? Math.max(1, Math.min(10, parsed.urgencyScore)) : 5)
      let urgencyReason = (parseFailed ? 'Unknown' : (parsed.urgencyReason ?? '')).slice(0, 300)
      if (!parseFailed) {
        const tri = reconcileAnalyzeTriage(
          { urgencyScore, needsReply, urgencyReason, summary },
          { subject: row.subject, body: row.body_text ?? '' }
        )
        urgencyScore = tri.urgencyScore
        needsReply = tri.needsReply
      }
      const actionItems = parseFailed ? [] : (Array.isArray(parsed.actionItems) ? parsed.actionItems.filter((x): x is string => typeof x === 'string').slice(0, 10) : [])
      const archiveRecommendation = parseFailed ? 'keep' : (parsed.archiveRecommendation === 'archive' ? 'archive' : 'keep')
      const archiveReason = (parseFailed ? 'Could not determine' : (parsed.archiveReason ?? '')).slice(0, 300)
      const draftReply =
        parseFailed || !needsReply
          ? null
          : typeof parsed.draftReply === 'string'
            ? parsed.draftReply.slice(0, 8000)
            : null

      console.log('[AI-ANALYZE] Parsed result:', JSON.stringify({ needsReply, needsReplyReason: needsReplyReason.slice(0, 80), summary: summary.slice(0, 80), urgencyScore, archiveRecommendation, hasDraftReply: !!draftReply }).slice(0, 500))

      return {
        ok: true,
        data: {
          needsReply,
          needsReplyReason,
          summary,
          urgencyScore,
          urgencyReason,
          actionItems,
          archiveRecommendation,
          archiveReason,
          draftReply,
        },
      }
    } catch (err: any) {
      console.error('[Inbox IPC] aiAnalyzeMessage error:', err)
      const isTimeout = err?.message?.startsWith('LLM_TIMEOUT')
      return {
        ok: false,
        error: isTimeout ? 'timeout' : 'llm_error',
        message: err?.message ?? 'Unknown error',
      }
    }
  })

  ipcMain.handle('inbox:aiAnalyzeMessageStream', async (event, messageId: string) => {
    console.log('[AI-ANALYZE-STREAM] Starting for message:', messageId)
    try {
      const db = await resolveDb()
      if (!db) {
        event.sender.send('inbox:aiAnalyzeMessageError', { messageId, error: 'llm_error', message: 'Database unavailable' })
        return { started: false }
      }
      const row = db.prepare('SELECT from_address, from_name, subject, body_text, received_at FROM inbox_messages WHERE id = ?').get(messageId) as { from_address?: string; from_name?: string; subject?: string; body_text?: string; received_at?: string } | undefined
      if (!row) {
        event.sender.send('inbox:aiAnalyzeMessageError', { messageId, error: 'llm_error', message: 'Message not found' })
        return { started: false }
      }

      const available = await isOllamaAvailable()
      if (!available) {
        event.sender.send('inbox:aiAnalyzeMessageError', { messageId, error: 'llm_error', message: 'LLM not available. Check Ollama status.' })
        return { started: false }
      }

      const sender = row.from_name ? `${row.from_name} <${row.from_address || ''}>` : (row.from_address || 'Unknown')
      const body = (row.body_text || '').trim().slice(0, 8000)
      const userPrompt = `From: ${sender}\nSubject: ${row.subject || '(No subject)'}\nDate: ${row.received_at || '—'}\n\n${body}`

      const { tone, sortRules } = getToneAndSortForPrompts(db)
      const contextBlock = getContextBlockForPrompts(db)
      let systemPrompt = `You are an email triage AI for WR Desk. Analyze the following email and respond with a JSON object only. Use these exact keys:
- needsReply: boolean — true if the user should respond to this email
- needsReplyReason: string — one sentence explaining why (e.g. "No — this is an automated notification" or "Yes — sender is asking for clarification")
- summary: string — 2-3 sentence summary of the message
- urgencyScore: number — 1-10 (1=low, 10=critical)
- urgencyReason: string — one sentence explaining the urgency
- actionItems: string[] — bullet list of extracted action items (empty array if none)
- archiveRecommendation: "archive" | "keep" — whether to archive or keep in inbox
- archiveReason: string — one sentence explaining the recommendation
- draftReply: string | null — if needsReply is true, write a professional, concise draft reply here. If needsReply is false, set draftReply to null.

Respond ONLY with valid JSON. No markdown, no backticks, no preamble, no explanation.`
      if (tone) systemPrompt += `\n\nUser instructions for response tone and style: ${tone}`
      if (sortRules) systemPrompt += `\n\nUser custom sorting rules: ${sortRules}`
      if (contextBlock) systemPrompt += contextBlock

      const stream = callInboxOllamaChatStream(systemPrompt, userPrompt)
      for await (const chunk of stream) {
        if (event.sender.isDestroyed()) break
        event.sender.send('inbox:aiAnalyzeMessageChunk', { messageId, chunk })
      }
      if (!event.sender.isDestroyed()) {
        event.sender.send('inbox:aiAnalyzeMessageDone', { messageId })
      }
    } catch (err: any) {
      console.error('[Inbox IPC] aiAnalyzeMessageStream error:', err)
      const isTimeout = err?.message?.startsWith('LLM_TIMEOUT')
      if (!event.sender.isDestroyed()) {
        event.sender.send('inbox:aiAnalyzeMessageError', {
          messageId,
          error: isTimeout ? 'timeout' : 'llm_error',
          message: err?.message ?? 'Unknown error',
        })
      }
    }
    return { started: true }
  })

  /** Per-message classification — used by both aiClassifySingle and aiCategorize. */
  async function classifySingleMessage(messageId: string): Promise<{
    messageId: string
    category?: string
    urgency?: number
    needsReply?: boolean
    summary?: string
    reason?: string
    draftReply?: string | null
    recommended_action?: string
    pending_delete?: boolean
    pending_review?: boolean
    error?: string
  }> {
    const db = await resolveDb()
    if (!db) return { messageId, error: 'Database unavailable' }
    const row = db.prepare('SELECT from_address, from_name, subject, body_text FROM inbox_messages WHERE id = ?').get(messageId) as { from_address?: string; from_name?: string; subject?: string; body_text?: string } | undefined
    if (!row) return { messageId, error: 'not_found' }

    const available = await isOllamaAvailable()
    if (!available) return { messageId, error: 'llm_unavailable' }

    const userRules = getInboxAiRulesForPrompt()
    const systemPrompt = `${userRules}

Return ONLY a JSON object with this exact shape — no explanation, no markdown:
{
  "category": "pending_delete" | "pending_review" | "archive" | "urgent" | "action_required" | "normal",
  "urgency": <number 1-10>,
  "needsReply": <boolean>,
  "summary": "<one sentence>",
  "reason": "<one sentence>",
  "draftReply": "<draft reply or null>"
}`

    const from = row.from_name ? `${row.from_name} <${row.from_address || ''}>` : (row.from_address || 'Unknown')
    /** Short body keeps Auto-Sort fast; subject + sender carry most triage signal. */
    const userPrompt = `Classify this email:
From: ${from}
Subject: ${row.subject || '(No subject)'}
Body (first 500 chars): ${(row.body_text ?? '').slice(0, 500)}`

    try {
      const raw = await Promise.race([
        callInboxOllamaChat(systemPrompt, userPrompt),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('LLM_TIMEOUT')), INBOX_LLM_TIMEOUT_MS)
        ),
      ])
      const parsed = parseAiJson(raw) as {
        category?: string
        urgency?: number
        needsReply?: boolean
        summary?: string
        reason?: string
        draftReply?: string | null
      }
      if (!parsed?.category) return { messageId, error: 'parse_failed', reason: raw?.slice?.(0, 200) }

      const cat = String(parsed.category).toLowerCase()
      const VALID_NEW = ['pending_delete', 'pending_review', 'archive', 'urgent', 'action_required', 'normal'] as const
      let validCategory = VALID_NEW.includes(cat as any) ? cat : 'normal'
      let urgency = typeof parsed.urgency === 'number' ? Math.max(1, Math.min(10, parsed.urgency)) : 5
      let needsReply = !!parsed.needsReply
      let reason = (parsed.reason ?? '').slice(0, 500)
      const summary = (parsed.summary ?? '').slice(0, 500)

      /** WRExpert coherence: promotional / unsolicited cannot be urgent+critical. */
      const reco = reconcileInboxClassification(
        { category: validCategory, urgency, needsReply, reason, summary },
        { subject: row.subject, body: row.body_text ?? '' }
      )
      validCategory = reco.category
      urgency = reco.urgency
      needsReply = reco.needsReply
      reason = reco.reason.slice(0, 500)

      const sortCategoryMap: Record<string, string> = {
        pending_delete: 'spam',
        pending_review: 'pending_review',
        archive: 'newsletter',
        urgent: 'urgent',
        action_required: 'important',
        normal: 'normal',
      }
      const sortCategory = sortCategoryMap[validCategory] ?? 'normal'
      const recommendedAction =
        validCategory === 'pending_delete' ? 'pending_delete'
        : validCategory === 'pending_review' ? 'pending_review'
        : validCategory === 'archive' ? 'archive'
        : validCategory === 'urgent' && needsReply ? 'draft_reply_ready'
        : validCategory === 'action_required' && needsReply ? 'draft_reply_ready'
        : 'keep_for_manual_action'
      let pendingDelete = validCategory === 'pending_delete'
      let pendingReview = validCategory === 'pending_review'

      /** Urgent messages (urgency >= 7) stay unsorted — never move to pending_delete, pending_review, or archived. */
      const URGENCY_THRESHOLD = 7
      const isUrgent = urgency >= URGENCY_THRESHOLD
      if (isUrgent) {
        pendingDelete = false
        pendingReview = false
      }

      /** Always write sort_category, urgency, needs_reply. For urgent: use 'urgent', never add pending_review_at. */
      const effectiveSortCategory = isUrgent ? 'urgent' : sortCategory
      const nowIso = new Date().toISOString()
      if (isUrgent) {
        db.prepare(
          `UPDATE inbox_messages SET archived = 0, pending_delete = 0, pending_delete_at = NULL, pending_review_at = NULL,
           sort_category = ?, sort_reason = ?, urgency_score = ?, needs_reply = ? WHERE id = ?`,
        ).run(effectiveSortCategory, reason || null, urgency, needsReply ? 1 : 0, messageId)
      } else if (pendingReview) {
        db.prepare(
          `UPDATE inbox_messages SET archived = 0, pending_delete = 0, pending_delete_at = NULL,
           sort_category = ?, sort_reason = ?, urgency_score = ?, needs_reply = ?, pending_review_at = ? WHERE id = ?`,
        ).run(effectiveSortCategory, reason || null, urgency, needsReply ? 1 : 0, nowIso, messageId)
      } else if (validCategory === 'archive') {
        db.prepare(
          `UPDATE inbox_messages SET archived = 1, pending_delete = 0, pending_delete_at = NULL, pending_review_at = NULL,
           sort_category = ?, sort_reason = ?, urgency_score = ?, needs_reply = ? WHERE id = ?`,
        ).run(effectiveSortCategory, reason || null, urgency, needsReply ? 1 : 0, messageId)
      } else if (pendingDelete) {
        db.prepare(
          `UPDATE inbox_messages SET archived = 0, pending_delete = 1, pending_delete_at = ?, pending_review_at = NULL,
           sort_category = ?, sort_reason = ?, urgency_score = ?, needs_reply = ? WHERE id = ?`,
        ).run(nowIso, effectiveSortCategory, reason || null, urgency, needsReply ? 1 : 0, messageId)
      } else {
        db.prepare(
          `UPDATE inbox_messages SET archived = 0, pending_delete = 0, pending_delete_at = NULL,
           sort_category = ?, sort_reason = ?, urgency_score = ?, needs_reply = ? WHERE id = ?`,
        ).run(effectiveSortCategory, reason || null, urgency, needsReply ? 1 : 0, messageId)
      }

      /** Persist AI analysis for sorted messages — survives clearBulkAiOutputsForIds. */
      const aiAnalysisJson = JSON.stringify({
        category: effectiveSortCategory,
        urgencyScore: urgency,
        urgencyReason: reason || '',
        summary: summary || '',
        reason: reason || '',
        needsReply,
        needsReplyReason: needsReply ? (reason || 'Reply warranted.') : 'No reply needed.',
        recommendedAction: isUrgent ? 'keep_for_manual_action' : recommendedAction,
        actionExplanation: reason || '',
        actionItems: [],
        draftReply: needsReply ? (parsed.draftReply ?? null) : null,
        status: 'classified',
      })
      db.prepare('UPDATE inbox_messages SET ai_analysis_json = ? WHERE id = ?').run(aiAnalysisJson, messageId)

      const effectiveRecommendedAction = isUrgent ? 'keep_for_manual_action' : recommendedAction

      if (!isUrgent) {
        if (pendingReview) fireRemoteOrchestratorSync(db, [messageId], 'pending_review')
        if (pendingDelete) fireRemoteOrchestratorSync(db, [messageId], 'pending_delete')
        if (validCategory === 'archive') fireRemoteOrchestratorSync(db, [messageId], 'archive')
      }

      return {
        messageId,
        category: effectiveSortCategory,
        urgency,
        needsReply,
        summary,
        reason,
        draftReply: needsReply ? (parsed.draftReply ?? null) : null,
        recommended_action: effectiveRecommendedAction,
        pending_delete: pendingDelete,
        pending_review: pendingReview,
      }
    } catch (err: any) {
      return {
        messageId,
        error: err?.message?.includes?.('LLM_TIMEOUT') ? 'timeout' : 'llm_error',
      }
    }
  }

  ipcMain.handle('inbox:aiClassifySingle', async (_e, messageId: string) => {
    const out = await classifySingleMessage(messageId)
    try {
      const db = await resolveDb()
      if (db) {
        scheduleOrchestratorRemoteDrain(resolveDb)
      }
    } catch (e: any) {
      console.warn('[Inbox] Post-aiClassifySingle remote schedule:', e?.message)
    }
    return out
  })

  /**
   * Manual bulk “Analyze” only: persist advisory analysis JSON without touching sort_category,
   * needs_reply, urgency_score, or triggering any auto-move.
   */
  ipcMain.handle('inbox:persistManualBulkAnalysis', async (_e, messageId: string, analysisJson: string) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      JSON.parse(analysisJson)
      db.prepare('UPDATE inbox_messages SET ai_analysis_json = ? WHERE id = ?').run(analysisJson, messageId)
      return { ok: true }
    } catch (e: any) {
      console.warn('[Inbox IPC] persistManualBulkAnalysis failed:', e?.message)
      return { ok: false, error: e?.message ?? 'persist failed' }
    }
  })

  ipcMain.handle('inbox:aiCategorize', async (_e, messageIds: string[]) => {
    const ids = messageIds ?? []
    console.log('[AI-CATEGORIZE] Starting for', ids.length, 'messages (per-message, concurrency 3):', ids.slice(0, 3))
    if (ids.length === 0) return { ok: true, data: { classifications: [] } }
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }

      const available = await isOllamaAvailable()
      if (!available) {
        const errMsg = 'LLM not available. Check Ollama status.'
        return {
          ok: true,
          data: {
            classifications: ids.map((id) => ({
              id,
              category: 'normal',
              summary: '',
              reason: errMsg,
              needs_reply: false,
              needs_reply_reason: errMsg,
              urgency_score: 5,
              urgency_reason: errMsg,
              recommended_action: 'keep_for_manual_action',
              action_explanation: errMsg,
              action_items: [],
              pending_delete: false,
              classification_failed: true,
            })),
            error: errMsg,
          },
        }
      }

      const CONCURRENCY = 3
      const classifications: Array<{
        id: string
        category: string
        summary: string
        reason: string
        needs_reply: boolean
        needs_reply_reason: string
        urgency_score: number
        urgency_reason: string
        recommended_action: string
        action_explanation: string
        action_items: string[]
        draft_reply?: string
        pending_delete: boolean
        classification_failed?: boolean
      }> = []

      for (let i = 0; i < ids.length; i += CONCURRENCY) {
        const batch = ids.slice(i, i + CONCURRENCY)
        const batchResults = await Promise.all(batch.map((id) => classifySingleMessage(id)))
        for (const r of batchResults) {
          if (r.error) {
            classifications.push({
              id: r.messageId,
              category: 'normal',
              summary: '',
              reason: r.error === 'timeout' ? 'Timed out.' : r.error === 'parse_failed' ? 'AI analysis returned no result for this message.' : r.error === 'not_found' ? 'Message not found.' : 'Analysis failed.',
              needs_reply: false,
              needs_reply_reason: 'No result from AI.',
              urgency_score: 5,
              urgency_reason: 'Analysis failed.',
              recommended_action: 'keep_for_manual_action',
              action_explanation: 'AI did not return a result. Use Summarize or Draft below to retry.',
              action_items: [],
              pending_delete: false,
              classification_failed: true,
            })
          } else {
            classifications.push({
              id: r.messageId,
              category: r.category ?? 'normal',
              summary: r.summary ?? '',
              reason: r.reason ?? '',
              needs_reply: r.needsReply ?? false,
              needs_reply_reason: r.needsReply ? 'Reply warranted.' : 'No reply needed.',
              urgency_score: r.urgency ?? 5,
              urgency_reason: r.reason ?? '',
              recommended_action: r.recommended_action ?? 'keep_for_manual_action',
              action_explanation: r.reason ?? '',
              action_items: [],
              ...(r.draftReply ? { draft_reply: r.draftReply } : {}),
              pending_delete: r.pending_delete ?? false,
            })
          }
        }
      }

      console.log('[AI-CATEGORIZE] Per-message classifications:', classifications.length, classifications.slice(0, 3).map((c) => ({ id: c.id, category: c.category, recommended_action: c.recommended_action })))

      try {
        const classifiedOk = classifications.filter((c) => !c.classification_failed).map((c) => c.id)
        if (classifiedOk.length) {
          enqueueRemoteOpsForLocalLifecycleState(db, classifiedOk)
        }
        scheduleOrchestratorRemoteDrain(resolveDb)
      } catch (e: any) {
        console.warn('[Inbox] Post-aiCategorize remote schedule:', e?.message)
      }

      return { ok: true, data: { classifications } }
    } catch (err: any) {
      console.error('[Inbox IPC] aiCategorize error:', err)
      const isTimeout = err?.message?.startsWith('LLM_TIMEOUT')
      return {
        ok: false,
        error: isTimeout ? 'timeout' : 'llm_error',
        message: err?.message ?? 'Unknown error',
      }
    }
  })

  ipcMain.handle('inbox:markPendingDelete', async (_e, messageIds: string[]) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const ids = messageIds ?? []
      const now = new Date().toISOString()
      const stmt = db.prepare('UPDATE inbox_messages SET pending_delete = 1, pending_delete_at = ? WHERE id = ?')
      for (const id of ids) stmt.run(now, id)
      fireRemoteOrchestratorSync(db, ids, 'pending_delete')
      return { ok: true, data: { marked: ids.length } }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Mark failed' }
    }
  })

  ipcMain.handle('inbox:moveToPendingReview', async (_e, ids: string[]) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const idList = ids ?? []
      if (idList.length === 0) return { ok: true }
      const now = new Date().toISOString()
      const placeholders = idList.map(() => '?').join(',')
      db.prepare(
        `UPDATE inbox_messages SET sort_category = 'pending_review', pending_review_at = ? WHERE id IN (${placeholders})`
      ).run(now, ...idList)
      fireRemoteOrchestratorSync(db, idList, 'pending_review')
      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Move failed' }
    }
  })

  ipcMain.handle('inbox:cancelPendingDelete', async (_e, messageId: string) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      /* FIX-H3: Reset color coding — clear sort_category, sort_reason, ai_analysis_json so message looks unsorted */
      db.prepare(
        'UPDATE inbox_messages SET pending_delete = 0, pending_delete_at = NULL, sort_category = NULL, sort_reason = NULL, ai_analysis_json = NULL WHERE id = ?'
      ).run(messageId)
      return { ok: true, data: { cancelled: true } }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Cancel failed' }
    }
  })

  ipcMain.handle('inbox:cancelPendingReview', async (_e, messageId: string) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      /* FIX-H3: Reset color coding — clear ai_analysis_json so message looks unsorted */
      db.prepare(
        'UPDATE inbox_messages SET sort_category = NULL, sort_reason = NULL, pending_review_at = NULL, ai_analysis_json = NULL WHERE id = ?'
      ).run(messageId)
      return { ok: true, data: { cancelled: true } }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Cancel failed' }
    }
  })

  ipcMain.handle('inbox:unarchive', async (_e, messageId: string) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      /* FIX-H3: Reset color coding — clear sort_category, sort_reason, ai_analysis_json so message looks unsorted */
      db.prepare(
        'UPDATE inbox_messages SET archived = 0, sort_category = NULL, sort_reason = NULL, ai_analysis_json = NULL WHERE id = ?'
      ).run(messageId)
      return { ok: true, data: { unarchived: true } }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Unarchive failed' }
    }
  })

  /**
   * Re-upsert remote move queue from current `inbox_messages` lifecycle columns for these IDs, then
   * schedule background drain. Call after bulk parallel Auto-Sort so mirror work is not dropped when
   * many `scheduleOrchestratorRemoteDrain` calls coalesce while the queue was still empty.
   */
  ipcMain.handle('inbox:enqueueRemoteLifecycleMirror', async (_e, messageIds: string[]) => {
    const out = await runEnqueueRemoteLifecycleMirrorFromIds(messageIds)
    if (!out.ok) {
      console.warn('[Inbox] enqueueRemoteLifecycleMirror:', out.error)
      return { ok: false, error: out.error }
    }
    return { ok: true, data: { enqueued: out.enqueued, skipped: out.skipped } }
  })

  /** Same as `inbox:enqueueRemoteLifecycleMirror` but flat `{ enqueued, skipped }` — used after Auto-Sort batch. */
  ipcMain.handle('inbox:enqueueRemoteSync', async (_e, messageIds: string[]) => {
    const out = await runEnqueueRemoteLifecycleMirrorFromIds(messageIds)
    if (!out.ok) return { ok: false, error: out.error }
    return { ok: true, enqueued: out.enqueued, skipped: out.skipped }
  })

  /** Diagnostics: recent remote orchestrator mutation queue rows (pending / failed / completed). */
  ipcMain.handle('inbox:listRemoteOrchestratorQueue', async (_e, limit?: number) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const n = typeof limit === 'number' && Number.isFinite(limit) ? Math.min(200, Math.max(1, limit)) : 50
      const rows = listRemoteOrchestratorQueueRows(db, n)
      return { ok: true, data: rows }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'List failed' }
    }
  })

  /**
   * IMAP only: re-enqueue remote lifecycle mutations from current local SQLite state (repair drift).
   * Processes asynchronously via the existing orchestrator queue drain.
   */
  ipcMain.handle('inbox:reconcileImapRemoteLifecycle', async (_e, accountId: string) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      if (typeof accountId !== 'string' || !accountId.trim()) {
        return { ok: false, error: 'accountId required' }
      }
      const r = reconcileImapLifecycleFromLocalState(db, accountId.trim(), getDb)
      return { ok: r.ok, data: { enqueued: r.enqueued, skipped: r.skipped }, error: r.error }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Reconcile failed' }
    }
  })

  // ── Inbox AI Settings ──
  ipcMain.handle('inbox:getInboxSettings', async () => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const tone = getInboxSetting(db, 'inbox_ai_tone') ?? ''
      const sortRules = getInboxSetting(db, 'inbox_ai_sort_rules') ?? ''
      const contextDocs = getInboxSetting(db, 'inbox_ai_context_docs') ?? []
      const batchSize = getInboxSetting(db, 'inbox_batch_size')
      const batchSizeNum = typeof batchSize === 'number' ? batchSize : (typeof batchSize === 'string' ? parseInt(batchSize, 10) : 10)
      const validBatch = [10, 12, 24, 48].includes(batchSizeNum) ? batchSizeNum : 10
      return {
        ok: true,
        data: {
          tone: typeof tone === 'string' ? tone : '',
          sortRules: typeof sortRules === 'string' ? sortRules : '',
          contextDocs: Array.isArray(contextDocs) ? contextDocs : [],
          batchSize: validBatch,
        },
      }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Get settings failed' }
    }
  })

  ipcMain.handle('inbox:setInboxSettings', async (_e, partial: { tone?: string; sortRules?: string; batchSize?: number }) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      if (partial.tone !== undefined) setInboxSetting(db, 'inbox_ai_tone', partial.tone)
      if (partial.sortRules !== undefined) setInboxSetting(db, 'inbox_ai_sort_rules', partial.sortRules)
      if (partial.batchSize !== undefined && [10, 12, 24, 48].includes(partial.batchSize)) {
        setInboxSetting(db, 'inbox_batch_size', partial.batchSize)
      }
      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Set settings failed' }
    }
  })

  function getInboxAiContextDir(): string {
    return path.join(app.getPath('userData'), 'inbox-ai-context')
  }

  ipcMain.handle('inbox:selectAndUploadContextDoc', async () => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const docs = (getInboxSetting(db, 'inbox_ai_context_docs') ?? []) as Array<{ id: string; name: string; size: number; extractedText: string }>
      if (docs.length >= 5) return { ok: false, error: 'Maximum 5 context documents allowed' }
      const totalBytes = docs.reduce((s, d) => s + (d.size ?? 0), 0)
      if (totalBytes >= CONTEXT_MAX_TOTAL_BYTES) return { ok: false, error: 'Maximum 10MB total for context documents' }

      const result = await dialog.showOpenDialog(mainWindow ?? null, {
        title: 'Select PDF for Business Context',
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
        properties: ['openFile'],
      })
      if (result.canceled || !result.filePaths?.length) return { ok: true, data: { skipped: true } }

      const filePath = result.filePaths[0]
      const buffer = fs.readFileSync(filePath)
      if (!isPdfFile('application/pdf', filePath)) return { ok: false, error: 'File is not a valid PDF' }
      if (totalBytes + buffer.length > CONTEXT_MAX_TOTAL_BYTES) return { ok: false, error: 'Adding this file would exceed 10MB total. Remove some documents first.' }

      const extracted = await extractPdfText(buffer)
      const text = extracted.success ? (extracted.text || '').trim() : ''
      const name = path.basename(filePath)
      const size = buffer.length
      const id = `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

      const dir = getInboxAiContextDir()
      fs.mkdirSync(dir, { recursive: true })
      const destPath = path.join(dir, `${id}.pdf`)
      fs.copyFileSync(filePath, destPath)

      const newDoc = { id, name, size, extractedText: text }
      docs.push(newDoc)
      setInboxSetting(db, 'inbox_ai_context_docs', docs)

      return { ok: true, data: { doc: newDoc, docs } }
    } catch (err: any) {
      console.error('[Inbox IPC] selectAndUploadContextDoc error:', err)
      return { ok: false, error: err?.message ?? 'Upload failed' }
    }
  })

  ipcMain.handle('inbox:deleteContextDoc', async (_e, docId: string) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const docs = (getInboxSetting(db, 'inbox_ai_context_docs') ?? []) as Array<{ id: string; name: string; size: number; extractedText: string }>
      const filtered = docs.filter((d) => d.id !== docId)
      if (filtered.length === docs.length) return { ok: false, error: 'Document not found' }
      setInboxSetting(db, 'inbox_ai_context_docs', filtered)
      const filePath = path.join(getInboxAiContextDir(), `${docId}.pdf`)
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
      } catch {
        /* ignore */
      }
      return { ok: true, data: { docs: filtered } }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Delete failed' }
    }
  })

  ipcMain.handle('inbox:listContextDocs', async () => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const docs = (getInboxSetting(db, 'inbox_ai_context_docs') ?? []) as Array<{ id: string; name: string; size: number; extractedText: string }>
      return { ok: true, data: docs.map((d) => ({ id: d.id, name: d.name, size: d.size })) }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'List failed' }
    }
  })

  ipcMain.handle('inbox:getAiRules', async () => {
    try {
      return fs.readFileSync(RULES_PATH, 'utf-8')
    } catch {
      return getInboxAiRules()
    }
  })

  ipcMain.handle('inbox:saveAiRules', async (_e, content: string) => {
    try {
      fs.writeFileSync(RULES_PATH, content ?? '', 'utf-8')
      rulesCache.mtime = 0
      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Save failed' }
    }
  })

  ipcMain.handle('inbox:getAiRulesDefault', async () => {
    return DEFAULT_WREXPERT_CONTENT
  })

  /** Show native file picker for draft attachments. Returns { files: { name, path, size }[] }. */
  ipcMain.handle('inbox:showOpenDialogForAttachments', async () => {
    const mainWindow = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    const result = await dialog.showOpenDialog(mainWindow ?? null, {
      title: 'Add attachment',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'All Files', extensions: ['*'] },
        { name: 'Documents', extensions: ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'txt'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
      ],
    })
    if (result.canceled || !result.filePaths?.length) return { ok: true, data: { files: [] } }
    const files = result.filePaths.map((p) => {
      const name = path.basename(p)
      let size = 0
      try {
        size = fs.statSync(p).size
      } catch {
        /* ignore */
      }
      return { name, path: p, size }
    })
    return { ok: true, data: { files } }
  })

  /** Read a file from disk and return as base64 for email attachment. */
  ipcMain.handle('inbox:readFileForAttachment', async (_e, filePath: string) => {
    try {
      if (!filePath || typeof filePath !== 'string') return { ok: false, error: 'Invalid path' }
      const normalized = path.normalize(filePath)
      if (normalized.includes('..')) return { ok: false, error: 'Invalid path' }
      if (!fs.existsSync(normalized)) return { ok: false, error: 'File not found' }
      const stat = fs.statSync(normalized)
      if (!stat.isFile()) return { ok: false, error: 'Not a file' }
      if (stat.size > 25 * 1024 * 1024) return { ok: false, error: 'File too large (max 25MB)' }
      const buffer = fs.readFileSync(normalized)
      const filename = path.basename(normalized)
      const ext = path.extname(filename).toLowerCase().slice(1)
      const mimeMap: Record<string, string> = {
        pdf: 'application/pdf',
        doc: 'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xls: 'application/vnd.ms-excel',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        webp: 'image/webp',
        txt: 'text/plain',
      }
      const mimeType = mimeMap[ext] ?? 'application/octet-stream'
      const contentBase64 = buffer.toString('base64')
      return { ok: true, data: { filename, mimeType, contentBase64 } }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Read failed' }
    }
  })

  // ── Periodic: retention lifecycle (UTC) — review 14d → pending delete, pending delete 7d → final queue, remote retries ──
  let deletionInterval: ReturnType<typeof setInterval> | null = null
  const runLifecycle = async () => {
    try {
      const db = await resolveDb()
      if (!db) return
      const tick = await runInboxLifecycleTick(db, { getDb })
      if (
        tick.errors.length ||
        tick.promotedReviewToPendingDelete ||
        tick.promotedPendingDeleteToFinalQueue ||
        tick.executedPendingDeletionsPass1.executed ||
        tick.executedPendingDeletionsPass2.executed
      ) {
        console.log('[Inbox IPC] lifecycle tick summary:', JSON.stringify(tick))
      }
    } catch (err: any) {
      console.error('[Inbox IPC] lifecycle tick error:', err?.message)
    }
  }
  deletionInterval = setInterval(runLifecycle, 5 * 60 * 1000)
  setImmediate(runLifecycle)

  console.log('[Inbox IPC] Handlers registered')
}

/**
 * Show Gmail OAuth credentials setup dialog
 * DEPRECATED: Inline setup in modal replaces this. Remove after confirming all paths work.
 */
export async function showGmailSetupDialog(): Promise<{ success: boolean }> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 550,
      height: 520,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      },
      title: 'Connect Gmail Account',
      resizable: false,
      alwaysOnTop: true,
      show: true,
      center: true,
      skipTaskbar: false
    })
    
    // Ensure window is visible and focused
    win.show()
    win.focus()
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 32px;
            background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
            min-height: 100vh;
          }
          h2 { 
            color: #0f172a; 
            margin-bottom: 8px; 
            font-size: 22px;
            display: flex;
            align-items: center;
            gap: 10px;
          }
          .subtitle {
            color: #64748b;
            font-size: 14px;
            margin-bottom: 24px;
            line-height: 1.5;
          }
          .step {
            background: white;
            border-radius: 12px;
            padding: 16px;
            margin-bottom: 16px;
            border: 1px solid #e2e8f0;
          }
          .step-header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 10px;
          }
          .step-num {
            background: #3b82f6;
            color: white;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 13px;
            font-weight: 600;
          }
          .step-title { font-weight: 600; color: #1e293b; font-size: 14px; }
          .step-desc { color: #64748b; font-size: 13px; line-height: 1.5; }
          .link {
            color: #3b82f6;
            text-decoration: none;
            cursor: pointer;
          }
          .link:hover { text-decoration: underline; }
          label { 
            display: block; 
            color: #374151; 
            font-size: 13px; 
            font-weight: 500; 
            margin-bottom: 6px;
            margin-top: 16px;
          }
          input { 
            width: 100%; 
            padding: 10px 12px; 
            border: 1px solid #d1d5db; 
            border-radius: 8px; 
            font-size: 14px;
            background: white;
          }
          input:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
          .buttons { 
            display: flex; 
            gap: 12px; 
            margin-top: 24px;
            justify-content: flex-end;
          }
          button {
            padding: 10px 20px;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s;
          }
          .primary { 
            background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
            color: white;
            box-shadow: 0 2px 8px rgba(59,130,246,0.3);
          }
          .primary:hover { 
            background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
            transform: translateY(-1px);
          }
          .primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
          }
          .secondary { 
            background: white;
            border: 1px solid #d1d5db;
            color: #374151;
          }
          .secondary:hover { background: #f8fafc; }
          .error {
            color: #dc2626;
            font-size: 13px;
            margin-top: 8px;
            display: none;
          }
        </style>
      </head>
      <body>
        <h2>📧 Connect Gmail</h2>
        <p class="subtitle">
          To read your emails securely, you need to set up Gmail API access.
          This is a one-time setup that takes about 2 minutes.
        </p>
        
        <div class="step">
          <div class="step-header">
            <span class="step-num">1</span>
            <span class="step-title">Create Google Cloud Project</span>
          </div>
          <p class="step-desc">
            Go to <a class="link" id="openConsole">Google Cloud Console</a> and create a new project 
            (or use an existing one).
          </p>
        </div>
        
        <div class="step">
          <div class="step-header">
            <span class="step-num">2</span>
            <span class="step-title">Enable Gmail API</span>
          </div>
          <p class="step-desc">
            In your project, go to "APIs & Services" → "Enable APIs" → search for "Gmail API" → Enable it.
          </p>
        </div>
        
        <div class="step">
          <div class="step-header">
            <span class="step-num">3</span>
            <span class="step-title">Create OAuth Credentials</span>
          </div>
          <p class="step-desc">
            Go to "Credentials" → "Create Credentials" → "OAuth client ID" → Choose "Desktop app".
            Copy the Client ID and Client Secret below.
          </p>
          
          <label>Client ID</label>
          <input type="text" id="clientId" placeholder="xxxxx.apps.googleusercontent.com">
          
          <label>Client Secret</label>
          <input type="password" id="clientSecret" placeholder="GOCSPX-xxxxx">
          
          <p class="error" id="error"></p>
        </div>
        
        <div class="buttons">
          <button class="secondary" onclick="window.close()">Cancel</button>
          <button class="primary" id="connectBtn" onclick="connect()">Connect Gmail</button>
        </div>
        
        <script>
          const { ipcRenderer, shell } = require('electron');
          
          document.getElementById('openConsole').onclick = (e) => {
            e.preventDefault();
            shell.openExternal('https://console.cloud.google.com/apis/credentials');
          };
          
          async function connect() {
            const clientId = document.getElementById('clientId').value.trim();
            const clientSecret = document.getElementById('clientSecret').value.trim();
            const error = document.getElementById('error');
            const btn = document.getElementById('connectBtn');
            
            if (!clientId || !clientSecret) {
              error.textContent = 'Please enter both Client ID and Client Secret';
              error.style.display = 'block';
              return;
            }
            
            error.style.display = 'none';
            btn.disabled = true;
            btn.textContent = 'Connecting...';
            
            try {
              // Save credentials
              await ipcRenderer.invoke('email:setGmailCredentials', clientId, clientSecret);
              
              // Start OAuth flow
              const result = await ipcRenderer.invoke('email:connectGmail', 'Gmail');
              
              if (result.ok) {
                ipcRenderer.send('gmail-setup-complete', { success: true });
                window.close();
              } else {
                error.textContent = result.error || 'Failed to connect';
                error.style.display = 'block';
                btn.disabled = false;
                btn.textContent = 'Connect Gmail';
              }
            } catch (err) {
              error.textContent = err.message || 'An error occurred';
              error.style.display = 'block';
              btn.disabled = false;
              btn.textContent = 'Connect Gmail';
            }
          }
        </script>
      </body>
      </html>
    `
    
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    
    let resolved = false
    
    const handleComplete = (_e: any, result: any) => {
      if (resolved) return
      resolved = true
      ipcMain.removeListener('gmail-setup-complete', handleComplete)
      resolve(result)
    }
    
    ipcMain.once('gmail-setup-complete', handleComplete)
    
    win.on('closed', () => {
      if (resolved) return
      resolved = true
      ipcMain.removeListener('gmail-setup-complete', handleComplete)
      resolve({ success: false })
    })
  })
}

/**
 * Show Outlook OAuth credentials setup dialog
 * DEPRECATED: Inline setup in modal replaces this. Remove after confirming all paths work.
 */
export async function showOutlookSetupDialog(): Promise<{ success: boolean }> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 550,
      height: 560,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      },
      title: 'Connect Microsoft 365 / Outlook',
      resizable: false,
      alwaysOnTop: true,
      show: true,
      center: true,
      skipTaskbar: false
    })
    
    // Ensure window is visible and focused
    win.show()
    win.focus()
    
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            padding: 32px;
            background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
            min-height: 100vh;
          }
          h2 { 
            color: #0f172a; 
            margin-bottom: 8px; 
            font-size: 22px;
            display: flex;
            align-items: center;
            gap: 10px;
          }
          .subtitle {
            color: #64748b;
            font-size: 14px;
            margin-bottom: 24px;
            line-height: 1.5;
          }
          .step {
            background: white;
            border-radius: 12px;
            padding: 16px;
            margin-bottom: 16px;
            border: 1px solid #e2e8f0;
          }
          .step-header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 10px;
          }
          .step-num {
            background: #0078d4;
            color: white;
            width: 24px;
            height: 24px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 13px;
            font-weight: 600;
          }
          .step-title { font-weight: 600; color: #1e293b; font-size: 14px; }
          .step-desc { color: #64748b; font-size: 13px; line-height: 1.5; }
          .link {
            color: #0078d4;
            text-decoration: none;
            cursor: pointer;
          }
          .link:hover { text-decoration: underline; }
          label { 
            display: block; 
            color: #374151; 
            font-size: 13px; 
            font-weight: 500; 
            margin-bottom: 6px;
            margin-top: 16px;
          }
          input { 
            width: 100%; 
            padding: 10px 12px; 
            border: 1px solid #d1d5db; 
            border-radius: 8px; 
            font-size: 14px;
            background: white;
          }
          input:focus { outline: none; border-color: #0078d4; box-shadow: 0 0 0 3px rgba(0,120,212,0.1); }
          .buttons { 
            display: flex; 
            gap: 12px; 
            margin-top: 24px;
            justify-content: flex-end;
          }
          button {
            padding: 10px 20px;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.15s;
          }
          .primary { 
            background: linear-gradient(135deg, #0078d4 0%, #106ebe 100%);
            color: white;
            box-shadow: 0 2px 8px rgba(0,120,212,0.3);
          }
          .primary:hover { 
            background: linear-gradient(135deg, #106ebe 0%, #005a9e 100%);
            transform: translateY(-1px);
          }
          .primary:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none;
          }
          .secondary { 
            background: white;
            border: 1px solid #d1d5db;
            color: #374151;
          }
          .secondary:hover { background: #f8fafc; }
          .error {
            color: #dc2626;
            font-size: 13px;
            margin-top: 8px;
            display: none;
          }
        </style>
      </head>
      <body>
        <h2>📨 Connect Microsoft 365</h2>
        <p class="subtitle">
          To read your emails securely, you need to set up Azure AD app access.
          This is a one-time setup that takes about 3 minutes.
        </p>
        
        <div class="step">
          <div class="step-header">
            <span class="step-num">1</span>
            <span class="step-title">Register Azure AD App</span>
          </div>
          <p class="step-desc">
            Go to <a class="link" id="openAzure">Azure Portal</a> → Azure Active Directory → 
            App registrations → New registration. Set redirect URI to: <code>http://localhost:51249/callback</code>
          </p>
        </div>
        
        <div class="step">
          <div class="step-header">
            <span class="step-num">2</span>
            <span class="step-title">Add API Permissions</span>
          </div>
          <p class="step-desc">
            In your app, go to "API permissions" → Add: Mail.Read, Mail.ReadWrite, Mail.Send, User.Read (delegated).
          </p>
        </div>
        
        <div class="step">
          <div class="step-header">
            <span class="step-num">3</span>
            <span class="step-title">Create Client Secret</span>
          </div>
          <p class="step-desc">
            Go to "Certificates & secrets" → New client secret. Copy the Application (client) ID 
            and the secret value below.
          </p>
          
          <label>Application (Client) ID</label>
          <input type="text" id="clientId" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx">
          
          <label>Client Secret</label>
          <input type="password" id="clientSecret" placeholder="Your client secret value">
          
          <p class="error" id="error"></p>
        </div>
        
        <div class="buttons">
          <button class="secondary" onclick="window.close()">Cancel</button>
          <button class="primary" id="connectBtn" onclick="connect()">Connect Outlook</button>
        </div>
        
        <script>
          const { ipcRenderer, shell } = require('electron');
          
          document.getElementById('openAzure').onclick = (e) => {
            e.preventDefault();
            shell.openExternal('https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade');
          };
          
          async function connect() {
            const clientId = document.getElementById('clientId').value.trim();
            const clientSecret = document.getElementById('clientSecret').value.trim();
            const error = document.getElementById('error');
            const btn = document.getElementById('connectBtn');
            
            if (!clientId || !clientSecret) {
              error.textContent = 'Please enter both Client ID and Client Secret';
              error.style.display = 'block';
              return;
            }
            
            error.style.display = 'none';
            btn.disabled = true;
            btn.textContent = 'Connecting...';
            
            try {
              // Save credentials
              await ipcRenderer.invoke('email:setOutlookCredentials', clientId, clientSecret);
              
              // Start OAuth flow
              const result = await ipcRenderer.invoke('email:connectOutlook', 'Outlook');
              
              if (result.ok) {
                ipcRenderer.send('outlook-setup-complete', { success: true });
                window.close();
              } else {
                error.textContent = result.error || 'Failed to connect';
                error.style.display = 'block';
                btn.disabled = false;
                btn.textContent = 'Connect Outlook';
              }
            } catch (err) {
              error.textContent = err.message || 'An error occurred';
              error.style.display = 'block';
              btn.disabled = false;
              btn.textContent = 'Connect Outlook';
            }
          }
        </script>
      </body>
      </html>
    `
    
    win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    
    let resolved = false
    
    const handleComplete = (_e: any, result: any) => {
      if (resolved) return
      resolved = true
      ipcMain.removeListener('outlook-setup-complete', handleComplete)
      resolve(result)
    }
    
    ipcMain.once('outlook-setup-complete', handleComplete)
    
    win.on('closed', () => {
      if (resolved) return
      resolved = true
      ipcMain.removeListener('outlook-setup-complete', handleComplete)
      resolve({ success: false })
    })
  })
}

