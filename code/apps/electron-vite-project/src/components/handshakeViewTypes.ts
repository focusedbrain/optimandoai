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
      getVaultStatus?: () => Promise<{ isUnlocked?: boolean; name?: string | null }>
      forceRevokeHandshake: (id: string) => Promise<{ success?: boolean; error?: string }>
      updateHandshakePolicies?: (handshakeId: string, policies: { ai_processing_mode?: string } | Record<string, boolean>) => Promise<{ success?: boolean }>
      updateContextItemGovernance?: (handshakeId: string, blockId: string, blockHash: string, senderUserId: string, governance: Record<string, unknown>) => Promise<{ success?: boolean; error?: string }>
      getContextBlockCount: (handshakeId: string) => Promise<number>
      queryContextBlocks?: (handshakeId: string, purpose?: 'local_ai' | 'cloud_ai' | 'export' | 'search' | 'peer_transmission' | 'auto_reply') => Promise<VerifiedContextBlock[]>
      semanticSearch?: (query: string, scope?: string, limit?: number) => Promise<{ success: boolean; error?: string; results?: Array<{ block_id: string; type?: string; snippet?: string; payload_ref?: string; score?: number }> }>
      chatWithContext?: (systemMessage: string, dataWrapper: string, userMessage: string) => Promise<string>
      initiateHandshake?: (receiverEmail: string, fromAccountId: string, contextOpts?: { message?: string; context_blocks?: any[] }) => Promise<any>
      buildForDownload?: (receiverEmail: string, contextOpts?: { message?: string; context_blocks?: any[] }) => Promise<any>
      downloadCapsule?: (capsuleJson: string, suggestedFilename: string) => Promise<any>
    }
    emailAccounts?: {
      listAccounts: () => Promise<{ ok: boolean; data?: Array<{ id: string; displayName: string; email: string; provider: string; status: string; lastError?: string }>; error?: string }>
    }
  }
}
