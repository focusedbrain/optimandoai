# Phase 5 Tracker — Supervisor / Replace-Not-Restart / Quarantine

> **Phase 5 commits land on `phase-1/pod-becomes-hot-path`. Branch name is historical.**

Branch: `phase-1/pod-becomes-hot-path`  
Strategy ref: `docs/architecture/beap-high-assurance-strategy.md` (§5 — **Phase 5 supersedes original §5 self-heal design**)  
Phase 4.5 ref: `docs/architecture/phase-4-5-tracker.md`  
Threat model ref: `docs/architecture/credential-security-threat-model.md`  
Builds on: P4.5.8 VM reboot recovery / supervisor poll scaffolding

**Do not merge to `main`** until downstream phases sign off.

---

## Hard rules

1. **Replace, never restart.** When a BEAP pod container fails, destroy it (`podman rm -f`) and respawn from the immutable image. The same container instance never carries state forward. If you find yourself writing `podman restart`, stop. The only state that crosses the boundary is **queue position**.

2. **Quarantine, never skip.** When a message causes a container to fail, preserve that message in an edge quarantine area. The fetch loop resumes from the **next** message. The crash-causing message is **not** silently dropped. Users must see in the dashboard that a quarantined message exists.

3. **Hardened report schema only.** Diagnostic reports may contain only: enumerated values from trusted code (exception class, stage), file paths and line numbers from code symbols, numeric system metrics, message hash, message size, IMAP-attested envelope fields (`from`, `to`, `date`), and allowlist-filtered subject line. Reports may **not** contain: exception `.message` strings, header bytes parsed from message body, body content, or other attacker-influenced fields.

4. **Sandbox routes the report.** Dashboard shows existence/timestamp inline only. Full report opens in the sandbox orchestrator. No exceptions.

5. **AI is advisory, validator is canon, cert is a gate not a substitute** — every prior phase's hard rules still apply.

---

## Strategy §5 deviations (from original beap-high-assurance-strategy.md)

Original §5 assumed Podman `restartPolicy: OnFailure` plus supervisor health pings and optional container/pod redeploy. **Phase 5 supersedes that design:**

| Topic | Original §5 | Phase 5 |
|-------|-------------|---------|
| Container recovery | `restartPolicy: OnFailure`; supervisor may restart failing container | `restartPolicy: Never` on trust-sensitive containers; supervisor **`podman rm -f` + `podman play kube`** per container |
| Failure semantics | Podman restart carries container state forward | **Replace-not-restart** — fresh container from immutable image; only queue position persists |
| Crash-causing mail | Not specified | **Quarantine model** — message preserved; loop advances to next |
| Diagnostics | Not specified | **Hardened report schema** — no exception message strings or body-derived content |
| Report viewing | Not specified | **Sandbox routing** — dashboard inline metadata only |
| Abuse / flapping | Per-replica circuit breaker (§5.2 load client) | **Replacement-budget circuit breaker** on supervisor (P5.7) |

**Current manifests (post–P5.1):** `packages/beap-pod/pod.yaml`, `pod-remote-edge.yaml`, and `pod-local-verify.yaml` use pod-level `restartPolicy: Never` for all trust-sensitive roles — supervisor replaces failed containers (P5.2+).

This deviation is recorded here in P5.0 and reflected in the strategy doc itself in **P5.11**.

---

## Steps

- [x] **P5.0** — Tracker, strategy deviation note, threat-model container-replacement section
- [x] **P5.1** — Pod manifests: `restartPolicy: Never` for trust-sensitive containers
- [x] **P5.2** — Diagnostic report schema, allowlist filtering, signing
- [x] **P5.3** — Role containers generate hardened diagnostic reports on failure
- [ ] **P5.4** — Diagnostic report pickup, transport, and supervisor integration
- [ ] **P5.5** — Crash-message quarantine store; fetch loop resume from next message
- [ ] **P5.6** — Dashboard quarantine indicators (existence + timestamp inline)
- [ ] **P5.7** — Replacement-budget circuit breaker
- [ ] **P5.8** — Sandbox-orchestrated full diagnostic report viewer
- [ ] **P5.9** — Host-initiated nuclear pod reset
- [ ] **P5.10** — End-to-end tests and manual verification recipe
- [ ] **P5.11** — Strategy doc §5 update and phase closeout

---

## Status summary

| Step | State | Commit |
|------|-------|--------|
| P5.0 | ✅ done | `f9f6c287` |
| P5.1 | ✅ done | `8b3864a6` |
| P5.2 | ✅ done | `6cc47e12` |
| P5.3 | ✅ done | `3b7dcd97` |
| P5.4 | ⬜ pending | — |
| P5.5 | ⬜ pending | — |
| P5.6 | ⬜ pending | — |
| P5.7 | ⬜ pending | — |
| P5.8 | ⬜ pending | — |
| P5.9 | ⬜ pending | — |
| P5.10 | ⬜ pending | — |
| P5.11 | ⬜ pending | — |

---

## Phase 5 exit criteria (from strategy, updated for replace-not-restart)

| Criterion | Target |
|-----------|--------|
| Container failure | Failing container destroyed and replaced from image; no `podman restart` on trust-sensitive roles |
| Crash-causing message | Quarantined on edge; fetch resumes at next message; visible in dashboard |
| Diagnostic reports | Hardened schema only; full report viewable only via sandbox |
| Abuse resistance | Replacement-budget circuit breaker stops replacement storms |
| Nuclear reset | Host can wipe and recreate pod state from dashboard |
| Automated tests | Phase 5 vitest green; manual recipe in P5.10 |

---

## Notes & deviations

*(Record in-phase decisions here.)*

### P5.0

- Branch confirmed: `phase-1/pod-becomes-hot-path`, clean working tree, up to date with remote.
- Step titles P5.1–P5.11 scoped from Phase 5 prompt sequence header (replace-not-restart supervisor, quarantine, hardened reports, sandbox routing, nuclear reset). Refine titles when individual prompts are run if the sequence doc differs.
- Threat model: added **Container replacement model** section in `credential-security-threat-model.md` (initial pass; P5.1+ may extend as supervisor lands).
- Baseline pod manifests: all three YAML files still `restartPolicy: OnFailure` until P5.1.

### P5.1

- Pod-level `restartPolicy: Never` in `pod.yaml`, `pod-remote-edge.yaml`, and `pod-local-verify.yaml` (all containers in each pod are trust-sensitive).
- Manifest header comments document supervisor-managed replacement; README sections for LOCAL_HOST, REMOTE_EDGE, and LOCAL_VERIFY note that Podman does not auto-restart.

### P5.2

- `packages/beap-cert/src/diagnosticReport.ts`: `DiagnosticReportV1` schema, envelope allowlist filtering, Ed25519 signing via `canonicalizeStableJson` (same stable JSON rules as message certs).
- Distinct from message certs: `report_v: 1` vs `v: 1`; signature field is `certificate` not `edge_signature`.
- Tests: enum coverage, round-trip verify, filtering edge cases, canonical bytes snapshot.
- Role-side report generation and transport deferred to P5.3/P5.4.

### P5.3

- `packages/beap-pod/src/shared/reportGenerator.ts`: `buildAndWriteReport`, exception classifier (class/kind only, no message strings), writes to `DIAGNOSTIC_REPORTS_DIR` (default `/tmp/diagnostic-reports/`).
- `roleDiagnostic.ts`: HTTP wrapper fail-closed, message watchdog (`StuckHealthProbeError`), health `/health` stuck probe.
- Per-role timeouts in `diagnosticConstants.ts` (depackager 30s, validator 10s, certifier 5s; global 60s ceiling).
- All seven roles wired: ingestor, validator, depackager, sealer, certifier, verifier, mail-fetcher.
- Signing: `DIAGNOSTIC_SIGNING_KEY_HEX` or `EDGE_PRIVATE_KEY_HEX`; certifier uses in-memory edge key.
- Tests: `roleDiagnosticIntegration.test.ts` (all roles + stuck watchdog snapshot); verifier JWT exp fix for clock drift.
