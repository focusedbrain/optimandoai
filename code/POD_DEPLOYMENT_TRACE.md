# Pod Deployment Trace — Current State

**Date:** 2025-03-15  
**Context:** Pod serves two purposes — A) LOCAL MODE (replaces Chrome sandbox, free users) and B) SERVER MODE (redundant pre-filter on hosted VM, DDoS protection).

---

## 1. beapStructuralValidator.ts

### Does it exist?

**No.** No file `beapStructuralValidator.ts` in the repo.

### Can it validate .beap structure without decryption?

**Partial.** Existing validation is scattered:

| Location | What it validates | Without decryption? |
|----------|-------------------|----------------------|
| `beapDecrypt.parseBeapFile()` | header, signature, metadata present; valid JSON | ✅ Yes |
| `shared/beap/validators.isBeapPackageJson()` | beapVersion, type, envelope markers | ✅ Yes |
| `ingestion-core/validator.ts` | Handshake capsules (capsule_type, schema_version) | N/A — different format |
| `ingestion-core/detectBeapCapsule()` | schema_version + capsule_type (handshake) | N/A — not .beap message packages |

**Gap:** No unified structural validator for .beap (header/metadata/envelope) with size/depth/field limits, prototype pollution guard, or schema checks. `parseBeapFile` is minimal (3 field checks).

### Is it standalone (no browser/extension dependencies)?

**N/A.** The closest is `parseBeapFile` in `beapDecrypt.ts` — it has no chrome.* imports. But it lives in the extension package and imports from `BeapPackageBuilder` (types). `ingestion-core` is standalone but validates handshake capsules, not .beap packages.

### Status: ❌

- No `beapStructuralValidator.ts`
- No unified .beap structural validation (size, depth, fields, prototype pollution)
- `parseBeapFile` + `isBeapPackageJson` are minimal; not suitable as server pre-filter

---

## 2. Compliance Artefact Generator

### Does it exist?

**No.** No module that signs validation results with a pod ephemeral Ed25519 key.

### Signs validation result with pod's ephemeral Ed25519 key?

**N/A.** Not implemented.

### Status: ❌

---

## 3. HTTP Server for the Pod

### Does it exist?

**No.** No HTTP server exposing:

- `POST /validate` (structural validation, server mode)
- `POST /depackage` (full pipeline, local mode)
- Health check endpoint

### Status: ❌

---

## 4. Containerfile / Dockerfile

### Does it exist for the pod?

**No.** No pod-specific Containerfile or Dockerfile.

### Existing Dockerfiles

- `packages/coordination-service/Dockerfile` — coordination service (Node 22, bookworm-slim)
- `packages/relay-server/Dockerfile` — relay server

### Base image (for future pod)

- Not defined. Coordination uses `node:22-bookworm-slim`.

### tmpfs for RAM-only operation

- `packages/relay-server/docker-compose.yml` has `tmpfs` for relay; no pod equivalent.

### Status: ❌

---

## 5. Pod Manifest (pod.yaml)

### Does it exist?

**No.** No `pod.yaml` or Podman pod configuration.

### Status: ❌

---

## 6. Setup Wizard UI

### Does it exist?

**No.** No UI for:

- "Local Pod" / "Remote Pod" / "Extension Sandbox" selector
- Connection test to pod
- Pod URL configuration

### Status: ❌

---

## 7. Node.js Compatibility

### Can ingestion-core run in Node 20 without Chrome extension APIs?

**Yes.** `ingestion-core`:

- Zero chrome.*, browser.*, or DOM APIs
- Uses Node built-ins: `crypto`, `Buffer`
- README: "Can run in Electron, child_process, standalone Node, Docker"
- No extension dependencies

### Can depackaging pipeline run in Node 20?

**Partially.** Depends on:

| Module | Chrome/extension deps? | Node 20 compatible? |
|--------|------------------------|----------------------|
| `depackagingPipeline.ts` | No | ✅ Uses `crypto.subtle` (Node 19+ has Web Crypto) |
| `beapCrypto.ts` | No (comment references chrome.storage for key storage) | ✅ `crypto.subtle`, `crypto.getRandomValues` |
| `x25519KeyAgreement.ts` | Yes — `chrome.storage.local` / `localStorage` for keypair | ⚠️ Key storage: needs injectable key provider for Node |
| `signingKeyVault.ts` | Yes — `chrome.storage.local` / `localStorage` | ⚠️ Signing key storage: needs injectable provider |
| `beapDecrypt.ts` | No | ✅ |
| `outerEnvelope.ts` | No | ✅ |
| `processingEventGate.ts` | No | ✅ |
| `poae.ts` | No | ✅ |
| `urlNormalizer.ts` | No | ✅ |
| `eligibilityCheck.ts` | No | ✅ |
| `beapCrypto.ts` (ML-KEM) | Yes — `fetch('http://127.0.0.1:17179/...')` for PQ ops | ❌ Node pod needs bundled ML-KEM or PQ service |

### Web Crypto → globalThis.crypto

**Yes.** Node 19+ exposes Web Crypto via `globalThis.crypto`. Node 20 is compatible.

### chrome.* API dependencies that would break in Node

| File | Usage | Impact |
|------|-------|--------|
| `x25519KeyAgreement.ts` | `chrome.storage.local` for device keypair; fallback `localStorage` | Node: no chrome, no localStorage. Keypair must be injected or read from env/file. |
| `signingKeyVault.ts` | `chrome.storage.local` for Ed25519 signing key | Node: same. Signing key must be injected for builder; depackaging doesn't need it. |

### Other incompatibilities

1. **Import paths:** Depackaging lives in `apps/extension-chromium`; imports extension-specific types (`BeapPackageBuilder`, etc.). Would need extraction to a shared package for Node.
2. **ML-KEM:** `beapCrypto.ts` calls `fetch('http://127.0.0.1:17179/api/crypto/pq/mlkem768/...')` for encapsulate, decapsulate, keypair. Node pod would need bundled ML-KEM-768 or a PQ service; otherwise qBEAP depackaging fails.
3. **Sandbox protocol:** `sandbox.ts` uses `window.postMessage`, `window.addEventListener` — browser-only. Pod would use HTTP instead.

### Status: ⚠️

- ingestion-core: ✅ Node-ready
- Depackaging crypto: ✅ Web Crypto compatible
- Key storage (x25519, signing): ⚠️ Requires injectable provider for Node
- Package layout: ⚠️ Depackaging tied to extension; needs refactor for standalone use

---

## Deployment Architecture for MVP

| Tier | Pod placement | Config |
|------|---------------|--------|
| Free | Local via Podman on user machine | Local pod URL (e.g. 127.0.0.1:17180) |
| Pro | Hosted VM as pre-filter | Remote pod URL; capsules relayed to local orchestrator |
| Enterprise | Customer infra with relay | Pod on customer VM; redundant pre-filter vs DDoS |

**All three use the SAME pod image, different config.**

---

## What's Needed for MVP

| Item | Current | Required |
|------|---------|----------|
| **Structural validator module** | ❌ None for .beap | Standalone module: size/depth/fields, prototype pollution, header/metadata/envelope schema. No browser deps. |
| **Compliance artefact generator** | ❌ | Optional for MVP; sign validation result with pod ephemeral Ed25519. |
| **HTTP server wrapper** | ❌ | POST /validate (structural only), POST /depackage (full pipeline), GET /health. |
| **Containerfile** | ❌ | Distroless Node 20 or Alpine; tmpfs for RAM-only if desired. |
| **Pod manifest** | ❌ | Podman pod.yaml for local deployment. |
| **Setup wizard** | ❌ | "Local Pod" / "Remote Pod" / "Extension Sandbox" selector; connection test; pod URL config. |
| **Pipeline routing** | N/A | Switch to route through pod instead of Chrome sandbox when pod connected. |

---

## Summary Table

| Component | Status | Notes |
|-----------|--------|-------|
| beapStructuralValidator.ts | ❌ | Does not exist |
| .beap structural validation | ⚠️ | parseBeapFile minimal; no size/depth/fields |
| Compliance artefact generator | ❌ | Not implemented |
| Pod HTTP server | ❌ | Not implemented |
| Containerfile for pod | ❌ | Not implemented |
| pod.yaml | ❌ | Not implemented |
| Setup wizard UI | ❌ | Not implemented |
| ingestion-core Node compat | ✅ | Standalone, no browser deps |
| Depackaging Node compat | ⚠️ | Web Crypto OK; key storage needs injection |
