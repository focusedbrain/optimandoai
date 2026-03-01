# TODO-HIGH-ASSURANCE: Security & Reliability Hardening

Items in this list are required for production deployment in regulated or high-trust environments. They go beyond the functional MVP.

## Cryptographic Assurance

- [ ] **Integrate ML-KEM-768 (PQC KEM)**: Post-quantum key encapsulation for handshake key agreement. Currently deferred to Electron native module integration.
- [ ] **Ed25519 signature verification in pipeline**: Add a pipeline step that verifies the capsule's Ed25519 signature against the sender's known public key. Currently delegated to the upstream validator (pre-pipeline).
- [ ] **AES-256-GCM AEAD verification**: Verify canonical AAD serialization and AEAD tag on context block payloads within the pipeline.
- [ ] **HKDF-SHA256 key derivation audit**: Verify that the key derivation from X25519 ECDH uses correct context strings and salt.
- [ ] **SHA-256 fingerprint chain verification**: Verify `capsule_hash` is the actual SHA-256 of the canonical capsule content (currently trusted from upstream).

## Memory Safety

- [ ] **Zero-on-logout**: Ensure all cryptographic keys (KEK, DEK, ECDH private keys) are zeroed from memory on logout, quit, and session expiry. Implement `secureMemset` or equivalent.
- [ ] **VSBT rotation**: Rotate the Vault Session Binding Token on each privileged operation to limit replay window.
- [ ] **Process isolation**: Evaluate sandboxing the handshake pipeline in a separate Electron utility process.

## Audit & Compliance

- [ ] **Immutable audit log**: Make the `audit_log` table append-only (no UPDATE, no DELETE). Consider using a WAL-mode SQLite with fsync guarantees.
- [ ] **Audit log integrity chain**: Chain audit entries with hash links (each entry includes hash of previous entry) for tamper detection.
- [ ] **PII scrubbing verification**: Automated test that scans all audit metadata fields for email-address patterns, IP addresses, and other PII.
- [ ] **Compliance export**: Export audit log in a format suitable for SOC 2 / ISO 27001 evidence collection.

## Fault Tolerance

- [ ] **Pipeline timeout**: Add a global timeout to `runHandshakeVerification` (e.g., 5 seconds) to prevent hung steps from blocking the main process.
- [ ] **DB corruption recovery**: Implement SQLCipher integrity check on vault open and graceful degradation if handshake tables are corrupted.
- [ ] **First-pending collision handling**: If two handshake-initiate capsules arrive simultaneously for the same relationship, ensure deterministic winner selection (currently: first-writer-wins via `INSERT`).
- [ ] **Idempotent capsule processing**: Ensure that re-processing a capsule after a crash mid-transaction is safe (dedup hash prevents double-apply).

## Testing

- [ ] **Integration tests with in-memory SQLite**: Full `processHandshakeCapsule` tests with a real (in-memory) SQLCipher database.
- [ ] **Fuzz testing**: Fuzz `VerifiedCapsuleInput` fields to verify that all malformed inputs produce clean denials (no crashes, no undefined behavior).
- [ ] **Performance benchmarks**: Measure pipeline latency under load (1000 capsules/sec) and context block query latency with 100k blocks.
- [ ] **Concurrency tests**: Verify thread safety of `runRetentionCycle` running concurrently with `processHandshakeCapsule`.
