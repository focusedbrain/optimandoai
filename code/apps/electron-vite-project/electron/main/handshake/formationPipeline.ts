/**
 * ONE formation pipeline (Phase 4 — V1, V2) [VII.4.6, IX.3.1]
 *
 * Every relationship formation goes through this module, dispatching on
 * Phase-3 profile-registry records. The former dialects are gone:
 *
 *  - initiator direct persist (deleted)           → formInitiatorRelationship
 *  - .beap file-import persist (deleted)          → staging + consent gate
 *  - inbound pipeline auto-insert                 → staging + consent gate
 *  - edge-agent pairing                           → retired for new pairings
 *
 * Inbound invitations NEVER create relationship rows. They pass the full
 * verification chain, land in the Connect-offer staging store, and only a
 * consent event lets the pipeline create the record:
 *
 *   verification chain → client-generated Connect offer → consent → record
 *
 * Failed verification suppresses the offer entirely — no "connect anyway"
 * [IX.3.1 rules 1–4]. Consent records are Hash-Pinned [IX.3.4].
 *
 * `ingress_path` is written by this pipeline per the Q4 mapping and remains
 * LOG-ONLY; capture-method values are log/render-only beyond the fail-closed
 * shippable gate. Formation via different paths yields semantically
 * identical relationships (same profile → same rights).
 */

import * as path from 'node:path'
import * as fs from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import {
  resolveCaptureMethodForFormation,
  resolveInvitationClassForFormation,
  resolveProfile,
  isRecordableIngressPath,
  canonicalJsonString,
  domainTag,
  type CanonicalJsonValue,
  type SourceType,
} from '@repo/ingestion-core'
import type { FormationMeta } from './coreStore'
import type { HandshakeCapsuleWire } from './capsuleBuilder'
import type { SigningKeypair } from './signatureKeys'
import type { SSOSession, HandshakeRecord, BeapKeyAgreementMaterial } from './types'
import type { ContextBlockForCommitment } from './contextCommitment'
import { HandshakeState as HS, INPUT_LIMITS, buildDefaultReceiverPolicy } from './types'
import { classifyHandshakeTier } from './tierClassification'
import { resolveEffectivePolicyFn } from './steps/policyResolution'
import {
  insertHandshakeRecord,
  insertSeenCapsuleHash,
  insertContextStoreEntry,
  updateHandshakePolicySelections,
} from './db'
import { validateInternalInitiateCapsuleWire } from './internalPersistence'
import { wireDeclaresSamePrincipal } from './samePrincipalWire'
import type { AiProcessingMode } from '../../../../../packages/shared/src/handshake/policyUtils'
import {
  createDefaultGovernance,
  createMessageGovernance,
  baselineFromHandshake,
  baselineFromPolicySelections,
  type ContextItemGovernance,
} from './contextGovernance'
import {
  stageConnectOffer,
  getConsentableOffer,
  buildConnectOfferPreview,
  insertConsentRecord,
  markOfferConsumed,
  expireStaleOffers,
  listPendingConnectOffers,
  findPendingOfferByHandshakeId,
  type ConnectOfferRow,
  type ConsentRecordRow,
} from './connectOfferStaging'

// ── Staging DB provider ───────────────────────────────────────────────────────
// The staging store lives in its OWN SQLite file, outside both relationship
// DB handles (vault DB and frozen ledger). main.ts may override the provider;
// the default opens <userProfile>/.opengiraffe/connect-offers.db lazily.

let _stagingDbProvider: (() => any) | null = null
let _defaultStagingDb: any = null

export function setConnectOfferDbProvider(provider: (() => any) | null): void {
  _stagingDbProvider = provider
}

export function getConnectOfferDb(): any {
  if (_stagingDbProvider) return _stagingDbProvider()
  if (!_defaultStagingDb) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3')
    if (process.env.VITEST) {
      // Test runs must never stage offers into the developer's real profile
      // DB (they would leak into the app's pending list and across runs).
      _defaultStagingDb = new Database(':memory:')
    } else {
      const dir = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.opengiraffe')
      fs.mkdirSync(dir, { recursive: true })
      _defaultStagingDb = new Database(path.join(dir, 'connect-offers.db'))
      _defaultStagingDb.pragma('journal_mode = WAL')
    }
  }
  return _defaultStagingDb
}

/** @internal test seam */
export function _resetConnectOfferDbForTests(): void {
  _stagingDbProvider = null
  try { _defaultStagingDb?.close() } catch { /* noop */ }
  _defaultStagingDb = null
}

// ── Q4 mapping: transport source → ingress path + capture method ─────────────
// Data-driven mapping (recording only): the recorded value is LOG-ONLY
// downstream [VII.4.6]. No code may branch on the recorded value.

const SOURCE_INGRESS_MAP: Readonly<Record<string, { ingress_path: string; capture_method: string }>> = Object.freeze({
  email: { ingress_path: 'beap_invitation', capture_method: 'assisted_email' },
  file_upload: { ingress_path: 'optirando.ingress.file_import', capture_method: 'manual_entry' },
  internal: { ingress_path: 'optirando_code_entry', capture_method: 'manual_entry' },
  p2p: { ingress_path: 'beap_invitation', capture_method: 'assisted_email' },
  p2p_relay: { ingress_path: 'beap_invitation', capture_method: 'assisted_email' },
  relay_pull: { ingress_path: 'beap_invitation', capture_method: 'assisted_email' },
  coordination_service: { ingress_path: 'beap_invitation', capture_method: 'assisted_email' },
  coordination_ws: { ingress_path: 'beap_invitation', capture_method: 'assisted_email' },
  api: { ingress_path: 'beap_invitation', capture_method: 'assisted_email' },
  extension: { ingress_path: 'beap_invitation', capture_method: 'assisted_email' },
})

export function ingressMappingForSource(sourceType: SourceType | string): { ingress_path: string; capture_method: string } {
  return SOURCE_INGRESS_MAP[sourceType] ?? { ingress_path: 'beap_invitation', capture_method: 'assisted_email' }
}

// ── Wire → profile mapping (compat boundary) ─────────────────────────────────
// Legacy v2 capsules carry no profile. The signed canonical v3 core carries
// one. This is the SINGLE place a legacy wire value maps to a profile id.

export function profileIdForWireCapsule(capsule: Record<string, unknown>): { id: string; version: number } {
  const envelope = capsule?.wr_canonical_v3 as { core?: { profile?: { id?: string; version?: number } } } | undefined
  const p = envelope?.core?.profile
  if (p && typeof p.id === 'string' && typeof p.version === 'number') {
    return { id: p.id, version: p.version }
  }
  // Legacy wire compat mapping (same-principal pairing → internal_device, Q9).
  if (wireDeclaresSamePrincipal(capsule as any)) return { id: 'internal_device', version: 1 }
  return { id: 'legacy_v0', version: 1 }
}

// ── Inbound staging (called from enforcement after the verification chain) ───

export interface StageInboundInitiateArgs {
  handshake_id: string
  capsule: Record<string, unknown>
  capsule_hash: string
  sender_email?: string | null
  sender_iss?: string | null
  sender_sub?: string | null
  sender_wrdesk_user_id?: string | null
  receiver_email?: string | null
  /** Ingestion provenance source (Q4 mapping input). */
  source_type: string
  /**
   * Compat boundary override: same-account .beap imports form under the
   * `internal_device` profile even when the legacy wire lacks the marker
   * (replaces the deleted ipc.ts force-internal UPDATE).
   */
  profile_id_override?: string
}

export type StageInboundResult = { staged: true; offerId: string } | { staged: false; reason: string; offerId?: string }

/**
 * Stage a fully verified inbound initiate capsule as a Connect offer. The
 * verification chain has already run (enforcement pipeline); this NEVER
 * touches the relationship store.
 */
export function stageInboundInitiate(args: StageInboundInitiateArgs): StageInboundResult {
  const stagingDb = getConnectOfferDb()
  const mapping = ingressMappingForSource(args.source_type)
  const profile = args.profile_id_override
    ? { id: args.profile_id_override, version: 1 }
    : profileIdForWireCapsule(args.capsule)
  const result = stageConnectOffer(stagingDb, {
    handshake_id: args.handshake_id,
    capsule: args.capsule,
    capsule_hash: args.capsule_hash,
    sender_email: args.sender_email,
    sender_iss: args.sender_iss,
    sender_sub: args.sender_sub,
    sender_wrdesk_user_id: args.sender_wrdesk_user_id,
    receiver_email: args.receiver_email,
    profile_id: profile.id,
    ingress_path: mapping.ingress_path,
    invitation_class: 'public_bearer',
    verification: { ok: true },
  })
  if (!result.staged) return { staged: false, reason: result.reason, offerId: result.offerId }
  return { staged: true, offerId: result.offerId }
}

// ── Offer listing / preview (renderer surface) ────────────────────────────────

export function listConnectOffers(): Array<ConnectOfferRow & { preview: ReturnType<typeof buildConnectOfferPreview> }> {
  const stagingDb = getConnectOfferDb()
  expireStaleOffers(stagingDb)
  return listPendingConnectOffers(stagingDb).map((offer) => ({
    ...offer,
    preview: buildConnectOfferPreview(offer),
  }))
}

export function pendingOfferForHandshake(handshakeId: string): ConnectOfferRow | null {
  return findPendingOfferByHandshakeId(getConnectOfferDb(), handshakeId)
}

export function declineConnectOffer(offerId: string): { ok: boolean } {
  const stagingDb = getConnectOfferDb()
  const offer = getConsentableOffer(stagingDb, offerId)
  if (!offer) return { ok: false }
  markOfferConsumed(stagingDb, offerId, 'declined')
  return { ok: true }
}

// ── Consent gate → record creation ────────────────────────────────────────────

export interface FormationConsentRef {
  consent_id: string
  offer_id: string
  formation: FormationMeta
}

export type ConsentPreparation =
  | { ok: true; offer: ConnectOfferRow; consentRef: FormationConsentRef; consent: ConsentRecordRow }
  | { ok: false; reason: string }

/**
 * The consent event [IX.3.1 rules 3–4]: validates that the offer is still
 * consentable (verified, unsuppressed, unconsumed, unexpired — suppressed
 * offers are structurally unreachable), fail-closes on capture method /
 * invitation class / profile, writes the Hash-Pinned consent record, and
 * hands back the FormationMeta the pipeline needs to create the record.
 *
 * `expectedPreviewHash` binds the consent to the preview the user actually
 * saw: if the staged material changed since presentation, consent fails.
 */
export function prepareFormationConsent(args: {
  offerId: string
  actorWrdeskUserId: string
  expectedPreviewHash?: string
  sourceReference?: string | null
}): ConsentPreparation {
  const stagingDb = getConnectOfferDb()
  expireStaleOffers(stagingDb)
  const offer = getConsentableOffer(stagingDb, args.offerId)
  if (!offer) return { ok: false, reason: 'OFFER_NOT_CONSENTABLE' }

  // Fail-closed registry gates [IX.3.2, VII.4.2].
  const invClass = resolveInvitationClassForFormation(offer.invitation_class)
  if (!invClass.ok) return { ok: false, reason: invClass.reason.toUpperCase() }
  const captureMethodId = ingressCaptureMethodForOffer(offer)
  if (captureMethodId === null) {
    return { ok: false, reason: `INGRESS_PATH_HAS_NO_CAPTURE_METHOD:${offer.ingress_path}` }
  }
  const capture = resolveCaptureMethodForFormation(captureMethodId)
  if (!capture.ok) return { ok: false, reason: capture.reason.toUpperCase() }
  const profileRes = resolveProfile(offer.profile_id, 1)
  if (!profileRes.ok) return { ok: false, reason: `${profileRes.reason.toUpperCase()}:${offer.profile_id}` }
  if (!isRecordableIngressPath(offer.ingress_path)) {
    return { ok: false, reason: 'INGRESS_PATH_NOT_RECORDABLE' }
  }

  const preview = buildConnectOfferPreview(offer)
  if (args.expectedPreviewHash && args.expectedPreviewHash !== preview.preview_hash) {
    return { ok: false, reason: 'PREVIEW_HASH_MISMATCH' }
  }

  const consent = insertConsentRecord(stagingDb, {
    offer_id: offer.offer_id,
    handshake_id: offer.handshake_id,
    role: 'acceptor',
    preview_hash: preview.preview_hash,
    bound_definition_hash: preview.bound_definition_hash,
    contract_state_hash: preview.contract_state_hash,
    capture_method: captureMethodId,
    ingress_path: offer.ingress_path,
    source_reference: args.sourceReference ?? null,
    actor_wrdesk_user_id: args.actorWrdeskUserId,
  })

  return {
    ok: true,
    offer,
    consent,
    consentRef: {
      consent_id: consent.consent_id,
      offer_id: offer.offer_id,
      formation: {
        profile_id: profileRes.record.id,
        profile_version: profileRes.record.version,
        ingress_path: offer.ingress_path,
        capture_method: captureMethodId,
        source_reference: args.sourceReference ?? null,
        consent_id: consent.consent_id,
        nonce: randomUUID(),
      },
    },
  }
}

/** Mark the offer consumed after the pipeline created the record. */
export function completeFormationConsent(consentRef: FormationConsentRef): void {
  markOfferConsumed(getConnectOfferDb(), consentRef.offer_id, 'consented', consentRef.consent_id)
}

/**
 * The capture method recorded in the consent evidence, derived from the offer's
 * ingress path. Returns null when no mapping matches.
 *
 * There is deliberately no fallback. The consent record is evidence of how the
 * user actually received the invitation, so an unmapped ingress path must fail
 * the consent rather than record a capture method nobody performed — a default
 * of `assisted_email` would attest to an email capture for offers that never
 * touched mail.
 */
function ingressCaptureMethodForOffer(offer: ConnectOfferRow): string | null {
  for (const mapping of Object.values(SOURCE_INGRESS_MAP)) {
    if (mapping.ingress_path === offer.ingress_path) return mapping.capture_method
  }
  return null
}

// ── Initiator-side formation (explicit user creation = consent event) ─────────

export interface InitiatorConsentArgs {
  handshake_id: string
  /** Contract state at consent time — the outgoing initiate capsule hash. */
  contract_state_hash: string
  /** Preview hash of the client-rendered creation summary. */
  preview_hash: string
  bound_definition_hash: string
  capture_method: string
  ingress_path: string
  source_reference?: string | null
  actor_wrdesk_user_id: string
}

export type InitiatorConsentResult =
  | { ok: true; formation: FormationMeta; consent: ConsentRecordRow }
  | { ok: false; reason: string }

/**
 * Wire → profile for NEW outbound formations (compat boundary, single site):
 * same-principal device pairing forms under `internal_device` (Q9);
 * everything else forms under `private_personal`.
 */
export function profileForNewFormation(capsule: Record<string, unknown>): string {
  return wireDeclaresSamePrincipal(capsule as any) ? 'internal_device' : 'private_personal'
}

const INITIATOR_PREVIEW_DOMAIN = 'wr.initiator_formation.preview'

function initiatorHashes(capsule: HandshakeCapsuleWire): {
  preview_hash: string
  bound_definition_hash: string
} {
  const boundDefinition: Record<string, CanonicalJsonValue> = {
    sender_email: capsule.senderIdentity?.email ?? '',
    sender_iss: capsule.senderIdentity?.iss ?? '',
    sender_sub: capsule.senderIdentity?.sub ?? '',
    sender_wrdesk_user_id: capsule.sender_wrdesk_user_id ?? '',
    receiver_email: capsule.receiver_email ?? '',
    profile_id: profileForNewFormation(capsule as unknown as Record<string, unknown>),
  }
  const preview: Record<string, CanonicalJsonValue> = {
    handshake_id: capsule.handshake_id,
    bound_definition: boundDefinition,
    scopes: Array.isArray((capsule as any).context_scopes)
      ? [...(capsule as any).context_scopes].filter((s: unknown) => typeof s === 'string').sort()
      : [],
    external_processing: capsule.external_processing ?? 'none',
    reciprocal_allowed: capsule.reciprocal_allowed === true,
  }
  const sha = (domain: string, value: CanonicalJsonValue): string =>
    createHash('sha256').update(domainTag(domain, 1)).update(canonicalJsonString(value), 'utf8').digest('hex')
  return {
    preview_hash: sha(INITIATOR_PREVIEW_DOMAIN, preview),
    bound_definition_hash: sha('wr.handshake.bound_definition', boundDefinition),
  }
}

export interface FormInitiatorResult {
  success: boolean
  error?: string
}

/**
 * Initiator-side formation through the ONE pipeline (replaces the deleted
 * initiatorPersist dialect). The user's explicit creation act is the consent
 * event; the record carries FormationMeta (profile, ingress_path, capture
 * provenance) into the core store [IX.3.1 rule 5].
 */
export function formInitiatorRelationship(
  db: any,
  capsule: HandshakeCapsuleWire,
  session: SSOSession,
  localBlocks: ContextBlockForCommitment[],
  keypair: SigningKeypair,
  formationArgs: {
    capture_method: string
    ingress_path: string
    source_reference?: string | null
  },
  policySelections?: { ai_processing_mode?: AiProcessingMode } | { cloud_ai?: boolean; internal_ai?: boolean },
  blockPolicyMap?: Map<string, { ai_processing_mode?: AiProcessingMode } | { cloud_ai?: boolean; internal_ai?: boolean }>,
  beapKeys?: BeapKeyAgreementMaterial | null,
): FormInitiatorResult {
  try {
    if (wireDeclaresSamePrincipal(capsule)) {
      const w = validateInternalInitiateCapsuleWire(capsule as unknown as Record<string, unknown>)
      if (!w.ok) {
        return { success: false, error: w.error ?? 'Internal initiate capsule invalid' }
      }
    }

    // Consent event + FormationMeta (fail-closed on capture method / ingress
    // path / profile) BEFORE anything touches the relationship store.
    const hashes = initiatorHashes(capsule)
    const prep = prepareInitiatorFormation(
      {
        handshake_id: capsule.handshake_id,
        contract_state_hash: capsule.capsule_hash,
        preview_hash: hashes.preview_hash,
        bound_definition_hash: hashes.bound_definition_hash,
        capture_method: formationArgs.capture_method,
        ingress_path: formationArgs.ingress_path,
        source_reference: formationArgs.source_reference ?? null,
        actor_wrdesk_user_id: session.wrdesk_user_id,
      },
      profileForNewFormation(capsule as unknown as Record<string, unknown>),
    )
    if (!prep.ok) {
      return { success: false, error: `Formation refused: ${prep.reason}` }
    }

    const tierDecision = classifyHandshakeTier({
      plan: session.plan,
      hardwareAttestation: session.currentHardwareAttestation,
      dnsVerification: session.currentDnsVerification,
      wrStampStatus: session.currentWrStampStatus,
    })

    const receiverPolicy = buildDefaultReceiverPolicy()
    const effectivePolicyResult = resolveEffectivePolicyFn(null, receiverPolicy)
    if ('unsatisfiable' in effectivePolicyResult) {
      return { success: false, error: 'Policy resolution failed' }
    }
    const effectivePolicy = effectivePolicyResult

    const senderP2PEndpoint: string | null =
      typeof capsule.p2p_endpoint === 'string' && capsule.p2p_endpoint.trim().length > 0
        ? capsule.p2p_endpoint.trim()
        : null
    const localP2pAuthToken: string =
      typeof capsule.p2p_auth_token === 'string' && capsule.p2p_auth_token.trim().length > 0
        ? capsule.p2p_auth_token.trim()
        : randomUUID()

    const record: HandshakeRecord = {
      handshake_id: capsule.handshake_id,
      relationship_id: capsule.relationship_id,
      state: HS.PENDING_ACCEPT,
      initiator: {
        email: capsule.senderIdentity.email,
        wrdesk_user_id: capsule.sender_wrdesk_user_id,
        iss: capsule.senderIdentity.iss,
        sub: capsule.senderIdentity.sub,
      },
      acceptor: null,
      local_role: 'initiator',
      sharing_mode: null,
      reciprocal_allowed: capsule.reciprocal_allowed,
      tier_snapshot: tierDecision,
      current_tier_signals: capsule.tierSignals,
      last_seq_sent: 0,
      last_seq_received: 0,
      last_capsule_hash_sent: '',
      last_capsule_hash_received: capsule.capsule_hash,
      effective_policy: effectivePolicy,
      external_processing: capsule.external_processing,
      created_at: new Date().toISOString(),
      activated_at: null,
      expires_at: new Date(Date.now() + INPUT_LIMITS.PENDING_TIMEOUT_MS).toISOString(),
      revoked_at: null,
      revocation_source: null,
      initiator_wrdesk_policy_hash: capsule.wrdesk_policy_hash,
      initiator_wrdesk_policy_version: capsule.wrdesk_policy_version,
      acceptor_wrdesk_policy_hash: null,
      acceptor_wrdesk_policy_version: null,
      initiator_context_commitment: capsule.context_commitment ?? null,
      acceptor_context_commitment: null,
      p2p_endpoint: senderP2PEndpoint,
      local_p2p_auth_token: localP2pAuthToken,
      counterparty_p2p_token: null,
      local_public_key: keypair.publicKey,
      local_private_key: keypair.privateKey,
      receiver_email: capsule.receiver_email ?? null,
      ...(beapKeys
        ? {
            local_x25519_private_key_b64: beapKeys.sender_x25519_private_key_b64,
            local_x25519_public_key_b64: beapKeys.sender_x25519_public_key_b64,
            local_mlkem768_secret_key_b64: beapKeys.sender_mlkem768_secret_key_b64,
            local_mlkem768_public_key_b64: beapKeys.sender_mlkem768_public_key_b64,
          }
        : {}),
      ...(capsule.sender_device_id?.trim()
        ? { initiator_coordination_device_id: capsule.sender_device_id.trim() }
        : {}),
      ...(wireDeclaresSamePrincipal(capsule)
        ? {
            same_principal: true,
            initiator_device_name: capsule.sender_computer_name?.trim() || null,
            initiator_device_role: capsule.sender_device_role ?? null,
            // Pairing-code-routed initiate capsules carry no receiver device
            // metadata on the wire — the pairing code is the sole peer
            // identifier, verified at acceptance time.
            acceptor_coordination_device_id: capsule.receiver_device_id?.trim() || null,
            acceptor_device_name: capsule.receiver_computer_name?.trim() || null,
            acceptor_device_role: capsule.receiver_device_role ?? null,
            internal_peer_device_id: capsule.receiver_device_id?.trim() || null,
            internal_peer_device_role: capsule.receiver_device_role ?? null,
            internal_peer_computer_name: capsule.receiver_computer_name?.trim() || null,
            internal_peer_pairing_code: capsule.receiver_pairing_code?.trim() || null,
          }
        : {}),
    }

    insertHandshakeRecord(db, record, prep.formation)
    insertSeenCapsuleHash(db, capsule.handshake_id, capsule.capsule_hash)
    if (policySelections && ((policySelections as { ai_processing_mode?: AiProcessingMode }).ai_processing_mode !== undefined
      || (policySelections as { cloud_ai?: boolean }).cloud_ai !== undefined
      || (policySelections as { internal_ai?: boolean }).internal_ai !== undefined)) {
      updateHandshakePolicySelections(db, capsule.handshake_id, policySelections)
    }
    console.log('[HANDSHAKE] Initiator formation OK:', capsule.handshake_id, 'state=PENDING_ACCEPT consent=', prep.consent.consent_id)

    const relationshipId = capsule.relationship_id
    const hasPolicy = policySelections && ((policySelections as { ai_processing_mode?: AiProcessingMode }).ai_processing_mode !== undefined
      || (policySelections as { cloud_ai?: boolean }).cloud_ai !== undefined
      || (policySelections as { internal_ai?: boolean }).internal_ai !== undefined)
    const globalBaseline = hasPolicy
      ? baselineFromPolicySelections(policySelections, record.effective_policy)
      : baselineFromHandshake(record)
    const buildGov = (b: { block_id: string; type: string }): ContextItemGovernance => {
      const isMsg = b.type === 'message' || b.block_id?.startsWith('ctx-msg')
      if (isMsg) {
        return createMessageGovernance({
          publisher_id: session.wrdesk_user_id,
          sender_wrdesk_user_id: session.wrdesk_user_id,
        })
      }
      const itemPolicy = blockPolicyMap?.get(b.block_id)
      const baseline = itemPolicy
        ? baselineFromPolicySelections(itemPolicy as Parameters<typeof baselineFromPolicySelections>[0], record.effective_policy)
        : globalBaseline
      return createDefaultGovernance({
        origin: 'local',
        usage_policy: { ...baseline },
        provenance: { publisher_id: session.wrdesk_user_id, sender_wrdesk_user_id: session.wrdesk_user_id },
      })
    }

    for (const block of localBlocks) {
      try {
        insertContextStoreEntry(db, {
          block_id: block.block_id,
          block_hash: block.block_hash,
          handshake_id: capsule.handshake_id,
          relationship_id: relationshipId,
          scope_id: block.scope_id ?? null,
          publisher_id: session.wrdesk_user_id,
          type: block.type,
          content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? {}),
          status: 'pending_delivery',
          valid_until: null,
          ingested_at: null,
          superseded: 0,
          governance_json: JSON.stringify(buildGov(block)),
        })
      } catch {
        /* non-fatal — context delivery can be retried */
      }
    }

    return { success: true }
  } catch (err: any) {
    return {
      success: false,
      error: err?.message ?? 'Initiator formation failed',
    }
  }
}

/**
 * The initiator's explicit creation act is the consent event on that side.
 * Fail-closed on capture method and ingress path; writes the Hash-Pinned
 * consent record and returns the FormationMeta for the insert.
 */
export function prepareInitiatorFormation(args: InitiatorConsentArgs, profileId: string): InitiatorConsentResult {
  const capture = resolveCaptureMethodForFormation(args.capture_method)
  if (!capture.ok) return { ok: false, reason: capture.reason.toUpperCase() }
  if (!isRecordableIngressPath(args.ingress_path)) {
    return { ok: false, reason: 'INGRESS_PATH_NOT_RECORDABLE' }
  }
  const profileRes = resolveProfile(profileId, 1)
  if (!profileRes.ok) return { ok: false, reason: `${profileRes.reason.toUpperCase()}:${profileId}` }

  const consent = insertConsentRecord(getConnectOfferDb(), {
    offer_id: null,
    handshake_id: args.handshake_id,
    role: 'initiator',
    preview_hash: args.preview_hash,
    bound_definition_hash: args.bound_definition_hash,
    contract_state_hash: args.contract_state_hash,
    capture_method: args.capture_method,
    ingress_path: args.ingress_path,
    source_reference: args.source_reference ?? null,
    actor_wrdesk_user_id: args.actor_wrdesk_user_id,
  })

  return {
    ok: true,
    consent,
    formation: {
      profile_id: profileRes.record.id,
      profile_version: profileRes.record.version,
      ingress_path: args.ingress_path,
      capture_method: args.capture_method,
      source_reference: args.source_reference ?? null,
      consent_id: consent.consent_id,
      nonce: randomUUID(),
    },
  }
}
