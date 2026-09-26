/**
 * Channel Provenance Record producer — build item 2 [IX.3.1, IX.11]
 *
 * The SINGLE place a CPR is created, persisted, and evidenced. Every ingest
 * path calls this, and a guard test proves no path constructs a record on its
 * own — one producer means one set of rules, so "what does this deployment
 * consider an authenticated channel" has exactly one answer.
 *
 * A CPR is produced for EVERY processed message. When there is nothing to
 * evaluate the verdict is `unverifiable`, which is a real verdict and fails
 * closed; a message with no CPR at all would be indistinguishable from one
 * that skipped the producer, so that state does not exist.
 *
 * Phase 1 fidelity: the producer consumes the authentication material the mail
 * pipeline already surfaces (`Authentication-Results` where the receiving
 * gateway wrote one). Discovery-Record evaluation needs DNS in main and lands
 * in Phase 3 — until then the field stays `not_evaluated` and is never
 * fabricated. Gating the pipeline on `channel_pass` is Phase 2's job; Phase 1
 * only produces, persists, and evidences the verdict.
 */

import { createHash } from 'crypto'
import {
  channelProvenanceMetadata,
  createChannelProvenanceRecord,
  type ChannelProvenanceRecord,
} from '@repo/ingestion-core'
import { appendEvidenceBestEffort, LOCAL_EVIDENCE_CHAIN } from '../handshake/evidenceChain'

/** Which ingest path produced the record — evidence metadata, never a gate. */
export type ChannelProvenanceIngestPath = 'inline' | 'seam' | 'seam_carrier' | 'p2p'

export interface ChannelProvenanceSource {
  /**
   * `Authentication-Results` values, already collected and capped at the
   * depackaging boundary. Read here and discarded; nothing from them reaches
   * the record.
   */
  authenticationResults?: readonly string[]
  /** RFC5322.From address or domain, for alignment. */
  fromAddress?: string | null
  /** Bytes the verdict is bound to; hashed by `channelProvenanceContentHash`. */
  contentSha256: string
}

/**
 * Content binding for the record. The raw provider payload is the truest
 * binding; without it we bind the identity + rendered body, which is what a
 * later reader would compare a stored verdict against.
 */
export function channelProvenanceContentHash(parts: {
  rawBytes?: Buffer | string | null
  messageId?: string
  subject?: string
  bodyText?: string
}): string {
  const hash = createHash('sha256')
  if (parts.rawBytes != null && parts.rawBytes.length > 0) {
    hash.update(Buffer.isBuffer(parts.rawBytes) ? parts.rawBytes : Buffer.from(parts.rawBytes, 'utf-8'))
    return hash.digest('hex')
  }
  hash.update(`${parts.messageId ?? ''}\n${parts.subject ?? ''}\n${parts.bodyText ?? ''}`, 'utf8')
  return hash.digest('hex')
}

/** Build the record. The only constructor any ingest path may call. */
export function produceChannelProvenance(source: ChannelProvenanceSource): ChannelProvenanceRecord {
  return createChannelProvenanceRecord({
    contentSha256: source.contentSha256,
    material: {
      authenticationResults: source.authenticationResults,
      fromDomain: source.fromAddress ?? null,
    },
  })
}

/**
 * Merge the CPR into a `depackaged_metadata` blob beside `pbeap_trust`. The
 * result is the string that is BOTH persisted and bound into the seal, so a
 * post-write edit of either verdict fails seal verification at read time.
 */
export function mergeChannelProvenanceMetadata(
  existingMetadataJson: string | null | undefined,
  record: ChannelProvenanceRecord,
): string {
  let base: Record<string, unknown> = {}
  if (typeof existingMetadataJson === 'string' && existingMetadataJson.trim() !== '') {
    try {
      const parsed = JSON.parse(existingMetadataJson)
      if (typeof parsed === 'object' && parsed !== null) base = parsed as Record<string, unknown>
    } catch {
      // A metadata blob we cannot read is not silently dropped: keep it under a
      // quarantine key so the CPR can still be persisted without losing it.
      base = { unparsable_metadata: existingMetadataJson }
    }
  }
  return JSON.stringify({ ...base, ...channelProvenanceMetadata(record) })
}

/**
 * Retain the verdict in the append-only evidence chain [IX.11].
 *
 * Class: BER — a message crossing the ingress boundary IS a boundary event,
 * and the CPR is the verdict at that crossing. This makes Phase 1 the first
 * BER writer (the schema note in `evidenceChain.ts` anticipated Phase 6).
 *
 * Metadata only: identifiers, digests, and typed verdicts. No subject, no
 * body, no addresses beyond the domain the channel actually authenticated.
 */
export function recordChannelProvenanceEvidence(args: {
  record: ChannelProvenanceRecord
  messageId: string
  /** inbox_messages.id or quarantine_messages.id, once known. */
  rowId: string | null
  path: ChannelProvenanceIngestPath
  outcome: 'inbox' | 'quarantine' | 'held'
}): void {
  const { record } = args
  appendEvidenceBestEffort({
    chainId: LOCAL_EVIDENCE_CHAIN,
    recordType: 'ber',
    payload: {
      kind: 'channel_provenance',
      direction: 'ingress',
      channel: 'email',
      ingest_path: args.path,
      outcome: args.outcome,
      message_id: args.messageId,
      row_id: args.rowId,
      marking_scheme: record.marking_scheme,
      producer_version: record.producer_version,
      evaluated_at: record.evaluated_at,
      content_sha256: record.content_sha256,
      spf: record.spf.verdict,
      spf_aligned: record.spf.aligned,
      dkim: record.dkim.verdict,
      dkim_aligned: record.dkim.aligned,
      dmarc: record.dmarc.verdict,
      dmarc_aligned: record.dmarc.aligned,
      channel_pass: record.channel_pass,
      authenticated_sender_domain: record.authenticated_sender_domain,
      discovery_record: record.discovery_record,
    },
  })
}
