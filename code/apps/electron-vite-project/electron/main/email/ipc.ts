/**
 * Email Gateway IPC Handlers
 *
 * Electron IPC interface for the email gateway.
 * These handlers expose email operations to the renderer process.
 */

import { ipcMain, BrowserWindow, shell, dialog, app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { emailGateway } from './gateway'
import { checkExistingCredentials, saveCredentials, isVaultUnlocked } from './credentials'
import {
  MessageSearchOptions,
  SendEmailPayload,
  IMAP_PRESETS
} from './types'
import { syncAccountEmails, startAutoSync, updateSyncState } from './syncOrchestrator'
import { bulkQueueDeletion, cancelRemoteDeletion, executePendingDeletions, queueRemoteDeletion } from './remoteDeletion'
import { processPendingPlainEmails } from './plainEmailIngestion'
import { extractPdfText, isPdfFile } from './pdf-extractor'
import { extractPdfTextWithVisionApi } from '../vault/hsContextOcrJob'

// ── Inbox: active auto-sync loops ──

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
  const response = await ollamaManager.chat(modelId, messages)
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
    'email:setOutlookCredentials', 'email:connectOutlook', 'email:showOutlookSetup', 'email:connectImap',
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
   * Connect IMAP account
   */
  ipcMain.handle('email:connectImap', async (_e, config: {
    displayName: string
    email: string
    host: string
    port: number
    username: string
    password: string
    security: 'ssl' | 'starttls' | 'none'
  }) => {
    try {
      const account = await emailGateway.connectImapAccount(config)
      return { ok: true, data: account }
    } catch (error: any) {
      console.error('[Email IPC] connectImap error:', error)
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
   * Send BEAP package via email (uses first connected account).
   * Contract: { to: string; subject: string; body: string; attachments: { name: string; data: string; mime: string }[] }
   */
  ipcMain.handle('email:sendBeapEmail', async (
    _e,
    contract: { to: string; subject: string; body: string; attachments: { name: string; data: string; mime: string }[] }
  ) => {
    try {
      const accounts = await emailGateway.listAccounts()
      const active = accounts.filter((a: any) => a.status === 'active')
      if (active.length === 0) {
        return { ok: false, error: 'No email account connected. Connect in Settings or use Download.' }
      }
      const accountId = active[0].id
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
    'inbox:listMessages', 'inbox:getMessage',
    'inbox:markRead', 'inbox:toggleStar', 'inbox:archiveMessages', 'inbox:setCategory',
    'inbox:deleteMessages', 'inbox:cancelDeletion', 'inbox:getDeletedMessages',
    'inbox:getAttachment', 'inbox:getAttachmentText', 'inbox:openAttachmentOriginal', 'inbox:rasterAttachment',
    'inbox:aiSummarize', 'inbox:aiDraftReply', 'inbox:aiAnalyzeMessage', 'inbox:aiCategorize', 'inbox:markPendingDelete', 'inbox:cancelPendingDelete',
    'inbox:getInboxSettings', 'inbox:setInboxSettings', 'inbox:selectAndUploadContextDoc', 'inbox:deleteContextDoc', 'inbox:listContextDocs',
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

  // ── Sync ──
  ipcMain.handle('inbox:syncAccount', async (_e, accountId: string) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const result = await syncAccountEmails(db, { accountId })
      processPendingPlainEmails(db)
      if (result.newMessages > 0) sendToRenderer('inbox:newMessages', result)
      return { ok: true, data: result }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Sync failed' }
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
        })
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

  // ── Messages ──
  ipcMain.handle('inbox:listMessages', async (_e, options: {
    filter?: string
    sourceType?: string
    handshakeId?: string
    category?: string
    limit?: number
    offset?: number
    search?: string
  } = {}) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const { filter, sourceType, handshakeId, category, limit = 50, offset = 0, search } = options ?? {}
      const conditions: string[] = []
      const params: any[] = []

      if (filter === 'deleted') conditions.push('deleted = 1')
      else if (filter === 'pending_delete') {
        conditions.push('deleted = 0', 'pending_delete = 1')
      } else if (filter === 'unread') {
        conditions.push('deleted = 0', 'archived = 0', 'read_status = 0', '(pending_delete = 0 OR pending_delete IS NULL)')
      } else if (filter === 'starred') {
        conditions.push('deleted = 0', 'archived = 0', 'starred = 1', '(pending_delete = 0 OR pending_delete IS NULL)')
      } else if (filter === 'archived') {
        conditions.push('archived = 1', 'deleted = 0')
      } else {
        conditions.push('deleted = 0')
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
      const countRow = db.prepare(`SELECT COUNT(*) as total FROM inbox_messages ${where}`).get(...params) as { total: number }
      const total = countRow?.total ?? 0

      params.push(limit, offset)
      const rows = db.prepare(
        `SELECT * FROM inbox_messages ${where} ORDER BY received_at DESC LIMIT ? OFFSET ?`
      ).all(...params) as any[]

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
      const stmt = db.prepare('UPDATE inbox_messages SET archived = 1 WHERE id = ?')
      for (const id of messageIds ?? []) stmt.run(id)
      return { ok: true }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Archive failed' }
    }
  })

  ipcMain.handle('inbox:setCategory', async (_e, messageIds: string[], category: string) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const stmt = db.prepare('UPDATE inbox_messages SET sort_category = ? WHERE id = ?')
      for (const id of messageIds ?? []) stmt.run(category ?? null, id)
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
      return { ok: true, data: { summary } }
    } catch (err: any) {
      const msg = err?.message ?? 'Summarize failed'
      return { ok: true, data: { summary: `Error: ${msg}`, error: true } }
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
      return { ok: true, data: { draft } }
    } catch (err: any) {
      const msg = err?.message ?? 'Draft failed'
      return { ok: true, data: { draft: `Error: ${msg}`, error: true } }
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
      }

      const parseFailed = !parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0
      const needsReply = parseFailed ? false : !!parsed.needsReply
      const needsReplyReason = (parseFailed ? 'Could not analyze' : (parsed.needsReplyReason ?? '')).slice(0, 300)
      const summary = (parseFailed ? 'Analysis failed — could not parse AI response' : (parsed.summary ?? '')).slice(0, 1000)
      const urgencyScore = parseFailed ? 5 : (typeof parsed.urgencyScore === 'number' ? Math.max(1, Math.min(10, parsed.urgencyScore)) : 5)
      const urgencyReason = (parseFailed ? 'Unknown' : (parsed.urgencyReason ?? '')).slice(0, 300)
      const actionItems = parseFailed ? [] : (Array.isArray(parsed.actionItems) ? parsed.actionItems.filter((x): x is string => typeof x === 'string').slice(0, 10) : [])
      const archiveRecommendation = parseFailed ? 'keep' : (parsed.archiveRecommendation === 'archive' ? 'archive' : 'keep')
      const archiveReason = (parseFailed ? 'Could not determine' : (parsed.archiveReason ?? '')).slice(0, 300)

      console.log('[AI-ANALYZE] Parsed result:', JSON.stringify({ needsReply, needsReplyReason: needsReplyReason.slice(0, 80), summary: summary.slice(0, 80), urgencyScore, archiveRecommendation }).slice(0, 500))

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
        },
      }
    } catch (err: any) {
      console.error('[Inbox IPC] aiAnalyzeMessage error:', err)
      return { ok: false, error: err?.message ?? 'Analyze failed' }
    }
  })

  ipcMain.handle('inbox:aiCategorize', async (_e, messageIds: string[]) => {
    const ids = messageIds ?? []
    console.log('[AI-CATEGORIZE] Starting for', ids.length, 'messages:', ids.slice(0, 3))
    if (ids.length === 0) return { ok: true, data: { classifications: [] } }
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }

      const available = await isOllamaAvailable()
      if (!available) {
        return { ok: true, data: { classifications: [], error: 'LLM not available. Check Ollama status.' } }
      }

      const messages: Array<{ id: string; from: string; subject: string; body_preview: string }> = []
      for (const id of ids) {
        const row = db.prepare('SELECT id, from_address, from_name, subject, body_text FROM inbox_messages WHERE id = ?').get(id) as { id: string; from_address?: string; from_name?: string; subject?: string; body_text?: string } | undefined
        if (!row) continue
        const from = row.from_name ? `${row.from_name} <${row.from_address || ''}>` : (row.from_address || 'Unknown')
        const body = (row.body_text || '').trim().slice(0, 500)
        messages.push({ id: row.id, from, subject: row.subject || '(No subject)', body_preview: body })
      }

      if (messages.length === 0) return { ok: true, data: { classifications: [] } }

      const { sortRules } = getToneAndSortForPrompts(db)
      const contextBlock = getContextBlockForPrompts(db)
      let systemPrompt = `You are an email triage AI. For each email below, respond with a JSON array only. Each entry must have:
- id: the message id (exact string from input)
- category: one of 'urgent', 'important', 'normal', 'newsletter', 'spam', 'irrelevant'
- reason: one sentence explaining why (e.g. 'Invoice pending payment due in 3 days')
- needs_reply: boolean
- urgency_score: number 1-10

Classify 'spam' or 'irrelevant' for: marketing newsletters the user didn't subscribe to, automated notifications with no action needed, obvious spam.
Classify 'urgent' for: invoices, deadlines, time-sensitive requests, security alerts.
Return ONLY a valid JSON array, no other text.`
      if (sortRules) systemPrompt += `\n\nUser custom sorting rules: ${sortRules}`
      if (contextBlock) systemPrompt += contextBlock

      const userPrompt = JSON.stringify(messages)

      console.log('[AI-CATEGORIZE] System prompt length:', systemPrompt.length)
      console.log('[AI-CATEGORIZE] Calling LLM...')
      const raw = await callInboxOllamaChat(systemPrompt, userPrompt)
      console.log('[AI-CATEGORIZE] Raw LLM response:', raw.substring(0, 500))
      let parsed: Array<{ id?: string; category?: string; reason?: string; needs_reply?: boolean; urgency_score?: number }>
      try {
        const jsonMatch = raw.match(/\[[\s\S]*\]/)
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : []
      } catch {
        parsed = []
      }

      const classifications: Array<{ id: string; category: string; reason: string; needs_reply: boolean; urgency_score: number; pending_delete: boolean }> = []
      const now = new Date().toISOString()

      for (const p of parsed) {
        const id = p.id ?? ''
        if (!ids.includes(id)) continue
        const category = (p.category ?? 'normal').toLowerCase().trim()
        const validCategory = ['urgent', 'important', 'normal', 'newsletter', 'spam', 'irrelevant'].includes(category) ? category : 'normal'
        const reason = (p.reason ?? '').slice(0, 200)
        const needsReply = !!p.needs_reply
        const urgencyScore = typeof p.urgency_score === 'number' ? Math.max(1, Math.min(10, p.urgency_score)) : 5
        const pendingDelete = validCategory === 'spam' || validCategory === 'irrelevant'

        db.prepare('UPDATE inbox_messages SET sort_category = ?, sort_reason = ?, urgency_score = ?, needs_reply = ? WHERE id = ?').run(validCategory, reason || null, urgencyScore, needsReply ? 1 : 0, id)
        // pending_delete is set by client after 5-min grace period via inbox:markPendingDelete

        classifications.push({ id, category: validCategory, reason, needs_reply: needsReply, urgency_score: urgencyScore, pending_delete: pendingDelete })
      }

      console.log('[AI-CATEGORIZE] Parsed classifications:', classifications.length, classifications.slice(0, 3).map((c) => ({ id: c.id, category: c.category })))
      return { ok: true, data: { classifications } }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Categorize failed' }
    }
  })

  ipcMain.handle('inbox:markPendingDelete', async (_e, messageIds: string[]) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const now = new Date().toISOString()
      const stmt = db.prepare('UPDATE inbox_messages SET pending_delete = 1, pending_delete_at = ? WHERE id = ?')
      for (const id of messageIds ?? []) stmt.run(now, id)
      return { ok: true, data: { marked: (messageIds ?? []).length } }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Mark failed' }
    }
  })

  ipcMain.handle('inbox:cancelPendingDelete', async (_e, messageId: string) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      db.prepare('UPDATE inbox_messages SET pending_delete = 0, pending_delete_at = NULL WHERE id = ?').run(messageId)
      return { ok: true, data: { cancelled: true } }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Cancel failed' }
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

  // ── Periodic: execute pending deletions every 5 minutes; process 7-day pending_delete → queue ──
  let deletionInterval: ReturnType<typeof setInterval> | null = null
  deletionInterval = setInterval(async () => {
    try {
      const db = await resolveDb()
      if (!db) return
      await executePendingDeletions(db)
      const sevenDaysAgo = new Date()
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
      const cutoff = sevenDaysAgo.toISOString()
      const rows = db.prepare(
        `SELECT m.id FROM inbox_messages m
         WHERE m.pending_delete = 1 AND m.pending_delete_at <= ?
         AND NOT EXISTS (SELECT 1 FROM deletion_queue dq WHERE dq.message_id = m.id AND dq.executed = 0 AND dq.cancelled = 0)`
      ).all(cutoff) as Array<{ id: string }>
      for (const r of rows) {
        try {
          queueRemoteDeletion(db, r.id, 0)
        } catch (e: any) {
          console.error('[Inbox IPC] queueRemoteDeletion for pending_delete:', e?.message)
        }
      }
    } catch (err: any) {
      console.error('[Inbox IPC] executePendingDeletions error:', err?.message)
    }
  }, 5 * 60 * 1000)

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

