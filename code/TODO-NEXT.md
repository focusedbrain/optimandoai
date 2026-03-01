# TODO-NEXT: Post-MVP Work Items

## P0 — Required Before Production

- [ ] **Wire ingestor/validator pipeline**: Connect the upstream signature verification, identity resolution, and decryption layers to produce `VerifiedCapsuleInput` from raw email capsules.
- [ ] **Receiver policy configuration UI**: Build settings screen for users to configure `ReceiverPolicy` (allowed domains, minimum tier, cloud preferences, classification acceptance).
- [ ] **Extension IPC client wrapper**: Refactor `useHandshakeStore.ts` to be a thin read-only proxy over WebSocket RPC, replacing direct `chrome.storage.local` persistence.
- [ ] **Accept/Reject UX flow**: Implement the single preview screen with "Accept (receive-only)" / "Accept & Return Share (reciprocal)" buttons, including Cloud AI warning disclosure.
- [ ] **Outbound capsule creation**: Implement capsule builder for initiating handshakes from the local user (uses existing `handshakeService.ts` crypto identity).
- [ ] **Best-effort peer notification on revocation**: Send a revocation capsule to the counterparty when local user revokes.

## P1 — Important Enhancements

- [ ] **Key lifecycle management**: Zero KEK/DEK from memory on logout/quit. Implement secure key wipe in Electron main process.
- [ ] **Embedding service integration**: Implement `LocalEmbeddingService` with an actual local model (e.g., MiniLM, BGE-small) for context block semantic search.
- [ ] **Retention policy per classification**: Enforce `retentionDays` per data classification (currently only `valid_until` is used for soft-delete).
- [ ] **Auto-expiry of PENDING_ACCEPT**: The retention job handles this, but add a user-configurable timeout override.
- [ ] **Autoregister/provisioning flow**: Wire `ExecutionCapsule` preview into the provisioning pipeline using the same handshake model.
- [ ] **Remove `'messenger'` from extension `delivery_method`**: Clean up the old type union in `apps/extension-chromium/src/handshake/types.ts`.

## P2 — Nice to Have

- [ ] **Handshake history viewer**: Dashboard UI for viewing handshake timeline, state transitions, and audit log entries.
- [ ] **Context block explorer**: UI for browsing and searching received context blocks, with semantic search integration.
- [ ] **Batch capsule processing**: Process multiple capsules in a single pipeline run for email threads with multiple handshake updates.
- [ ] **Export context blocks**: Implement `export-context` action with receiver policy gating.
- [ ] **WebSocket push events**: Emit `HandshakeIPCEvent` push events to connected extension clients on state changes.
