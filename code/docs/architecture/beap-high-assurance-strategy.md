# BEAP High-Assurance Pod Architecture — Implementation Strategy

**Date:** 2026-05-24  
**Based on:** `beap-ingestor-audit-prompt.md` results, 2026-05-24  
**Branch:** `phase-1/pod-becomes-hot-path` (Phases 1–3 complete; held for review — do not merge to `main` until downstream phases sign off)

**Trackers:** [Phase 1](phase-1-tracker.md) · [Phase 2](phase-2-tracker.md) · [Phase 3](phase-3-tracker.md) · [Phase 3 manual E2E](phase-3-manual-test.md)

| Phase | Status |
| --- | --- |
| Phase 1 — Pod becomes hot path | ✅ SHIPPED 2026-05 |
| Phase 1.5 — Extension pod-client migration | ⏸ deferred |
| Phase 2 — AI analysis enhancement | ✅ SHIPPED 2026-05 |
| Phase 3 — Certification | ✅ SHIPPED 2026-05-24 |
| Phase 4 — Wizard | 🔜 next |
| Phase 5 — Supervisor / self-heal / LB | planned |
| Phase 6 — Polish | planned |

---

## 0. Executive summary

A Podman pod composed of isolated, role-specific containers (ingestor, validator, depackager, sealer, certifier, verifier) — all built from one source-of-truth image — runs in three modes on any desktop OS Podman supports, with a wizard a non-developer can finish in under five minutes to deploy the paid-tier edge pod on a Linux VM, certified per-message against SSO identity, self-healing without Kubernetes, and feeding into an enhanced AI analysis frame for phishing and scam detection.

The audit's blocker — *production traffic never goes through the pod today* — was Phase 1. Certification, wizard, and self-heal layer on top of a pod that's actually the hot path. Phases 1–3 are complete on `phase-1/pod-becomes-hot-path`; Phases 4–6 build on that foundation.

**Out of scope for this work:** the relay server (`packages/relay-server`) and coordination service (`packages/coordination-service`). They handle peer transport and coordination — a different concern with its own containerization, its own threat model, and its own lifecycle. Nothing in this strategy touches them.

**Platform scope:**

- **Local pod (desktop):** runs anywhere Podman is installed — Linux, Windows (via Podman Desktop / `podman machine`), macOS (same). No platform-specific code paths in the pod. The image is built once and runs everywhere Podman runs.
- **Remote pod (paid-tier edge VM):** Linux VMs only at launch. The wizard deploys over SSH to VMs the user provides; it does not provision VMs or integrate with provider APIs. The Containerfile and pod manifest are not Linux-only; the wizard's SSH automation targets Linux only.

---

## 1. North-star architecture

### 1.1 One image, three pod modes

The pod assembles role-specific containers from **one image** (`beap-components:vX.Y.Z`). Each container in the pod is the same image started with a different `BEAP_ROLE`. The pod itself runs in one of three modes:

```
POD_MODE=LOCAL_HOST    # free tier, on user machine, terminal of the pipeline
POD_MODE=REMOTE_EDGE   # paid tier, on user Linux VM, first-pass validator + cert issuer
POD_MODE=LOCAL_VERIFY  # paid tier, on user machine, replaces LOCAL_HOST; verifies cert then re-validates
```

The mode determines **which containers the pod includes** and which side of the network they listen on. Same `Containerfile`, same compiled artifact, same tests for every container.

Containers per mode:

| Container | LOCAL_HOST | REMOTE_EDGE | LOCAL_VERIFY |
| --- | --- | --- | --- |
| `ingestor` | yes | yes | yes |
| `validator` | yes | yes | yes |
| `depackager` | yes | yes | yes |
| `sealer` (holds HMAC key) | yes | no | yes |
| `certifier` (holds Ed25519 private key) | no | yes | no |
| `verifier` (holds attested edge public keys) | no | no | yes |

This is the "one source of truth" property: bumping the image bumps every container in every deployment everywhere at once. No mode-specific images, no mode-specific code paths beyond which container the pod runs.

**Manifests (implemented):**

| Mode | Manifest |
| --- | --- |
| LOCAL_HOST | `packages/beap-pod/pod.yaml` |
| REMOTE_EDGE | `packages/beap-pod/pod-remote-edge.yaml` |
| LOCAL_VERIFY | `packages/beap-pod/pod-local-verify.yaml` |

### 1.2 Pod becomes the validator-of-record

Move the canonical depackage + validate + seal pipeline OUT of Electron main and the extension sandbox and INTO the pod. Electron becomes a thin client: it hands raw input to the pod, receives sealed output, writes to SQLite.

What moves into the pod:
- `packages/ingestion-core/*` (already portable)
- Host depackage logic from `electron/main/beap/decryptQBeapPackage.ts` *(retired in Phase 1)*
- 6-gate sandbox pipeline logic from `apps/extension-chromium/src/beap-messages/services/depackagingPipeline.ts` *(ported to pod depackager; extension path remains for Phase 1.5)*
- HMAC seal computation from `electron/main/validator-process/index.ts` *(retired in Phase 1)*
- `/depackage` endpoint is real *(Phase 1)*

What stays in Electron / extension:
- UI and rendering
- IPC routing, settings, P2P transport
- SQLite writes (pod returns a sealed payload; Electron only inserts it)
- SSO session and vault VMK derivation
- The sandbox depackager survives **only** as a defense-in-depth path for legacy email decryption while the migration completes; new traffic goes pod-only

Why this is the right move:
- One canonical rule enforcement site, not three runtimes
- Auditable: one image, one source of truth for all containers
- Updates are atomic image bumps that propagate to every container in the pod
- Attack surface narrows from "Electron main + fork + extension sandbox" to **a set of containers each with minimal capabilities, dropped privileges, and no access to the others' secrets**
- Same image works locally and remotely — the wizard story is "deploy this pod elsewhere"

### 1.3 Pod composition — separate containers per role

The pod is a podman pod (shared network/PID namespace group) containing one container per role. Each container runs the same image with `BEAP_ROLE` set to its role and exposes only its own HTTP endpoint on the pod's loopback network.

**Containers and responsibilities**

| Container | Owns | Exposes | Talks to |
| --- | --- | --- | --- |
| `ingestor` | nothing sensitive | `/ingest` on `127.0.0.1:18100` | `validator` (+ `verifier` in LOCAL_VERIFY) |
| `validator` | nothing sensitive | `/validate` on `127.0.0.1:18101` | `depackager` |
| `depackager` | depackage workspace (tmpfs) | `/depackage` on `127.0.0.1:18102` | `sealer` or `certifier` |
| `sealer` | **HMAC seal key** (in memory only) | `/seal` on `127.0.0.1:18103` | nothing outbound |
| `certifier` | **Ed25519 private key** (in memory only) | `/certify` on `127.0.0.1:18104` | nothing outbound |
| `verifier` | attested edge public keys | `/verify-cert` on `127.0.0.1:18105` | nothing outbound |

Only the `ingestor` accepts traffic from outside the pod. All other containers are loopback-only inside the pod's namespace. The image's entrypoint is a small dispatcher:

```sh
#!/bin/sh
case "${BEAP_ROLE}" in
  ingestor)   exec node /app/packages/beap-pod/dist/roles/ingestor.js ;;
  validator)  exec node /app/packages/beap-pod/dist/roles/validator.js ;;
  depackager) exec node /app/packages/beap-pod/dist/roles/depackager.js ;;
  sealer)     exec node /app/packages/beap-pod/dist/roles/sealer.js ;;
  certifier)  exec node /app/packages/beap-pod/dist/roles/certifier.js ;;
  verifier)   exec node /app/packages/beap-pod/dist/roles/verifier.js ;;
  *) echo "Unknown BEAP_ROLE: ${BEAP_ROLE}" >&2; exit 1 ;;
esac
```

**Hardening per container** (default for all; some get tighter)

- Non-root UID per role (e.g. uid 10100..10105) — separate uids so a container escape on one role does not yield filesystem access on another's volumes
- `--read-only` root filesystem
- `--cap-drop=ALL`, no added capabilities
- `--security-opt=no-new-privileges`
- Seccomp profile per role; the **sealer** and **certifier** get the tightest profile (essentially read/write/futex/exit only)
- Memory and CPU limits per container
- No outbound network on `sealer`, `certifier`, `verifier` (egress-deny)
- `tmpfs` for any scratch space in `depackager`; no persistent volumes there

**The security property this buys**

The HMAC seal key lives only inside the `sealer` container's memory. The Ed25519 private key lives only inside the `certifier` container's memory. A parser bug in the `depackager` cannot directly read either key — the attacker would have to escape the depackager container *and* break into another container that runs as a different uid with different capabilities and a stricter seccomp profile. That is a substantially higher bar than "compromise the validator process and you have everything".

**Inter-container communication**

Loopback HTTP inside the pod's network namespace. Each container has a short shared secret (rotated at pod start) it includes as a `X-Pod-Auth` header, so a foothold elsewhere on the host cannot just call the sealer directly even if it can reach 127.0.0.1 — the secret is only known inside the pod. The secret is injected as an env var by the wizard/pod-supervisor at pod start; never written to disk. Implemented in `packages/beap-pod/src/shared/podAuth.ts`.

(Unix domain sockets on a shared volume are a stricter alternative — no TCP at all between containers — but HTTP is simpler for Phase 1 and the namespace isolation does most of the work. Reconsider sockets if the threat model demands it later.)

**Image build**

One `Containerfile` produces one image. The image has all role binaries baked in; the dispatcher selects one at runtime. Pros: one image to sign, one digest to pin, one CI build. Cons: slightly larger image. The trade is correct at this scale.

### 1.4 What this pod is NOT

To avoid the confusion the existing `packages/relay-server/Dockerfile` invites: this strategy concerns **only** the ingestor/validator/depackager pod. The relay server and coordination service are **separate systems** with separate concerns:

| System | Repo path | Concern | Containerization |
| --- | --- | --- | --- |
| Ingest pod (this work) | `packages/beap-pod/` | Validate untrusted inbound messages | Multi-container podman pod described above |
| Relay server | `packages/relay-server/` | Peer transport / message relay between users | Its own image, its own lifecycle, untouched here |
| Coordination service | `packages/coordination-service/` | Higher-level peer coordination | Its own image, its own lifecycle, untouched here |

There is **no shared container** between these systems. No shared image. No shared keys. The wizard does not deploy the relay server. The supervisor does not monitor the relay server. If you later want similar treatment for the relay server, that is a separate design exercise.

The audit's repo orientation showed both packages; this distinction was glossed in the first draft. It matters because the threat models and trust boundaries are different: the ingest pod handles untrusted inbound bytes from arbitrary peers, while the relay server forwards already-packaged BEAP messages between authenticated peers.

---

## 2. Trust model and certificate design

### 2.1 What the cert is, and what it is not

The certificate is a **gate**, not a substitute for validation. The local pod always runs the full pipeline. The cert tells the local pod: "these bytes survived a remote pod that you, the SSO-authenticated user, own." It does not tell the local pod the bytes are safe.

This is the security property that defeats parser-knockout and DoS attacks: an attacker who exhausts or crashes the remote edge cannot produce a valid certificate, and the local pod refuses the message. The host orchestrator therefore never processes attacker-controlled bytes through a broken edge.

### 2.2 Certificate format

Implemented in `packages/beap-cert/` (`@repo/beap-cert`):

```jsonc
{
  "v": 1,
  "package_hash": "sha256:...",
  "capsule_canonical_hash": "sha256:...",   // post-validator-normalization
  "validation_result_digest": "sha256:...", // hash of canonical validation result JSON
  "edge_pod_id": "uuid",
  "issued_at": "2026-05-24T10:00:00Z",
  "expires_at": "2026-05-25T10:00:00Z",     // 24h default, configurable
  "sso_attestation": "<keycloak-signed JWT binding edge_pod_id to sub>",
  "edge_signature": "ed25519:..."           // over all fields above except itself
}
```

### 2.3 Acceptance rule (LOCAL_VERIFY)

```
accept(cert) iff
  ed25519_verify(cert.edge_signature, edge_public_key)
  AND keycloak_verify(cert.sso_attestation)
  AND cert.sso_attestation.sub == local_sso_session.sub
  AND cert.sso_attestation.pod_id == cert.edge_pod_id
  AND now() < cert.expires_at
  AND cert.package_hash == sha256(received_bytes)
  AND cert.capsule_canonical_hash == sha256(canonicalize(local_validation.capsule))
```

Implemented in `packages/beap-pod/src/roles/verifier.ts` with shallow (pre-validator) and deep (post-validator) passes.

### 2.4 Why this composition

- `package_hash` binds the cert to the raw bytes. Transit tampering invalidates it.
- `capsule_canonical_hash` binds the cert to the **shape** after normalization. A semantically-equivalent but byte-different replay still fails verification on the local pod's own validator output.
- `sso_attestation` is a Keycloak-signed JWT obtained at deploy time (and on rotation). It binds the edge pod's public key to the user's `sub`. The trust anchor is the IdP, not the edge pod itself.
- `expires_at` bounds replay if a key leaks. 24 h default.
- Re-running the full validator after verification means the cert is never "load-bearing" alone.

### 2.5 Edge key lifecycle

- Generated in the **wizard** (Phase 4) or dev CLI today, in the Electron process — not on the VM
- Public key sent to Keycloak with the user's fresh token to obtain the attestation JWT
- Private key encrypted to a key derived from the user's vault VMK, then delivered to the VM as a one-shot deploy bundle (over SSH or as cloud-init `user-data`)
- Rotation: "Rotate edge keys" button in the dashboard runs the same flow with a new keypair; old cert still valid until its TTL expires

**Phase 3 implementation:** `apps/electron-vite-project/electron/main/edge-tier/` — keygen, VMK-encrypted key storage, JWKS cache, attestation via OAuth 2.0 token exchange (RFC 8693); dev stub via `BEAP_ATTESTATION_STUB=1`. CLI: `apps/electron-vite-project/scripts/edge-cli.ts`.

This keeps key ownership with the user. A VM compromise costs them this one edge's identity, not their broader SSO identity, and they can rotate from the desktop.

---

## 3. Deployment topologies

### 3.1 Free tier

```
[Electron / extension]
    │
    │ HTTPS localhost → ingestor only
    v
┌──────────────────────────────────────── Pod (LOCAL_HOST) ─────┐
│  [ingestor] → [validator] → [depackager] → [sealer]          │
│   18100        18101          18102          18103           │
│                                                              │
│  All loopback in pod netns. sealer holds HMAC key in memory. │
└──────────────────────────────────────────────────────────────┘
    │
    │ sealed payload
    v
[SQLite inbox]
    │
    v
[AI analysis frame on host, post-seal]
```

Single local pod, supervised by Electron, restarted automatically by podman quadlet on per-container crash. The user sees no containers; the pod just runs.

### 3.2 Paid tier

```
   Inbound BEAP / email
            │
            v
┌───────────────────────── Pod (REMOTE_EDGE) on user Linux VM ──┐
│  [ingestor] → [validator] → [depackager] → [certifier]       │
│                                              │               │
│                                              v               │
│                                       Ed25519 signature      │
└──────────────────────────────────────────────┬───────────────┘
            (1..N replicas on separate VMs)    │
            │ returns depackaged_payload + edge_certificate
            v (TLS, optionally WireGuard)
   [pod-client in Electron]
            │ HTTPS localhost → ingestor only
            v
┌──────────────────────────── Pod (LOCAL_VERIFY) on user machine ┐
│  [ingestor] → [verifier] → [validator] → [depackager] → [sealer]│
│                  │                                              │
│                  └─ rejects on cert failure → quarantine        │
└─────────────────────────────────────────────────────────────────┘
            │
            v
   [SQLite inbox]
            │
            v
   [AI analysis frame on host]
```

The local pod treats edge output as untrusted bytes — it just gets a free attestation that an SSO-bound peer also looked at them, *and* the certifier and verifier keys live in their own containers so a compromise of the ingestor or depackager cannot mint or accept rogue certs.

**Phase 3 routing:** `@repo/pod-client` two-hop ingest (edge → local with `edge_certificate`); `fallback_policy: reject` default; single replica (Phase 5 adds health-aware round-robin).

### 3.3 Why two layers + per-role isolation buy real security

| Attack | Single-pod outcome | This design's outcome |
| --- | --- | --- |
| Parser bug in depackager (e.g. zip bomb, malformed MIME) | Compromises local validator and key material | Container escape required to reach sealer/certifier; both have stricter seccomp + different uid |
| Remote DoS against edge | Local validator exposed | No cert produced → local verifier refuses → host untouched |
| Stolen edge signing key | Forge cert | Local verifier still validates; key rotation revokes via attestation expiry; key was only in `certifier` container memory |
| MITM between edge and local | Tamper in transit | `package_hash` mismatch → reject |
| Compromised local desktop | Total | Edge cert is independent verification trail; auditable |
| Process-level memory disclosure in ingestor | Reads HMAC seal key | HMAC key never in ingestor's address space; only `sealer` holds it |

The cert is not magic. It composes with the validator. If both have the same bug, the user gets no extra defense from this layer for that specific bug. The protection is against transit, key-binding, DoS, and **lateral movement within the pipeline** — exactly the threats high-assurance customers care about.

---

## 4. Wizard design

Wizard goal: a paid user with a Linux VPS deploys their first edge pod in under five minutes and trusts the result. **Provider-agnostic** — any Linux VPS with root SSH access works (Hetzner, OVH, DigitalOcean, self-hosted, a Raspberry Pi, anything). The wizard does not integrate with any provider API, does not store provider tokens, does not recommend or prefer any host. The user brings the VM; the wizard does the rest over SSH.

**Platform scope:** wizard deploys to Linux VMs only. Other server platforms (BSD, Windows Server) are out of scope. The wizard verifies the target is a supported Linux distribution before proceeding.

**Phase 3 interim:** manual deploy via `podman play kube` + `edge-cli.ts`; dev status UI in `EdgeTierAdminPanel.tsx`. Full wizard is Phase 4.

### 4.1 Six steps

**Step 1 — Re-authenticate.** Fresh Keycloak token (short `max_age`). Plan claim (`wrdesk_plan`) checked.

**Step 2 — Provide the VM.** User enters:
- Host (IP or DNS)
- SSH port (default 22)
- Username (default `root`; the wizard requires root or equivalent passwordless sudo)
- SSH private key (file picker, with passphrase field if encrypted)

The wizard does NOT provision VMs, does NOT call provider APIs, does NOT store provider credentials of any kind. The user is responsible for having a Linux VPS they can SSH into. How they got it is their business.

**Step 3 — Probe and prepare.** The wizard SSHes to the target and:
- Detects the Linux distribution (supports Debian/Ubuntu/Fedora/RHEL family at launch; refuses unsupported distros with a clear message)
- Checks for Podman; installs it via the distro's package manager if missing
- Verifies the user has root or passwordless sudo
- Reports back what it found and what it intends to install
- Asks for confirmation before any installation step

**Step 4 — Replica count (1 / 2 / 3).** Inline explanation: "Each replica is an independent edge pod on its own VM. If one is attacked or down, the others keep validating. Most users pick 2."

If the user picks more than one replica, they go through Step 2 and Step 3 once per replica. The wizard does not assume multiple replicas live on the same provider or in the same region.

**Step 5 — Generate identity and deploy.** Wizard generates the edge's Ed25519 keypair in Electron. Public key → Keycloak → attestation JWT. Private key encrypted to a vault-derived key, sealed into a one-shot deploy bundle that is transferred over SSH and injected only into the `certifier` container's environment at pod start, never written to the VM's disk. Live log stream: SSH connection, Podman install (if needed), image pull, pod assembly (one line per container as it comes up), health check across all containers. Failure modes have human-readable retry steps.

**Step 6 — Verify and switch over.** Wizard sends a synthetic BEAP message through the new edge, verifies the cert locally, then flips the routing flag. Reversible.

### 4.2 Status dashboard

Always-on view in Electron:

- Replicas list — host, health, cert issuance rate, last cert timestamp
- Per-replica actions — view logs, restart, redeploy, remove
- Global actions — "Rotate edge keys", "Add replica", "Pause edge tier" (with downgrade warning)
- Last 50 cert verifications with status (verified / rejected / why)

**Phase 3 partial:** dev `EdgeTierAdminPanel` shows edge tier status + last 50 verifications (read-only). Full dashboard is Phase 4.

### 4.3 Wizard-mode flag

A single Electron-side setting toggles paid-tier behavior:

```json
{
  "edge_tier": {
    "enabled": true,
    "replicas": [...],
    "fallback_policy": "reject",
    "key_rotation_interval_days": 90
  }
}
```

Persisted to `edge-tier-settings.json`. When `enabled=false`, Electron starts a `LOCAL_HOST` pod. When `enabled=true`, Electron starts a `LOCAL_VERIFY` pod and routes through edge first. Switching is atomic and reversible.

---

## 5. Self-healing and load balancing

A small supervisor in `packages/pod-supervisor/` inside Electron. Not Kubernetes. K8s for at-most-three-replicas-per-user is overkill and a maintenance tax. **Not yet implemented — Phase 5.**

### 5.1 Self-heal

- Each container in the pod has `RestartPolicy=on-failure` in the pod's quadlet / `podman play kube` manifest. Process crashes are handled at the podman level out of the box.
- The whole pod has a single readiness gate that aggregates all containers' `/ready` — pod is ready only when every container is ready.
- Supervisor health-pings every 5 s, hits each container's `/health`. Three consecutive misses on any container → mark replica unhealthy.
- Unhealthy → first try restarting just the failing container; if that fails twice → redeploy the whole pod on the VM from the stored deployment manifest. For remote replicas this means re-running the SSH bootstrap path with stored credentials. If credentials are no longer valid, surface to the user — don't store anything that survives without the user's blessing.

### 5.2 Load balancing (`packages/pod-client/`)

- Round-robin across healthy edge replicas, default
- Optional least-connections for latency-sensitive customers
- Per-replica circuit breaker: 5 consecutive failures → 60 s quarantine
- Hedged requests for paid tier: send to two edges in parallel, take the first valid cert. Costs 2× requests, halves p95 latency. Default off.

**Phase 3:** single replica only; `PodEdgeUnreachableError` when edge down and `fallback_policy=reject`.

### 5.3 Fallback policy — **default to reject**

If 0 healthy edge replicas:

- **Reject** (default): quarantine the message, alert the user, do not write to inbox.
- **Downgrade with badge** (opt-in): write to inbox with a visible "validation downgraded" badge, recorded in `ai_analysis_json` and audit log.

Default-reject is correct for high-assurance customers: silently downgrading erases the security property they're paying for, without their knowledge. The wizard asks once during setup.

### 5.4 What this is not

- Not a scheduler. Replicas are configured by the wizard, not autoscaled.
- Not a service mesh. mTLS between local and edge is enough.
- Not a control plane. Each user owns their replicas; Anthropic does not.

Keeping these out of scope is the "efficient complexity" you asked for.

---

## 6. AI analysis enhancement

Two additions to `ai_analysis_json`. Both plug into existing seams identified in the audit (§9). Both run **after** the seal — they enrich the row, they do not gate ingest. The validator stays deterministic; AI stays advisory.

**Status:** ✅ shipped in Phase 2.

### 6.1 Phishing risk score

Hook: `inbox:aiAnalyzeMessage` and `inbox:aiAnalyzeMessageStream` in `electron/main/email/ipc.ts`.

New `ai_analysis_json` field:

```jsonc
"phishing_assessment": {
  "score": 0,                   // 0..100, higher = riskier
  "label": "low" | "elevated" | "high",
  "signals": [
    { "kind": "domain_lookalike", "evidence": "...", "weight": 0.3 },
    { "kind": "credential_request", "evidence": "...", "weight": 0.5 }
  ],
  "flagged_urls": [
    { "url": "...", "reason": "...", "open_policy": "sandbox_only" }
  ],
  "disclaimer_version": "v1",
  "model": "...",
  "generated_at": "..."
}
```

UI:
- Inbox row badge for elevated/high
- Detail panel listing flagged signals and URLs
- **Persistent disclaimer** in every detail panel: *"AI phishing analysis can miss attacks. Open links only via the sandbox orchestrator. Do not enter credentials based on email contents."*

Link policy: in the renderer, intercept link clicks on AI-analyzed messages and route through a modified `safeLinks.ts` that:
- requires confirmation to open
- defaults the open target to the sandbox orchestrator (existing infrastructure)
- shows the resolved final URL after redirects
- never opens credential-request flagged URLs without an extra acknowledgment

### 6.2 Validation cross-check

Hook: same handler, post-validate.

```jsonc
"validation_crosscheck": {
  "agrees_with_validator": true,
  "findings": [
    { "kind": "urgency_pressure", "evidence": "..." },
    { "kind": "sender_display_mismatch", "evidence": "..." }
  ],
  "confidence": "low" | "medium" | "high",
  "model": "...",
  "generated_at": "..."
}
```

When AI disagrees with validator (validator passed, AI flags) → row gets a `needs_review` UI state. User sees both signals and decides. Never auto-rejects a structurally valid message based on AI alone — the validator is canon; AI advises.

### 6.3 Validator-side support

Extend `validateAiAnalysisField()` in `contentValidator.ts` to require the new fields and validate their shape. This is the existing structural validation seam — no new plumbing.

### 6.4 Free vs paid

Both analyses run for free and paid tiers. The certification layer is the paid-tier differentiator. Phishing/scam protection should reach every user — that's a baseline duty of care, not a tier feature.

---

## 7. Phased implementation

Total ~8–9 weeks of focused work. Phases 1–3 delivered significant security uplift; Phases 4–6 remain.

### Phase 1 — Pod becomes the hot path ✅ SHIPPED (2026-05)

**Status:** complete on `phase-1/pod-becomes-hot-path`, commits P1.0–P1.12. Held on branch pending repo-owner review before any upstream merge.

**What shipped:**

- Multi-container pod manifest (`packages/beap-pod/pod.yaml`) with four containers for LOCAL_HOST: ingestor, validator, depackager, sealer
- Single `Containerfile` with role dispatcher entrypoint
- Per-role binaries built from `packages/ingestion-core/` plus newly-extracted depackager and sealer code
- Role services implemented:
  - `ingestor` (HTTP frontend; calls validator)
  - `validator` (ported `validator.ts` + `contentValidator.ts`; calls depackager)
  - `depackager` (ported `decryptQBeapPackage` + 6-gate logic; calls sealer)
  - `sealer` (HMAC seal; holds key from startup IPC)
- Inter-container `X-Pod-Auth` shared-secret middleware
- `packages/pod-client/` in Electron replaces direct `validatorOrchestrator` and `decryptQBeapPackage` calls
- `MAX_STRING_LENGTH` and `ALLOWED_CONTENT_TYPES` gaps closed in validator
- HTML sanitization in depackager
- CI builds the single image and runs the multi-container smoke test on Linux (`.github/workflows/pod.yml`)
- Old in-process paths (`validator-process/`, `decryptQBeapPackage.ts`) deleted; `WR_POD_HOT_PATH` flag removed
- **Cross-platform local pod:** Linux-only platform guard removed; runtime Podman feature-detect (`podmanDetect.ts`) — PATH check + running podman machine on Windows/macOS; actionable desktop notification when unavailable (`Fix: af00fccc`)

**Note on platform support:** Phase 1 originally guarded the Electron local-pod runner against non-Linux hosts based on a wrong assumption about Podman. That guard is **removed** — the runner now feature-detects Podman on every desktop platform (Linux native; Windows/macOS via Podman Desktop). There are no platform-specific code paths in the pod image or role binaries.

**Scope gap discovered during Phase 2:** the Chrome extension still depackages independently via its own sandbox + `mergeExtensionDepackaged`. Phase 1 migrated Electron's ingestion but not the extension's `importPipeline`. Addressed by Phase 1.5 below.

### Phase 1.5 — Extension pod-client migration (deferred; ~1 week when picked up)

Origin: Phase 2 P2.8 audit found four call sites in the extension's import pipeline that still depend on `sandboxDepackage` / `mergeExtensionDepackaged`. All were category (b) "preserve for now" because there is no extension-side pod-client. The pod is the depackager-of-record for Electron-side traffic but not yet for extension-driven .beap file imports.

Scope:
- Audit findings already documented in TODO(phase-1.5) markers at the four call sites and in `apps/extension-chromium/src/beap-messages/sandbox/index.ts` module header
- Build an extension-side pod-client (parallels `packages/pod-client/` but works inside the extension's runtime constraints; no Node APIs)
- Migrate the four call sites:
  - `POST /api/inbox/merge-depackaged` HTTP handler (`electron/main.ts`)
  - `drainExtensionMergeBuffer` (`electron/main.ts`)
  - `sandboxDepackage()` in `verifyImportedMessage` (`importPipeline.ts`)
  - `verifyImportedMessage()` in `processPendingP2PBeapQueue` (`pendingP2PBeapQueue.ts`)
- Once migrated, delete `apps/extension-chromium/src/beap-messages/sandbox/` and related files
- Keep the extension's sandbox isolation primitive for unrelated features; only the depackager goes

Exit criteria: extension .beap file imports and P2P arrivals route through the pod; no remaining call sites of `sandboxDepackage` or `mergeExtensionDepackaged`.

When to do this: before Phase 4 if you want "pod is the only depackager" to be a complete property before the wizard; after Phase 4 if extension import traffic is low-volume and wizard urgency is higher. Either order works.

### Phase 2 — AI analysis enhancement ✅ SHIPPED (2026-05)

**Status:** complete on `phase-1/pod-becomes-hot-path`, commits P2.0–P2.8. Same branch as Phase 1.

**What shipped:**

- `ai_analysis_json` schema extended with `phishing_assessment` and `validation_crosscheck` (validated server-side)
- Phishing scoring module with provider-agnostic structured output
- Validation cross-check module
- Both wired into `inbox:aiAnalyzeMessage` IPC handlers, running after seal
- UI badges (elevated/high/needs_review), detail panel with persistent disclaimer
- User-selectable AI provider with tier defaults (free → Ollama, paid → cloud)
- `safeLinks.ts` confirmation modal with sandbox-orchestrator-default open policy
- P2.8 (sandbox depackager retirement): audited; all four call sites were category (b); deferred to Phase 1.5 with TODO markers

Exit criteria met: every analyzed message has both new fields when analysis succeeds; UI surfaces them; AI failure does not block sealing; link clicks route through confirmation.

### Phase 3 — Certification ✅ SHIPPED (2026-05-24)

**Status:** complete on `phase-1/pod-becomes-hot-path`, commits P3.0–P3.10. Same branch as Phases 1–2.

**What shipped:**

- **`@repo/beap-cert`** — certificate types, canonical serialization, Ed25519 sign/verify, hash helpers (`package_hash`, `capsule_canonical_hash`, `validation_result_digest`)
- **REMOTE_EDGE manifest** (`pod-remote-edge.yaml`) — ingestor → validator → depackager → certifier; `/certify` on :18104
- **LOCAL_VERIFY manifest** (`pod-local-verify.yaml`) — ingestor → verifier → validator → depackager → sealer; `/verify-cert` on :18105
- **Certifier role** — POST `/certify`, holds Ed25519 private key in memory, signs via `@repo/beap-cert`
- **Verifier role** — POST `/verify-cert`, full §2.3 acceptance rule (8 reason codes), shallow + deep passes; JSON audit line per verification to stdout
- **Ingestor POD_MODE branching** — LOCAL_HOST unchanged; LOCAL_VERIFY shallow→validate→deep→seal; REMOTE_EDGE returns `{ depackaged_payload, certificate }`
- **Electron edge-tier** (`electron/main/edge-tier/`) — settings, keygen, VMK-encrypted key storage, JWKS cache, SSO attestation via token exchange (RFC 8693); `edge-cli.ts` for dev/manual deploy
- **LOCAL_VERIFY mode switching** — `edge_tier.enabled` toggles `pod.yaml` ↔ `pod-local-verify.yaml`; pod restart on settings change
- **`@repo/pod-client` edge routing** — two-hop ingest (edge → local with `edge_certificate`); `PodEdgeUnreachableError`; single replica; default `fallback_policy: reject`
- **Audit trail + dev UI** — verifier log tailer, IPC status/verifications, `EdgeTierAdminPanel` (last 50 verifications)
- **Manual E2E procedure** — [`phase-3-manual-test.md`](phase-3-manual-test.md)

Exit criteria met: round-trip cert flow works manually; no wizard yet (Phase 4).

**Not in Phase 3:** setup wizard, replica failover/LB, telemetry export.

### Phase 4 — Wizard (2 weeks)

- SSH-based bring-your-own-VM path (the only path; no provider integrations)
- Distro detection and Podman installation over SSH (`/etc/os-release` probe)
- Six-step wizard UI (§4.1)
- Status dashboard with replica list, cert verification log, rotation control (extends Phase 3 dev panel)
- Synthetic test message and verification step

Exit criteria: a paid user with a Linux VPS they brought themselves can deploy an edge and route traffic through it from the wizard alone.

### Phase 5 — Supervisor / self-heal / load balance (1 week)

- Health probes and unhealthy detection
- Round-robin client; circuit breaker
- Redeploy on failure for remote replicas
- Fallback policy with badge

Exit criteria: killing a replica triggers redeploy; killing all replicas triggers configured fallback.

### Phase 6 — Polish (1 week)

- User-facing setup guide; updated threat model
- Telemetry (opt-in, no message content)
- Backup/restore of wizard state (replica list + encrypted keys; user can move to a new desktop)
- Documentation of the cert verification path so external auditors can read it

---

## 8. What this does NOT solve

Be honest about residual risk so the docs match reality:

- **Shared-bug attacks.** If the validator has a logic bug, edge and local both have it. Cert doesn't help. Mitigation: keep the validator small, well-tested, fuzzed.
- **Compromised local desktop.** If the user's machine is fully owned, the local pod is owned too. Cert verification then runs in attacker context. Mitigation: outside this system; rely on the cert audit trail for forensics.
- **Keycloak compromise.** The whole trust chain anchors there. Mitigation: the same anchor SSO has always relied on; no worse than today.
- **Hostile pod operator.** A user could intentionally run a backdoored edge image. Mitigation: image digest pinning + reproducible builds, with the wizard refusing to deploy non-canonical images. Provenance for paranoid customers via Sigstore later.

---

## 9. Decisions confirmed

These were open before Phase 1; resolutions recorded here and in phase trackers.

| # | Decision | Resolution |
| --- | --- | --- |
| 1 | Extension sandbox depackager | Retire for new BEAP traffic via pod; keep for legacy email until Phase 1.5 completes |
| 2 | Single image vs per-role images | **One image, six entrypoints** (§1.3) — implemented |
| 3 | Inter-container transport | **Loopback HTTP + `X-Pod-Auth`** for Phase 1–3; Unix sockets deferred |
| 4 | VM target requirements | Wizard supports any Linux VPS with root SSH access. **Supported distros at launch:** Debian/Ubuntu/Fedora/RHEL family. Arch, Alpine, openSUSE out of scope at launch — Phase 4 |
| 5 | Distro detection method | **Parse `/etc/os-release` over SSH**; refuse unsupported distros with a clear error — Phase 4 |
| 6 | Certificate TTL | **24 h default**; user-settable in Phase 4 wizard |
| 7 | Fallback policy default | **`reject`** — implemented in `@repo/pod-client` and edge-tier settings |
| 8 | AI provider for paid tier | User-selectable; tier defaults (free → Ollama, paid → cloud) — shipped Phase 2 |
| 9 | Telemetry | Opt-in only; aggregate metrics without message content — Phase 6 |
| 10 | Relay server / coordination service | **Out of scope** — unchanged |
| 11 | Keycloak attestation mechanism | **OAuth 2.0 token exchange (RFC 8693)**; dev stub `BEAP_ATTESTATION_STUB=1` — Phase 3 |
| 12 | Wizard provider integration | **None.** No provider APIs, no stored tokens, no one-click provisioning. User brings VM; wizard deploys over SSH only — Phase 4 |
| 13 | Local desktop pod platform | **Podman feature-detect on all desktop OSes**; no Linux-only guard — shipped (`Fix: af00fccc`) |

---

## 10. Files / packages this strategy creates or substantially changes

**New (implemented):**

| Path | Purpose |
| --- | --- |
| `packages/beap-pod/src/roles/ingestor.ts` | Ingestor container entrypoint |
| `packages/beap-pod/src/roles/validator.ts` | Validator container entrypoint |
| `packages/beap-pod/src/roles/depackager.ts` | Depackager container entrypoint |
| `packages/beap-pod/src/roles/sealer.ts` | Sealer container (HMAC key) |
| `packages/beap-pod/src/roles/certifier.ts` | Certifier container (REMOTE_EDGE, Ed25519 key) |
| `packages/beap-pod/src/roles/verifier.ts` | Verifier container (LOCAL_VERIFY) |
| `packages/beap-pod/src/shared/podAuth.ts` | `X-Pod-Auth` middleware |
| `packages/beap-pod/pod.yaml` | LOCAL_HOST manifest |
| `packages/beap-pod/pod-remote-edge.yaml` | REMOTE_EDGE manifest |
| `packages/beap-pod/pod-local-verify.yaml` | LOCAL_VERIFY manifest |
| `packages/beap-pod/entrypoint.sh` | Role dispatcher |
| `packages/beap-cert/` | Certificate format library (`@repo/beap-cert`) |
| `packages/pod-client/` | HTTP client for pod ingestor (+ edge routing) |
| `apps/electron-vite-project/electron/main/edge-tier/` | Edge-tier settings, key storage, JWKS, attestation |
| `apps/electron-vite-project/electron/main/local-pod/` | Local pod lifecycle (Podman feature-detect, manifest apply, mode switch) |
| `apps/electron-vite-project/electron/main/local-pod/podmanDetect.ts` | Runtime Podman PATH + machine checks |
| `apps/electron-vite-project/electron/main/local-pod/notify.ts` | Desktop notification when pod cannot start |
| `apps/electron-vite-project/scripts/edge-cli.ts` | Dev/manual edge deploy CLI (SSH to Linux targets) |
| `apps/electron-vite-project/src/components/EdgeTierAdminPanel.tsx` | Dev status + verification audit UI |

**New (planned):**

| Path | Phase |
| --- | --- |
| `packages/pod-supervisor/` | Phase 5 |
| `packages/wizard/` (or feature-flagged area in electron app) | Phase 4 |

**Substantially changed:**

- `packages/beap-pod/Containerfile` — single image with all role binaries
- `packages/ingestion-core/` — `MAX_STRING_LENGTH`, `ALLOWED_CONTENT_TYPES` enforced
- `apps/electron-vite-project/electron/main/ingestion/ingestionPipeline.ts` — pod + edge routing
- `apps/electron-vite-project/electron/main/email/ipc.ts` — AI analysis hooks
- `apps/electron-vite-project/src/utils/safeLinks.ts` — sandbox-orchestrator link policy

**Retires (after migration window):**

- Extension sandbox depackager for new traffic *(Phase 1.5)*
- Inline `decryptQBeapPackage` in Electron main *(done — Phase 1)*
- `validator-process` forked subprocess *(done — Phase 1)*

**Explicitly NOT changed:**

- `packages/relay-server/` — out of scope
- `packages/coordination-service/` — out of scope

This is a large but linear refactor. Tests already cover the behaviors that move; they migrate alongside the code into their respective role containers.
