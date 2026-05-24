# Phase 4 Tracker — Edge Deployment Wizard & Status Dashboard

> **Phase 4 commits land on `phase-1/pod-becomes-hot-path`. Branch name is historical.**

Branch: `phase-1/pod-becomes-hot-path`  
Strategy ref: `docs/architecture/beap-high-assurance-strategy.md` (§4 wizard design — six steps, dashboard, settings shape)  
Phase 3 ref: `docs/architecture/phase-3-tracker.md`  
P3.8 building blocks: `apps/electron-vite-project/scripts/edge-cli.ts`, `apps/electron-vite-project/electron/main/edge-tier/`

---

## Hard rules

1. **Provider-agnostic.** The wizard supports any Linux VPS with root SSH access. It does **not** integrate with any provider API, does **not** store provider tokens, does **not** recommend any host, and has **no** one-click VPS path. If a step adds provider integration, stop — that is out of scope for Phase 4.

2. **Edge private key never on VM disk.** Keypair is generated in Electron, encrypted to a vault-derived key, transferred over SSH as part of a one-shot deploy command, and injected only into the `certifier` container environment at pod start. Strategy §2.5 is non-negotiable.

3. **Cert is a gate, not a substitute for validation.** (Carried from Phase 3.) LOCAL_VERIFY always runs the full validator after cert verification.

4. **Do not merge to `main`** until downstream phases sign off.

---

## Steps

- [x] **P4.0** — Confirm branch and create Phase 4 tracker *(this file)*
- [ ] **P4.1** — SSH transport module (`/etc/os-release` distro probe, sudo check, remote exec; no provider APIs)
- [ ] **P4.2** — Wizard scaffold + Step 1 re-authenticate (fresh SSO token, `wrdesk_plan` paid-tier gate)
- [ ] **P4.3** — Step 2 provide-the-VM UI (host, port, username, SSH key file + passphrase; no provider credentials)
- [ ] **P4.4** — Step 3 probe and prepare (distro report, Podman install if missing, user confirm before install)
- [ ] **P4.5** — Step 4 replica count (1/2/3) + per-replica VM credential loop
- [ ] **P4.6** — Step 5 generate identity and deploy (wrap `edge-cli` keygen/register/deploy; live deploy log stream; key off VM disk)
- [ ] **P4.7** — Step 6 verify and switch over (synthetic BEAP through edge, local cert check, enable `edge_tier`)
- [ ] **P4.8** — Status dashboard (replica list, health, per-replica actions, rotation, verification log; extends Phase 3 dev panel)
- [ ] **P4.9** — Phase 4 verification pass + manual test documentation

---

## Status summary

| Step | State | Commit |
|------|-------|--------|
| P4.0 | ✅ done | P4.0: phase 4 tracker |
| P4.1 | ⬜ pending | — |
| P4.2 | ⬜ pending | — |
| P4.3 | ⬜ pending | — |
| P4.4 | ⬜ pending | — |
| P4.5 | ⬜ pending | — |
| P4.6 | ⬜ pending | — |
| P4.7 | ⬜ pending | — |
| P4.8 | ⬜ pending | — |
| P4.9 | ⬜ pending | — |

---

## Phase 4 exit criteria (from strategy §7)

A paid user with a **Linux VPS they brought themselves** can deploy an edge replica and route traffic through it from the wizard alone — no terminal, no provider integration. Status dashboard manages replicas long-term (view, restart, redeploy, rotate keys, pause tier).

**Builds on Phase 3:** `edge-cli.ts` logic (generate-keypair, register-edge, deploy-edge) moves behind wizard UI handlers; `edge-tier/` settings, key storage, attestation, and pod lifecycle remain the backend.

**Not in Phase 4:** replica health-aware load balancing (Phase 5), telemetry export (Phase 6), provider API integrations (explicitly out of scope).

---

## Wizard steps ↔ implementation map

| Strategy §4.1 step | Tracker steps |
| --- | --- |
| Step 1 — Re-authenticate | P4.2 |
| Step 2 — Provide the VM | P4.3 |
| Step 3 — Probe and prepare | P4.1 (SSH module), P4.4 (UI + flow) |
| Step 4 — Replica count | P4.5 |
| Step 5 — Generate identity and deploy | P4.6 |
| Step 6 — Verify and switch over | P4.7 |
| §4.2 Status dashboard | P4.8 |
| End-of-phase verification | P4.9 |

---

## Notes & deviations

*(Record any decisions made differently from the strategy here, with rationale.)*

### P4.0

- Step titles P4.1–P4.9 derived from strategy §4 (six wizard steps + SSH module + dashboard + verification). Titles may be refined when individual prompts are run; deviations will be noted here.
- Phase 3 `edge-cli.ts` is the reference implementation for deploy flows until P4.6 extracts shared library functions the wizard calls directly.
- Phase 3 dev UI (`EdgeTierAdminPanel.tsx`) is read-only; P4.8 promotes it to the full status dashboard per §4.2.
- Supported distros at launch: Debian/Ubuntu/Fedora/RHEL family (strategy §9 decision #4). Probe via `/etc/os-release` over SSH.
