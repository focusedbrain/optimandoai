## STOP — blocking contradiction in Build B's cutover target

Pre-flight passed (branch `feature/layered-sandbox`, HEAD `42dcb444`, Build A present, its tests green: 33 passed/1 rig-skipped). But before touching the live email path I traced the named call sites against the seam's actual `depackage` semantics, and **the cutover as specified cannot satisfy its own requirements**. The build prompt explicitly tells me to report contradictions rather than absorb them, so here it is with evidence.

### The two operations are not the same operation

**What the seam's `kind:'depackage'` does** (Build A, unchangeable in this build):
- `InProcessExecutor`/`MicroVMExecutor` → `runDepackagingJob` → `depackage(inputBytes, sandboxPubKey)` → `extractMime(inputBytes)` → **MIME parsing of raw email bytes** → `SafeTextV1` + encrypted `CourierArtifactRecord[]` (`depackagingWorker.ts:53,114`; `safeText.ts`).
- Needs only the sandbox **public** key. Never touches handshake keys.

**What the named call sites do** (`messageRouter.ts:505–533`, `beapEmailIngestion.ts:1114–1174`):
- qBEAP → `decryptQBeapPackage(...)`: X25519 + ML‑KEM768 hybrid decapsulation using the handshake's **local private key** + **ML‑KEM secret key**, HKDF, AES‑256‑GCM (`decryptQBeapPackage.ts:272–290,429,454–455`), producing the decrypted **capsule JSON** (`rawCapsuleJson`).
- pBEAP → base64‑decode the public payload to capsule JSON.
- Output stored in `inbox_messages.depackaged_json` is the **canonical BEAP capsule JSON**, then sealed.

These are different transformations with different inputs, different key requirements, and **different output shapes** (`SafeTextV1`+courier artifacts vs. canonical capsule JSON).

### Why each core requirement breaks

1. **Parity (req #2) fails by construction.** Routing the qBEAP/pBEAP sites through `kind:'depackage'` would run MIME extraction over a BEAP package and emit `SafeTextV1`, which is *not* the canonical capsule JSON the row stores today. Flag‑on/in‑process would produce entirely different `depackaged_json` and break seal/validation — the opposite of byte‑identical.

2. **"exec=microvm closes invariant‑0" (mission) is impossible here under INV‑2.** qBEAP decryption requires the handshake **private**/**ML‑KEM secret** keys. INV‑2 (carried over from Build A) forbids any vault/handshake key material from entering a microVM guest. So the microVM literally cannot decrypt a qBEAP capsule — the per‑action‑microVM goal can't apply to these sites.

3. **Seal‑after‑dispatch (req #3) has nothing to seal.** The seam returns `SafeTextV1`+signature; the live path needs the validated **capsule JSON** to seal. No mapping exists.

The original Build A analysis already flagged the root of this: *"The microVM is not on the live email path at all. Live depackaging is inline in the main process (`messageRouter.ts:505-533`)."* That statement is true at the *location* level, but the analysis equated the inline **capsule decryption** with the microVM **MIME‑depackage worker** — and at the code level they are not interchangeable. Build B inherits that equation, and it doesn't hold.

### What I did *not* do
No code changes. No flag added. No ad‑hoc seam pieces. Nothing staged.

### How I'd recommend proceeding
The cleanest options (all change the build's stated assumptions, so I want your call):
