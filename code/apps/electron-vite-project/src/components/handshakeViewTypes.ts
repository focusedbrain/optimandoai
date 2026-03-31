/**
 * Shared IPC bridge type for the handshakeView window object.
 * Single declaration to avoid TS2717 duplicate property errors.
 */

import type { VerifiedContextBlock } from './contextEscaping'
import type { NormalInboxAiResult, BulkClassification } from '../types/inboxAi'

/** AutoSort session persistence / review (preload `window.autosortSession`). */
export interface AutosortSessionAPI {
  create: () => Promise<string | null>
  finalize: (id: string, stats: any) => Promise<void>
  generateSummary: (id: string) => Promise<unknown>
  getSession: (id: string) => Promise<Record<string, unknown> | undefined>
  listSessions: (limit?: number) => Promise<Record<string, unknown>[]>
  deleteSession: (id: string) => Promise<void>
  getSessionMessages: (id: string) => Promise<Record<string, unknown>[]>
}

declare global {
  interface Window {
    handshakeView?: {
      listHandshakes: (filter?: { state?: string }) => Promise<any[]>
      submitCapsule: (jsonString: string) => Promise<any>
      importCapsule: (jsonString: string) => Promise<any>
      acceptHandshake: (id: string, sharingMode: string, fromAccountId: string, contextOpts?: { context_blocks?: any[]; profile_ids?: string[] }) => Promise<any>
      declineHandshake: (id: string) => Promise<any>
      deleteHandshake: (id: string) => Promise<{ success?: boolean; error?: string }>
      requestUnlockVault: () => Promise<{ success?: boolean; reason?: string; needsUnlock?: boolean }>
      unlockVaultWithPassword: (password: string, vaultId?: string) => Promise<{ success?: boolean; error?: string }>
      getVaultStatus?: () => Promise<{ isUnlocked?: boolean; name?: string | null; tier?: string; canUseHsContextProfiles?: boolean; email?: string | null }>
      listHsContextProfiles?: (includeArchived?: boolean) => Promise<{ profiles: Array<{ id: string; name: string; description?: string; scope: 'non_confidential' | 'confidential'; tags: string[]; updated_at: number; created_at: number; document_count: number; documents_ready: number; documents_pending: number; documents_failed: number; documents_failed_names: string[] }> }>
      getDocumentPageCount?: (documentId: string) => Promise<{ count: number }>
      getDocumentPage?: (documentId: string, pageNumber: number) => Promise<{ text: string | null }>
      getDocumentPageList?: (documentId: string) => Promise<{ pages: Array<{ page_number: number; char_count: number }> }>
      getDocumentFullText?: (documentId: string) => Promise<{ text: string | null }>
      searchDocumentPages?: (documentId: string, query: string) => Promise<{ matches: Array<{ page_number: number; match_count: number; snippet: string }> }>
      forceRevokeHandshake: (id: string) => Promise<{ success?: boolean; error?: string }>
      updateHandshakePolicies?: (handshakeId: string, policies: { ai_processing_mode?: string } | Record<string, boolean>) => Promise<{ success?: boolean }>
      updateContextItemGovernance?: (handshakeId: string, blockId: string, blockHash: string, senderUserId: string, governance: Record<string, unknown>) => Promise<{ success?: boolean; error?: string }>
      setBlockVisibility?: (args: { sender_wrdesk_user_id: string; block_id: string; block_hash: string; visibility: 'public' | 'private' }) => Promise<{ success?: boolean; error?: string }>
      setBulkBlockVisibility?: (args: { handshake_id: string; visibility: 'public' | 'private' }) => Promise<{ success?: boolean; error?: string }>
      getContextBlockCount: (handshakeId: string) => Promise<number>
      queryContextBlocks?: (handshakeId: string, purpose?: 'local_ai' | 'cloud_ai' | 'export' | 'search' | 'peer_transmission' | 'auto_reply') => Promise<VerifiedContextBlock[]>
      requestOriginalDocument?: (documentId: string, acknowledgedWarning: boolean, handshakeId?: string | null) => Promise<{ success: boolean; error?: string; approved?: boolean; contentBase64?: string; filename?: string; mimeType?: string }>
      requestLinkOpenApproval?: (linkEntityId: string, acknowledgedWarning: boolean, handshakeId?: string | null) => Promise<{ success: boolean; error?: string; approved?: boolean }>
      semanticSearch?: (query: string, scope?: string, limit?: number) => Promise<{ success: boolean; error?: string; results?: Array<{ block_id: string; type?: string; snippet?: string; payload_ref?: string; score?: number }> }>
      getAvailableModels?: () => Promise<{ success: boolean; error?: string; models?: Array<{ id: string; name: string; provider: string; type: 'local' | 'cloud' }> }>
      generateDraft?: (prompt: string) => Promise<{ success: boolean; answer?: string; error?: string }>
      chatWithContext?: (systemMessage: string, dataWrapper: string, userMessage: string) => Promise<string>
      chatDirect?: (params: { model: string; provider: string; systemPrompt: string; userPrompt: string; stream?: boolean }) => Promise<{
        success: boolean
        error?: string
        message?: string
        answer?: string
      }>
      chatWithContextRag?: (params: { query: string; scope?: string; model: string; provider: string; stream?: boolean; debug?: boolean; conversationContext?: { lastAnswer?: string }; selectedDocumentId?: string; selectedAttachmentId?: string; selectedMessageId?: string }) => Promise<{
        success: boolean
        error?: string
        provider?: string
        message?: string
        answer?: string
        sources?: Array<{ handshake_id: string; capsule_id?: string; block_id: string; source: string; score: number }>
        governanceNote?: string
        streamed?: boolean
        cached?: boolean
        resultType?: 'document_card' | 'result_card' | 'context_answer'
        structuredResult?: { title: string; items: Array<{ id: string; title: string; snippet: string; handshake_id: string; block_id: string; source: string; score: number; type?: string }> }
        intent?: string
        domain?: string
        latency?: { total_ms: number; classification_ms?: number; structured_ms?: number; semantic_ms?: number; block_retrieval_ms?: number; llm_ms?: number; cache_hit?: boolean; provider?: string; intent?: string; domain?: string }
      }>
      onChatStreamStart?: (callback: (data: { contextBlocks: string[]; sources: unknown[] }) => void) => () => void
      onChatStreamToken?: (callback: (data: { token: string }) => void) => () => void
      initiateHandshake?: (receiverEmail: string, fromAccountId: string, contextOpts?: { message?: string; context_blocks?: any[] }) => Promise<any>
      buildForDownload?: (receiverEmail: string, contextOpts?: { message?: string; context_blocks?: any[] }) => Promise<any>
      downloadCapsule?: (capsuleJson: string, suggestedFilename: string) => Promise<any>
      getPendingP2PBeapMessages?: () => Promise<{ items: Array<{ id: number; handshake_id: string; package_json: string; created_at: string }> }>
      ackPendingP2PBeap?: (id: number) => Promise<{ success?: boolean }>
      importBeapMessage?: (packageJson: string) => Promise<{ success: boolean; error?: string }>
      sendBeapViaP2P?: (
        handshakeId: string,
        packageJson: string,
      ) => Promise<{ success: boolean; error?: string; delivered?: boolean; queued?: boolean; code?: string }>
      checkHandshakeSendReady?: (handshakeId: string) => Promise<{ ready: boolean; error?: string }>
      /** Electron: X-Launch-Secret for localhost PQ KEM HTTP (beapCrypto pqEncapsulate). */
      pqHeaders?: () => Promise<Record<string, string>>
    }
    /** Sent BEAP outbox (ledger DB; previews and metadata only). See `BeapBridge` in vite-env.d.ts for `window.beap`. */
    outbox?: {
      insertSent: (record: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>
      listSent: (opts?: { limit?: number; offset?: number }) => Promise<{
        success: boolean
        messages?: Array<Record<string, unknown>>
        error?: string
      }>
    }
    emailAccounts?: {
      listAccounts: () => Promise<{
        ok: boolean
        data?: Array<{
          id: string
          displayName: string
          email: string
          provider: string
          status: string
          /** Present from gateway; false/absent = not paused */
          processingPaused?: boolean
          lastError?: string
          capabilities?: {
            oauthBased: boolean
            passwordBased: boolean
            inboundSyncCapable: boolean
            outboundSendCapable: boolean
            remoteFolderMutationCapable: boolean
            multiMailboxPerAuthGrantSupported: boolean
            supportsMultipleMailboxSlicesOnRow: boolean
          }
          mailboxes?: Array<{
            mailboxId: string
            label: string
            isDefault: boolean
            providerMailboxResourceRef?: string
          }>
        }>
        error?: string
      }>
      sendEmail: (
        accountId: string,
        payload: {
          to: string[]
          subject: string
          bodyText: string
          attachments?: { filename: string; mimeType: string; contentBase64: string }[]
        },
      ) => Promise<{ ok: boolean; data?: { success: boolean; messageId?: string }; error?: string }>
      validateImapLifecycleRemote?: (accountId: string) => Promise<
        | { ok: true; result: { ok: boolean; entries: Array<{ role: string; mailbox: string; exists: boolean; created?: boolean; error?: string }> } }
        | { ok: false; error: string }
      >
      getAccount?: (accountId: string) => Promise<{ ok: boolean; data?: unknown; error?: string }>
      setProcessingPaused?: (
        accountId: string,
        paused: boolean,
      ) => Promise<{ ok: boolean; data?: unknown; error?: string }>
      testConnection?: (accountId: string) => Promise<{ ok: boolean; data?: { success: boolean; error?: string }; error?: string }>
      getImapReconnectHints?: (accountId: string) => Promise<{ ok: boolean; data?: Record<string, unknown> | null; error?: string }>
      updateImapCredentials?: (
        accountId: string,
        creds: { imapPassword: string; smtpPassword?: string; smtpUseSameCredentials?: boolean },
      ) => Promise<{ ok: boolean; data?: { success: boolean; error?: string }; error?: string }>
      deleteAccount?: (accountId: string) => Promise<{ ok: boolean; error?: string }>
      /** Clears inbox DB sync cursor so the next Pull runs a full bootstrap window again. */
      resetSyncState?: (accountId: string) => Promise<{ ok: boolean; error?: string }>
      fullResetAccount?: (accountId: string) => Promise<{
        ok: boolean
        error?: string
        results?: string[]
      }>
      /** DevTools: schemas + sample rows for tables whose names include sync or state. */
      debugDumpSyncState?: () => Promise<{ ok: boolean; dump?: Record<string, unknown>; error?: string }>
      onAccountConnected?: (
        callback: (data: { provider: string; email: string; accountId?: string }) => void | Promise<void>,
      ) => () => void
      /** Main → renderer when IMAP auth fails during sync (`email:credentialError`). */
      onCredentialError?: (
        callback: (data: { accountId: string; provider: string; message: string }) => void | Promise<void>,
      ) => () => void
      /** Gmail / Outlook / Zoho connect + credential checks (EmailConnectWizard; preload bridge). */
      connectGmail?: (
        displayName?: string,
        syncWindowDays?: number,
        gmailOAuthCredentialSource?: 'builtin_public' | 'developer_saved',
      ) => Promise<{
        ok: boolean
        data?: { id: string; email: string; provider: string }
        error?: string
        debug?: {
          step: string
          httpStatus: number | null
          googleError: string | null
          googleErrorDescription: string | null
          responseBody: string | null
          raw?: string
        }
      }>
      connectOutlook?: (
        displayName?: string,
        syncWindowDays?: number,
      ) => Promise<{ ok: boolean; data?: { id: string; email: string; provider: string }; error?: string }>
      connectZoho?: (
        displayName?: string,
        syncWindowDays?: number,
      ) => Promise<{ ok: boolean; data?: { id: string; email: string; provider: string }; error?: string }>
      setGmailCredentials?: (
        clientId: string,
        clientSecret?: string,
        storeInVault?: boolean,
      ) => Promise<{ ok: boolean; savedToVault?: boolean; error?: string }>
      setOutlookCredentials?: (
        clientId: string,
        clientSecret?: string,
        tenantId?: string,
        storeInVault?: boolean,
      ) => Promise<{ ok: boolean; savedToVault?: boolean; error?: string }>
      setZohoCredentials?: (
        clientId: string,
        clientSecret: string,
        datacenter?: 'com' | 'eu',
        storeInVault?: boolean,
      ) => Promise<{ ok: boolean; savedToVault?: boolean; error?: string }>
      checkGmailCredentials?: () => Promise<{
        ok: boolean
        data?: {
          configured: boolean
          developerCredentialsStored?: boolean
          builtinOAuthAvailable?: boolean
          /** Unpackaged app or WR_DESK_EMAIL_DEVELOPER_MODE / WR_DESK_DEVELOPER_MODE */
          developerModeEnabled?: boolean
          clientId?: string
          source?: string
          credentials?: unknown
          hasSecret?: boolean
          vaultUnlocked?: boolean
          /** Fingerprint of client id used for standard Connect Google (`builtin_public`); null if none resolved. */
          standardConnectBundledClientFingerprint?: string | null
          standardConnectBuiltinSourceKind?: string | null
        }
        error?: string
      }>
      /** Packaged Gmail OAuth runtime proof (fingerprints + paths — no secrets / full client ids / tokens). */
      getGmailOAuthRuntimeDiagnostics?: () => Promise<{
        ok: boolean
        error?: string
        data?: {
          expectedBundledClientFingerprint: string | null
          authorizeClientIdFingerprint: string | null
          tokenExchangeClientIdFingerprint: string | null
          builtinSourceKind: string | null | undefined
          authMode: string | null | undefined
          packagedStandardConnectEnvIgnored: boolean
          startup: Record<string, unknown>
          lastStandardConnectFlow: Record<string, unknown> | null
        }
      }>
      checkOutlookCredentials?: () => Promise<{
        ok: boolean
        data?: {
          configured: boolean
          clientId?: string
          source?: string
          credentials?: unknown
          hasSecret?: boolean
          vaultUnlocked?: boolean
        }
        error?: string
      }>
      checkZohoCredentials?: () => Promise<{
        ok: boolean
        data?: {
          configured: boolean
          clientId?: string
          source?: string
          credentials?: unknown
          hasSecret?: boolean
          vaultUnlocked?: boolean
        }
        error?: string
      }>
      checkVaultStatus?: () => Promise<{ isUnlocked?: boolean }>
      connectCustomMailbox?: (payload: Record<string, unknown>) => Promise<{
        ok: boolean
        data?: { id: string; email: string; provider: string }
        error?: string
      }>
    }
    email?: {
      sendBeapEmail: (contract: { to: string; subject: string; body: string; attachments: { name: string; data: string; mime: string }[] }) => Promise<{ ok: boolean; data?: { success: boolean; messageId?: string }; error?: string }>
    }
    /** Email Inbox IPC bridge (inbox_messages, sync, deletion, attachments, AI placeholders) */
    emailInbox?: EmailInboxBridge
    /** AutoSort run CRUD + session summary (IPC). */
    autosortSession?: AutosortSessionAPI
  }
}

/** Email Inbox IPC bridge interface */
export interface EmailInboxBridge {
  /** DevTools diagnostic: remote orchestrator queue snapshot (main process logs + return value). */
  debugQueueStatus?: () => Promise<Record<string, unknown>>
  /** Main-inbox message rows (WR Desk “all” tab) + reasons they may not have a lifecycle remote move. */
  debugMainInboxRows?: (accountId?: string | null) => Promise<Record<string, unknown>>
  /** IMAP: LIST + STATUS counts + canonical lifecycle exact-match (read-only; legacy folders ignored for match). */
  verifyImapRemoteFolders?: (accountId: string) => Promise<Record<string, unknown>>
  /** Gateway vs DB: connected accounts, inbox row counts, orphan account_ids after reconnect. */
  debugAccountMigrationStatus?: () => Promise<Record<string, unknown>>
  /** Stale account_id → connected id; removes remote queue rows for old id only (not inbox rows). */
  migrateInboxAccountId?: (fromAccountId: string, toAccountId: string) => Promise<Record<string, unknown>>
  debugTestMoveOne?: (messageId: string) => Promise<Record<string, unknown>>
  /** Set all failed remote orchestrator queue rows back to pending + schedule drain. */
  retryFailedRemoteOps?: (accountId?: string) => Promise<{ ok: boolean; resetCount?: number; error?: string }>
  /** Permanently delete failed queue rows for one account (requires accountId). */
  clearFailedRemoteOps?: (accountId: string) => Promise<{ ok: boolean; deletedCount?: number; error?: string }>
  syncAccount: (accountId: string) => Promise<{
    ok: boolean
    data?: unknown
    error?: string
    /** Pull diagnostics for in-app log */
    pullStats?: { listed: number; new: number; skippedDupes: number; errors: number }
    /** Shown in activity log when new mail was pulled — suggests Auto-Sort */
    pullHint?: string
    /** Present when some messages failed to ingest but sync continued */
    warningCount?: number
    syncWarnings?: string[]
  }>
  /** Next batch of older messages (see Smart Sync / Pull More). */
  pullMoreAccount?: (accountId: string) => Promise<{
    ok: boolean
    data?: unknown
    error?: string
    pullStats?: { listed: number; new: number; skippedDupes: number; errors: number }
    pullHint?: string
    warningCount?: number
    syncWarnings?: string[]
  }>
  patchAccountSyncPreferences?: (
    accountId: string,
    partial: { syncWindowDays?: number; maxMessagesPerPull?: number },
  ) => Promise<{ ok: boolean; data?: unknown; error?: string }>
  toggleAutoSync: (accountId: string, enabled: boolean) => Promise<{ ok: boolean; error?: string }>
  getSyncState: (accountId: string) => Promise<{ ok: boolean; data?: unknown; error?: string }>
  /** Wipes local DB rows with this account_id across all tables (see main process). */
  fullResetAccount?: (accountId: string) => Promise<{ ok: boolean; error?: string; results?: string[] }>
  onNewMessages: (handler: (data: unknown) => void) => () => void
  /** After P2P BEAP pending rows are imported into `inbox_messages`. */
  onBeapInboxUpdated?: (handler: (data: { handshakeId: string | null }) => void) => () => void
  /** Each background drain batch: `{ processed, pending, failed, deferred }` (deferred = pull-lock). */
  onDrainProgress?: (handler: (data: unknown) => void) => () => void
  /** Simple drain: `{ status: 'moved'|'skipped', op, msgId }` per completed row. */
  onSimpleDrainRow?: (handler: (data: unknown) => void) => () => void
  listMessages: (options?: {
    filter?: string
    sourceType?: string
    messageKind?: 'handshake' | 'depackaged'
    handshakeId?: string
    category?: string
    limit?: number
    offset?: number
    search?: string
  }) => Promise<{ ok: boolean; data?: { messages: unknown[]; total: number }; error?: string }>
  /** Read-only Analysis dashboard aggregate (see `collectReadOnlyDashboardSnapshot`). */
  dashboardSnapshot?: (options?: { urgentMessageLimit?: number }) => Promise<
    { ok: true; data: import('../types/analysisDashboardSnapshot').InboxDashboardSnapshotWire } | { ok: false; error: string }
  >
  listMessageIds: (options?: {
    filter?: string
    sourceType?: string
    messageKind?: 'handshake' | 'depackaged'
    handshakeId?: string
    category?: string
    limit?: number
    offset?: number
    search?: string
  }) => Promise<{ ok: boolean; data?: { ids: string[]; total: number }; error?: string }>
  getMessage: (messageId: string) => Promise<{ ok: boolean; data?: unknown; error?: string }>
  markRead: (ids: string[], read: boolean) => Promise<{ ok: boolean; error?: string }>
  toggleStar: (id: string) => Promise<{ ok: boolean; data?: { starred: boolean }; error?: string }>
  archiveMessages: (ids: string[]) => Promise<{ ok: boolean; error?: string }>
  setCategory: (ids: string[], category: string) => Promise<{ ok: boolean; error?: string }>
  deleteMessages: (ids: string[], gracePeriodHours?: number) => Promise<{ ok: boolean; data?: { queued: number; failed: number }; error?: string }>
  /** Dev: bulk-delete all `direct_beap` inbox messages (local DB only). */
  deleteAllDirectBeap?: () => Promise<{ ok: boolean; data?: { deleted: number; failed: number }; error?: string }>
  cancelDeletion: (id: string) => Promise<{ ok: boolean; data?: { cancelled: boolean }; error?: string }>
  getDeletedMessages: () => Promise<{ ok: boolean; data?: unknown[]; error?: string }>
  getAttachment: (id: string) => Promise<{ ok: boolean; data?: unknown; error?: string }>
  getAttachmentText: (id: string) => Promise<{
    ok: boolean
    data?: {
      text: string
      /** Per-page text when available (pdfjs extraction or split from stored text). */
      pages?: string[]
      status: string
      error?: string | null
      content_sha256?: string | null
      extracted_text_sha256?: string | null
    }
    error?: string
  }>
  openAttachmentOriginal: (id: string) => Promise<{ ok: boolean; data?: { opened: boolean }; error?: string }>
  aiSummarize: (id: string) => Promise<{ ok: boolean; data?: { summary: string }; error?: string }>
  aiDraftReply: (id: string) => Promise<{
    ok: boolean
    data?: {
      draft: string
      /** Present when the message is native BEAP — split public / encrypted capsule text. */
      capsuleDraft?: { publicText: string; encryptedText: string }
      isNativeBeap?: boolean
      error?: boolean
    }
    error?: string
  }>
  aiAnalyzeMessage: (id: string) => Promise<{ ok: boolean; data?: NormalInboxAiResult; error?: string }>
  aiAnalyzeMessageStream: (messageId: string) => Promise<{ started: boolean }>
  onAiAnalyzeChunk: (cb: (data: { messageId: string; chunk: string }) => void) => () => void
  onAiAnalyzeDone: (cb: (data: { messageId: string }) => void) => () => void
  onAiAnalyzeError: (cb: (data: { messageId: string; error: string; message: string }) => void) => () => void
  aiCategorize: (ids: string[]) => Promise<{ ok: boolean; data?: { classifications?: BulkClassification[] }; error?: string }>
  aiClassifySingle?: (
    messageId: string,
    sessionId?: string,
  ) => Promise<{
    messageId?: string
    category?: string
    error?: string
    recommended_action?: string
    pending_delete?: boolean
    pending_review?: boolean
    remoteEnqueue?: { enqueued: number; skipped: number; skipReasons?: string[] }
    [key: string]: unknown
  }>
  /**
   * Re-enqueue remote folder moves from local lifecycle state + schedule background drain.
   * Use after bulk Auto-Sort (parallel classify) so Microsoft 365 / IMAP mirrors reliably.
   */
  enqueueRemoteLifecycleMirror?: (messageIds: string[]) => Promise<{
    ok: boolean
    data?: { enqueued: number; skipped: number; skipReasons?: string[] }
    error?: string
  }>
  /** Same lifecycle re-enqueue + drain as `enqueueRemoteLifecycleMirror` (flat result). */
  enqueueRemoteSync?: (messageIds: string[]) => Promise<{
    ok: boolean
    enqueued?: number
    skipped?: number
    skipReasons?: string[]
    error?: string
  }>
  /** Enqueue lifecycle moves for any row on the account where local state ≠ `imap_remote_mailbox`. */
  fullRemoteSync?: (accountId: string) => Promise<{
    ok: boolean
    enqueued?: number
    skipped?: number
    inboxRestoreNeeded?: number
    error?: string
  }>
  /** Same as fullRemoteSync for each distinct account among the given message ids. */
  fullRemoteSyncForMessages?: (messageIds: string[]) => Promise<{
    ok: boolean
    enqueued?: number
    skipped?: number
    inboxRestoreNeeded?: number
    error?: string
  }>
  /** Full reconcile for every connected email account (background queue drain). */
  fullRemoteSyncAllAccounts?: () => Promise<{
    ok: boolean
    enqueued?: number
    skipped?: number
    inboxRestoreNeeded?: number
    accountCount?: number
    /** Classified rows that had no active queue row before this run (backfill). */
    unmirroredIds?: number
    unmirroredEnqueued?: number
    unmirroredSkipped?: number
    /** pending/processing rows failed for disconnected account_id */
    orphanPendingCleared?: number
    /** Drain runs in background until queue empty (IPC does not await bounded drain). */
    backgroundDrain?: boolean
    error?: string
  }>
  /** Persist manual Analyze result to ai_analysis_json only (no sort / move). */
  persistManualBulkAnalysis?: (messageId: string, analysisJson: string) => Promise<{ ok: boolean; error?: string }>
  markPendingDelete: (ids: string[]) => Promise<{ ok: boolean; data?: { marked: number }; error?: string }>
  moveToPendingReview: (ids: string[]) => Promise<{ ok: boolean; error?: string }>
  cancelPendingDelete: (messageId: string) => Promise<{ ok: boolean; data?: { cancelled: boolean }; error?: string }>
  cancelPendingReview: (messageId: string) => Promise<{ ok: boolean; data?: { cancelled: boolean }; error?: string }>
  unarchive: (messageId: string) => Promise<{ ok: boolean; data?: { unarchived: boolean }; error?: string }>
  getInboxSettings: () => Promise<{ ok: boolean; data?: { tone: string; sortRules: string; contextDocs: unknown[]; batchSize: number }; error?: string }>
  setInboxSettings: (partial: { tone?: string; sortRules?: string; batchSize?: number }) => Promise<{ ok: boolean; error?: string }>
  selectAndUploadContextDoc: () => Promise<{ ok: boolean; data?: { skipped?: boolean; doc?: unknown; docs?: unknown[] }; error?: string }>
  deleteContextDoc: (docId: string) => Promise<{ ok: boolean; data?: { docs: unknown[] }; error?: string }>
  listContextDocs: () => Promise<{ ok: boolean; data?: Array<{ id: string; name: string; size: number }>; error?: string }>
  getAiRules: () => Promise<string>
  saveAiRules: (content: string) => Promise<{ ok: boolean; error?: string }>
  getAiRulesDefault: () => Promise<string>
  /** Native file picker for compose attachments ({ name, path, size } per file). */
  showOpenDialogForAttachments?: () => Promise<{
    ok: boolean
    data?: { files: Array<{ name: string; path: string; size: number }> }
    error?: string
  }>
  /** Read file from disk as base64 for outbound email attachment. */
  readFileForAttachment?: (filePath: string) => Promise<{
    ok: boolean
    data?: { filename: string; mimeType: string; contentBase64: string }
    error?: string
  }>
}
