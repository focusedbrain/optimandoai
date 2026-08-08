# WR Handshake Refactor — Code Inventory (Phase 1)

Analysis date: 2026-07-24. Normative basis: WR Handshake Extracts VII v1.1, IX v2.0, X v1.0, XI v1.1, XII v1.0 (annex-number-provisional).
All paths relative to repo root. Read-only analysis; no code was modified.

Tier-1 area keys used in the tables:
**CORE** (core schema/serialization), **PROF** (profile machinery), **FORM** (formation/initiation), **GOV** (governance-class routing), **GRANT** (grant/rights model), **ID** (identity/SSO), **CONTRACT** (contract objects & persistence), **EVID** (PoAC/PoAE/evidence), **XDEV** (cross-device).

---

## 1. Handshake core (Electron main, trusted boundary)

`apps/electron-vite-project/electron/main/handshake/`

| Path | Responsibility | Persistence touched | Areas |
|---|---|---|---|
| `types.ts` | All canonical types: `HandshakeRecord` (≈60 fields, mutable), `VerifiedCapsuleInput`, tiers, states, `ReceiverPolicy`, `EffectivePolicy`, pipeline types | — | CORE, PROF, GRANT |
| `pipeline.ts` | Deny-by-default step runner (`runHandshakeVerification`) | — | CORE, FORM |
| `steps/index.ts` + `steps/*.ts` | Frozen 24-step inbound verification pipeline (schema, dedup, ownership, receiver binding, domain, policy anchor, limits, capsule/context hash, state transition, **internal routing**, chain integrity, sharing mode, external processing, context binding, context versions *(no-op)*, policy resolution, scope, timestamp, expiry, 4 tier steps) | — | CORE, FORM, GRANT |
| `canonicalRebuild.ts` | Gate-2 allowlist rebuild of inbound capsules; deny-list rejects (`data`, `payload`, …); **unknown fields stripped** | — | CORE |
| `capsuleHash.ts` | SHA-256 over sorted-JSON **subset** of capsule fields → `capsule_hash` | — | CORE |
| `contextHash.ts` | Context-payload hash; nonce generation; timestamp/nonce validators | — | CORE |
| `capsuleBuilder.ts` | Builds initiate/accept/refresh/revoke/context_sync wire capsules; signs; mints per-handshake Ed25519 keys; `receiver_pairing_code` explicitly out of hash (`:137-139`) | — | CORE, FORM |
| `signatureKeys.ts` | Ed25519 keygen; sign/verify **over `capsule_hash` bytes only**; weak-key rejection (TOFU ingest comment `:89`) | — | CORE, ID |
| `handshakeVerification.ts` | Standalone verify incl. seen-nonce replay — **only used from unit tests** | — | CORE (obsolete path) |
| `enforcement.ts` | `processHandshakeCapsule`: hash + signature + pipeline + persist; `authorizeAction`; builds initiate/accept/revoke records | vault/ledger handshake tables | FORM, GRANT |
| `initiatorPersist.ts` | Initiator local row (`PENDING_ACCEPT`) — **explicitly bypasses receive pipeline** (`:4-10`) | `handshakes`, `seen_capsule_hashes` | FORM |
| `recipientPersist.ts` | File-import initiate → `PENDING_REVIEW` — bypasses `processHandshakeCapsule` | `handshakes`, `seen_capsule_hashes` | FORM |
| `ipc.ts` | Formation IPC: initiate (`:1276-1605`), buildForDownload, importCapsule (`:792-871`; forces `handshake_type='internal'` for same-account `:853-860`), accept (`:1839+`, typed pairing-code check `:1987-2032`) | orchestrates all | FORM, XDEV |
| `resolvePairingCode.ts` | 6-digit code → peer `instance_id` via coordination (fail-open, side-effect-free) | — | XDEV, FORM |
| `relationshipId.ts` | Symmetric `rel:` + SHA-256 derivation | — | CORE |
| `sessionFactory.ts` | `SSOSession` from JWT claims | — | ID |
| `handshakeAccountIsolation.ts` | `sessionMatchesParty` (OR-logic: wrdesk **or** iss+sub **or** email), `samePrincipalForInternal` | — | ID |
| `db.ts` | `HANDSHAKE_MIGRATIONS` v1–v72; CRUD; audit insert; expiry no-ops (v52); `deleteHandshakeRecord` also deletes audit rows (`:2358-2363`) | vault SQLCipher DB handshake tables | CONTRACT, EVID |
| `ledger.ts` | Separate SSO-keyed SQLCipher `handshake-ledger.db`; **also applies full handshake migrations** (`:223-228`) despite hashes-only header claim (`:1-17`) | `~/.opengiraffe/electron-data/handshake-ledger.db` | CONTRACT |
| `auditLog.ts` | Audit entry builders (pipeline success/denial, revoked) — no preview/intent hash | `audit_log` | EVID |
| `revocation.ts` | Local revoke: state, **delete blocks + embeddings**, audit, close P2P, un-wire topology, **best-effort revoke capsule to peer** (`:108-170`) | handshakes, context_blocks, outbound queue | GRANT |
| `remoteRevokeCallbackRegistry.ts` | UI callback on remote revoke | — | GRANT |
| `retentionJob.ts` | Expired-block cleanup (exported; **not started from production entrypoints**) | context_blocks, audit_log | EVID |
| `contextGovernance.ts` | Per-block usage flags (`local_ai_allowed`, `transmit_to_peer_allowed`, …); egress filter for peer transmission | governance_json | GRANT |
| `vaultGating.ts`, `visibilityFilter.ts` | Vault/tier gates; lock-state visibility | reads handshakes | GRANT |
| `tierClassification.ts`, `steps/tierSteps.ts` | Account-class analog (free/pro/publisher/enterprise) tier decision, claim downgrade | — | PROF |
| `internalPersistence.ts`, `internalCoordinationWire.ts`, `internalSandboxesApi.ts`, `sandboxTopologyKind.ts`, `topologyAutoWire.ts` | Internal (same-principal) handshake identity completeness, routing keys, host↔sandbox topology inference and **post-ACTIVE auto-wiring of `linked[]`** | handshakes, orchestrator-mode.json | GOV |
| `internalRelayOutboundGuards.ts`, `relayOutboundClassification.ts`, `relayQueueTransportOutcome.ts`, `outboundQueue.ts` | Outbound queue + relay wire guards / retry taxonomy | `outbound_capsule_queue` | GOV |
| `emailTransport.ts`, `capsuleTransport.ts` | Email body / transport embedding of capsules | — | FORM |
| `p2pTransport.ts`, `p2pTokenBackfill.ts` | Direct-P2P delivery; opaque UUID Bearer token mint/rotate | handshakes token columns | GOV, XDEV |
| `handshakeConfidentiality.ts` | Vault HS profiles ↔ `confidentiality_scope` (not a relationship-type registry) | `handshake_hs_profiles` | CONTRACT |
| `keyBindingDebug.ts` | Key-binding diagnostics | — | ID |
| Context machinery (`contextBlocks.ts`, `contextIngestion.ts`, `contextSync*.ts`, `embeddings.ts`, `hybridSearch.ts`, `queryCache.ts`, …) | Context exchange/search on top of relationships | context tables | GRANT (peripheral) |

## 2. Formation entry points (complete enumeration)

| # | Entry point | Location | What it creates | Converges on shared pipeline? |
|---|---|---|---|---|
| E1 | User initiate (email/relay delivery) | `handshake/ipc.ts:1276-1605`, UI `SendHandshakeDelivery.tsx` | New `PENDING_ACCEPT` initiator row | **No** — `persistInitiatorHandshakeRecord` bypass |
| E2 | Initiate → `.beap` download | `ipc.ts:1607-1833` | Same initiator persist + file | **No** (same bypass) |
| E3 | File import of initiate capsule | `ipc.ts:792-871` | `PENDING_REVIEW` acceptor row | **Partial** — canonicalRebuild only, then `persistRecipientHandshakeRecord`; may force `handshake_type='internal'` (`:853-860`) |
| E4 | Inbound initiate via email poll | `email/beapSync.ts:82-104, 185-220, 256-304` | `PENDING_REVIEW` row, **no user tap before insert** | **Yes** (`processHandshakeCapsule`) |
| E5 | Inbound initiate via coordination WS | `p2p/coordinationWs.ts:490-514` (`ingress_path: 'coordination_ws'`) | Same | **Yes** |
| E6 | Inbound initiate via relay pull | `p2p/relayPull.ts:314-328` (`ingress_path: 'relay_pull'`) | Same | **Yes** |
| E7 | Inbound via ingestion RPC/HTTP | `ingestion/ipc.ts:146-172, 319-333` | Same | **Yes** |
| E8 | User Accept (activation) | `AcceptHandshakeModal.tsx:203-265` → `ipc.ts:1839+` | Extends row → ACCEPTED/ACTIVE; accept capsule out | **Yes** |
| E9 | Edge-agent device pairing | `apps/edge-agent/dist/pairingProtocol.js:23-80`, `pairingConfirm.js:5-73` | Separate `handshake_type: 'edge_ingestor'` pair record in agent state | **No** — parallel dialect outside the ledger |

Non-formation adjacents: pairing-code mint/register/resolve (`orchestratorModeStore.ts:83-87`, coordination `server.ts:487-564`) — routing only, creates no relationship. Deep links / protocol handlers (`main.ts:1250-1287`, `2481-2495`) — open UI only, no formation. No QR/camera scan capture exists anywhere (electron or extension).

## 3. Governance-class-relevant modules

| Path | Responsibility | Current authorization model |
|---|---|---|
| `electron/main/internalInference/policy.ts` (`assertRecordForServiceRpc` `:289-301`), `hostAiInternalPairingLedger.ts:15-29` | Host↔Sandbox inference gate | Handshake-ledger: ACTIVE + `internal` + same-principal + roles + identity-complete |
| `internalInference/hostInferencePolicyStore.ts`, `hostAiRemoteInferencePolicyResolve.ts:134-138` | Host opt-in policy | JSON policy file; **default-allow when `unset`** and paired |
| `internalInference/relayP2pSignalHandler.ts`, `transport/transportDecide.ts`, `p2pInferenceFlags.ts` | P2P signaling/transport | Env flags + handshake gate (see workspace invariants) |
| `packages/coordination-service/src/server.ts`, `auth.ts`, `handshakeRegistry.ts`, `pairingCodeRegistry.ts`, `store.ts` | Cloud relay: registry, capsule store, p2p_signal, pairing codes | OIDC Bearer (JWT `sub`-keyed); no client↔relay handshake object |
| `packages/relay-server/src/server.ts`, `auth.ts`, `store.ts` | Self-hosted relay | Shared `relay_auth_secret` + per-handshake ingest token |
| `electron/main/llm/*`, `handshakeAvailableModelsCompute.ts:210-228` | Local Ollama discovery/use | Ambient (probe + list); no admission object |
| `handshake/aiProviders.ts`, `llmStream.ts`, `ocr/router.ts` | Cloud model APIs | Hardcoded URLs + API keys from settings; availability = key present |
| `electron/main/email/gateway.ts:370-434`, `secure-storage.ts`, `roleScopedTokenStore.ts` | Email providers | `email-accounts.json` (metadata plaintext, creds safeStorage-encrypted inline); no signed admission artifact |
| `electron/main/sandbox/sandboxOutboundPolicy.ts:92-224`, `packages/ingestion-core/src/sandboxEgressClassification.ts:31-50` | Sandbox egress allowlist | Deny-by-default for sandbox capsule types; host side has no equivalent universal gate |
| `electron/main/orchestrator/orchestratorModeStore.ts`, `orchestrator-db/*` | Orchestrator mode/state | Local config + encrypted local DB; not a peer relationship |

## 4. Persistent stores

| Store | Disk location | Content relevant to refactor | Migration machinery |
|---|---|---|---|
| `handshake-ledger.db` | `~/.opengiraffe/electron-data/handshake-ledger.db`; SQLCipher, key HMAC(sessionToken, `beap-handshake-ledger-v1`); WAL | `ledger_meta`, `ledger_handshakes` (status/hashes/commitments/policy refs), `ledger_context_blocks`; **plus full handshake schema via `migrateHandshakeTables`** (can hold private keys) | Ledger-native `schema_version=1` + shared `HANDSHAKE_MIGRATIONS` |
| Vault DB (`vault.db` / `vault_<id>.db`) | same dir; SQLCipher; WAL | `handshakes` (incl. `local_private_key`, X25519/ML-KEM secret cols, `effective_policy_json`, seq/hash chain, P2P tokens, internal routing, `confidentiality_scope`, `topology_pairing_kind`), `context_blocks`, `context_block_versions`, `context_embeddings`, `seen_capsule_hashes`, `audit_log`, `context_store`, `outbound_capsule_queue`, `p2p_config`, `inbox_*`, `quarantine_messages`, `sent_beap_outbox`, `handshake_hs_profiles`, vault-native tables (`hs_context_access_approvals`/`_audit`, …), ingestion tables | `HANDSHAKE_MIGRATIONS` 1–72 (`handshake_schema_migrations`), additive + rebuilds; ingestion v1 |
| Orchestrator DB | `~/.opengiraffe/electron-data/orchestrator.db` + `orchestrator.key` (safeStorage-wrapped DEK) | `device_keys` (`x25519_device_v1`, private AES-GCM-wrapped, refuse-overwrite), sessions/settings/templates | `orchestrator_meta.schema_version = 2.0.0`, idempotent add |
| `email-accounts.json` | userData | Account metadata plaintext; OAuth tokens / IMAP passwords safeStorage-encrypted inline (not keychain refs); `.bak` copy | none (shape versioned by fields) |
| `orchestrator-mode.json` | userData | mode, deviceName, instanceId, **pairingCode**, `linked[]` peers | none |
| Coordination DB | `COORD_DB_PATH` (server-side) | `coordination_capsules`, `coordination_handshake_registry`, `coordination_token_cache`, `coordination_pairing_codes`, `coordination_handshake_health_reports` | additive ALTERs |
| Relay DB | `./relay.db` (self-host) | `relay_capsules`, `relay_handshake_registry`, `relay_device_registry` | fixed schema |
| Quarantine blobs | `userData/inbox-quarantine-blobs/` | hybrid-encrypted quarantined content | n/a |
| Role token files | `userData/email-role-tokens/` | A2 send/read split OAuth tokens (node-local, INV-2) | n/a |

## 5. Evidence / audit writers

| Writer | Store | Hash-chained | Append-only | Taxonomy |
|---|---|---|---|---|
| `insertAuditLogEntry` (`db.ts:2125-2139`) | `audit_log` | **No** | **No** (deleted with handshake `db.ts:2362`) | `handshake_pipeline_success/denial`, `handshake_revoked`, `VALIDATION_BYPASS_ATTEMPT`, `retention_cycle`, `TOOL_AUTHORIZED/DENIED`, `TOOL_EXECUTION_*` |
| Capsule chain (`chainIntegrity.ts`) | `handshakes.last_seq_*`, `last_capsule_hash_*` | per-capsule prev_hash (refresh) | mutable row state | replay/gap rejection |
| `insertIngestionAuditRecord` (`ingestion/persistenceDb.ts:239-250`) | `ingestion_audit_log` | No | **No** (purged by `retention/retentionJob.ts:73-94`) | ingest events |
| `hsContextAccessService.ts:30-54` | `hs_context_access_approvals` / `_audit` | No | vault-mutable | doc/link approvals (no shown-text hash) |
| `sealed-storage/index.ts:157-184` | RAM only | n/a | cleared on demand | tamper events (not durable) |
| Extension `poae.ts` / BeapPackageBuilder | embedded in package JSON in inbox rows | package-level | inbox mutable | PoAE-shaped, not a durable chain, no Intent Hash of presented preview |
| PoAC | **absent** (grep empty) | — | — | — |

## 6. Cross-device & web-facing surfaces

| Surface | Status |
|---|---|
| Second same-user device join | Pairing-code + internal handshake; binding by user re-typing the 6-digit code (string equality, `ipc.ts:1987-2032`); **no cryptographic challenge exchange, no epoch/nonce binding**; no key/authority transfer (per-device X25519 refuse-overwrite) |
| `/.well-known/` | Only consumed for OIDC discovery (`src/auth/discovery.ts:4-13`); nothing served/consumed for publisher identity |
| DNS TXT | No runtime lookup anywhere; `dns-txt` only as identity-anchor enum + tier-signal field (`types.ts:201`, `sessionFactory.ts:31-34`) |
| Website connector | Nothing in-repo; `wp-content/` is a WordPress theme (marketing site), unrelated to runtime |
| Token formats | Capsules: whitelist rebuild strips unknowns; hash over subset (extension-tolerant only if fields registered + kept out of hash). Sealed service-RPC envelope: outer extras ignored, AAD = routing trio. `p2p_signal`: unknown non-forbidden keys **preserved**; forbidden content keys rejected. P2P Bearer / relay secrets: opaque strings. OIDC JWT: extra claims preserved by jose |
| Consent UIs | `AcceptHandshakeModal`, extension `ConsentDialog` (CAP/HSP), `SessionImportDialog`, vault auto-mode consent — none captures a hash of what was shown |

## 7. Legacy / dead / obsolete paths (findings in themselves)

1. `handshake/handshakeVerification.ts` (nonce-store verify) — production ingest never calls it; nonces are validated for format but the replay store used is `seen_capsule_hashes` + seq.
2. `steps/contextVersions.ts` — intentional no-op; `context_block_versions` high-water table exists but is not enforced in the pipeline.
3. `skipConsentForAutomation` — policy schema default only (`handshake-overrides.ts:30,178`); no runtime consumers.
4. Legacy UUID peer routing (`counterparty_device_id` / `internal_peer_device_id`) accepted alongside pairing-code identity.
5. Retention schedulers (`startRetentionJob`, `startRetentionSchedule`) — defined, never started from production entrypoints.
6. `packages/sso` — empty dist, no source; session logic lives in the Electron app.
7. `packages/role-policy` — mail-role policy, not handshake grants (name collision hazard for the refactor).
8. Edge-agent pairing dialect (`apps/edge-agent/dist/pairingProtocol.js`) — parallel formation mechanism outside the handshake ledger.
9. Schema-v1 capsules still accepted with weaker hash checks (`schemaCheck.ts`, `verifyCapsuleHash.ts:38-40`).
10. `onRevocationDeleteBlocks` policy field — persisted, resolved, never consulted by `revokeHandshake`.
11. Dropped tables `plain_email_inbox` (v65), `p2p_pending_beap` (v66) — confirm no residual readers.
12. `opengiraffe://` protocol registration retained for compatibility — no formation semantics (keep it that way).
