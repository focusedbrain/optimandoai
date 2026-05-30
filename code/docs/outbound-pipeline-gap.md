# Outbound Pipeline Gap — tracked isolation asymmetry

**Status:** Known gap, tracked. IsolationProvider API is ready. Pod roles not yet built.
**Build:** build001 (re-architecture baseline)
**Owner:** architecture

---

## What is missing

The BEAP inbound pipeline runs entirely inside isolated pod containers:

```
host → ingestor (:18100) → validator (:18101) → depackager (:18102) → sealer (:18103)
```

The BEAP **outbound** pipeline — building and sending a qBEAP/pBEAP capsule — runs
**entirely in-process in the renderer / extension sandbox**, with zero pod involvement:

```
BeapInlineComposer.tsx
  → executeDeliveryAction()
  → buildPackage()
      → buildQBeapPackage()  or  buildPBeapPackage()
          ← AEAD encryption (ML-KEM-768 + X25519, AES-256-GCM) in renderer
          ← Ed25519 signature in renderer
          ← No structural validator
          ← No sealer
  → executeDownloadAction / executeEmailAction / executeP2PAction
```

**File:line of the in-process build entry point:**
`apps/extension-chromium/src/beap-messages/services/BeapPackageBuilder.ts:1046`
(`buildQBeapPackage`) and `:1833` (`buildPBeapPackage`).

---

## The two missing roles

### 1. Outbound validator pod
**Purpose:** validate plaintext message body + attachment structure in isolation
*before* handing it to the encryption step, so a compromised renderer cannot
inject malformed or policy-violating content into a capsule.

**Seam (in `buildQBeapPackage`):**
```typescript
// TODO(outbound-pipeline): provider.callPipeline('outbound-validator', 'validate-plaintext', payload)
// BeapPackageBuilder.ts — search "ISOLATION GAP — OUTBOUND VALIDATOR"
```

### 2. Outbound sealer pod
**Purpose:** produce a tamper-evident HMAC seal over the *sender's* outbound
capsule record, with a key that never leaves the sealer container. Mirrors the
inbound pod sealer that seals the receiver's depackaged row.

**Seam (in `buildQBeapPackage`, after package assembly):**
```typescript
// TODO(outbound-pipeline): provider.callPipeline('outbound-sealer', 'seal-outbound', capsuleBytes)
// BeapPackageBuilder.ts — search "ISOLATION GAP — OUTBOUND SEALER"
```

---

## Why not built yet

- The pod image (`beap-components:dev`) currently has no `outbound-validator`
  or `outbound-sealer` role binary.
- `BeapPackageBuilder.ts` runs in the Chromium extension sandbox (renderer
  process), which cannot call `podman exec` directly. It communicates with
  Electron main via IPC. Routing the build through the isolation provider
  requires an IPC bridge from the renderer to the main-process provider.
- The E2E key material (ML-KEM-768 private key, X25519 ephemeral) that drives
  the AEAD encryption is currently derived in the renderer. Moving encryption
  into the pod requires key-derivation handoff design.

---

## IsolationProvider readiness

The `IsolationProvider` interface and capability ladder (build001) are ready
to host both roles once the pod image contains the binaries:

```typescript
// When outbound-validator pod role exists:
await provider.callPipeline('outbound-validator', 'validate-plaintext', plaintextPayload)

// When outbound-sealer pod role exists:
await provider.callPipeline('outbound-sealer', 'seal-outbound', capsulePayload)
```

The PodmanExecProvider will dispatch these via `podman exec -i <container>` over
the runtime socket (same exec channel that makes PDF extraction work on both Windows
and Linux despite the dead TCP path).

---

## Isolation asymmetry statement

> **Current state:** inbound BEAP traffic is fully pod-isolated (pod is mandatory
> since Phase 1, fail-closed). Outbound BEAP capsule construction has NO pod
> isolation — plaintext, keys, and signing happen entirely in the Electron renderer /
> extension sandbox. This is a known isolation asymmetry vs the inbound path.
> Building the outbound validator + sealer pods is the next architecture task.

---

## References

- `apps/electron-vite-project/electron/main/isolation/` — IsolationProvider API
- `apps/extension-chromium/src/beap-messages/services/BeapPackageBuilder.ts:1046,1823`
- `SECURITY/ISOLATION.md` — inbound isolation invariants (outbound not yet covered)
- `docs/architecture/beap-high-assurance-strategy.md §1.2` — pod scope is currently inbound-only
