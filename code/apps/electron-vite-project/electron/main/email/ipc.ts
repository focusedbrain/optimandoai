/**
 * Email Gateway IPC Handlers
 *
 * Electron IPC interface for the email gateway.
 * These handlers expose email operations to the renderer process.
 */

import { ipcMain, BrowserWindow, shell, dialog, app } from 'electron'
import { createHash, randomUUID } from 'crypto'
import {
  DEBUG_AUTOSORT_DIAGNOSTICS,
  DEBUG_AUTOSORT_TIMING,
  autosortDiagLog,
  autosortTimingLog,
  getAutosortDiagMainState,
  isRecentVaultLock,
  setAutosortDiagMainState,
} from '../autosortDiagnostics'
import {
  ollamaRuntimeBeginBatch,
  ollamaRuntimeEndBatch,
  type OllamaClassifyBatchChunkDiag,
} from '../llm/ollamaRuntimeDiagnostics'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { fileURLToPath } from 'node:url'
import { extractInboxMessageRedirectSourceFromRow } from './beapRedirectSource'
import { prepareBeapInboxSandboxClone } from './beapInboxClonePrepare'
import { isHostMode } from '../orchestrator/orchestratorModeStore'

/** Per-call ⚡ logs for `inbox:aiAnalyzeMessage` — keep false in production. */
const DEBUG_INBOX_AI_IPC_VERBOSE = false

// ── WRExpert.md: user-editable AI behaviour (userData, survives app updates) ──
const RULES_PATH = path.join(app.getPath('userData'), 'WRExpert.md')
/** Bundled main chunk lives in dist-electron/ — same base as main.ts (not per-source __dirname in ESM). */
const DEFAULT_RULES_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../electron/WRExpert.default.md',
)

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
- Never classify messages with meaningful attachments as pending_delete

### pending_review (human review required, auto-deleted after 14 days)
Move here if ANY of these apply:
- Legal notices or contract-related emails that are NOT time-sensitive
- Supplier or vendor communications that are informational only
- Any email where the intent is unclear and automatic action seems risky
- Receipts or invoices over €500 (even if automated)
- First contact from an unknown sender on a potentially relevant topic
- Messages with attachments that need manual inspection

### archive (kept permanently, no action needed)
Move here if:
- Useful reference material (documentation, guides, confirmations you might need later)
- Completed transaction records under €500
- Meeting notes, summaries, reports for future reference
- Any email explicitly marked by the user as "keep"

### urgent (WR Desk Urgent tab + mirrored to server **Urgent** folder on sync, urgency >= 7)
Move here if ANY of these apply:
- Invoice or payment overdue or due within 3 days
- Legal deadline within 7 days
- Contract termination or dispute
- Security alert requiring immediate action
- Direct request from a known important contact requiring same-day response

### action_required (WR Desk Important flow + mirrored to **Pending Review** on sync, urgency 4–6)
Move here if:
- Requires a response within the next 7 days
- Requires a decision or manual step (not just reading)
- Contains a question directed at you that is not automated

### normal (WR Desk Normal / All until archived; mirrored to **Archive** on sync when classified)
Move here if:
- Requires attention but no urgency
- Does not fit the above categories
- Personal or low-stakes business communication

# Attachment Handling Rules
Messages that include attachments (PDFs, documents, images, spreadsheets, or any file) should be treated with higher priority:
- A message with attachments should be classified as minimum "pending_review" — never "pending_delete" or "archive" unless the sender is a known newsletter or automated notification.
- If a message with attachments also has urgency indicators (deadline language, request for action, important sender), classify as "urgent" or "action_required".
- Attachments from unknown senders should be "pending_review" for manual inspection.

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
- If the email body references attachments (e.g. "please find attached", "see the attachment", "I've attached") but attachment metadata is missing or unclear, treat as if attachments may be present and apply the Attachment Handling Rules conservatively (minimum pending_review when in doubt).

## SOURCE TYPE WEIGHTING (same categories — signals only)
Transport and handshake metadata are weighting hints inside this single pipeline, not separate routing classes and not a verdict by themselves:
- Native BEAP (email_beap, direct_beap): bias toward archive when content fits; disfavor pending_delete unless the message is clearly low-value or spam-like; preserve conservatively.
- Depackaged email (email_plain): bias toward pending_review when unsure; be less eager to archive than for Native BEAP; pending_delete only when content is clearly low-quality, irrelevant, or spam-like.
- Handshake-linked (non-empty handshake_id or direct_beap): strongly favor visibility and review priority; do not choose archive or pending_delete for borderline cases alone; still respect attachments and high-stakes rules.

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
import { pickOauthDebugFromError } from './gmailOAuthConnectDebug'
import { DIAGNOSE_IMAP_IPC_DEV, EMAIL_DEBUG, emailDebugLog, gmailPersistenceDebugLog } from './emailDebug'
import { runDiagnoseImapStandalone } from './diagnoseImapStandalone'
import { pickDefaultEmailAccountRowId } from './domain/accountRowPicker'
import { checkExistingCredentials, saveCredentials, isVaultUnlocked } from './credentials'
import {
  MessageSearchOptions,
  SendEmailPayload,
  IMAP_PRESETS,
  type CustomImapSmtpConnectPayload
} from './types'
import {
  clearConsecutiveZeroListingPulls,
  syncAccountEmails,
  startAutoSync,
  updateSyncState,
  type SyncResult,
} from './syncOrchestrator'
import { isLikelyEmailAuthError } from './emailAuthErrors'
import { bulkQueueDeletion, cancelRemoteDeletion, deleteAllDirectBeapMessages } from './remoteDeletion'
import {
  enqueueOrchestratorRemoteMutations,
  scheduleOrchestratorRemoteDrain,
  listRemoteOrchestratorQueueRows,
  resetFailedOrchestratorRemoteQueueRows,
  clearFailedOrchestratorRemoteQueueForAccount,
  cleanupStaleFailedRemoteQueueOnReconnect,
  tryAutoMigrateInboxAccountOnReconnect,
  getInboxAccountMigrationDiagnostics,
  migrateInboxAccountIdAndClearQueue,
  enqueueRemoteOpsForLocalLifecycleState,
  enqueueFullRemoteSync,
  enqueueFullRemoteSyncForAccountsTouchingMessages,
  enqueueUnmirroredClassifiedLifecycleMessages,
  markOrphanPendingQueueRowsAsFailed,
  purgeImapRemoteQueueRows,
  ensureOrchestratorRemoteDrainWatchdog,
  processOrchestratorRemoteQueueBatch,
  setOrchestratorDrainProgressReporter,
  setSimpleOrchestratorRemoteDrainPrimary,
  BATCH as ORCHESTRATOR_REMOTE_QUEUE_BATCH,
} from './inboxOrchestratorRemoteQueue'
import { clearAllPullActiveLocks, markPullInactive } from './syncPullLock'
import { runInboxLifecycleTick } from './inboxLifecycleEngine'
import { reconcileImapLifecycleFromLocalState } from './imapLifecycleReconcile'
import type {
  OrchestratorRemoteApplyContext,
  OrchestratorRemoteApplyResult,
  OrchestratorRemoteOperation,
} from './domain/orchestratorRemoteTypes'
import { ensureInboxAttachmentsFromBeapPackageJson, processPendingP2PBeapEmails } from './beapEmailIngestion'
import { notifyBeapInboxDashboard } from './beapInboxDashboardNotify'
import type { InboxListFilterOptions } from './inboxWhereClause'
import { buildInboxMessagesWhereClause } from './inboxWhereClause'
import { collectReadOnlyDashboardSnapshot } from './dashboardSnapshot'

/** Dedup concurrent `inbox:aiAnalyzeMessageStream` IPC calls for the same message id. */
const activeAiAnalyzeMessageStreams = new Set<string>()
import { processPendingPlainEmails } from './plainEmailIngestion'
import { reconcileAnalyzeTriage, reconcileInboxClassification } from '../../../src/lib/inboxClassificationReconcile'
import { streamInboxOllamaAnalyzeWithSandboxRouting } from './inboxOllamaChatStreamSandbox'
import { mapInferenceRoutingErrorToIPC } from '../internalInference/inferenceRoutingIpcPayload'
import { formatSourceWeightingForPrompt, sortSourceWeightingFromMessageRow } from '../../../src/lib/inboxSortSourceWeighting'
import { extractPdfText, isPdfFile, resolveInboxPdfExtractionStatus } from './pdf-extractor'
import { readDecryptedAttachmentBuffer, type AttachmentRowCrypto } from './attachmentBlobCrypto'
import { inboxLlmChat, isLlmAvailable, INBOX_LLM_TIMEOUT_MS, resolveInboxLlmSettings, preResolveInboxLlm, type ResolvedLlmContext } from './inboxLlmChat'
import { maybePrewarmOllamaForBulkClassify, type OllamaBulkPrewarmDiag } from '../llm/ollamaBulkPrewarm'

/** Per-page strings from DB `extracted_text` (extraction joins pages with \\n\\n). */
function inboxPagesFromStoredExtractedText(text: string): string[] {
  const t = typeof text === 'string' ? text : ''
  const trimmed = t.trim()
  if (!trimmed) return []
  const parts = t.split(/\n\n+/).map((s) => s.trim()).filter(Boolean)
  return parts.length > 0 ? parts : [trimmed]
}

// ── Inbox: active auto-sync loops ──

/** @deprecated Use `inboxLlmChat` from `./inboxLlmChat` (unified provider). Kept for Ollama NDJSON stream path. */
async function callInboxOllamaChat(systemPrompt: string, userPrompt: string): Promise<string> {
  const { ollamaManager } = await import('../llm/ollama-manager')
  const modelId = await ollamaManager.getEffectiveChatModelName()
  if (!modelId) {
    throw new Error('No LLM model installed. Install a model in LLM Settings first.')
  }
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

/** @deprecated Use `isLlmAvailable` from `./inboxLlmChat`. */
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
  // 1. Try markdown code block content first (model wrapped output in ```json...```)
  const cbMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/)
  const fromBlock = cbMatch?.[1]?.trim()
  if (fromBlock) {
    try { return JSON.parse(fromBlock) as Record<string, unknown> } catch {}
  }

  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()

  // 2. Direct parse (model returned clean JSON with no prose)
  try { return JSON.parse(text) as Record<string, unknown> } catch {}

  // 3. Brace-depth scan: extract the first complete JSON object even when the model
  //    adds explanatory prose that itself contains { } characters before the real JSON.
  //    Simple indexOf('{') is NOT enough — it picks up {email system}, {company}, etc.
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '{') continue
    let depth = 0
    let inString = false
    let escape = false
    for (let j = i; j < text.length; j++) {
      const ch = text[j]
      if (escape) { escape = false; continue }
      if (ch === '\\' && inString) { escape = true; continue }
      if (ch === '"') { inString = !inString; continue }
      if (inString) continue
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          try { return JSON.parse(text.substring(i, j + 1)) as Record<string, unknown> } catch {}
          break
        }
      }
    }
  }

  return {}
}

/**
 * Body text for AI analyze/draft prompts on native BEAP rows — prefers depackaged structure
 * and package transport text over raw body_text placeholders.
 */
function buildNativeBeapAnalyzeBody(row: {
  body_text?: string | null
  depackaged_json?: string | null
  beap_package_json?: string | null
  subject?: string | null
}): string {
  let messageContent = ''
  if (row.depackaged_json) {
    try {
      const d = JSON.parse(row.depackaged_json) as Record<string, unknown>
      const body = d.body
      if (typeof body === 'string') {
        messageContent = body
      } else if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>
        messageContent = String(b.text ?? b.content ?? b.message ?? b.body ?? b.plaintext ?? '')
        if (!messageContent.trim()) messageContent = JSON.stringify(body, null, 2)
      }
      const subj = d.subject
      if (typeof subj === 'string' && subj.trim()) {
        messageContent = `Subject: ${subj}\n\n${messageContent}`
      }
    } catch {
      messageContent = (row.body_text || '').trim()
    }
  } else {
    messageContent = (row.body_text || '').trim()
  }
  const rawBt = (row.body_text || '').trim()
  if (
    !messageContent.trim() &&
    rawBt &&
    !rawBt.includes('open in extension') &&
    !rawBt.includes('Encrypted qBEAP')
  ) {
    messageContent = rawBt
  }
  if (!messageContent.trim() && row.beap_package_json) {
    try {
      const pkg = JSON.parse(row.beap_package_json) as Record<string, unknown>
      const tp =
        (typeof pkg.transport_plaintext === 'string' && pkg.transport_plaintext) ||
        (pkg.header &&
          typeof pkg.header === 'object' &&
          typeof (pkg.header as Record<string, unknown>).transport_plaintext === 'string' &&
          String((pkg.header as Record<string, unknown>).transport_plaintext)) ||
        ''
      if (typeof tp === 'string' && tp.trim()) messageContent = tp.trim()
    } catch {
      /* ignore */
    }
  }
  if (!messageContent.trim()) messageContent = row.subject || '(no content)'
  return messageContent.slice(0, 12_000)
}

/** Normalize draftReply from LLM JSON for native BEAP (flat keys, object, or stringified JSON). */
function normalizeNativeBeapDraftReply(parsed: Record<string, unknown>): {
  publicMessage: string
  encryptedMessage: string
} | null {
  const flatPub = typeof parsed.draftReplyPublic === 'string' ? parsed.draftReplyPublic.trim() : ''
  const flatFull = typeof parsed.draftReplyFull === 'string' ? parsed.draftReplyFull.trim() : ''
  if (flatPub || flatFull) {
    return { publicMessage: flatPub, encryptedMessage: flatFull }
  }
  const dr = parsed.draftReply
  if (dr && typeof dr === 'object' && !Array.isArray(dr)) {
    const o = dr as Record<string, unknown>
    if ('publicMessage' in o || 'encryptedMessage' in o) {
      return {
        publicMessage: String(o.publicMessage ?? ''),
        encryptedMessage: String(o.encryptedMessage ?? ''),
      }
    }
  }
  if (typeof dr === 'string' && dr.trim().startsWith('{')) {
    try {
      const inner = parseAiJson(dr) as Record<string, unknown>
      if (inner.publicMessage != null || inner.encryptedMessage != null) {
        return {
          publicMessage: String(inner.publicMessage ?? ''),
          encryptedMessage: String(inner.encryptedMessage ?? ''),
        }
      }
    } catch {
      /* ignore */
    }
  }
  return null
}

const activeAutoSyncLoops = new Map<string, { stop: () => void }>()

/** Set from `main.ts` with the same getter as inbox — used for post-connect remote queue cleanup. */
let inboxDbGetterForEmailIpc: (() => Promise<any> | any) | null = null

/**
 * Notify renderer(s) to refresh inbox list snapshot after background sync (or invalidate on error).
 * Uses same IPC channel as legacy `inbox:newMessages` — renderer always re-queries SQLite via `listMessages`.
 * - Success (`result.ok`): send full `SyncResult` (even when `newMessages === 0`).
 * - Failure / timeout / `!result.ok`: send lightweight `{ inboxInvalidate: true, reason }`.
 */
function broadcastInboxSnapshotAfterSync(result: SyncResult | null, error?: unknown): void {
  const useInvalidate = error != null || result == null || !result.ok
  const payload: unknown = useInvalidate
    ? {
        inboxInvalidate: true,
        reason:
          error != null
            ? String((error as Error)?.message ?? error)
            : result?.errors?.[0] ?? 'sync_failed',
      }
    : result
  BrowserWindow.getAllWindows().forEach((w) => {
    try {
      if (!w.isDestroyed() && w.webContents) w.webContents.send('inbox:newMessages', payload)
    } catch {
      /* ignore */
    }
  })
}

/**
 * IMAP-only periodic pull (separate from DB-driven `startAutoSync`).
 * Registered once from `registerInboxHandlers` — must not live behind `showOutlookSetupDialog` or other dead paths.
 */
const IMAP_AUTO_SYNC_INTERVAL_MS = 2 * 60 * 1000
let imapBruteForceAutoSyncIntervalHandle: ReturnType<typeof setInterval> | null = null

function ensureImapBruteForceAutoSyncIntervalRegistered(getDb: () => Promise<any> | any): void {
  if (imapBruteForceAutoSyncIntervalHandle != null) return

  imapBruteForceAutoSyncIntervalHandle = setInterval(() => {
    void (async () => {
      try {
        const accounts = await emailGateway.listAccounts()
        const db = typeof getDb === 'function' ? await getDb() : getDb
        if (!db) return

        for (const acc of accounts) {
          if (acc.provider !== 'imap' || acc.status !== 'active') continue
          if (acc.processingPaused === true) continue
          console.log('[IMAP-AUTO-SYNC] Triggering pull for IMAP account:', acc.id, acc.email)
          console.log('[IMAP-AUTO-SYNC] Account status:', acc.status, 'processingPaused:', acc.processingPaused)
          try {
            const result = await syncAccountEmails(db, { accountId: acc.id })
            broadcastInboxSnapshotAfterSync(result)
            console.log('[IMAP-AUTO-SYNC] Pull completed for:', acc.id)
          } catch (err) {
            console.error('[IMAP-AUTO-SYNC] Pull failed for:', acc.id, err)
            broadcastInboxSnapshotAfterSync(null, err)
          }
        }
      } catch (err) {
        console.error('[IMAP-AUTO-SYNC] Error:', err)
      }
    })()
  }, IMAP_AUTO_SYNC_INTERVAL_MS)

  console.log('[IMAP-AUTO-SYNC] Registered IMAP auto-sync interval (every 2 min)')
}

/**
 * Start the per-account auto-sync timer if not already running (reads `sync_interval_ms` from `email_sync_state`).
 */
function startStoredAutoSyncLoopIfMissing(
  db: any,
  accountId: string,
  getDbForRemoteDrain?: () => Promise<any> | any,
): void {
  if (activeAutoSyncLoops.has(accountId)) return
  const row = db
    .prepare('SELECT sync_interval_ms FROM email_sync_state WHERE account_id = ?')
    .get(accountId) as { sync_interval_ms?: number } | undefined
  const intervalMs = row?.sync_interval_ms ?? 300_000
  const loop = startAutoSync(
    db,
    accountId,
    intervalMs,
    (r, e) => broadcastInboxSnapshotAfterSync(r, e),
    getDbForRemoteDrain,
  )
  activeAutoSyncLoops.set(accountId, loop)
}

/**
 * If any account already has inbox auto-sync enabled, turn it on for this account and start its loop.
 * Used when adding IMAP (or another) account while global Auto is already on in SQLite.
 */
function mirrorGlobalAutoSyncToNewAccount(accountId: string): void {
  void (async () => {
    try {
      if (!inboxDbGetterForEmailIpc) return
      const db =
        typeof inboxDbGetterForEmailIpc === 'function'
          ? await inboxDbGetterForEmailIpc()
          : inboxDbGetterForEmailIpc
      if (!db) return
      const anyAuto = db.prepare('SELECT 1 FROM email_sync_state WHERE auto_sync_enabled = 1 LIMIT 1').get()
      if (!anyAuto) return
      updateSyncState(db, accountId, { auto_sync_enabled: 1 })
      startStoredAutoSyncLoopIfMissing(db, accountId, inboxDbGetterForEmailIpc ?? undefined)
      console.log('[Email IPC] Mirrored global auto-sync to new account:', accountId)
    } catch (e: any) {
      console.warn('[Email IPC] mirrorGlobalAutoSyncToNewAccount:', e?.message)
    }
  })()
}

async function runPostEmailConnectFailedQueueCleanup(account: { id: string; email: string }): Promise<void> {
  if (!inboxDbGetterForEmailIpc) return
  try {
    const db =
      typeof inboxDbGetterForEmailIpc === 'function' ? await inboxDbGetterForEmailIpc() : inboxDbGetterForEmailIpc
    if (!db) return
    const accounts = await emailGateway.listAccounts()
    const slim = accounts.map((a) => ({ id: a.id, email: a.email }))
    const mig = tryAutoMigrateInboxAccountOnReconnect(db, slim, { id: account.id, email: account.email })
    if (mig.didMigrate) {
      console.log(
        `[Email IPC] Post-connect: migrated inbox ${mig.fromId} → ${mig.toId} (${mig.messagesUpdated} messages, ${mig.queueRowsDeleted} queue row(s) removed)`,
      )
    } else if (mig.reason && mig.reason !== 'email_not_unique_in_gateway') {
      console.log('[Email IPC] Post-connect: inbox account auto-migrate skipped:', mig.reason)
    }
    const { deletedCount } = cleanupStaleFailedRemoteQueueOnReconnect(db, slim, {
      id: account.id,
      email: account.email,
    })
    if (deletedCount > 0) {
      console.log(
        `[Email IPC] Post-connect: removed ${deletedCount} stale failed remote queue row(s) (orphan / same-email old id)`,
      )
    }
  } catch (e: any) {
    console.warn('[Email IPC] Post-connect failed-queue cleanup skipped:', e?.message)
  }
}

/**
 * Register all email-related IPC handlers.
 * Uses removeHandler before each handle to allow re-registration (idempotent).
 * @param getInboxDb — optional; when set, stale failed remote queue rows are cleaned after a successful account connect.
 */
export function registerEmailHandlers(getInboxDb?: () => Promise<any> | any): void {
  inboxDbGetterForEmailIpc = getInboxDb ?? null
  console.log('[Email IPC] Registering handlers...')
  
  const channels = [
    'email:listAccounts', 'email:getAccount', 'email:setProcessingPaused', 'email:deleteAccount', 'email:testConnection',
    'email:getImapReconnectHints', 'email:updateImapCredentials',
    'email:getImapPresets', 'email:setGmailCredentials', 'email:connectGmail',
    'email:getGmailOAuthRuntimeDiagnostics', 'email:showGmailSetup',
    'email:checkGmailCredentials', 'email:checkOutlookCredentials', 'email:checkZohoCredentials',
    'email:setOutlookCredentials', 'email:connectOutlook', 'email:showOutlookSetup',
    'email:setZohoCredentials', 'email:connectZoho',
    'email:connectImap', 'email:connectCustomMailbox',
    'email:validateImapLifecycleRemote',
    'email:listMessages', 'email:getMessage', 'email:markAsRead', 'email:markAsUnread', 'email:flagMessage',
    'email:listAttachments', 'email:extractAttachmentText', 'email:sendReply', 'email:sendEmail', 'email:sendBeapEmail',
    'email:syncAccount', 'email:getSyncStatus',
  ] as const
  channels.forEach(ch => ipcMain.removeHandler(ch))
  ipcMain.removeHandler('email:diagnoseImap')

  // =================================================================
  // Account Management
  // =================================================================
  
  /**
   * List all email accounts
   */
  ipcMain.handle('email:listAccounts', async () => {
    try {
      const accounts = await emailGateway.listAccounts()
      const persistence = emailGateway.getPersistenceDiagnostics()
      emailDebugLog('[Email IPC] listAccounts', accounts.length, 'rows', {
        loadOk: persistence.load.ok,
        decryptIssues: persistence.credentialDecryptIssues.length,
      })
      gmailPersistenceDebugLog('listAccounts', accounts.length, 'rows', {
        load: persistence.load,
        rehydrate: persistence.rehydrateSnapshot,
        decryptIssueCount: persistence.credentialDecryptIssues.length,
        lastPersistOk: persistence.lastPersistOk,
        secureStorageAvailable: persistence.secureStorageAvailable,
      })
      return { ok: true, data: accounts, persistence }
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

  ipcMain.handle('email:setProcessingPaused', async (_e, accountId: unknown, paused: unknown) => {
    try {
      const id = typeof accountId === 'string' ? accountId.trim() : ''
      if (!id) return { ok: false, error: 'accountId required' }
      if (typeof paused !== 'boolean') return { ok: false, error: 'paused must be a boolean' }
      const info = await emailGateway.setProcessingPaused(id, paused)
      return { ok: true, data: info }
    } catch (error: any) {
      console.error('[Email IPC] setProcessingPaused error:', error)
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

  // DEV ONLY — raw IMAP diagnostic, not for production
  if (DIAGNOSE_IMAP_IPC_DEV) {
    ipcMain.handle('email:diagnoseImap', async (_e, raw: unknown) => {
      try {
        const p = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
        if (!p) {
          return { ok: false, error: 'Expected object { host, port, security, username, password }' }
        }
        const host = typeof p.host === 'string' ? p.host.trim() : ''
        if (!host || host.length > 253 || /\s/.test(host)) {
          return { ok: false, error: 'host: invalid (1–253 chars, no whitespace)' }
        }
        const portNum = typeof p.port === 'number' ? p.port : parseInt(String(p.port ?? '').trim(), 10)
        if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
          return { ok: false, error: 'port: expected integer 1–65535' }
        }
        const sec = p.security
        if (sec !== 'ssl' && sec !== 'starttls' && sec !== 'none') {
          return { ok: false, error: 'security: expected ssl | starttls | none' }
        }
        const username = typeof p.username === 'string' ? p.username.trim() : ''
        if (!username || username.length > 320) {
          return { ok: false, error: 'username: non-empty string required (max 320 chars)' }
        }
        const password = typeof p.password === 'string' ? p.password : ''
        if (!password || password.length > 2048) {
          return { ok: false, error: 'password: non-empty string required (max 2048 chars)' }
        }
        const data = await runDiagnoseImapStandalone({
          host,
          port: portNum,
          security: sec,
          username,
          password,
        })
        return { ok: true, data }
      } catch (error: any) {
        console.error('[Email IPC] diagnoseImap error:', error)
        return { ok: false, error: error.message ?? String(error) }
      }
    })
  }

  ipcMain.handle('email:getImapReconnectHints', async (_e, accountId: string) => {
    try {
      const id = String(accountId ?? '').trim()
      if (!id) return { ok: false, error: 'accountId required' }
      const hints = await emailGateway.getImapReconnectHints(id)
      return { ok: true, data: hints }
    } catch (error: any) {
      console.error('[Email IPC] getImapReconnectHints error:', error)
      return { ok: false, error: error.message }
    }
  })

  ipcMain.handle(
    'email:updateImapCredentials',
    async (
      _e,
      accountId: string,
      creds: { imapPassword: string; smtpPassword?: string; smtpUseSameCredentials?: boolean },
    ) => {
      try {
        const id = String(accountId ?? '').trim()
        if (!id) return { ok: false, error: 'accountId required' }
        const result = await emailGateway.updateImapCredentials(id, creds ?? { imapPassword: '' })
        return { ok: true, data: result }
      } catch (error: any) {
        console.error('[Email IPC] updateImapCredentials error:', error)
        return { ok: false, error: error.message }
      }
    },
  )

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
  ipcMain.handle(
    'email:setGmailCredentials',
    async (_e, clientId: string, clientSecret: string | undefined, storeInVault: boolean = true) => {
      try {
        if (!clientId?.trim()) {
          return { ok: false, error: 'clientId is required' }
        }
        const result = await saveCredentials(
          'gmail',
          { clientId: clientId.trim(), clientSecret: clientSecret?.trim() },
          storeInVault,
        )
        return { ok: result.ok, savedToVault: result.savedToVault, error: result.error }
      } catch (error: any) {
        console.error('[Email IPC] setGmailCredentials error:', error)
        return { ok: false, error: error.message }
      }
    },
  )

  /**
   * Check Gmail credentials with honest source (vault / vault-migrated / temporary / none)
   */
  ipcMain.handle('email:checkGmailCredentials', async () => {
    try {
      const { isEmailDeveloperModeEnabled, getStandardConnectBuiltinClientDiagnostics } = await import(
        './googleOAuthBuiltin'
      )
      const result = await checkExistingCredentials('gmail')
      const canConnect =
        !!result.credentials || result.builtinOAuthAvailable === true
      const std = getStandardConnectBuiltinClientDiagnostics()
      return {
        ok: true,
        data: {
          configured: canConnect,
          developerCredentialsStored: !!result.credentials,
          builtinOAuthAvailable: result.builtinOAuthAvailable === true,
          developerModeEnabled: isEmailDeveloperModeEnabled(),
          clientId: result.clientId,
          source: result.source,
          credentials: result.credentials,
          hasSecret: result.hasSecret,
          vaultUnlocked: isVaultUnlocked(),
          standardConnectBundledClientFingerprint: std.standardConnectBundledClientFingerprint,
          standardConnectBuiltinSourceKind: std.standardConnectBuiltinSourceKind,
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

  ipcMain.handle('email:checkZohoCredentials', async () => {
    try {
      const result = await checkExistingCredentials('zoho')
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
  ipcMain.handle(
    'email:connectGmail',
    async (
      _e,
      displayName?: string,
      syncWindowDays?: number,
      gmailOAuthCredentialSource?: 'builtin_public' | 'developer_saved',
    ) => {
    try {
      gmailPersistenceDebugLog('connectGmail requested', { displayName, syncWindowDays, gmailOAuthCredentialSource })
      const account = await emailGateway.connectGmailAccount(displayName, syncWindowDays, {
        gmailOAuthCredentialSource,
      })
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('email:accountConnected', {
          provider: 'gmail',
          email: account.email,
          accountId: account.id,
        })
      })
      if (account.status === 'active') {
        gmailPersistenceDebugLog('connectGmail persisted and verified', { id: account.id, email: account.email })
        void runPostEmailConnectFailedQueueCleanup({ id: account.id, email: account.email })
        mirrorGlobalAutoSyncToNewAccount(account.id)
        return { ok: true, data: account }
      }
      gmailPersistenceDebugLog('connectGmail finished without active status', {
        id: account.id,
        status: account.status,
        lastError: account.lastError,
      })
      return {
        ok: false,
        error:
          account.lastError ||
          'Gmail sign-in completed but verification failed. The account is on file — try Connect again or check the account status below.',
        data: account,
        needsReconnect: true,
        debug: null,
      }
    } catch (error: any) {
      console.error('[Email IPC] connectGmail error:', error)
      gmailPersistenceDebugLog('connectGmail threw', error?.message)
      return {
        ok: false,
        error: error?.message != null ? String(error.message) : 'Unknown error',
        debug: pickOauthDebugFromError(error),
      }
    }
  })

  /**
   * Packaged Gmail OAuth runtime proof (fingerprints + startup paths only — no secrets, tokens, full client ids).
   */
  ipcMain.handle('email:getGmailOAuthRuntimeDiagnostics', async () => {
    try {
      const { getGmailOAuthPackagedStartupDiagnostics } = await import('./googleOAuthBuiltin')
      const { getLastGmailStandardConnectRuntimeProof } = await import('./gmailOAuthRuntimeProof')
      const startup = getGmailOAuthPackagedStartupDiagnostics()
      const lastStandardConnectFlow = getLastGmailStandardConnectRuntimeProof()
      return {
        ok: true,
        data: {
          expectedBundledClientFingerprint: startup.bundledFirstLineClientIdFingerprint,
          authorizeClientIdFingerprint: lastStandardConnectFlow?.authorizeClientIdFingerprint ?? null,
          tokenExchangeClientIdFingerprint: lastStandardConnectFlow?.tokenExchangeClientIdFingerprint ?? null,
          builtinSourceKind: lastStandardConnectFlow?.builtinSourceKind ?? null,
          authMode: lastStandardConnectFlow?.authMode ?? null,
          packagedStandardConnectEnvIgnored: lastStandardConnectFlow?.packagedStandardConnectEnvIgnored ?? false,
          startup,
          lastStandardConnectFlow,
        },
      }
    } catch (error: any) {
      console.error('[Email IPC] getGmailOAuthRuntimeDiagnostics error:', error)
      return { ok: false, error: error?.message ?? String(error) }
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
      return { ok: result.ok, savedToVault: result.savedToVault, error: result.error }
    } catch (error: any) {
      console.error('[Email IPC] setOutlookCredentials error:', error)
      return { ok: false, error: error.message }
    }
  })
  
  /**
   * Start Outlook OAuth flow
   */
  ipcMain.handle('email:connectOutlook', async (_e, displayName?: string, syncWindowDays?: number) => {
    try {
      gmailPersistenceDebugLog('connectOutlook requested', { displayName, syncWindowDays })
      const account = await emailGateway.connectOutlookAccount(displayName, syncWindowDays)
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('email:accountConnected', {
          provider: 'microsoft365',
          email: account.email,
          accountId: account.id,
        })
      })
      if (account.status === 'active') {
        gmailPersistenceDebugLog('connectOutlook persisted and verified', { id: account.id, email: account.email })
        void runPostEmailConnectFailedQueueCleanup({ id: account.id, email: account.email })
        mirrorGlobalAutoSyncToNewAccount(account.id)
        return { ok: true, data: account }
      }
      gmailPersistenceDebugLog('connectOutlook finished without active status', {
        id: account.id,
        status: account.status,
        lastError: account.lastError,
      })
      return {
        ok: false,
        error:
          account.lastError ||
          'Microsoft 365 sign-in completed but verification failed. The account is on file — try Connect again.',
        data: account,
        needsReconnect: true,
        debug: null,
      }
    } catch (error: any) {
      console.error('[Email IPC] connectOutlook error:', error)
      gmailPersistenceDebugLog('connectOutlook threw', error?.message)
      return {
        ok: false,
        error: error?.message != null ? String(error.message) : 'Unknown error',
        debug: pickOauthDebugFromError(error),
      }
    }
  })

  ipcMain.handle(
    'email:setZohoCredentials',
    async (
      _e,
      clientId: string,
      clientSecret: string,
      datacenter: 'com' | 'eu' = 'com',
      storeInVault: boolean = true,
    ) => {
      try {
        const result = await saveCredentials(
          'zoho',
          {
            clientId,
            clientSecret,
            datacenter: datacenter === 'eu' ? 'eu' : 'com',
          },
          storeInVault,
        )
        return { ok: result.ok, savedToVault: result.savedToVault, error: result.error }
      } catch (error: any) {
        console.error('[Email IPC] setZohoCredentials error:', error)
        return { ok: false, error: error.message }
      }
    },
  )

  ipcMain.handle('email:connectZoho', async (_e, displayName?: string, syncWindowDays?: number) => {
    try {
      gmailPersistenceDebugLog('connectZoho requested', { displayName, syncWindowDays })
      const account = await emailGateway.connectZohoAccount(displayName, syncWindowDays)
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('email:accountConnected', {
          provider: 'zoho',
          email: account.email,
          accountId: account.id,
        })
      })
      if (account.status === 'active') {
        gmailPersistenceDebugLog('connectZoho persisted and verified', { id: account.id, email: account.email })
        void runPostEmailConnectFailedQueueCleanup({ id: account.id, email: account.email })
        mirrorGlobalAutoSyncToNewAccount(account.id)
        return { ok: true, data: account }
      }
      gmailPersistenceDebugLog('connectZoho finished without active status', {
        id: account.id,
        status: account.status,
        lastError: account.lastError,
      })
      return {
        ok: false,
        error:
          account.lastError ||
          'Zoho sign-in completed but verification failed. The account is on file — try Connect again.',
        data: account,
        needsReconnect: true,
        debug: null,
      }
    } catch (error: any) {
      console.error('[Email IPC] connectZoho error:', error)
      gmailPersistenceDebugLog('connectZoho threw', error?.message)
      return {
        ok: false,
        error: error?.message != null ? String(error.message) : 'Unknown error',
        debug: pickOauthDebugFromError(error),
      }
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
    syncWindowDays?: number
  }) => {
    try {
      const account = await emailGateway.connectImapAccount(config)
      BrowserWindow.getAllWindows().forEach(win => {
        win.webContents.send('email:accountConnected', { provider: 'imap', email: account.email, accountId: account.id })
      })
      void runPostEmailConnectFailedQueueCleanup({ id: account.id, email: account.email })
      mirrorGlobalAutoSyncToNewAccount(account.id)
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
        win.webContents.send('email:accountConnected', { provider: 'imap', email: account.email, accountId: account.id })
      })
      void runPostEmailConnectFailedQueueCleanup({ id: account.id, email: account.email })
      mirrorGlobalAutoSyncToNewAccount(account.id)
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

/**
 * Conservative IMAP drain profile (SimpleDrain timer path).
 * - Does **not** force reconnect on every tick: only when `isProviderSessionConnected` is false or on transient errors.
 * - `tickIntervalMs` is how often we **wake** to dequeue; spacing between moves/batches uses the other fields.
 * - Reconnect policy: **on_error_only** — see IMAP warmup + transient handler (no reconnect when session already connected).
 */
const IMAP_SIMPLE_DRAIN = {
  interRowDelayMs: 1000,
  batchSize: 10,
  pauseAfterBatchMs: 30_000,
  tickIntervalMs: 10_000,
}

const SIMPLE_DRAIN_INTERVAL_MS = IMAP_SIMPLE_DRAIN.tickIntervalMs
/** Fetch extra candidates so we can cap IMAP rows per tick without starving API accounts. */
const SIMPLE_DRAIN_FETCH_CAP = 45
const SIMPLE_DRAIN_MAX_ROWS_PER_TICK = 20
const SIMPLE_DRAIN_MAX_IMAP_ROWS_PER_TICK = IMAP_SIMPLE_DRAIN.batchSize
const SIMPLE_DRAIN_MAX_ATTEMPTS = 8
/** After repeated IMAP apply failures, enforce a long cool-down (ms). */
const SIMPLE_DRAIN_IMAP_LONG_COOLDOWN_MS = 300_000

type SimpleDrainProfile = { interRowMs: number; pauseAfterBatchMs: number; transientPauseMs: number }

function simpleDrainProfileForProvider(providerType: string): SimpleDrainProfile {
  if (providerType === 'microsoft365' || providerType === 'gmail') {
    return { interRowMs: 200, pauseAfterBatchMs: 5000, transientPauseMs: 3000 }
  }
  if (providerType === 'imap') {
    return {
      interRowMs: IMAP_SIMPLE_DRAIN.interRowDelayMs,
      pauseAfterBatchMs: IMAP_SIMPLE_DRAIN.pauseAfterBatchMs,
      transientPauseMs: 60_000,
    }
  }
  return { interRowMs: 1000, pauseAfterBatchMs: 30_000, transientPauseMs: 60_000 }
}

/** Gate the next batch start (conservative IMAP spacing — “slow and reliable”). */
let simpleDrainNextBatchAllowedAt = 0
let simpleDrainImapApplyErrorStreak = 0

/** Single process-wide interval — started from {@link registerInboxHandlers}. */
let simpleOrchestratorRemoteDrainInterval: ReturnType<typeof setInterval> | null = null

type SimpleDrainQueueRow = {
  id: string
  message_id: string
  account_id: string
  email_message_id: string
  operation: OrchestratorRemoteOperation
  attempts: number | null
  imap_remote_mailbox: string | null
  imap_rfc_message_id: string | null
}

function simpleDrainIsPermanentOrchestratorError(message: string): boolean {
  const m = message.toLowerCase()
  return (
    (m.includes('account not found') && m.includes('disconnected or removed')) ||
    m.includes('does not implement remote orchestrator') ||
    m.includes('failed to decrypt stored') ||
    m.includes('failed to decrypt imap') ||
    m.includes('failed to decrypt smtp')
  )
}

function simpleDrainIsTransientOrchestratorError(message: string): boolean {
  if (!message || typeof message !== 'string') return false
  if (simpleDrainIsPermanentOrchestratorError(message)) return false
  const m = message.toLowerCase()
  return (
    /timeout|timed out|handshake/i.test(m) ||
    /not connected|connection closed|connection lost|connection reset/i.test(m) ||
    /econnreset|epipe|etimedout|enotconn|socket|network|broken pipe|write econnreset|read econnreset/i.test(m) ||
    /not authenticated|session not connected/i.test(m) ||
    /reconnect required/i.test(m) ||
    /imap (client|connection)|no.*socket/i.test(m) ||
    /account authentication failed — reconnect required/i.test(m)
  )
}

/**
 * Register inbox IPC handlers.
 * Requires db (or getter) and optional mainWindow for sending events.
 * Call from main.ts alongside registerEmailHandlers.
 * getAnthropicApiKey is reserved for future use; inbox PDF text uses extractPdfText only (no Vision fallback).
 */
export function registerInboxHandlers(
  getDb: () => Promise<any> | any,
  mainWindow?: BrowserWindow | null,
  _getAnthropicApiKey?: GetAnthropicApiKey,
): void {
  console.log('[INBOX-IPC] registerInboxHandlers called')

  const channels = [
    'inbox:syncAccount',
    'inbox:pullMore',
    'inbox:resetSyncState',
    'inbox:fullResetAccount',
    'inbox:debugDumpSyncState',
    'inbox:patchAccountSyncPreferences',
    'inbox:toggleAutoSync',
    'inbox:getSyncState',
    'inbox:listMessages', 'inbox:listMessageIds', 'inbox:dashboardSnapshot', 'inbox:getMessage', 'inbox:getBeapRedirectSource',
    'inbox:beapInboxCloneToSandboxPrepare',
    'inbox:cloneBeapToSandbox',
    'inbox:markRead', 'inbox:toggleStar', 'inbox:archiveMessages', 'inbox:setCategory',
    'inbox:deleteMessages', 'inbox:cancelDeletion', 'inbox:getDeletedMessages', 'inbox:deleteAllDirectBeap',
    'inbox:getAttachment', 'inbox:getAttachmentText', 'inbox:openAttachmentOriginal', 'inbox:rasterAttachment',
    'inbox:aiSummarize', 'inbox:aiDraftReply', 'inbox:aiAnalyzeMessage', 'inbox:aiAnalyzeMessageStream', 'inbox:aiClassifySingle', 'inbox:aiClassifyBatch', 'inbox:persistManualBulkAnalysis', 'inbox:aiCategorize', 'inbox:enqueueRemoteLifecycleMirror', 'inbox:enqueueRemoteSync', 'inbox:markPendingDelete', 'inbox:moveToPendingReview', 'inbox:cancelPendingDelete', 'inbox:cancelPendingReview', 'inbox:unarchive', 'inbox:autosortDiagSync',
    'inbox:getInboxSettings', 'inbox:setInboxSettings', 'inbox:selectAndUploadContextDoc', 'inbox:deleteContextDoc', 'inbox:listContextDocs',
    'inbox:getAiRules', 'inbox:saveAiRules', 'inbox:getAiRulesDefault',
    'inbox:listRemoteOrchestratorQueue',
    'inbox:retryFailedRemoteOps',
    'inbox:reconcileImapRemoteLifecycle',
    'inbox:fullRemoteSync',
    'inbox:fullRemoteSyncForMessages',
    'inbox:fullRemoteSyncAllAccounts',
    'inbox:debugMainInboxRows',
    'inbox:verifyImapRemoteFolders',
    'inbox:debugAccountMigrationStatus',
    'inbox:migrateInboxAccountId',
    'inbox:debugTestMoveOne',
    'autosort:createSession',
    'autosort:finalizeSession',
    'autosort:getSession',
    'autosort:listSessions',
    'autosort:deleteSession',
    'autosort:getSessionMessages',
    'autosort:generateSummary',
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

  /** Same DB accessor as all inbox handlers + drain; drives optional UI drain progress. */
  const resolveDbCore = async () => (typeof getDb === 'function' ? await getDb() : getDb)
  const resolveDb = resolveDbCore

  async function resolveDbWithDiag(handler: string): Promise<Awaited<ReturnType<typeof resolveDbCore>>> {
    const db = await resolveDbCore()
    if (DEBUG_AUTOSORT_DIAGNOSTICS) {
      autosortDiagLog('resolveDb', { handler, result: db ? 'handle' : 'null' })
    }
    return db
  }

  /**
   * Effective max concurrent Ollama `/api/chat` calls per `aiClassifyBatch` chunk.
   * - **Normal path:** renderer sends `ollamaMaxConcurrentFromUi` (1–8) from bulk progress **Parallelism** control (persisted).
   * - **Developer override:** `WRDESK_OLLAMA_CLASSIFY_MAX_CONCURRENT` — when set (valid int), **wins** over UI for that process.
   * - **Fallback** when env unset and UI omitted: **4**.
   * Chunk **batch size** (how many message IDs per IPC) is separate — renderer `sortConcurrency`; this cap only limits in-flight Ollama classifies **inside** each batch.
   */
  let _ollamaCapEnvRangeWarned = false
  function resolveBulkOllamaClassifyCap(fromUi?: number | null): { cap: number; source: 'env' | 'ui' | 'default' } {
    const envRaw = process.env.WRDESK_OLLAMA_CLASSIFY_MAX_CONCURRENT
    if (envRaw != null && String(envRaw).trim() !== '') {
      const parsed = Number.parseInt(String(envRaw), 10)
      if (Number.isFinite(parsed)) {
        const clamped = Math.max(1, Math.min(8, Math.floor(parsed)))
        if (
          !_ollamaCapEnvRangeWarned &&
          (parsed < 1 || parsed > 8 || Math.floor(parsed) !== clamped)
        ) {
          _ollamaCapEnvRangeWarned = true
          console.warn(
            '[AutoSort] WRDESK_OLLAMA_CLASSIFY_MAX_CONCURRENT must be integer 1–8; using',
            clamped,
            `(raw=${JSON.stringify(envRaw)})`,
          )
        }
        return { cap: clamped, source: 'env' }
      }
    }
    if (typeof fromUi === 'number' && Number.isFinite(fromUi)) {
      return { cap: Math.max(1, Math.min(8, Math.floor(fromUi))), source: 'ui' }
    }
    return { cap: 4, source: 'default' }
  }

  /** Last resolved cap for tuning logs (updated each successful `aiClassifyBatch`; reset when bulk starts). */
  let lastBulkOllamaResolve: { cap: number; source: 'env' | 'ui' | 'default' } = { cap: 4, source: 'default' }

  /** Peak `maxInFlightSeenDuringChunk` across chunks in the current bulk run (updated in `aiClassifyBatch`; reset when bulk starts). */
  let autosortBulkRunMaxInFlight = 0
  /** True if any chunk used local Ollama (`run-tuning-main` in-flight hints apply only then). */
  let autosortBulkRunUsedOllama = false

  ipcMain.handle(
    'inbox:autosortDiagSync',
    (_e, payload: { runId: string | null; bulkSortActive: boolean }) => {
      if (payload.bulkSortActive) {
        autosortBulkRunMaxInFlight = 0
        autosortBulkRunUsedOllama = false
        lastBulkOllamaResolve = { cap: 4, source: 'default' }
      } else if (DEBUG_AUTOSORT_TIMING) {
        const cap = lastBulkOllamaResolve.cap
        if (autosortBulkRunUsedOllama) {
          autosortTimingLog('run-tuning-main', {
            ollamaCapEffective: cap,
            ollamaCapSource: lastBulkOllamaResolve.source,
            maxInFlightSeenAcrossChunks: autosortBulkRunMaxInFlight,
            parallelHint:
              cap >= 2 && autosortBulkRunMaxInFlight <= 1
                ? 'maxInFlight<=1 with cap>=2: Ollama often serializing server-side — try cap 2 vs 4 vs 6 on wallMs, not sumMs.'
                : autosortBulkRunMaxInFlight >= cap
                  ? 'maxInFlight reached cap (requests overlapped on client).'
                  : 'maxInFlight below cap (small last chunks or short overlaps).',
          })
        } else {
          autosortTimingLog('run-tuning-main', {
            ollamaCapEffective: cap,
            ollamaCapSource: lastBulkOllamaResolve.source,
            note: 'No Ollama classify in this bulk run — cap / maxInFlight above are N/A for cloud-only classifies.',
          })
        }
      }
      setAutosortDiagMainState(payload)
      return { ok: true as const }
    },
  )

  ensureImapBruteForceAutoSyncIntervalRegistered(getDb)

  const RESET_SYNC_STATE_COOLDOWN_MS = 5 * 60 * 1000
  const lastInboxResetSyncStateAt = new Map<string, number>()

  // ── AutoSort sessions (autosort_sessions + inbox_messages.last_autosort_session_id) ──
  ipcMain.handle('autosort:createSession', async () => {
    const db = await resolveDb()
    if (!db) return null
    const id = randomUUID()
    db.prepare('INSERT INTO autosort_sessions (id, started_at, status) VALUES (?, ?, ?)').run(id, new Date().toISOString(), 'running')
    return id
  })

  ipcMain.handle(
    'autosort:finalizeSession',
    async (
      _e,
      sessionId: string,
      stats: {
        total: number
        urgent: number
        pendingReview: number
        pendingDelete: number
        archived: number
        errors: number
        durationMs: number
      },
    ) => {
      const db = await resolveDb()
      if (!db) return
      db.prepare(
        `UPDATE autosort_sessions SET completed_at = ?, total_messages = ?, urgent_count = ?, pending_review_count = ?, pending_delete_count = ?, archived_count = ?, error_count = ?, duration_ms = ?, status = ? WHERE id = ?`,
      ).run(
        new Date().toISOString(),
        stats.total,
        stats.urgent,
        stats.pendingReview,
        stats.pendingDelete,
        stats.archived,
        stats.errors,
        stats.durationMs,
        'completed',
        sessionId,
      )
    },
  )

  ipcMain.handle('autosort:getSession', async (_e, sessionId: string) => {
    const db = await resolveDb()
    if (!db) return undefined
    return db.prepare('SELECT * FROM autosort_sessions WHERE id = ?').get(sessionId)
  })

  ipcMain.handle('autosort:listSessions', async (_e, limit: number = 50) => {
    const db = await resolveDb()
    if (!db) return []
    return db.prepare('SELECT * FROM autosort_sessions WHERE status = ? ORDER BY started_at DESC LIMIT ?').all('completed', limit)
  })

  ipcMain.handle('autosort:deleteSession', async (_e, sessionId: string) => {
    const db = await resolveDb()
    if (!db) return
    db.prepare('UPDATE inbox_messages SET last_autosort_session_id = NULL WHERE last_autosort_session_id = ?').run(sessionId)
    db.prepare('DELETE FROM autosort_sessions WHERE id = ?').run(sessionId)
  })

  ipcMain.handle('autosort:getSessionMessages', async (_e, sessionId: string) => {
    const db = await resolveDb()
    if (!db) return []
    return db
      .prepare(
        'SELECT id, from_address, from_name, subject, received_at, sort_category, urgency_score, needs_reply, sort_reason, pending_delete, pending_review_at, archived FROM inbox_messages WHERE last_autosort_session_id = ? ORDER BY urgency_score DESC, received_at DESC',
      )
      .all(sessionId)
  })

  ipcMain.handle('autosort:generateSummary', async (_e, sessionId: string) => {
    const db = await resolveDb()
    if (!db) return null
    const messages = db
      .prepare(
        'SELECT id, from_name, from_address, subject, sort_category, urgency_score, needs_reply, sort_reason FROM inbox_messages WHERE last_autosort_session_id = ? ORDER BY urgency_score DESC',
      )
      .all(sessionId) as Array<{
      id: string
      from_name?: string | null
      from_address?: string | null
      subject?: string | null
      sort_category?: string | null
      urgency_score?: number | null
      needs_reply?: number | null
      sort_reason?: string | null
    }>

    if (!messages.length) return null

    const lines = messages.map((m, i) =>
      `${i + 1}. [${m.sort_category}|urgency:${m.urgency_score}|reply:${m.needs_reply ? 'Y' : 'N'}] ${m.from_name || m.from_address}: ${m.subject}${m.sort_reason ? ' — ' + m.sort_reason : ''}`,
    ).join('\n')

    const systemPrompt = `You are a concise email triage assistant. Given the AutoSort results below, produce a brief JSON summary.

RESPOND ONLY WITH VALID JSON. No markdown, no explanation, no code fences.

Schema:
{
  "headline": "<one sentence summary — MUST begin with the exact number of messages from the batch, e.g. '4 emails sorted — 1 has attachments needing review'>",
  "patterns_note": "<1-2 sentences about notable patterns: recurring senders, bulk newsletters, time-sensitive items, attachment-heavy messages>"
}

Rules:
- headline MUST start with the actual message count number provided in the batch
- Keep all text very concise — this is a quick-glance dashboard summary
- patterns_note should mention attachment patterns if any messages have attachments`

    const userPrompt = `AutoSort batch — ${messages.length} messages:\n\n${lines}`

    try {
      const rawStr = (await inboxLlmChat({ system: systemPrompt, user: userPrompt })).trim()
      const parsed = parseAiJson(rawStr)
      if (!parsed || Object.keys(parsed).length === 0) throw new Error('Failed to parse summary JSON')

      const actualCount = messages.length
      let headline =
        typeof parsed.headline === 'string' && parsed.headline.trim()
          ? parsed.headline.trim()
          : `${actualCount} emails sorted`
      headline = headline.replace(/^\d+/, String(actualCount))
      if (!/^\d/.test(headline)) {
        headline = `${actualCount} emails sorted — ${headline}`
      }
      const patterns_note =
        typeof parsed.patterns_note === 'string' && parsed.patterns_note.trim()
          ? parsed.patterns_note.trim()
          : ''
      const summaryOut = { headline, patterns_note }

      db.prepare('UPDATE autosort_sessions SET ai_summary_json = ? WHERE id = ?').run(JSON.stringify(summaryOut), sessionId)

      return summaryOut
    } catch (err) {
      console.error('[AutoSort] Summary generation failed:', err)
      return null
    }
  })

  setOrchestratorDrainProgressReporter((p) => {
    try {
      sendToRenderer('inbox:drainProgress', p)
    } catch {
      /* ignore */
    }
  })

  // Legacy setImmediate chain + bounded post-sync batch drain disabled — simple timer processor owns the queue.
  setSimpleOrchestratorRemoteDrainPrimary(true)

  // ═══════════════════════════════════════════════════════════
  // SIMPLE DRAIN PROCESSOR — timer-based (every 10s), up to 20 rows, no pull-lock / chain flags.
  // Runs alongside legacy code paths; `scheduleOrchestratorRemoteDrain` is a no-op while primary.
  // ═══════════════════════════════════════════════════════════
  if (!simpleOrchestratorRemoteDrainInterval) {
    let simpleDrainRunning = false
    simpleOrchestratorRemoteDrainInterval = setInterval(() => {
      void (async () => {
        if (simpleDrainRunning) return
        simpleDrainRunning = true
        try {
          const db = await resolveDb()
          if (!db) return

          const twoMinAgo = new Date(Date.now() - 120_000).toISOString()
          const nowIso = new Date().toISOString()
          db.prepare(
            `UPDATE remote_orchestrator_mutation_queue SET status = 'pending', updated_at = ? WHERE status = 'processing' AND updated_at < ?`,
          ).run(nowIso, twoMinAgo)

          if (Date.now() < simpleDrainNextBatchAllowedAt) {
            return
          }

          const rowProviderType = (accountId: string): string => {
            try {
              return emailGateway.getProviderSync(accountId)
            } catch {
              return 'imap'
            }
          }

          const rows = db
            .prepare(
              `SELECT q.id, q.message_id, q.account_id, q.email_message_id,
                      q.operation, q.attempts,
                      m.imap_remote_mailbox, m.imap_rfc_message_id
               FROM remote_orchestrator_mutation_queue q
               LEFT JOIN inbox_messages m ON m.id = q.message_id
               WHERE q.status = 'pending' AND q.attempts < ?
               ORDER BY q.created_at ASC
               LIMIT ?`,
            )
            .all(SIMPLE_DRAIN_MAX_ATTEMPTS, SIMPLE_DRAIN_FETCH_CAP) as SimpleDrainQueueRow[]

          if (rows.length === 0) return

          /* API / OAuth accounts first; cap IMAP moves per tick for conservative provider-friendly draining. */
          const sortedRows: SimpleDrainQueueRow[] = [...rows].sort((a, b) => {
            const pa = rowProviderType(a.account_id)
            const pb = rowProviderType(b.account_id)
            if (pa === 'imap' && pb !== 'imap') return 1
            if (pa !== 'imap' && pb === 'imap') return -1
            return 0
          })

          const workRows: SimpleDrainQueueRow[] = []
          let imapRowsThisTick = 0
          for (const r of sortedRows) {
            const pt = rowProviderType(r.account_id)
            const isImap = pt === 'imap'
            if (isImap && imapRowsThisTick >= SIMPLE_DRAIN_MAX_IMAP_ROWS_PER_TICK) continue
            workRows.push(r)
            if (isImap) imapRowsThisTick += 1
            if (workRows.length >= SIMPLE_DRAIN_MAX_ROWS_PER_TICK) break
          }

          const imapAccountIdsInBatch = new Set<string>()
          for (const r of workRows) {
            if (rowProviderType(r.account_id) === 'imap') imapAccountIdsInBatch.add(r.account_id)
          }

          const imapListPingFailed = new Set<string>()
          for (const accId of imapAccountIdsInBatch) {
            try {
              await emailGateway.pingImapSessionWithListFolders(accId)
              console.log('[SimpleDrain] IMAP LIST ping OK:', accId)
            } catch (pingErr: any) {
              console.warn(
                '[SimpleDrain] IMAP LIST ping FAILED — deferring IMAP rows this tick:',
                accId,
                pingErr?.message || pingErr,
              )
              imapListPingFailed.add(accId)
            }
          }

          console.log(`[SimpleDrain] Processing ${workRows.length} row(s) (${imapRowsThisTick} IMAP max cap ${SIMPLE_DRAIN_MAX_IMAP_ROWS_PER_TICK})`)
          try {
            sendToRenderer('inbox:drainProgress', {
              processed: 0,
              pending: workRows.length,
              failed: 0,
              deferred: 0,
              phase: 'simple_processing',
              batchSize: workRows.length,
            })
          } catch {
            /* ignore */
          }

          const markCompleted = db.prepare(
            `UPDATE remote_orchestrator_mutation_queue SET status = 'completed', last_error = NULL, updated_at = ? WHERE id = ?`,
          )
          const markFailed = db.prepare(
            `UPDATE remote_orchestrator_mutation_queue SET status = 'failed', attempts = ?, last_error = ?, updated_at = ? WHERE id = ?`,
          )
          const resetPending = db.prepare(
            `UPDATE remote_orchestrator_mutation_queue SET status = 'pending', attempts = ?, last_error = ?, updated_at = ? WHERE id = ?`,
          )
          const resetPendingTransient = db.prepare(
            `UPDATE remote_orchestrator_mutation_queue SET status = 'pending', last_error = ?, updated_at = ? WHERE id = ?`,
          )
          const touchMsgErr = db.prepare(`UPDATE inbox_messages SET remote_orchestrator_last_error = ? WHERE id = ?`)
          const touchMsgErrNull = db.prepare(`UPDATE inbox_messages SET remote_orchestrator_last_error = NULL WHERE id = ?`)

          let batchMoved = 0
          let batchSkipped = 0
          let batchErrors = 0
          let batchImapDeferred = 0
          const imapBatchWarmupDone = new Set<string>()

          for (const r of workRows) {
            try {
              const rowProvider = rowProviderType(r.account_id)
              const rowProf = simpleDrainProfileForProvider(rowProvider)

              if (rowProvider === 'imap' && imapListPingFailed.has(r.account_id)) {
                batchImapDeferred += 1
                console.log('[SimpleDrain] Defer row (IMAP LIST ping failed this tick):', r.id.slice(0, 8), r.account_id)
                await new Promise((res) => setTimeout(res, rowProf.interRowMs))
                continue
              }

              if (!imapBatchWarmupDone.has(r.account_id)) {
                imapBatchWarmupDone.add(r.account_id)
                try {
                  if (emailGateway.getProviderSync(r.account_id) === 'imap') {
                    /** on_error_only: reconnect only when the cached session is gone — not every timer tick. */
                    if (!emailGateway.isProviderSessionConnected(r.account_id)) {
                      console.log('[SimpleDrain] IMAP not connected, opening session:', r.account_id)
                      await emailGateway.forceReconnect(r.account_id)
                    } else {
                      console.log('[SimpleDrain] IMAP session already connected, reusing:', r.account_id)
                    }
                  }
                } catch (reErr: any) {
                  console.warn('[SimpleDrain] IMAP session ensure failed:', r.account_id, reErr?.message || reErr)
                }
              }

              db.prepare(
                `UPDATE remote_orchestrator_mutation_queue SET status = 'processing', updated_at = ? WHERE id = ?`,
              ).run(new Date().toISOString(), r.id)

              const context: OrchestratorRemoteApplyContext = {
                imapRfcMessageId: r.imap_rfc_message_id ?? null,
                imapRemoteMailbox: r.imap_remote_mailbox ?? null,
              }

              let apply: OrchestratorRemoteApplyResult
              try {
                apply = await emailGateway.applyOrchestratorRemoteOperation(
                  r.account_id,
                  r.email_message_id,
                  r.operation,
                  context,
                )
              } catch (callErr: any) {
                const errMsg = (callErr?.message || String(callErr)).slice(0, 2000)
                apply = { ok: false, error: errMsg }
              }

              const rowNow = new Date().toISOString()
              const prevAttempts = r.attempts ?? 0
              const msgShort = String(r.message_id).slice(0, 8)

              if (apply.ok) {
                if (rowProvider === 'imap') {
                  simpleDrainImapApplyErrorStreak = 0
                }
                const detail = apply.skipped ? 'SKIPPED' : 'MOVED'
                const dest = apply.imapMailboxAfterMove ?? '?'
                try {
                  sendToRenderer('inbox:simpleDrainRow', {
                    status: apply.skipped ? 'skipped' : 'moved',
                    op: r.operation,
                    msgId: r.message_id,
                    accountId: r.account_id,
                    dest,
                    emailMessageId: r.email_message_id,
                  })
                } catch {
                  /* ignore */
                }
                console.log(
                  `[SimpleDrain] ${detail}: op=${r.operation} msg=${msgShort} dest=${dest} emailId=${r.email_message_id}`,
                )

                if (apply.skipped) {
                  batchSkipped += 1
                } else {
                  batchMoved += 1
                }

                markCompleted.run(rowNow, r.id)
                if (apply.imapUidAfterMove != null && apply.imapMailboxAfterMove != null) {
                  try {
                    db.prepare(`UPDATE inbox_messages SET email_message_id = ?, imap_remote_mailbox = ? WHERE id = ?`).run(
                      apply.imapUidAfterMove,
                      apply.imapMailboxAfterMove,
                      r.message_id,
                    )
                  } catch {
                    /* ignore */
                  }
                }
                try {
                  touchMsgErrNull.run(r.message_id)
                } catch {
                  /* ignore */
                }
              } else {
                batchErrors += 1
                if (rowProvider === 'imap') {
                  simpleDrainImapApplyErrorStreak += 1
                  if (simpleDrainImapApplyErrorStreak >= 2) {
                    const coolUntil = Date.now() + SIMPLE_DRAIN_IMAP_LONG_COOLDOWN_MS
                    simpleDrainNextBatchAllowedAt = Math.max(simpleDrainNextBatchAllowedAt, coolUntil)
                    console.warn(
                      '[SimpleDrain] IMAP errors — long cool-down',
                      SIMPLE_DRAIN_IMAP_LONG_COOLDOWN_MS,
                      'ms (next batch gated)',
                    )
                    simpleDrainImapApplyErrorStreak = 0
                  }
                }
                const errMsg = (apply.error || 'Unknown error').slice(0, 2000)
                const errShort = errMsg.slice(0, 120)
                try {
                  sendToRenderer('inbox:simpleDrainRow', {
                    status: 'error',
                    op: r.operation,
                    msgId: r.message_id,
                    accountId: r.account_id,
                    error: errShort,
                    emailMessageId: r.email_message_id,
                  })
                } catch {
                  /* ignore */
                }
                console.log(`[SimpleDrain] ERROR: op=${r.operation} msg=${msgShort} err=${errShort}`)

                if (simpleDrainIsPermanentOrchestratorError(errMsg)) {
                  markFailed.run(SIMPLE_DRAIN_MAX_ATTEMPTS, errMsg, rowNow, r.id)
                  try {
                    touchMsgErr.run(`[${r.operation}] ${errMsg}`, r.message_id)
                  } catch {
                    /* ignore */
                  }
                  console.log(`[SimpleDrain] FAILED (permanent): ${String(r.message_id).slice(0, 8)} — ${errMsg.slice(0, 60)}`)
                } else if (simpleDrainIsTransientOrchestratorError(errMsg)) {
                  resetPendingTransient.run(errMsg, rowNow, r.id)
                  try {
                    touchMsgErr.run(`[${r.operation}] ${errMsg} (transient — will retry)`, r.message_id)
                  } catch {
                    /* ignore */
                  }
                  console.log(
                    `[SimpleDrain] RETRY (transient): ${String(r.message_id).slice(0, 8)} — ${errMsg.slice(0, 60)}`,
                  )
                  try {
                    await emailGateway.forceReconnect(r.account_id)
                  } catch {
                    /* ignore */
                  }
                  await new Promise((res) => setTimeout(res, rowProf.transientPauseMs))
                } else {
                  const nextAttempts = prevAttempts + 1
                  if (nextAttempts >= SIMPLE_DRAIN_MAX_ATTEMPTS) {
                    markFailed.run(nextAttempts, errMsg, rowNow, r.id)
                    console.log(`[SimpleDrain] FAILED: ${String(r.message_id).slice(0, 8)} — ${errMsg.slice(0, 60)}`)
                  } else {
                    resetPending.run(nextAttempts, errMsg, rowNow, r.id)
                    console.log(
                      `[SimpleDrain] RETRY (${nextAttempts}/${SIMPLE_DRAIN_MAX_ATTEMPTS}): ${String(r.message_id).slice(0, 8)} — ${errMsg.slice(0, 60)}`,
                    )
                  }
                  try {
                    touchMsgErr.run(`[${r.operation}] ${errMsg}`, r.message_id)
                  } catch {
                    /* ignore */
                  }
                }
              }

              await new Promise((res) => setTimeout(res, rowProf.interRowMs))
            } catch (rowErr: any) {
              try {
                db.prepare(
                  `UPDATE remote_orchestrator_mutation_queue SET status = 'pending', last_error = ?, updated_at = ? WHERE id = ?`,
                ).run(rowErr?.message || 'Unknown', new Date().toISOString(), r.id)
              } catch {
                /* ignore */
              }
              console.error(`[SimpleDrain] Row error: ${r.id}`, rowErr?.message)
            }
          }

          try {
            const remaining = db
              .prepare(`SELECT COUNT(*) as c FROM remote_orchestrator_mutation_queue WHERE status = 'pending'`)
              .get() as { c: number }
            sendToRenderer('inbox:drainProgress', {
              processed: workRows.length,
              pending: remaining.c,
              failed: batchErrors,
              deferred: batchImapDeferred,
              phase: 'simple_idle',
              batchSize: workRows.length,
              batchMoved,
              batchSkipped,
              batchErrors,
              batchImapDeferred,
            })
          } catch {
            /* ignore */
          }

          let pauseAfterBatch = 5000
          for (const wr of workRows) {
            pauseAfterBatch = Math.max(
              pauseAfterBatch,
              simpleDrainProfileForProvider(rowProviderType(wr.account_id)).pauseAfterBatchMs,
            )
          }
          simpleDrainNextBatchAllowedAt = Date.now() + pauseAfterBatch
        } catch (err) {
          console.error('[SimpleDrain] Error:', err)
        } finally {
          simpleDrainRunning = false
        }
      })()
    }, SIMPLE_DRAIN_INTERVAL_MS)
  }

  /** Watchdog uses this same `getDb` as handlers (no module-level resolveDb mismatch). */
  ensureOrchestratorRemoteDrainWatchdog(getDb)
  setImmediate(() => {
    void (async () => {
      try {
        const db = await resolveDb()
        if (!db) return
        const um = enqueueUnmirroredClassifiedLifecycleMessages(db)
        if (um.enqueued > 0) {
          console.log('[Inbox] Startup: unmirrored classified lifecycle enqueue:', um)
          scheduleOrchestratorRemoteDrain(getDb)
        }
      } catch (e: any) {
        console.warn('[Inbox] Startup unmirrored enqueue:', e?.message)
      }
    })()
  })

  ipcMain.removeHandler('debug:queueStatus')
  ipcMain.handle('debug:queueStatus', async () => {
    try {
      const db = await resolveDb()
      if (!db) return { error: 'no db' }

      const total = db.prepare('SELECT COUNT(*) as c FROM remote_orchestrator_mutation_queue').get()
      const byStatus = db
        .prepare('SELECT status, COUNT(*) as c FROM remote_orchestrator_mutation_queue GROUP BY status')
        .all()
      const byOp = db
        .prepare(
          'SELECT operation, status, COUNT(*) as c FROM remote_orchestrator_mutation_queue GROUP BY operation, status',
        )
        .all()
      const failed = db
        .prepare(
          'SELECT id, message_id, account_id, operation, status, attempts, last_error, email_message_id FROM remote_orchestrator_mutation_queue WHERE status = ? LIMIT 10',
        )
        .all('failed')
      const pending = db
        .prepare(
          'SELECT id, message_id, account_id, operation, status, attempts, last_error, email_message_id FROM remote_orchestrator_mutation_queue WHERE status = ? LIMIT 10',
        )
        .all('pending')
      const processing = db
        .prepare(
          'SELECT id, message_id, account_id, operation, status, attempts, updated_at FROM remote_orchestrator_mutation_queue WHERE status = ?',
        )
        .all('processing')
      const sample = db
        .prepare(
          'SELECT id, message_id, account_id, email_message_id, operation, status, attempts, last_error, created_at, updated_at FROM remote_orchestrator_mutation_queue ORDER BY created_at DESC LIMIT 5',
        )
        .all()
      const failedByLastError = db
        .prepare(
          'SELECT last_error, COUNT(*) as c FROM remote_orchestrator_mutation_queue WHERE status = ? GROUP BY last_error ORDER BY c DESC',
        )
        .all('failed')

      const byAccountStatus = db
        .prepare(
          `SELECT account_id, status, COUNT(*) as c FROM remote_orchestrator_mutation_queue GROUP BY account_id, status ORDER BY account_id, status`,
        )
        .all() as Array<{ account_id: string | null; status: string; c: number }>

      type AccAgg = {
        accountId: string
        label: string
        provider?: string
        pending: number
        processing: number
        completed: number
        failed: number
        total: number
      }
      const aggMap = new Map<string, AccAgg>()
      const bump = (accountId: string, status: string, c: number) => {
        const id = accountId || '(no account_id)'
        let a = aggMap.get(id)
        if (!a) {
          a = {
            accountId: id,
            label: id,
            pending: 0,
            processing: 0,
            completed: 0,
            failed: 0,
            total: 0,
          }
          aggMap.set(id, a)
        }
        a.total += c
        if (status === 'pending') a.pending += c
        else if (status === 'processing') a.processing += c
        else if (status === 'completed') a.completed += c
        else if (status === 'failed') a.failed += c
      }
      for (const row of byAccountStatus) {
        bump(row.account_id != null ? String(row.account_id) : '(no account_id)', row.status, Number(row.c) || 0)
      }

      try {
        const accounts = await emailGateway.listAccounts()
        for (const acc of accounts) {
          const a = aggMap.get(acc.id)
          if (a) {
            a.label = `${acc.email} (${acc.provider})`
            a.provider = acc.provider
          }
        }
      } catch (e: any) {
        console.warn('[QUEUE_STATUS] listAccounts for labels failed:', e?.message)
      }

      const queueByAccountSummary = [...aggMap.values()]
        .filter((x) => x.provider !== 'imap')
        .sort((x, y) => x.label.localeCompare(y.label))

      console.log('[QUEUE_STATUS] === QUEUE STATUS ===')
      console.log('[QUEUE_STATUS] Total rows:', total)
      console.log('[QUEUE_STATUS] By status:', JSON.stringify(byStatus))
      console.log('[QUEUE_STATUS] By op+status:', JSON.stringify(byOp))
      console.log('[QUEUE_STATUS] Failed (sample):', JSON.stringify(failed, null, 2))
      console.log('[QUEUE_STATUS] Pending (sample):', JSON.stringify(pending, null, 2))
      console.log('[QUEUE_STATUS] Processing (stuck?):', JSON.stringify(processing, null, 2))
      console.log('[QUEUE_STATUS] Recent (sample):', JSON.stringify(sample, null, 2))
      console.log('[QUEUE_STATUS] Failed by last_error:', JSON.stringify(failedByLastError))
      console.log('[QUEUE_STATUS] By account × status:', JSON.stringify(byAccountStatus))
      console.log('[QUEUE_STATUS] Per-account summary:', JSON.stringify(queueByAccountSummary))

      return {
        total,
        byStatus,
        byOp,
        byAccountStatus,
        queueByAccountSummary,
        failed,
        pending,
        processing,
        sample,
        failedByLastError,
      }
    } catch (e: any) {
      console.error('[QUEUE_STATUS] debug:queueStatus error:', e)
      return { error: e.message }
    }
  })

  /**
   * Debug: WR Desk “main inbox” rows (same filter as UI “all” tab) — explains why mail may still sit in server Inbox.
   * Optional `accountId` limits to one account; omit / null = all accounts (capped).
   */
  ipcMain.handle('inbox:debugMainInboxRows', async (_e, accountId?: string | null) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const acc =
        typeof accountId === 'string' && accountId.trim() && accountId.trim() !== '(no account_id)'
          ? accountId.trim()
          : null

      const sql = `
        SELECT m.id, m.account_id, m.email_message_id, m.subject, m.from_address, m.received_at,
               m.sort_category, m.urgency_score, m.imap_remote_mailbox,
               CASE WHEN m.ai_analysis_json IS NOT NULL AND TRIM(COALESCE(m.ai_analysis_json,'')) != '' THEN 1 ELSE 0 END AS has_ai_analysis,
               (SELECT q.operation FROM remote_orchestrator_mutation_queue q WHERE q.message_id = m.id ORDER BY q.updated_at DESC LIMIT 1) AS queue_op,
               (SELECT q.status FROM remote_orchestrator_mutation_queue q WHERE q.message_id = m.id ORDER BY q.updated_at DESC LIMIT 1) AS queue_status,
               (SELECT q.last_error FROM remote_orchestrator_mutation_queue q WHERE q.message_id = m.id ORDER BY q.updated_at DESC LIMIT 1) AS queue_last_error
        FROM inbox_messages m
        WHERE m.deleted = 0
          AND m.archived = 0
          AND (m.pending_delete = 0 OR m.pending_delete IS NULL)
          AND (m.sort_category IS NULL OR m.sort_category NOT IN ('pending_review', 'important', 'urgent'))
          AND (m.pending_review_at IS NULL OR TRIM(COALESCE(m.pending_review_at, '')) = '')
          AND (m.source_type = 'email_plain' OR m.source_type = 'email_beap')
          AND (? IS NULL OR m.account_id = ?)
        ORDER BY datetime(COALESCE(m.received_at, m.ingested_at)) DESC
        LIMIT 40
      `
      const raw = db.prepare(sql).all(acc, acc) as Array<{
        id: string
        account_id: string | null
        email_message_id: string | null
        subject: string | null
        from_address: string | null
        received_at: string | null
        sort_category: string | null
        urgency_score: number | null
        imap_remote_mailbox: string | null
        has_ai_analysis: number
        queue_op: string | null
        queue_status: string | null
        queue_last_error: string | null
      }>

      type Why =
        | 'not_analyzed'
        | 'urgent_classified'
        | 'non_lifecycle_no_remote_folder'
        | 'remote_queue_pending'
        | 'remote_queue_failed'
        | 'other'

      function inferWhy(r: (typeof raw)[0]): Why {
        if (!r.has_ai_analysis) return 'not_analyzed'
        if (r.queue_status === 'pending' || r.queue_status === 'processing') return 'remote_queue_pending'
        if (r.queue_status === 'failed') return 'remote_queue_failed'
        const u = typeof r.urgency_score === 'number' ? r.urgency_score : Number(r.urgency_score) || 0
        const sc = (r.sort_category || '').trim().toLowerCase()
        if (sc === 'urgent' || u >= 7) return 'urgent_classified'
        if (sc === 'normal' || sc === 'important' || sc === 'newsletter')
          return 'non_lifecycle_no_remote_folder'
        return 'other'
      }

      const whyLabels: Record<Why, string> = {
        not_analyzed: 'Not analyzed (no AI classification yet — run Auto-Sort)',
        urgent_classified:
          'Urgent / high urgency — remote **Urgent** folder move is enqueued; if server Inbox still shows the message, wait for queue drain or use ☁ Sync Remote / Pull.',
        non_lifecycle_no_remote_folder:
          'Classified normal/important/newsletter — lifecycle remote moves are enqueued from local columns; see queue_op / Sync Remote if the server folder lags',
        remote_queue_pending: 'Remote queue still pending/processing for this message',
        remote_queue_failed: 'Remote queue row failed — see queue_last_error / Retry failed',
        other: 'Other — check sort_category and imap_remote_mailbox',
      }

      const rows = raw.map((r) => {
        const why = inferWhy(r)
        return {
          ...r,
          why,
          whyDetail: whyLabels[why],
        }
      })

      const counts: Record<Why, number> = {
        not_analyzed: 0,
        urgent_classified: 0,
        non_lifecycle_no_remote_folder: 0,
        remote_queue_pending: 0,
        remote_queue_failed: 0,
        other: 0,
      }
      for (const r of rows) counts[r.why as Why]++

      const summaryText = `${rows.length} main-inbox row(s) shown (max 40)${acc ? ` · account ${acc.slice(0, 8)}…` : ' · all accounts'} — ` +
        Object.entries(counts)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`)
          .join(', ')

      return {
        ok: true,
        accountIdFilter: acc,
        rows,
        counts,
        summaryText,
        policyNote:
          'All classified lifecycle categories (including urgent, important, newsletter, normal, archive, pending) enqueue remote folder moves from local SQLite; main-inbox rows here may still appear until the drain completes and mail is moved on the server.',
      }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'debugMainInboxRows failed' }
    }
  })

  /**
   * IMAP: LIST + STATUS (counts per folder) + canonical lifecycle exact-match snapshot (read-only; no CREATE).
   */
  ipcMain.handle('inbox:verifyImapRemoteFolders', async (_e, accountId: string) => {
    const VERIFY_IMAP_REMOTE_MS = 15_000
    try {
      const id = typeof accountId === 'string' ? accountId.trim() : ''
      if (!id) return { ok: false, error: 'accountId required' }
      const result = await Promise.race([
        emailGateway.verifyImapRemoteFolders(id),
        new Promise<{ ok: false; error: string }>((resolve) =>
          setTimeout(
            () =>
              resolve({
                ok: false,
                error: 'IMAP connection timed out. The connection may be dead.',
              }),
            VERIFY_IMAP_REMOTE_MS,
          ),
        ),
      ])
      return result
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'verifyImapRemoteFolders failed' }
    }
  })

  /** Debug: gateway accounts vs inbox_messages.account_id orphans (reconnect ID mismatch). */
  ipcMain.handle('inbox:debugAccountMigrationStatus', async () => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const accounts = await emailGateway.listAccounts()
      const diag = getInboxAccountMigrationDiagnostics(
        db,
        accounts.map((a) => ({
          id: a.id,
          email: a.email,
          provider: a.provider,
          status: a.status,
        })),
      )
      return { ok: true, ...diag }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'debugAccountMigrationStatus failed' }
    }
  })

  /**
   * Repoint inbox_messages from a stale account_id to the current gateway id and delete all remote queue rows for the old id.
   * Does not delete message rows.
   */
  ipcMain.handle('inbox:migrateInboxAccountId', async (_e, fromAccountId: string, toAccountId: string) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const fromId = typeof fromAccountId === 'string' ? fromAccountId.trim() : ''
      const toId = typeof toAccountId === 'string' ? toAccountId.trim() : ''
      if (!fromId || !toId) {
        return { ok: false, error: 'fromAccountId and toAccountId are required' }
      }
      const known = new Set((await emailGateway.listAccounts()).map((a) => String(a.id).trim()))
      if (!known.has(toId)) {
        return { ok: false, error: 'toAccountId is not a connected account in the gateway' }
      }
      if (known.has(fromId)) {
        return {
          ok: false,
          error:
            'fromAccountId is still a connected account — disconnect it first or pick a stale orphan id from the debug list',
        }
      }
      const r = migrateInboxAccountIdAndClearQueue(db, fromId, toId)
      return { ok: true, ...r }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'migrateInboxAccountId failed' }
    }
  })

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
    { ok: true; enqueued: number; skipped: number; skipReasons: string[] } | { ok: false; error: string }
  > {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const ids = Array.isArray(messageIds)
        ? messageIds.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
        : []
      const r = ids.length
        ? enqueueRemoteOpsForLocalLifecycleState(db, ids)
        : { enqueued: 0, skipped: 0, skipReasons: [] as string[] }
      scheduleOrchestratorRemoteDrain(getDb)
      return { ok: true, enqueued: r.enqueued, skipped: r.skipped, skipReasons: r.skipReasons }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'enqueue failed' }
    }
  }

  // ── Sync ──
  async function runInboxAccountPullKind(accountId: string, kind: 'pull' | 'pullMore') {
    console.log(
      `[PULL] inbox:${kind === 'pullMore' ? 'pullMore' : 'syncAccount'} called for account:`,
      accountId,
    )
    emailDebugLog('[SYNC-DEBUG] runInboxAccountPullKind → syncAccountEmails (no pre-check skips pull)', {
      accountId,
      kind,
    })
    const db = await resolveDb()
    if (!db) return { ok: false, error: 'Database unavailable' }

    let result: Awaited<ReturnType<typeof syncAccountEmails>>
    try {
      result = await syncAccountEmails(
        db,
        kind === 'pullMore' ? { accountId, pullMore: true } : { accountId },
      )
    } catch (syncErr: any) {
      console.error('[Inbox] syncAccountEmails threw:', syncErr)
      const msg = syncErr?.message ?? 'Sync failed'
      try {
        const acc = await emailGateway.getAccount(accountId)
        if (acc?.provider === 'imap' && isLikelyEmailAuthError(msg)) {
          await emailGateway.updateAccount(accountId, {
            status: 'auth_error',
            lastError: 'Authentication failed — check credentials',
          })
        }
      } catch {
        /* ignore */
      }
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
      const beapDrained = await processPendingP2PBeapEmails(db)
      if (beapDrained > 0) notifyBeapInboxDashboard(null)
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
    const pullStats = {
      listed: result.listedFromProvider ?? 0,
      new: result.newMessages,
      skippedDupes: result.skippedDuplicate ?? 0,
      errors: errors.length,
    }
    const pausedSkip = result.skipReason === 'processing_paused'
    const pausedHint =
      'Mail sync is paused for this account — no mail was fetched. Use Resume on the account card, then pull again.'
    const pullHint = pausedSkip
      ? pausedHint
      : result.newMessages > 0
        ? `${result.newMessages} new message(s) pulled — run Auto-Sort to classify and enqueue lifecycle moves (unsorted mail stays in server Inbox until classified).`
        : undefined

    if (pausedSkip) {
      const pausedMsg = `${pausedHint} (Connected Email Accounts → Resume.)`
      return {
        ok: false,
        error: pausedMsg,
        data: result,
        pullStats,
        pullHint,
        warningCount: 1,
        syncWarnings: [pausedMsg],
      }
    }

    if (!result.ok) {
      return {
        ok: false,
        error: errors[0] ?? 'Sync failed',
        data: result,
        pullStats,
        pullHint,
        warningCount: warnCount,
        syncWarnings: errors,
      }
    }

    if (result.newMessages === 0 && warnCount > 0) {
      return {
        ok: false,
        error: 'All messages failed to sync',
        data: result,
        pullStats,
        warningCount: warnCount,
        syncWarnings: errors,
      }
    }

    if (result.newMessages === 0 && warnCount === 0 && result.ok) {
      emailDebugLog(
        '[SYNC-DEBUG] IPC pull finished ok with 0 new messages and 0 warnings (silent empty — see main logs for SEARCH/folder/last_sync_at)',
        { accountId, kind, pullStats },
      )
    }

    if (result.ok) {
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
        pullStats,
        pullHint,
        warningCount: warnCount,
        syncWarnings: errors,
      }
    }

    return { ok: true, data: result, pullStats, pullHint }
  }

  ipcMain.handle('inbox:syncAccount', async (_e, accountId: string) => {
    console.log('[IMAP-PULL-TRACE] syncAccount called for:', accountId)
    try {
      try {
        return await runInboxAccountPullKind(accountId, 'pull')
      } catch (err) {
        console.error('[IMAP-PULL-TRACE] syncAccount CRASHED:', err)
        console.error('[IMAP-PULL-TRACE] stack:', (err as Error)?.stack)
        throw err
      }
    } catch (err: any) {
      console.error('[Inbox] inbox:syncAccount unhandled error:', err)
      return { ok: false, error: err?.message ?? 'Sync failed (unhandled)' }
    }
  })

  ipcMain.handle('inbox:pullMore', async (_e, accountId: string) => {
    try {
      return await runInboxAccountPullKind(accountId, 'pullMore')
    } catch (err: any) {
      console.error('[Inbox] inbox:pullMore unhandled error:', err)
      return { ok: false, error: err?.message ?? 'Pull More failed (unhandled)' }
    }
  })

  ipcMain.handle('inbox:resetSyncState', async (_e, accountId: string) => {
    try {
      const id = String(accountId ?? '').trim()
      if (!id) return { ok: false, error: 'accountId required' }
      const now = Date.now()
      const prev = lastInboxResetSyncStateAt.get(id) ?? 0
      const elapsed = now - prev
      if (prev > 0 && elapsed < RESET_SYNC_STATE_COOLDOWN_MS) {
        const waitSec = Math.ceil((RESET_SYNC_STATE_COOLDOWN_MS - elapsed) / 1000)
        return {
          ok: false,
          error: `Reset is limited to once per 5 minutes per account. Try again in ${waitSec}s.`,
        }
      }
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      db.prepare(
        `UPDATE email_sync_state
         SET last_sync_at = NULL, last_error = NULL, last_error_at = NULL
         WHERE account_id = ?`,
      ).run(id)
      clearConsecutiveZeroListingPulls(id)
      lastInboxResetSyncStateAt.set(id, now)
      emailDebugLog('[SYNC-DEBUG] inbox:resetSyncState cleared last_sync_at / last_error for account', id)
      return { ok: true }
    } catch (e: any) {
      console.error('[Inbox] inbox:resetSyncState error:', e)
      return { ok: false, error: e?.message ?? 'resetSyncState failed' }
    }
  })

  ipcMain.handle('inbox:fullResetAccount', async (_e, rawAccountId: unknown) => {
    const accountId = String(rawAccountId ?? '').trim()
    if (!accountId) return { ok: false, error: 'accountId required' }

    let db: any
    try {
      db = await resolveDb()
    } catch {
      return { ok: false, error: 'DB resolve failed' }
    }
    if (!db) return { ok: false, error: 'Database unavailable' }

    emailDebugLog('[FULL-RESET] requested', { accountId })

    /** Stale pull locks defer orchestrator work indefinitely — clear before touching the DB. */
    markPullInactive(accountId)

    const sqliteIdent = (name: string) => `"${String(name).replace(/"/g, '""')}"`
    const results: string[] = []

    const safeRun = (label: string, fn: () => { changes: number } | void) => {
      try {
        const r = fn()
        const ch = r && typeof r.changes === 'number' ? r.changes : 0
        results.push(`${label}: ${ch}`)
      } catch (e: any) {
        results.push(`${label}: error - ${e?.message ?? String(e)}`)
      }
    }

    try {
      /** Must run outside an active transaction (SQLite). */
      db.exec('PRAGMA foreign_keys = OFF')
      db.exec('BEGIN IMMEDIATE')

      /** Child rows do not have account_id; with foreign_keys OFF, CASCADE may not run — delete explicitly. */
      safeRun('inbox_embeddings', () =>
        db
          .prepare(
            `DELETE FROM inbox_embeddings WHERE message_id IN (SELECT id FROM inbox_messages WHERE account_id = ?)`,
          )
          .run(accountId),
      )
      safeRun('inbox_attachments', () =>
        db
          .prepare(
            `DELETE FROM inbox_attachments WHERE message_id IN (SELECT id FROM inbox_messages WHERE account_id = ?)`,
          )
          .run(accountId),
      )

      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
      const tableNames = tables.map((t) => t.name).filter((n) => n && !n.startsWith('sqlite_'))

      for (const table of tableNames) {
        if (table === 'email_sync_state') continue
        try {
          const cols = db.prepare(`PRAGMA table_info(${sqliteIdent(table)})`).all() as { name: string }[]
          const hasAccountId = cols.some((c) => c.name === 'account_id')
          if (!hasAccountId) continue
          const del = db.prepare(`DELETE FROM ${sqliteIdent(table)} WHERE account_id = ?`).run(accountId)
          const ch = typeof del?.changes === 'number' ? del.changes : 0
          results.push(`${table}: ${ch} rows deleted`)
        } catch (e: any) {
          results.push(`${table}: error - ${e?.message ?? String(e)}`)
        }
      }

      /**
       * Preserve auto_sync_enabled, sync_interval_ms, imap_folders_consolidated — only clear pull cursors/errors.
       * Deleting the whole row (old behavior) reset auto_sync to 0 and felt like a broken recovery path.
       */
      let syncClear = 0
      try {
        const up = db
          .prepare(
            `UPDATE email_sync_state SET
               last_sync_at = NULL,
               last_uid = NULL,
               sync_cursor = NULL,
               total_synced = 0,
               last_error = NULL,
               last_error_at = NULL
             WHERE account_id = ?`,
          )
          .run(accountId)
        syncClear = typeof up?.changes === 'number' ? up.changes : 0
      } catch (e: any) {
        results.push(`email_sync_state: error - ${e?.message ?? String(e)}`)
      }
      if (syncClear > 0) {
        results.push(`email_sync_state: ${syncClear} row(s) — cursors cleared, prefs preserved`)
      } else {
        try {
          db.prepare(
            `INSERT INTO email_sync_state (account_id, last_sync_at, last_uid, sync_cursor, auto_sync_enabled, sync_interval_ms, total_synced, last_error, last_error_at)
             VALUES (?, NULL, NULL, NULL, 0, 30000, 0, NULL, NULL)`,
          ).run(accountId)
          results.push('email_sync_state: new row inserted (defaults)')
        } catch (e2: any) {
          results.push(`email_sync_state: no row to update; insert failed - ${e2?.message ?? String(e2)}`)
        }
      }

      db.exec('COMMIT')
    } catch (e: any) {
      try {
        db.exec('ROLLBACK')
      } catch {
        /* noop */
      }
      emailDebugLog('[FULL-RESET] transaction failed', { accountId, message: e?.message })
      if (EMAIL_DEBUG) {
        console.error('[FULL-RESET] transaction failed:', e)
      }
      return { ok: false, error: e?.message ?? String(e), results }
    } finally {
      try {
        db.exec('PRAGMA foreign_keys = ON')
      } catch {
        /* noop */
      }
    }

    try {
      clearConsecutiveZeroListingPulls(accountId)
    } catch {
      /* noop */
    }

    emailDebugLog('[FULL-RESET] committed', { accountId, results })

    void (async () => {
      try {
        const r = await syncAccountEmails(db, { accountId })
        emailDebugLog('[FULL-RESET] post-reset pull finished', {
          accountId,
          newMessages: r.newMessages,
          ok: r.ok,
          errors: r.errors?.length ?? 0,
        })
        if (r.ok) {
          try {
            sendToRenderer('inbox:newMessages', r)
          } catch (err: any) {
            console.warn('[FULL-RESET] sendToRenderer inbox:newMessages:', err?.message)
          }
        }
      } catch (e: any) {
        console.warn('[FULL-RESET] post-reset syncAccountEmails:', e?.message ?? e)
        emailDebugLog('[FULL-RESET] post-reset pull threw', { accountId, message: e?.message })
      }
    })()

    return { ok: true, results, kickedFollowUpPull: true as const }
  })

  ipcMain.handle('inbox:debugDumpSyncState', async () => {
    const ident = (name: string) => `"${String(name).replace(/"/g, '""')}"`
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'DB unavailable' }

      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
      const dump: Record<string, any> = {}

      for (const t of tables as { name: string }[]) {
        if (t.name.toLowerCase().includes('sync') || t.name.toLowerCase().includes('state')) {
          const schema = db.prepare(`PRAGMA table_info(${ident(t.name)})`).all()
          const rows = db.prepare(`SELECT * FROM ${ident(t.name)} LIMIT 5`).all()
          dump[t.name] = { schema, sampleRows: rows }
        }
      }

      return { ok: true, dump }
    } catch (e: any) {
      return { ok: false, error: e.message }
    }
  })

  ipcMain.handle('inbox:patchAccountSyncPreferences', async (_e, accountId: string, partial: unknown) => {
    try {
      const id = String(accountId ?? '').trim()
      if (!id) return { ok: false, error: 'accountId required' }
      const p = partial && typeof partial === 'object' && partial !== null ? (partial as Record<string, unknown>) : {}
      const syncWindowDays = p.syncWindowDays
      const maxMessagesPerPull = p.maxMessagesPerPull
      const patch: { syncWindowDays?: number; maxMessagesPerPull?: number } = {}
      if (typeof syncWindowDays === 'number' && syncWindowDays >= 0 && Number.isFinite(syncWindowDays)) {
        patch.syncWindowDays = Math.min(3650, Math.floor(syncWindowDays))
      }
      if (typeof maxMessagesPerPull === 'number' && maxMessagesPerPull > 0 && Number.isFinite(maxMessagesPerPull)) {
        patch.maxMessagesPerPull = Math.min(5000, Math.floor(maxMessagesPerPull))
      }
      if (Object.keys(patch).length === 0) {
        return { ok: false, error: 'No valid sync fields (syncWindowDays, maxMessagesPerPull)' }
      }
      const info = await emailGateway.patchAccountSyncPreferences(id, patch)
      return { ok: true, data: info }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'patchAccountSyncPreferences failed' }
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
        startStoredAutoSyncLoopIfMissing(db, accountId, resolveDb)
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
      const row = db.prepare('SELECT * FROM email_sync_state WHERE account_id = ?').get(accountId) as Record<string, unknown> | undefined
      const cfg = emailGateway.getAccountConfig(String(accountId ?? '').trim())
      const syncPrefs = cfg
        ? {
            syncWindowDays: cfg.sync?.syncWindowDays ?? 30,
            maxMessagesPerPull: cfg.sync?.maxMessagesPerPull ?? 500,
          }
        : null
      const base = row && typeof row === 'object' ? { ...row } : {}
      return { ok: true, data: { ...base, syncPreferences: syncPrefs } }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Failed' }
    }
  })

  /**
   * Resume auto-sync after restart: if **any** account has `auto_sync_enabled = 1`, treat that as global Auto
   * and enable + start loops for **every** gateway account with `status === 'active'`.
   * (Legacy DB rows often only had the primary/Microsoft account flagged; IMAP never got a loop.)
   */
  void (async () => {
    try {
      const db = await resolveDb()
      if (!db) return
      const anyAuto = db.prepare('SELECT 1 FROM email_sync_state WHERE auto_sync_enabled = 1 LIMIT 1').get()
      if (!anyAuto) return

      const list = await emailGateway.listAccounts()
      const activeIds = list.filter((a) => a.status === 'active').map((a) => a.id)

      for (const accountId of activeIds) {
        updateSyncState(db, accountId, { auto_sync_enabled: 1 })
        startStoredAutoSyncLoopIfMissing(db, accountId, resolveDb)
        const row = db.prepare('SELECT sync_interval_ms FROM email_sync_state WHERE account_id = ?').get(accountId) as
          | { sync_interval_ms?: number }
          | undefined
        const intervalMs = row?.sync_interval_ms ?? 300_000
        console.log('[Inbox] Resumed auto-sync loop for account', accountId, 'interval', intervalMs)
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
        `SELECT inbox_messages.*,
          (SELECT q.status FROM remote_orchestrator_mutation_queue q WHERE q.message_id = inbox_messages.id ORDER BY q.updated_at DESC LIMIT 1) AS remote_queue_status,
          (SELECT q.last_error FROM remote_orchestrator_mutation_queue q WHERE q.message_id = inbox_messages.id ORDER BY q.updated_at DESC LIMIT 1) AS remote_queue_last_error,
          (SELECT q.operation FROM remote_orchestrator_mutation_queue q WHERE q.message_id = inbox_messages.id ORDER BY q.updated_at DESC LIMIT 1) AS remote_queue_operation
         FROM inbox_messages ${where} ORDER BY received_at DESC LIMIT ? OFFSET ?`
      ).all(...qParams) as any[]

      const attStmt = db.prepare('SELECT * FROM inbox_attachments WHERE message_id = ?')
      for (const m of rows) {
        // Always attach rows: flags can be stale (e.g. P2P backfill) or out of sync with inbox_attachments.
        m.attachments = attStmt.all(m.id) as any[]
      }

      return { ok: true, data: { messages: rows, total } }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'List failed' }
    }
  })

  /** Read-only Analysis dashboard aggregation (inbox + autosort tables only). */
  ipcMain.handle(
    'inbox:dashboardSnapshot',
    async (_e, options?: { urgentMessageLimit?: number }) => {
      try {
        const db = await resolveDb()
        if (!db) return { ok: false, error: 'Database unavailable' }
        const lim =
          typeof options?.urgentMessageLimit === 'number' && Number.isFinite(options.urgentMessageLimit)
            ? Math.trunc(options.urgentMessageLimit)
            : undefined
        const data = collectReadOnlyDashboardSnapshot(db, { urgentMessageLimit: lim })
        return { ok: true, data }
      } catch (err: any) {
        return { ok: false, error: err?.message ?? 'Dashboard snapshot failed' }
      }
    },
  )

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
      const st = row.source_type as string | undefined
      const pkgJson = row.beap_package_json as string | null | undefined
      if ((st === 'direct_beap' || st === 'email_beap') && pkgJson) {
        ensureInboxAttachmentsFromBeapPackageJson(db, messageId, pkgJson)
      }
      const atts = db.prepare('SELECT * FROM inbox_attachments WHERE message_id = ?').all(messageId) as any[]
      row.attachments = atts
      db.prepare('UPDATE inbox_messages SET read_status = 1 WHERE id = ?').run(messageId)
      return { ok: true, data: row }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Get failed' }
    }
  })

  /**
   * Read-only: plaintext layers for BEAP redirect. Does not return `beap_package_json` or ciphertext.
   */
  ipcMain.handle('inbox:getBeapRedirectSource', async (_e, messageId: string) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const id = typeof messageId === 'string' ? messageId.trim() : ''
      if (!id) return { ok: false, error: 'messageId required' }
      const row = db
        .prepare(
          `SELECT id, source_type, handshake_id, subject, body_text, depackaged_json, beap_package_json, has_attachments, received_at, ingested_at, account_id, from_address
           FROM inbox_messages WHERE id = ?`,
        )
        .get(id) as
        | {
            id: string
            source_type?: string | null
            handshake_id?: string | null
            subject?: string | null
            body_text?: string | null
            depackaged_json?: string | null
            beap_package_json?: string | null
            has_attachments?: number | null
          }
        | undefined
      const extracted = extractInboxMessageRedirectSourceFromRow(row)
      if (!extracted.ok) return extracted

      let redirectedBy = ''
      try {
        const { getCurrentSession } = await import('../handshake/ipc')
        const session = getCurrentSession() as
          | { email?: string | null; wrdesk_user_id?: string | null; sub?: string | null }
          | null
          | undefined
        redirectedBy =
          (session?.email && String(session.email).trim()) ||
          (session?.wrdesk_user_id && String(session.wrdesk_user_id).trim()) ||
          (session?.sub && String(session.sub).trim()) ||
          ''
      } catch {
        /* session optional */
      }

      return {
        ok: true,
        message_id: extracted.message_id,
        source_type: extracted.source_type,
        original_handshake_id: extracted.original_handshake_id,
        subject: extracted.subject,
        public_text: extracted.public_text,
        encrypted_text: extracted.encrypted_text,
        has_attachments: (row?.has_attachments ?? 0) > 0,
        ...(extracted.content_warning ? { content_warning: extracted.content_warning } : {}),
        redirected_by_account: redirectedBy || null,
      }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'getBeapRedirectSource failed' }
    }
  })

  /**
   * Validate internal sandbox target, and extract cloneable plaintext (ledger + SSO session; no vault unlock).
   * Does not build or send the BEAP package (renderer uses BeapPackageBuilder + executeDeliveryAction).
   * `inbox:cloneBeapToSandbox` is the product channel name; both invoke the same logic.
   *
   * Host only: clone is a Host → Sandbox orchestration path (same identity, internal handshake).
   * On failure, `code` may include `NO_ACTIVE_SANDBOX_HANDSHAKE`, `MESSAGE_NOT_FOUND`, `MESSAGE_CONTENT_NOT_EXTRACTABLE`,
   * `TARGET_HANDSHAKE_REQUIRED`, or `NOT_HOST_ORCHESTRATOR` (envelope) for structured UI.
   */
  async function handleBeapInboxCloneToSandbox(
    _e: unknown,
    payload:
      | {
          sourceMessageId?: string
          targetHandshakeId?: string
          cloneReason?: 'sandbox_test' | 'external_link_or_artifact_review'
          triggeredUrl?: string
        }
      | undefined,
  ) {
    try {
      if (!isHostMode()) {
        return {
          success: false,
          code: 'NOT_HOST_ORCHESTRATOR' as const,
          error: 'Sandbox clone is only available when this device is the Host orchestrator.',
        }
      }

      const { getCurrentSession } = await import('../handshake/ipc')
      const session = getCurrentSession()
      if (!session) {
        return { success: false, code: 'UNAUTHENTICATED' as const, error: 'Not logged in' }
      }

      const db = await resolveDb()
      if (!db) {
        return { success: false, code: 'DB_UNAVAILABLE' as const, error: 'Database unavailable' }
      }

      const srcId = typeof payload?.sourceMessageId === 'string' ? payload.sourceMessageId.trim() : ''
      if (!srcId) {
        return { success: false, error: 'sourceMessageId is required' }
      }

      const tgt =
        typeof payload?.targetHandshakeId === 'string' && payload.targetHandshakeId.trim()
          ? payload.targetHandshakeId.trim()
          : undefined

      const accountTag =
        (session.email && String(session.email).trim()) ||
        (session.wrdesk_user_id && String(session.wrdesk_user_id).trim()) ||
        (session.sub && String(session.sub).trim()) ||
        null

      const cr = payload?.cloneReason
      const tu = typeof payload?.triggeredUrl === 'string' ? payload.triggeredUrl.trim() : ''
      const cloneOptions =
        cr === 'external_link_or_artifact_review'
          ? {
              clone_reason: 'external_link_or_artifact_review' as const,
              ...(tu ? { triggered_url: tu } : {}),
            }
          : undefined
      const prep = prepareBeapInboxSandboxClone(db, session, srcId, tgt, accountTag, cloneOptions)
      if (!prep.ok) {
        return {
          success: false,
          error: prep.error,
          ...(prep.code != null
            ? { code: prep.code as string, details: prep.details as Record<string, unknown> | undefined }
            : {}),
        }
      }

      return { success: true, prepare: prep }
    } catch (err: any) {
      return { success: false, error: err?.message ?? 'beapInboxCloneToSandboxPrepare failed' }
    }
  }

  ipcMain.handle('inbox:beapInboxCloneToSandboxPrepare', handleBeapInboxCloneToSandbox)
  ipcMain.handle('inbox:cloneBeapToSandbox', handleBeapInboxCloneToSandbox)

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
      const db = await resolveDbWithDiag('inbox:archiveMessages')
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
      try {
        enqueueRemoteOpsForLocalLifecycleState(db, ids)
        scheduleOrchestratorRemoteDrain(getDb)
      } catch (e: any) {
        console.warn('[Inbox] setCategory remote mirror enqueue:', e?.message)
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
      const ids = messageIds ?? []
      let touchedDirectBeap = false
      for (const id of ids) {
        const r = db
          .prepare('SELECT source_type, account_id FROM inbox_messages WHERE id = ?')
          .get(id) as { source_type?: string | null; account_id?: string | null } | undefined
        if (r && (r.source_type === 'direct_beap' || r.account_id === '__p2p_beap__')) {
          touchedDirectBeap = true
          break
        }
      }
      const result = bulkQueueDeletion(db, ids, gracePeriodHours ?? 72)
      if (touchedDirectBeap) {
        BrowserWindow.getAllWindows().forEach((w) => {
          try {
            if (!w.isDestroyed() && w.webContents) {
              w.webContents.send('inbox:newMessages', { inboxInvalidate: true, reason: 'direct_beap_deleted' })
            }
          } catch {
            /* ignore */
          }
        })
      }
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

  /** Dev: purge all `direct_beap` inbox rows (no remote mailbox). */
  ipcMain.handle('inbox:deleteAllDirectBeap', async () => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const data = deleteAllDirectBeapMessages(db)
      BrowserWindow.getAllWindows().forEach((w) => {
        try {
          if (!w.isDestroyed() && w.webContents) {
            w.webContents.send('inbox:newMessages', { inboxInvalidate: true, reason: 'delete_all_direct_beap' })
          }
        } catch {
          /* ignore */
        }
      })
      return { ok: true, data }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Delete all direct_beap failed' }
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
      if (
        (row.text_extraction_status === 'done' || row.text_extraction_status === 'partial') &&
        row.extracted_text
      ) {
        return {
          ok: true,
          data: {
            text: row.extracted_text,
            pages: inboxPagesFromStoredExtractedText(row.extracted_text),
            status: row.text_extraction_status,
            error: row.text_extraction_error ?? null,
            content_sha256: row.content_sha256 ?? null,
            extracted_text_sha256: row.extracted_text_sha256 ?? null,
          },
        }
      }
      if (row.text_extraction_status === 'done' && !row.extracted_text) {
        return {
          ok: true,
          data: {
            text: '',
            pages: [],
            status: 'done',
            error: null,
            content_sha256: row.content_sha256 ?? null,
            extracted_text_sha256: row.extracted_text_sha256 ?? null,
          },
        }
      }
      if (row.text_extraction_status === 'skipped' || row.text_extraction_status === 'failed') {
        return {
          ok: true,
          data: {
            text: '',
            pages: [],
            status: row.text_extraction_status,
            error: row.text_extraction_error ?? null,
            content_sha256: row.content_sha256 ?? null,
            extracted_text_sha256: row.extracted_text_sha256 ?? null,
          },
        }
      }
      if (row.storage_path && fs.existsSync(row.storage_path) && isPdfFile(row.content_type || '', row.filename)) {
        let buf: Buffer
        try {
          buf = readDecryptedAttachmentBuffer(row)
        } catch (decErr: any) {
          return { ok: false, error: decErr?.message ?? 'Could not read attachment' }
        }
        const result = await extractPdfText(buf)
        const text = result.text ?? ''
        const { status, error: errMsg } = resolveInboxPdfExtractionStatus(result)

        const contentSha256 = createHash('sha256').update(buf).digest('hex')
        const extractedTextSha256 = createHash('sha256').update(text, 'utf8').digest('hex')

        const pageCount =
          typeof result.pageCount === 'number' && result.pageCount > 0 ? result.pageCount : null
        db.prepare(
          `UPDATE inbox_attachments SET extracted_text = ?, text_extraction_status = ?, text_extraction_error = ?,
           content_sha256 = ?, extracted_text_sha256 = ?, page_count = ?
           WHERE id = ?`,
        ).run(text, status, errMsg, contentSha256, extractedTextSha256, pageCount, attachmentId)

        // Merge extracted text + status + hashes into depackaged_json (same shape as ingest-time depackaging)
        const messageId = row.message_id
        if (messageId) {
          try {
            const msgRow = db.prepare('SELECT depackaged_json FROM inbox_messages WHERE id = ?').get(messageId) as
              | { depackaged_json?: string }
              | undefined
            const depackaged = msgRow?.depackaged_json
            if (depackaged) {
              const parsed = JSON.parse(depackaged) as {
                attachments?: Array<{
                  id?: string
                  content_id?: string
                  extracted_text?: string
                  extraction_status?: string
                  extraction_error?: string | null
                  content_sha256?: string
                  extracted_text_sha256?: string
                }>
              }
              if (Array.isArray(parsed.attachments)) {
                let updated = false
                for (const att of parsed.attachments) {
                  if (att.content_id === attachmentId || att.id === attachmentId) {
                    att.extracted_text = text
                    att.extraction_status = status
                    att.extraction_error = errMsg
                    att.content_sha256 = contentSha256
                    att.extracted_text_sha256 = extractedTextSha256
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

        const pagesOut =
          Array.isArray(result?.pages) && result.pages.length > 0
            ? result.pages
            : inboxPagesFromStoredExtractedText(text)
        return {
          ok: true,
          data: {
            text,
            pages: pagesOut,
            status,
            error: errMsg,
            content_sha256: contentSha256,
            extracted_text_sha256: extractedTextSha256,
          },
        }
      }
      db.prepare('UPDATE inbox_attachments SET text_extraction_status = ? WHERE id = ?').run('skipped', attachmentId)
      return {
        ok: true,
        data: {
          text: '',
          pages: [],
          status: 'skipped',
          error: null,
          content_sha256: row.content_sha256 ?? null,
          extracted_text_sha256: row.extracted_text_sha256 ?? null,
        },
      }
    } catch (err: any) {
      return { ok: false, error: err?.message ?? 'Extract failed' }
    }
  })

  ipcMain.handle('inbox:openAttachmentOriginal', async (_e, attachmentId: string) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const row = db.prepare('SELECT * FROM inbox_attachments WHERE id = ?').get(attachmentId) as Record<string, unknown> | undefined
      if (!row?.storage_path || typeof row.storage_path !== 'string' || !fs.existsSync(row.storage_path)) {
        return { ok: false, error: 'Attachment file not found' }
      }
      let plaintext: Buffer
      try {
        plaintext = readDecryptedAttachmentBuffer(row as AttachmentRowCrypto)
      } catch (e: any) {
        return { ok: false, error: e?.message ?? 'Could not decrypt attachment' }
      }
      const rawName = typeof row.filename === 'string' && row.filename.trim() ? row.filename : 'attachment'
      const safeBase = rawName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'attachment'
      const tempPath = path.join(os.tmpdir(), `wrdesk-open-${attachmentId}-${Date.now()}-${safeBase}`)
      fs.writeFileSync(tempPath, plaintext)
      const result = await shell.openPath(tempPath)
      const opened = result === ''
      setTimeout(() => {
        try {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath)
        } catch {
          /* ignore */
        }
      }, 120_000)
      return { ok: true, data: { opened } }
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

      const available = await isLlmAvailable()
      if (!available) {
        return {
          ok: true,
          data: { summary: 'Error: No AI provider available. Check Backend settings (local model or cloud API key).', error: true },
        }
      }

      const sender = row.from_name ? `${row.from_name} <${row.from_address || ''}>` : (row.from_address || 'Unknown')
      const body = (row.body_text || '').trim().slice(0, 8000)
      const userPrompt = `From: ${sender}\nSubject: ${row.subject || '(No subject)'}\nDate: ${row.received_at || '—'}\n\n${body}`

      const systemPrompt = 'You are an AI assistant for WR Desk inbox. Summarize the following email concisely in 2-3 sentences. Focus on: who sent it, what they want, and any action required.'
      console.log('[AI-SUMMARIZE] System prompt length:', systemPrompt.length)
      console.log('[AI-SUMMARIZE] Calling LLM...')
      const summary = await inboxLlmChat({ system: systemPrompt, user: userPrompt })
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
    let isNativeBeap = false
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const row = db
        .prepare(
          'SELECT from_address, from_name, subject, body_text, source_type, handshake_id, depackaged_json, beap_package_json FROM inbox_messages WHERE id = ?',
        )
        .get(messageId) as
        | {
            from_address?: string
            from_name?: string
            subject?: string
            body_text?: string
            source_type?: string | null
            handshake_id?: string | null
            depackaged_json?: string | null
            beap_package_json?: string | null
          }
        | undefined
      if (!row) return { ok: false, error: 'Message not found' }
      console.log('[AI-DRAFT] Message fetched:', { from: row.from_address, subject: row.subject, bodyLength: (row.body_text ?? '').length })

      isNativeBeap =
        row.source_type === 'direct_beap' || (!!row.handshake_id && row.source_type !== 'email_plain')

      const available = await isLlmAvailable()
      if (!available) {
        if (isNativeBeap) {
          return {
            ok: true,
            data: {
              draft: '',
              capsuleDraft: { publicText: '', encryptedText: '' },
              isNativeBeap: true as const,
              error: true,
            },
          }
        }
        return {
          ok: true,
          data: { draft: 'Error: No AI provider available. Check Backend settings (local model or cloud API key).', error: true },
        }
      }

      if (isNativeBeap) {
        const messageContent = buildNativeBeapAnalyzeBody(row)
        const { tone } = getToneAndSortForPrompts(db)
        const contextBlock = getContextBlockForPrompts(db)
        let systemFull =
          'You are a professional assistant writing a reply to a business message. Output only the reply text as natural prose. No JSON, no key-value contact cards, no structured metadata.'
        let systemSummary =
          'You summarize text into a short 1-2 sentence preview for an inbox. Output only the summary text. No JSON.'
        if (tone) {
          systemFull += `\n\nUser instructions for response tone and style: ${tone}`
          systemSummary += `\n\nUser instructions for tone: ${tone}`
        }
        if (contextBlock) {
          systemFull += contextBlock
          systemSummary += contextBlock
        }

        const fullUserPrompt = `Write a professional reply to this message.
Output ONLY the reply text. No JSON, no labels, no structured fields — write as normal sentences.
Match the language of the original message.

Original message:
${messageContent}`

        const fullReply = (await inboxLlmChat({ system: systemFull, user: fullUserPrompt })).trim().slice(0, 8000)
        console.log('[AI-DRAFT] Native BEAP full reply length:', fullReply.length)

        const summaryUserPrompt = `Summarize this reply in 1-2 sentences for a preview.
Output ONLY the summary text. No JSON, no formatting.

Reply being summarized:
${fullReply}`

        const summary = (await inboxLlmChat({ system: systemSummary, user: summaryUserPrompt })).trim().slice(0, 4000)
        console.log('[AI-DRAFT] Native BEAP summary length:', summary.length)

        const capsuleDraft = {
          publicText: summary || '',
          encryptedText: fullReply || '',
        }
        const draftFallback = (capsuleDraft.encryptedText || capsuleDraft.publicText).slice(0, 8000)

        const existingRow = db.prepare('SELECT ai_analysis_json FROM inbox_messages WHERE id = ?').get(messageId) as { ai_analysis_json?: string | null } | undefined
        let merged: Record<string, unknown> = {}
        if (existingRow?.ai_analysis_json) {
          try {
            merged = JSON.parse(existingRow.ai_analysis_json) as Record<string, unknown>
          } catch {
            /* ignore */
          }
        }
        merged.draftReply = {
          publicMessage: capsuleDraft.publicText,
          encryptedMessage: capsuleDraft.encryptedText,
        }
        merged.status = merged.status ?? 'draft_reply'
        db.prepare('UPDATE inbox_messages SET ai_analysis_json = ? WHERE id = ?').run(JSON.stringify(merged), messageId)

        return {
          ok: true,
          data: {
            draft: draftFallback,
            capsuleDraft,
            isNativeBeap: true as const,
          },
        }
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
      const draft = await inboxLlmChat({ system: systemPrompt, user: userPrompt })
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
      if (isNativeBeap) {
        return {
          ok: true,
          data: {
            draft: '',
            capsuleDraft: { publicText: '', encryptedText: '' },
            isNativeBeap: true as const,
            error: true,
          },
        }
      }
      const isTimeout = err?.message?.startsWith('LLM_TIMEOUT')
      return {
        ok: false,
        error: isTimeout ? 'timeout' : 'llm_error',
        message: err?.message ?? 'Unknown error',
      }
    }
  })

  ipcMain.handle('inbox:aiAnalyzeMessage', async (_e, messageId: string) => {
    if (DEBUG_INBOX_AI_IPC_VERBOSE) {
      console.warn('⚡ aiAnalyzeMessage CALLED', new Date().toISOString(), { messageId })
      console.log('[AI-ANALYZE] Starting for message:', messageId)
    }
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const row = db
        .prepare(
          'SELECT from_address, from_name, subject, body_text, received_at, source_type, handshake_id, depackaged_json, beap_package_json FROM inbox_messages WHERE id = ?',
        )
        .get(messageId) as
        | {
            from_address?: string
            from_name?: string
            subject?: string
            body_text?: string
            received_at?: string
            source_type?: string | null
            handshake_id?: string | null
            depackaged_json?: string | null
            beap_package_json?: string | null
          }
        | undefined
      if (!row) return { ok: false, error: 'Message not found' }
      console.log('[AI-ANALYZE] Message fetched:', { from: row.from_address, subject: row.subject, bodyLength: (row.body_text ?? '').length })

      const available = await isLlmAvailable()
      if (!available) {
        return { ok: true, data: { error: 'No AI provider available. Check Backend settings (local model or cloud API key).' } }
      }

      const isNativeBeap =
        row.source_type === 'direct_beap' || (!!row.handshake_id && row.source_type !== 'email_plain')

      const sender = row.from_name ? `${row.from_name} <${row.from_address || ''}>` : (row.from_address || 'Unknown')
      const body = isNativeBeap
        ? buildNativeBeapAnalyzeBody(row)
        : (row.body_text || '').trim().slice(0, 8000)
      const sortWAnalyze = sortSourceWeightingFromMessageRow(row)
      const userPrompt = `From: ${sender}\nSubject: ${row.subject || '(No subject)'}\nDate: ${row.received_at || '—'}\n\n${body}\n\n${formatSourceWeightingForPrompt(sortWAnalyze)}`

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
      if (isNativeBeap) {
        systemPrompt = `You are an email triage AI for WR Desk. The message is a BEAP handshake / native capsule. Analyze it and respond with a JSON object only. Use these exact keys:
- needsReply: boolean — true if the user should respond
- needsReplyReason: string — one sentence why
- summary: string — 2-3 sentence summary
- urgencyScore: number — 1-10
- urgencyReason: string
- actionItems: string[] — empty array if none
- archiveRecommendation: "archive" | "keep"
- archiveReason: string
- draftReplyPublic: string | null — If needsReply is true, a brief 1-2 sentence preview (plain prose only). If needsReply is false, null.
- draftReplyFull: string | null — If needsReply is true, the full reply as natural prose only (no JSON inside the string, no structured contact-card fields). If needsReply is false, null.

Respond ONLY with valid JSON. No markdown, no backticks, no preamble, no explanation.`
      }
      if (tone) systemPrompt += `\n\nUser instructions for response tone and style: ${tone}`
      if (sortRules) systemPrompt += `\n\nUser custom sorting rules: ${sortRules}`
      if (contextBlock) systemPrompt += contextBlock

      console.log('[AI-ANALYZE] System prompt length:', systemPrompt.length)
      console.log('[AI-ANALYZE] Calling LLM...')
      const raw = await inboxLlmChat({ system: systemPrompt, user: userPrompt })
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
          { subject: row.subject, body: row.body_text ?? '' },
          sortWAnalyze
        )
        urgencyScore = tri.urgencyScore
        needsReply = tri.needsReply
      }
      const actionItems = parseFailed ? [] : (Array.isArray(parsed.actionItems) ? parsed.actionItems.filter((x): x is string => typeof x === 'string').slice(0, 10) : [])
      const archiveRecommendation = parseFailed ? 'keep' : (parsed.archiveRecommendation === 'archive' ? 'archive' : 'keep')
      const archiveReason = (parseFailed ? 'Could not determine' : (parsed.archiveReason ?? '')).slice(0, 300)
      let draftReply: string | { publicMessage: string; encryptedMessage: string } | null = null
      if (!parseFailed && needsReply) {
        if (isNativeBeap) {
          const cap = normalizeNativeBeapDraftReply(parsed as Record<string, unknown>)
          if (cap && (cap.publicMessage.trim() || cap.encryptedMessage.trim())) {
            draftReply = {
              publicMessage: cap.publicMessage.slice(0, 4000),
              encryptedMessage: cap.encryptedMessage.slice(0, 8000),
            }
          } else if (typeof parsed.draftReply === 'string') {
            draftReply = parsed.draftReply.slice(0, 8000)
          }
        } else if (typeof parsed.draftReply === 'string') {
          draftReply = parsed.draftReply.slice(0, 8000)
        }
      }

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
    if (DEBUG_AUTOSORT_DIAGNOSTICS) {
      const st = getAutosortDiagMainState()
      autosortDiagLog('aiAnalyzeMessageStream:invoke', {
        messageId,
        ts: new Date().toISOString(),
        bulkSortActive: st.bulkSortActive,
        diagRunId: st.runId,
      })
    }
    if (activeAiAnalyzeMessageStreams.has(messageId)) {
      console.log('[AI-ANALYZE-STREAM] Already running for:', messageId)
      return { started: false, reason: 'already-running' as const }
    }
    activeAiAnalyzeMessageStreams.add(messageId)
    console.log('[AI-ANALYZE-STREAM] Starting for message:', messageId)
    let streamStartedOk = false
    try {
      const db = await resolveDbWithDiag('inbox:aiAnalyzeMessageStream')
      if (!db) {
        event.sender.send('inbox:aiAnalyzeMessageError', { messageId, error: 'llm_error', message: 'Database unavailable' })
        return { started: false }
      }
      const row = db
        .prepare(
          'SELECT from_address, from_name, subject, body_text, received_at, source_type, handshake_id, depackaged_json, beap_package_json FROM inbox_messages WHERE id = ?',
        )
        .get(messageId) as
        | {
            from_address?: string
            from_name?: string
            subject?: string
            body_text?: string
            received_at?: string
            source_type?: string | null
            handshake_id?: string | null
            depackaged_json?: string | null
            beap_package_json?: string | null
          }
        | undefined
      if (!row) {
        event.sender.send('inbox:aiAnalyzeMessageError', { messageId, error: 'llm_error', message: 'Message not found' })
        return { started: false }
      }

      const settings = resolveInboxLlmSettings()
      let ollamaModelForStream: string | undefined
      if (settings.provider.toLowerCase() === 'ollama') {
        const { ollamaManager } = await import('../llm/ollama-manager')
        const resolved = await ollamaManager.getEffectiveChatModelName()
        if (!resolved) {
          event.sender.send('inbox:aiAnalyzeMessageError', {
            messageId,
            error: 'llm_error',
            message: 'No AI provider available. Check Backend settings (local model or cloud API key).',
          })
          return { started: false }
        }
        ollamaModelForStream = resolved
      } else {
        const available = await isLlmAvailable()
        if (!available) {
          event.sender.send('inbox:aiAnalyzeMessageError', {
            messageId,
            error: 'llm_error',
            message: 'No AI provider available. Check Backend settings (local model or cloud API key).',
          })
          return { started: false }
        }
      }

      const isNativeBeapStream =
        row.source_type === 'direct_beap' || (!!row.handshake_id && row.source_type !== 'email_plain')

      const sender = row.from_name ? `${row.from_name} <${row.from_address || ''}>` : (row.from_address || 'Unknown')
      const body = isNativeBeapStream
        ? buildNativeBeapAnalyzeBody(row)
        : (row.body_text || '').trim().slice(0, 8000)
      const sortWStream = sortSourceWeightingFromMessageRow(row)
      const userPrompt = `From: ${sender}\nSubject: ${row.subject || '(No subject)'}\nDate: ${row.received_at || '—'}\n\n${body}\n\n${formatSourceWeightingForPrompt(sortWStream)}`

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
      if (isNativeBeapStream) {
        systemPrompt = `You are an email triage AI for WR Desk. The message is a BEAP handshake / native capsule. Analyze it and respond with JSON only. Keys:
- needsReply, needsReplyReason, summary, urgencyScore, urgencyReason, actionItems, archiveRecommendation, archiveReason (same meanings as email triage)
- draftReplyPublic: string | null — If needsReply is true, brief 1-2 sentence preview (plain prose). If false, null.
- draftReplyFull: string | null — If needsReply is true, full reply as natural prose (no JSON inside strings). If false, null.

Respond ONLY with valid JSON. No markdown, no backticks, no preamble.`
      }
      if (tone) systemPrompt += `\n\nUser instructions for response tone and style: ${tone}`
      if (sortRules) systemPrompt += `\n\nUser custom sorting rules: ${sortRules}`
      if (contextBlock) systemPrompt += contextBlock

      if (ollamaModelForStream) {
        const stream = streamInboxOllamaAnalyzeWithSandboxRouting(systemPrompt, userPrompt, ollamaModelForStream)
        for await (const chunk of stream) {
          if (event.sender.isDestroyed()) break
          event.sender.send('inbox:aiAnalyzeMessageChunk', { messageId, chunk })
        }
      } else {
        const text = await inboxLlmChat({ system: systemPrompt, user: userPrompt })
        if (!event.sender.isDestroyed() && text) {
          event.sender.send('inbox:aiAnalyzeMessageChunk', { messageId, chunk: text })
        }
      }
      if (!event.sender.isDestroyed()) {
        event.sender.send('inbox:aiAnalyzeMessageDone', { messageId })
        streamStartedOk = true
      }
    } catch (err: unknown) {
      const ir = mapInferenceRoutingErrorToIPC(err)
      const msg = err instanceof Error ? err.message : String(err)
      const stack = err instanceof Error ? err.stack : undefined
      console.error('[Inbox IPC] aiAnalyzeMessageStream error:', msg, stack ?? err)
      const isTimeout = msg.startsWith('LLM_TIMEOUT')
      if (!event.sender.isDestroyed()) {
        if (ir) {
          event.sender.send('inbox:aiAnalyzeMessageError', {
            messageId,
            error: ir.error,
            message: ir.message,
            inferenceRoutingReason: ir.inferenceRoutingReason,
          })
        } else {
          event.sender.send('inbox:aiAnalyzeMessageError', {
            messageId,
            error: isTimeout ? 'timeout' : 'llm_error',
            message: msg || 'Unknown error',
          })
        }
      }
    } finally {
      activeAiAnalyzeMessageStreams.delete(messageId)
    }
    return { started: streamStartedOk }
  })

  /**
   * Options for bulk-classify callers that have already resolved the LLM once for the run.
   * Passing resolvedLlm skips isLlmAvailable() and listModels() inside classifySingleMessage
   * and inboxLlmChat, so a batch of N parallel messages causes exactly 1 shared /api/tags
   * request rather than 2N.
   */

  /**
   * Set true only during local debugging.
   * In production these lines fire once per message in every bulk run — keep them silent.
   */
  const DEBUG_AI_DIAGNOSTICS = false

  interface ClassifySingleMessageOptions {
    /** Pre-resolved LLM context for the batch run. Skips isLlmAvailable + listModels per message. */
    resolvedLlm?: ResolvedLlmContext
    /** Opaque run identifier included in diagnostic logs. */
    runId?: string
    /** 1-based renderer Auto-Sort chunk index (bulk `aiClassifyBatch` invocation). */
    chunkIndex?: number
    /** Zero-based message index within the current concurrent batch, for diagnostic logs. */
    batchIndex?: number
  }

  /** Per-message classification — used by both aiClassifySingle and aiCategorize. */
  async function classifySingleMessage(messageId: string, sessionId?: string, opts?: ClassifySingleMessageOptions): Promise<{
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
    /** Present when classify succeeded and remote lifecycle enqueue ran (all categories, including urgent). */
    remoteEnqueue?: { enqueued: number; skipped: number; skipReasons: string[] }
  }> {
    if (DEBUG_AI_DIAGNOSTICS) console.warn('⚡ classifySingleMessage CALLED', new Date().toISOString(), {
      messageId,
      model: opts?.resolvedLlm?.model ?? '(will resolve)',
      skipAvailabilityCheck: opts?.resolvedLlm != null,
      ...(opts?.runId ? { runId: opts.runId } : {}),
      ...(opts?.batchIndex != null ? { batchIndex: opts.batchIndex } : {}),
    })
    const db = await resolveDbWithDiag(opts?.runId ? `classifySingleMessage:${opts.runId}` : 'classifySingleMessage')
    if (!db) {
      const errCode = isRecentVaultLock(120_000) ? 'vault_locked' : 'database_unavailable'
      return { messageId, error: errCode }
    }
    const row = db
      .prepare(
        'SELECT from_address, from_name, subject, body_text, has_attachments, attachment_count, source_type, handshake_id FROM inbox_messages WHERE id = ?',
      )
      .get(messageId) as
      | {
          from_address?: string
          from_name?: string
          subject?: string
          body_text?: string
          has_attachments?: number | null
          attachment_count?: number | null
          source_type?: string | null
          handshake_id?: string | null
        }
      | undefined
    if (!row) return { messageId, error: 'not_found' }

    // Stamp session membership immediately — even if classify fails, this message is part of the session
    if (sessionId) {
      try {
        db.prepare('UPDATE inbox_messages SET last_autosort_session_id = ? WHERE id = ?').run(sessionId, messageId)
      } catch (e) {
        console.error('[AutoSort] Failed to stamp session on message:', messageId, e)
      }
    }

    // Skip LLM availability check when the caller already resolved the model for this batch.
    // This eliminates one listModels() → /api/tags call per message in a concurrent bulk run.
    if (!opts?.resolvedLlm) {
      const available = await isLlmAvailable()
      if (!available) return { messageId, error: 'llm_unavailable' }
    }

    const userRules = getInboxAiRulesForPrompt()
    const systemPrompt = `You are an inbox classifier. Return ONLY a raw JSON object — no prose, no explanation, no markdown fences.

REQUIRED OUTPUT FORMAT (use exactly this shape, nothing else):
{
  "category": "pending_delete" | "pending_review" | "archive" | "urgent" | "action_required" | "normal",
  "urgency": <integer 1-10>,
  "needsReply": <true|false>,
  "summary": "<one sentence>",
  "reason": "<one sentence>",
  "draftReply": "<reply text or null>"
}

CLASSIFICATION RULES:
${userRules}`

    const from = row.from_name ? `${row.from_name} <${row.from_address || ''}>` : (row.from_address || 'Unknown')
    const attCount = typeof row.attachment_count === 'number' ? row.attachment_count : 0
    const hasAtt = (row.has_attachments === 1 || attCount > 0) ? 'yes' : 'no'
    const attachmentLine =
      hasAtt === 'yes'
        ? `Has attachments: yes (${attCount} file(s) per message metadata)`
        : 'Has attachments: no (0 files per message metadata)'
    const sortWeight = sortSourceWeightingFromMessageRow(row)
    /** Short body keeps Auto-Sort fast; subject + sender carry most triage signal. */
    const userPrompt = `Classify this email:
From: ${from}
Subject: ${row.subject || '(No subject)'}
${attachmentLine}
Body (first 500 chars): ${(row.body_text ?? '').slice(0, 500)}

${formatSourceWeightingForPrompt(sortWeight)}`

    try {
      const raw = await inboxLlmChat({
        system: systemPrompt,
        user: userPrompt,
        resolvedContext: opts?.resolvedLlm,
        llmTrace:
          opts?.resolvedLlm != null
            ? {
                source: 'bulk_autosort',
                runId: opts.runId,
                chunkIndex: opts.chunkIndex,
                batchIndex: opts.batchIndex ?? 0,
              }
            : undefined,
      })
      const parsed = parseAiJson(raw) as {
        category?: string
        urgency?: number
        needsReply?: boolean
        summary?: string
        reason?: string
        draftReply?: string | null
      }
      if (!parsed?.category) return { messageId, error: 'parse_failed', reason: raw?.slice?.(0, 200) }

      // Normalize: lowercase + collapse spaces/hyphens to underscores so "action required" → "action_required"
      const cat = String(parsed.category).toLowerCase().replace(/[\s\-]+/g, '_')
      const VALID_NEW = ['pending_delete', 'pending_review', 'archive', 'urgent', 'action_required', 'normal'] as const
      let validCategory = VALID_NEW.includes(cat as any) ? cat : 'normal'
      let urgency = typeof parsed.urgency === 'number' ? Math.max(1, Math.min(10, parsed.urgency)) : 5
      let needsReply = !!parsed.needsReply
      let reason = (parsed.reason ?? '').slice(0, 500)
      const summary = (parsed.summary ?? '').slice(0, 500)

      /** WRExpert coherence: promotional / unsolicited cannot be urgent+critical; source/handshake weighting softens delete/archive where policy requires. */
      const reco = reconcileInboxClassification(
        { category: validCategory, urgency, needsReply, reason, summary },
        { subject: row.subject, body: row.body_text ?? '' },
        sortWeight
      )
      validCategory = reco.category
      urgency = reco.urgency
      needsReply = reco.needsReply
      reason = reco.reason.slice(0, 500)

      // ── Attachment guard: messages with attachments must be minimum pending_review ──
      const hasAttachments =
        row.has_attachments === 1 || (typeof row.attachment_count === 'number' && row.attachment_count > 0)
      if (hasAttachments) {
        const lowPriorityCategories = ['archive', 'pending_delete', 'spam', 'irrelevant', 'newsletter'] as const
        if ((lowPriorityCategories as readonly string[]).includes(validCategory)) {
          if (DEBUG_AI_DIAGNOSTICS) {
            console.log(
              `[AutoSort] Attachment guard: bumping "${validCategory}" → "pending_review" for message with attachments:`,
              messageId,
            )
          }
          validCategory = 'pending_review'
          reason = ((reason || '') + ' [Bumped to review: has attachments]').slice(0, 500)
          if (urgency < 5) {
            urgency = 5
          }
        }
      }

      const sortCategoryMap: Record<string, string> = {
        pending_delete: 'spam',
        pending_review: 'pending_review',
        archive: 'newsletter',
        urgent: 'urgent',
        /** Must match workflow tabs: `filterByInboxFilter` / `buildInboxMessagesWhereClause` treat `pending_review` + `pending_review_at` as Pending Review; `important` was excluded from that tab and left rows on All. */
        action_required: 'pending_review',
        normal: 'normal',
      }
      const sortCategory = sortCategoryMap[validCategory] ?? 'normal'
      /** action_required → same persisted row shape as pending_review (`sort_category` + `pending_review_at`); recommendedAction stays `pending_review` for bulk moves. */
      const recommendedAction =
        validCategory === 'pending_delete' ? 'pending_delete'
        : validCategory === 'pending_review' ? 'pending_review'
        : validCategory === 'archive' ? 'archive'
        : validCategory === 'action_required' ? 'pending_review'
        : validCategory === 'urgent' && needsReply ? 'draft_reply_ready'
        : 'keep_for_manual_action'
      let pendingDelete = validCategory === 'pending_delete'
      let pendingReview = validCategory === 'pending_review' || validCategory === 'action_required'

      /** High urgency (score >= 7): local sort_category = urgent, no pending_delete / pending_review / archived locally — remote still mirrors to the Urgent folder via enqueue. */
      const URGENCY_THRESHOLD = 7
      const isUrgent = urgency >= URGENCY_THRESHOLD
      if (isUrgent) {
        pendingDelete = false
        pendingReview = false
      }

      /** Always write sort_category, urgency, needs_reply. For urgent: use 'urgent', never add pending_review_at. */
      const effectiveSortCategory = isUrgent ? 'urgent' : sortCategory
      if (DEBUG_AI_DIAGNOSTICS) {
        console.log(
          `[AutoSort] ${messageId}: raw=${cat} valid=${validCategory} → sortCat=${effectiveSortCategory} rec=${recommendedAction} urgency=${urgency} del=${pendingDelete} rev=${pendingReview}`,
        )
      }
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
        /** Clear `pending_review_at` whenever we leave the review workflow — otherwise rows stay excluded from the main inbox tab (`filter=all`) while `sort_category` reads `normal`, which looks like “analyzed but not sorted.” */
        db.prepare(
          `UPDATE inbox_messages SET archived = 0, pending_delete = 0, pending_delete_at = NULL, pending_review_at = NULL,
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
        recommendedAction,
        actionExplanation: reason || '',
        actionItems: [],
        draftReply: needsReply ? (parsed.draftReply ?? null) : null,
        status: 'classified',
      })
      db.prepare('UPDATE inbox_messages SET ai_analysis_json = ? WHERE id = ?').run(aiAnalysisJson, messageId)

      /** Single path: DB columns are source of truth; skips if `imap_remote_mailbox` already matches; supersedes stale queue rows. All classified categories (including urgent) enqueue remote lifecycle ops. */
      let remoteEnqueue: { enqueued: number; skipped: number; skipReasons: string[] } | undefined
      try {
        remoteEnqueue = enqueueRemoteOpsForLocalLifecycleState(db, [messageId])
      } catch (e: any) {
        console.warn('[Inbox] enqueueRemoteOpsForLocalLifecycleState after classify:', e?.message)
      }

      return {
        messageId,
        category: effectiveSortCategory,
        urgency,
        needsReply,
        summary,
        reason,
        draftReply: needsReply ? (parsed.draftReply ?? null) : null,
        recommended_action: recommendedAction,
        pending_delete: pendingDelete,
        pending_review: pendingReview,
        /** ISO timestamps / flags main wrote — renderer bulk Auto-Sort can sync Zustand without a second IPC. */
        pending_delete_at: pendingDelete ? nowIso : null,
        pending_review_at: pendingReview ? nowIso : null,
        archived: validCategory === 'archive' ? 1 : 0,
        remoteEnqueue,
      }
    } catch (err: any) {
      return {
        messageId,
        error: err?.message?.includes?.('LLM_TIMEOUT') ? 'timeout' : 'llm_error',
      }
    }
  }

  async function runClassifyBatchWithOptionalOllamaCap(
    batchIds: string[],
    sessionId: string | undefined,
    resolvedLlm: ResolvedLlmContext,
    runId: string | undefined,
    chunkIndex: number | undefined,
    ollamaParallelCap: number,
  ): Promise<{
    results: Awaited<ReturnType<typeof classifySingleMessage>>[]
    ollamaChunkDiag: OllamaClassifyBatchChunkDiag | null
  }> {
    const ollamaMax = ollamaParallelCap
    const ollama = resolvedLlm.provider.toLowerCase() === 'ollama'
    const capped = ollama && batchIds.length > ollamaMax
    const effectiveConcurrency = !ollama || batchIds.length <= ollamaMax ? batchIds.length : ollamaMax
    ollamaRuntimeBeginBatch({
      runId,
      chunkIndex,
      chunkSize: batchIds.length,
      capped,
      effectiveConcurrency,
    })
    let results: Awaited<ReturnType<typeof classifySingleMessage>>[] = []
    let ollamaChunkDiag: OllamaClassifyBatchChunkDiag | null = null
    try {
      const perIdMs: number[] = []
      const runOne = async (id: string, idx: number) => {
        const t0 = performance.now()
        const r = await classifySingleMessage(id, sessionId, {
          resolvedLlm,
          batchIndex: idx,
          runId,
          chunkIndex,
        })
        if (DEBUG_AUTOSORT_TIMING) perIdMs.push(Math.round(performance.now() - t0))
        return r
      }
      if (!ollama || batchIds.length <= ollamaMax) {
        results = await Promise.all(batchIds.map((id, idx) => runOne(id, idx)))
      } else {
        results = new Array(batchIds.length)
        let cursor = 0
        const worker = async () => {
          for (;;) {
            const idx = cursor++
            if (idx >= batchIds.length) break
            results[idx] = await runOne(batchIds[idx], idx)
          }
        }
        await Promise.all(Array.from({ length: ollamaMax }, () => worker()))
      }
      if (DEBUG_AUTOSORT_TIMING && perIdMs.length > 0) {
        const sum = perIdMs.reduce((a, b) => a + b, 0)
        autosortTimingLog('aiClassifyBatch:perMessage', {
          n: perIdMs.length,
          sumMs: sum,
          maxMs: Math.max(...perIdMs),
          avgMs: Math.round(sum / perIdMs.length),
          ollamaCapped: capped,
          ollamaParallelCapEffective: ollamaMax,
          tuningNote:
            'sumMs sums overlapping per-message walls (can exceed chunk wallMs). Use aiClassifyBatch:ipc.wallMs for real chunk time; use maxInFlightSeenDuringChunk on the ipc line for parallelism.',
        })
      }
    } finally {
      ollamaChunkDiag = ollamaRuntimeEndBatch()
    }
    return { results, ollamaChunkDiag }
  }

  ipcMain.handle('inbox:aiClassifySingle', async (_e, messageId: string, sessionId?: string) => {
    const out = await classifySingleMessage(messageId, sessionId)
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
   * Batch-classify handler for the renderer's Auto-Sort bulk loop.
   *
   * The renderer sends one chunk of IDs per batch (chunk size = user sort concurrency).
   * Compared with N×aiClassifySingle:
   *   - 1 IPC round-trip instead of N
   *   - LLM pre-resolved once for the whole chunk (no per-message listModels call)
   *   - Results returned together so the renderer can apply one React state update per batch
   * Optional 6th arg: **Ollama parallelism** (1–8) from bulk progress UI; `WRDESK_OLLAMA_CLASSIFY_MAX_CONCURRENT` overrides when set.
   * (cloud APIs still run the full chunk in parallel regardless of this cap).
   */
  ipcMain.handle(
    'inbox:aiClassifyBatch',
    async (
      _e,
      ids: string[],
      sessionId?: string,
      runId?: string,
      chunkIndex?: number,
      ollamaMaxConcurrentFromUi?: number,
    ) => {
    const ipcWallT0 = DEBUG_AUTOSORT_TIMING ? performance.now() : 0
    if (!ids?.length) return { results: [], batchRuntime: undefined }

    const dbFirst = await resolveDbCore()
    if (DEBUG_AUTOSORT_DIAGNOSTICS) {
      autosortDiagLog('resolveDb', {
        handler: 'inbox:aiClassifyBatch',
        result: dbFirst ? 'handle' : 'null',
        runId: runId ?? null,
      })
    }
    if (!dbFirst) {
      const errCode = isRecentVaultLock(120_000) ? 'vault_locked' : 'database_unavailable'
      return {
        results: ids.map((messageId) => ({ messageId, error: errCode })),
        batchError: errCode,
        batchRuntime: undefined,
      }
    }

    // Resolve LLM once for the entire chunk — eliminates N×listModels / redundant dynamic import churn.
    const preResolveT0 = performance.now()
    const resolvedLlm = (await preResolveInboxLlm()) ?? undefined
    const preResolveMs = Math.round(performance.now() - preResolveT0)
    if (!resolvedLlm) {
      return { results: ids.map((messageId) => ({ messageId, error: 'llm_unavailable' })), batchRuntime: undefined }
    }

    let ollamaPrewarm: OllamaBulkPrewarmDiag | undefined
    if (resolvedLlm.provider.toLowerCase() === 'ollama') {
      if (chunkIndex == null || chunkIndex === 1) {
        // Fire-and-forget: model loads in background while first classify prepares.
        // Previously awaited here, which blocked the entire first chunk for 10–20 s on a cold model.
        void maybePrewarmOllamaForBulkClassify(resolvedLlm.model, { chunkIndex })
        ollamaPrewarm = undefined
      }
      if (DEBUG_AUTOSORT_TIMING) {
        autosortTimingLog('aiClassifyBatch:ollamaPrewarm', {
          model: resolvedLlm.model,
          chunkIndex: chunkIndex ?? null,
          runId: runId ?? null,
          ...ollamaPrewarm,
        })
      }
    }

    // Resolved once per chunk so mid-chunk UI changes never alter this IPC's in-flight cap (next chunk picks up new UI).
    const ollamaResolved = resolveBulkOllamaClassifyCap(ollamaMaxConcurrentFromUi)
    lastBulkOllamaResolve = ollamaResolved

    if (DEBUG_AI_DIAGNOSTICS) {
      console.log('[AI-BATCH] classifying', ids.length, 'messages, model:', resolvedLlm.model, {
        provider: resolvedLlm.provider,
        ollamaCap: resolvedLlm.provider.toLowerCase() === 'ollama' ? ollamaResolved.cap : null,
        ollamaCapSource: resolvedLlm.provider.toLowerCase() === 'ollama' ? ollamaResolved.source : null,
      })
    }

    // Cloud: full chunk parallelism. Ollama: cap in-flight chats (see `runClassifyBatchWithOptionalOllamaCap`).
    const { results, ollamaChunkDiag } = await runClassifyBatchWithOptionalOllamaCap(
      ids,
      sessionId,
      resolvedLlm,
      runId,
      chunkIndex,
      ollamaResolved.cap,
    )

    try {
      const db = await resolveDb()
      if (db) scheduleOrchestratorRemoteDrain(resolveDb)
    } catch (e: any) {
      console.warn('[Inbox] Post-aiClassifyBatch remote schedule:', e?.message)
    }

    if (DEBUG_AUTOSORT_TIMING) {
      const ollama = resolvedLlm.provider.toLowerCase() === 'ollama'
      if (ollama) autosortBulkRunUsedOllama = true
      const maxFlight = ollamaChunkDiag?.maxInFlightSeenDuringChunk ?? null
      if (ollama && typeof maxFlight === 'number' && maxFlight >= 0) {
        autosortBulkRunMaxInFlight = Math.max(autosortBulkRunMaxInFlight, maxFlight)
      }
      autosortTimingLog('aiClassifyBatch:ipc', {
        wallMs: Math.round(performance.now() - ipcWallT0),
        preResolveMs: preResolveMs ?? null,
        ollamaPrewarm: ollamaPrewarm ?? null,
        resolvedModel: resolvedLlm.model,
        resolvedProvider: resolvedLlm.provider,
        chunkIndex: chunkIndex ?? null,
        chunkSize: ids.length,
        ollamaParallelFromUi:
          typeof ollamaMaxConcurrentFromUi === 'number' && Number.isFinite(ollamaMaxConcurrentFromUi)
            ? Math.max(1, Math.min(8, Math.floor(ollamaMaxConcurrentFromUi)))
            : null,
        provider: resolvedLlm.provider,
        ollamaConcurrencyCapped: ollama && ids.length > ollamaResolved.cap,
        ollamaCapEffective: ollamaResolved.cap,
        ollamaCapSource: ollamaResolved.source,
        maxInFlightSeenDuringChunk: maxFlight,
        effectiveOllamaConcurrency: ollamaChunkDiag?.effectiveConcurrency ?? null,
        runId: runId ?? null,
        tuningNote:
          'wallMs=true chunk duration. maxInFlightSeenDuringChunk shows real overlap (if 1 with cap>1, Ollama serializes). High cap can still hurt on single-GPU.',
      })
    }

    return {
      results,
      batchRuntime: {
        model: resolvedLlm.model,
        provider: resolvedLlm.provider,
        preResolveMs,
        ...(ollamaPrewarm ? { ollamaPrewarm } : {}),
      },
    }
  },
  )

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

      // Pre-resolve LLM once for the entire batch — eliminates 2×CONCURRENCY /api/tags
      // round-trips (one from isLlmAvailable + one from inboxLlmChat per message).
      const resolvedLlm = await preResolveInboxLlm()
      if (!resolvedLlm) {
        const errMsg = 'No AI provider available. Check Backend settings (local model or cloud API key).'
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
        const batchResults = await Promise.all(batch.map((id, idx) => classifySingleMessage(id, undefined, { resolvedLlm, batchIndex: i + idx })))
        for (const r of batchResults) {
          if (r.error) {
            classifications.push({
              id: r.messageId,
              category: 'normal',
              summary: '',
              reason:
                r.error === 'timeout'
                  ? 'Timed out.'
                  : r.error === 'parse_failed'
                    ? 'AI analysis returned no result for this message.'
                    : r.error === 'not_found'
                      ? 'Message not found.'
                      : r.error === 'llm_unavailable'
                        ? 'No AI provider available. Check Backend settings (local model or cloud API key).'
                        : 'Analysis failed.',
              needs_reply: false,
              needs_reply_reason: 'No result from AI.',
              urgency_score: 5,
              urgency_reason:
                r.error === 'llm_unavailable'
                  ? 'No AI provider available. Check Backend settings (local model or cloud API key).'
                  : 'Analysis failed.',
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
              remote_enqueue: r.remoteEnqueue,
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
      const db = await resolveDbWithDiag('inbox:markPendingDelete')
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
      const db = await resolveDbWithDiag('inbox:moveToPendingReview')
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
    return { ok: true, data: { enqueued: out.enqueued, skipped: out.skipped, skipReasons: out.skipReasons } }
  })

  /** Same as `inbox:enqueueRemoteLifecycleMirror` but flat `{ enqueued, skipped, skipReasons }` — used after Auto-Sort batch. */
  ipcMain.handle('inbox:enqueueRemoteSync', async (_e, messageIds: string[]) => {
    const out = await runEnqueueRemoteLifecycleMirrorFromIds(messageIds)
    if (!out.ok) return { ok: false, error: out.error }
    return { ok: true, enqueued: out.enqueued, skipped: out.skipped, skipReasons: out.skipReasons }
  })

  /** Reconcile entire account: enqueue moves where local lifecycle ≠ `imap_remote_mailbox`. */
  ipcMain.handle('inbox:fullRemoteSync', async (_e, accountId: string) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      if (typeof accountId !== 'string' || !accountId.trim()) {
        return { ok: false, error: 'accountId required' }
      }
      const r = enqueueFullRemoteSync(db, accountId.trim())
      scheduleOrchestratorRemoteDrain(getDb)
      return {
        ok: true,
        enqueued: r.enqueued,
        skipped: r.skipped,
        inboxRestoreNeeded: r.inboxRestoreNeeded,
      }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'fullRemoteSync failed' }
    }
  })

  /** Run {@link enqueueFullRemoteSync} for every distinct account among these message ids. */
  ipcMain.handle('inbox:fullRemoteSyncForMessages', async (_e, messageIds: string[]) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const ids = Array.isArray(messageIds)
        ? messageIds.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
        : []
      const r = enqueueFullRemoteSyncForAccountsTouchingMessages(db, ids)
      scheduleOrchestratorRemoteDrain(getDb)
      return {
        ok: true,
        enqueued: r.enqueued,
        skipped: r.skipped,
        inboxRestoreNeeded: r.inboxRestoreNeeded,
      }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'fullRemoteSyncForMessages failed' }
    }
  })

  /** Full lifecycle reconcile for every connected email account — **no** inline bounded drain; background drain until empty. */
  ipcMain.handle('inbox:fullRemoteSyncAllAccounts', async () => {
    try {
      // Clear ALL pull locks — stale locks from crashed pulls block the drain (defer every row for that account).
      clearAllPullActiveLocks()
      console.log('[SYNC_REMOTE] IPC inbox:fullRemoteSyncAllAccounts handler started')
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const accounts = await emailGateway.listAccounts()
      const knownIds = accounts.map((a) => a?.id).filter((x): x is string => typeof x === 'string' && x.trim() !== '')
      const orphanCleared = markOrphanPendingQueueRowsAsFailed(db, knownIds)
      const unmirrored = enqueueUnmirroredClassifiedLifecycleMessages(db)

      let enqueued = unmirrored.enqueued
      let skipped = unmirrored.skipped
      let inboxRestoreNeeded = 0
      let accountCount = 0
      for (const a of accounts) {
        if (!a?.id) continue
        const r = enqueueFullRemoteSync(db, a.id)
        enqueued += r.enqueued
        skipped += r.skipped
        inboxRestoreNeeded += r.inboxRestoreNeeded
        accountCount += 1
      }
      scheduleOrchestratorRemoteDrain(getDb)
      console.log(
        `[Inbox] fullRemoteSyncAllAccounts: accounts=${accountCount} enqueued=${enqueued} skipped=${skipped} inboxRestoreNeeded=${inboxRestoreNeeded} unmirroredIds=${unmirrored.idsFound} orphanPendingCleared=${orphanCleared.cleared} (simple timer drain will process pending rows)`,
      )
      return {
        ok: true,
        enqueued,
        skipped,
        inboxRestoreNeeded,
        accountCount,
        unmirroredIds: unmirrored.idsFound,
        unmirroredEnqueued: unmirrored.enqueued,
        unmirroredSkipped: unmirrored.skipped,
        orphanPendingCleared: orphanCleared.cleared,
        backgroundDrain: true,
      }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'fullRemoteSyncAllAccounts failed' }
    }
  })

  /**
   * Dev-only: enqueue lifecycle mirror for one message, then synchronously drain batches until
   * its pending rows clear or timeout (for in-app diagnostics without terminal).
   */
  ipcMain.handle('inbox:debugTestMoveOne', async (_e, messageId: string) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const mid = typeof messageId === 'string' ? messageId.trim() : ''
      if (!mid) return { ok: false, error: 'messageId required' }

      const selMsg = db.prepare(
        `SELECT id, imap_remote_mailbox, email_message_id, archived, pending_delete, sort_category, pending_review_at,
                source_type, account_id
         FROM inbox_messages WHERE id = ?`,
      )
      const messageRowBeforeEnqueue = selMsg.get(mid) as Record<string, unknown> | undefined

      const enqueue = enqueueRemoteOpsForLocalLifecycleState(db, [mid])
      let drainProcessed = 0
      let drainFailed = 0
      const start = Date.now()
      const maxMs = 45_000
      let batches = 0
      const maxBatches = 80

      while (Date.now() - start < maxMs && batches < maxBatches) {
        const pendingForMsg = db
          .prepare(
            `SELECT COUNT(*) as c FROM remote_orchestrator_mutation_queue WHERE message_id = ? AND status = 'pending'`,
          )
          .get(mid) as { c: number }
        if ((pendingForMsg?.c ?? 0) === 0) break

        const b = await processOrchestratorRemoteQueueBatch(db, ORCHESTRATOR_REMOTE_QUEUE_BATCH)
        drainProcessed += b.processed
        drainFailed += b.failed
        batches += 1
        if (b.processed === 0 && b.failed === 0 && (b.deferredDueToPull ?? 0) === 0) break
        if ((b.deferredDueToPull ?? 0) > 0 && b.processed === 0 && b.failed === 0) {
          await new Promise((r) => setTimeout(r, 400))
        }
      }

      const lastRow = db
        .prepare(
          `SELECT operation, status, last_error, attempts, email_message_id FROM remote_orchestrator_mutation_queue WHERE message_id = ? ORDER BY updated_at DESC LIMIT 1`,
        )
        .get(mid) as
        | {
            operation: string
            status: string
            last_error: string | null
            attempts: number
            email_message_id: string
          }
        | undefined

      const queueRowsForMessage = db
        .prepare(
          `SELECT id, operation, status, attempts, last_error, created_at, updated_at, email_message_id
           FROM remote_orchestrator_mutation_queue
           WHERE message_id = ?
           ORDER BY updated_at DESC
           LIMIT 25`,
        )
        .all(mid) as Array<Record<string, unknown>>

      const messageRowAfterDrain = selMsg.get(mid) as Record<string, unknown> | undefined

      try {
        scheduleOrchestratorRemoteDrain(getDb)
      } catch {
        /* ignore */
      }

      return {
        ok: true,
        enqueue,
        drainProcessed,
        drainFailed,
        lastRow: lastRow ?? null,
        messageRowBeforeEnqueue: messageRowBeforeEnqueue ?? null,
        messageRowAfterDrain: messageRowAfterDrain ?? null,
        queueRowsForMessage,
      }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'debugTestMoveOne failed' }
    }
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
   * Reset `failed` orchestrator queue rows to `pending` (attempts=0) and schedule drain.
   * Optional `accountId` limits the reset to one account (debug: “Retry failed” per Outlook / M365).
   */
  ipcMain.handle('inbox:retryFailedRemoteOps', async (_e, accountId?: string) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const aid =
        typeof accountId === 'string' && accountId.trim() && accountId.trim() !== '(no account_id)'
          ? accountId.trim()
          : undefined
      const { resetCount } = resetFailedOrchestratorRemoteQueueRows(db, aid)
      try {
        scheduleOrchestratorRemoteDrain(getDb)
      } catch {
        /* ignore */
      }
      return { ok: true, resetCount }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'retryFailedRemoteOps failed' }
    }
  })

  /**
   * Permanently remove **failed** remote queue rows for one account (orphan “Account not found”, etc.).
   * Requires a concrete `accountId` (use debug panel per-account button).
   */
  ipcMain.handle('inbox:clearFailedRemoteOps', async (_e, accountId?: string) => {
    try {
      const db = await resolveDb()
      if (!db) return { ok: false, error: 'Database unavailable' }
      const aid =
        typeof accountId === 'string' && accountId.trim() && accountId.trim() !== '(no account_id)'
          ? accountId.trim()
          : undefined
      if (!aid) {
        return { ok: false, error: 'accountId is required' }
      }
      const { deletedCount } = clearFailedOrchestratorRemoteQueueForAccount(db, aid)
      return { ok: true, deletedCount }
    } catch (e: any) {
      return { ok: false, error: e?.message ?? 'clearFailedRemoteOps failed' }
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
        tick.skippedFinalDeleteOrphanAccount ||
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

  void (async () => {
    try {
      const db = await resolveDb()
      if (db) {
        const n = purgeImapRemoteQueueRows(db)
        if (n > 0) {
          console.log('[OrchestratorRemote] Startup purge: removed', n, 'IMAP remote queue row(s)')
        }
      }
    } catch (e: any) {
      console.warn('[OrchestratorRemote] Startup IMAP queue purge failed:', e?.message || e)
    }
  })()

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
            App registrations → New registration. Set redirect URI to: <code>http://127.0.0.1:51249/callback</code>
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

