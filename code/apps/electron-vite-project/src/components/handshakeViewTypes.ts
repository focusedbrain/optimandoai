/**
 * Shared IPC bridge type for the handshakeView window object.
 * Single declaration to avoid TS2717 duplicate property errors.
 */

import type { VerifiedContextBlock } from './contextEscaping'

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
      chatWithContext?: (systemMessage: string, dataWrapper: string, userMessage: string) => Promise<string>
      chatWithContextRag?: (params: { query: string; scope?: string; model: string; provider: string; stream?: boolean; debug?: boolean; conversationContext?: { lastAnswer?: string }; selectedDocumentId?: string; selectedAttachmentId?: string }) => Promise<{
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
    }
    emailAccounts?: {
      listAccounts: () => Promise<{ ok: boolean; data?: Array<{ id: string; displayName: string; email: string; provider: string; status: string; lastError?: string }>; error?: string }>
      sendEmail: (accountId: string, payload: { to: string[]; subject: string; bodyText: string }) => Promise<{ ok: boolean; data?: { success: boolean; messageId?: string }; error?: string }>
    }
  }
}
