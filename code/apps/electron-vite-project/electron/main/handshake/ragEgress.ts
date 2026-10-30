/**
 * RAG egress check — one gate before every model call of `handshake:chatWithContextRag`
 * (roadmap item 0.13, decision D-37 "local first; cloud only through the egress check").
 *
 * - Locality comes from the provider INSTANCE `getProvider` returned, never from a list of
 *   provider names: only {@link OllamaProvider} (local llama.cpp / the user's own Host over
 *   the internal handshake) is local; every other provider, including `cloudai` and any
 *   future id, is remote (deny unless local).
 * - For a remote provider, every context block that would enter the prompt must pass
 *   {@link filterBlocksForCloudAI} on its resolved governance (`cloud_ai_allowed`,
 *   `sensitive`). Missing handshake record, missing/hidden block row → excluded.
 * - {@link assertRagEgressCleared} is called right before each model call with the block
 *   ids actually placed in the prompt; it throws if one of them was not cleared.
 */

import { OllamaProvider, type AIProvider } from './aiProviders'
import {
  filterBlocksForCloudAI,
  parseGovernanceJson,
  resolveEffectiveGovernance,
} from './contextGovernance'
import type { HandshakeRecord } from './types'

export type ProviderLocality = 'local' | 'remote'

export function providerLocality(provider: AIProvider): ProviderLocality {
  return provider instanceof OllamaProvider ? 'local' : 'remote'
}

export interface RagEgressBlockRef {
  handshake_id: string
  block_id: string
  /** When absent, every visible row of (handshake_id, block_id) must allow cloud AI. */
  block_hash?: string | null
}

export interface RagEgressBlockRow {
  governance_json?: string | null
  type?: string | null
  data_classification?: string | null
  scope_id?: string | null
  sender_wrdesk_user_id?: string | null
  source?: string | null
}

export interface RagEgressLookup {
  rows(ref: RagEgressBlockRef): RagEgressBlockRow[]
  record(handshakeId: string): HandshakeRecord | null
}

export const RAG_EGRESS_GOVERNANCE_NOTE = (n: number) =>
  `${n} context block(s) were excluded because their governance policy restricts cloud AI processing. Use a local model to access all results.`

const CLEARED = Symbol('ragEgressCleared')

export interface RagEgressClearance<T extends RagEgressBlockRef> {
  readonly locality: ProviderLocality
  readonly allowed: T[]
  readonly excludedCount: number
  readonly governanceNote: string | null
  readonly [CLEARED]: ReadonlySet<string>
}

const refKey = (handshakeId: string, blockId: string) => `${handshakeId}\u0000${blockId}`

function remoteAllows(ref: RagEgressBlockRef, lookup: RagEgressLookup): boolean {
  const record = lookup.record(ref.handshake_id)
  if (!record) return false
  const rows = lookup.rows(ref)
  if (rows.length === 0) return false
  return rows.every((row) => {
    const governance = resolveEffectiveGovernance(
      parseGovernanceJson(row.governance_json),
      {
        block_id: ref.block_id,
        type: row.type ?? '',
        data_classification: row.data_classification ?? undefined,
        scope_id: row.scope_id ?? undefined,
        sender_wrdesk_user_id: row.sender_wrdesk_user_id ?? '',
        publisher_id: row.sender_wrdesk_user_id ?? undefined,
        source: row.source === 'received' || row.source === 'sent' ? row.source : undefined,
      },
      record,
      record.relationship_id,
    )
    return filterBlocksForCloudAI([{ governance }], null).length === 1
  })
}

export function clearBlocksForModel<T extends RagEgressBlockRef>(
  provider: AIProvider,
  blocks: T[],
  lookup: RagEgressLookup,
): RagEgressClearance<T> {
  const locality = providerLocality(provider)
  const allowed = locality === 'local' ? [...blocks] : blocks.filter((b) => remoteAllows(b, lookup))
  const excludedCount = blocks.length - allowed.length
  return {
    locality,
    allowed,
    excludedCount,
    governanceNote: excludedCount > 0 ? RAG_EGRESS_GOVERNANCE_NOTE(excludedCount) : null,
    [CLEARED]: new Set(allowed.map((b) => refKey(b.handshake_id, b.block_id))),
  }
}

/** Throws unless every block placed in the prompt was cleared for this provider. */
export function assertRagEgressCleared(
  clearance: RagEgressClearance<RagEgressBlockRef>,
  used: ReadonlyArray<{ handshake_id: string; block_id: string }>,
): void {
  if (clearance.locality === 'local') return
  for (const u of used) {
    if (!clearance[CLEARED].has(refKey(u.handshake_id, u.block_id))) {
      throw new Error(`rag_egress_refused: block ${u.block_id} is not cleared for a remote model`)
    }
  }
}

/** Database-backed lookup; rows are visibility-filtered like every other context read. */
export function dbRagEgressLookup(
  db: any,
  deps: {
    getHandshakeRecord: (db: any, handshakeId: string) => HandshakeRecord | null
    visibilityWhereClause: (alias: string, vaultUnlocked: boolean) => { sql: string; params: unknown[] }
    vaultUnlocked: boolean
  },
): RagEgressLookup {
  const { sql: visSql, params: visParams } = deps.visibilityWhereClause('context_blocks', deps.vaultUnlocked)
  return {
    record: (handshakeId) => deps.getHandshakeRecord(db, handshakeId),
    rows: (ref) => {
      const cols = 'governance_json, type, data_classification, scope_id, sender_wrdesk_user_id, source'
      return ref.block_hash
        ? (db
            .prepare(`SELECT ${cols} FROM context_blocks WHERE handshake_id=? AND block_id=? AND block_hash=?${visSql}`)
            .all(ref.handshake_id, ref.block_id, ref.block_hash, ...visParams) as RagEgressBlockRow[])
        : (db
            .prepare(`SELECT ${cols} FROM context_blocks WHERE handshake_id=? AND block_id=?${visSql}`)
            .all(ref.handshake_id, ref.block_id, ...visParams) as RagEgressBlockRow[])
    },
  }
}
